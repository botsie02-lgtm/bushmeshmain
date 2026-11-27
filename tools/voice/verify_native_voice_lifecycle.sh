#!/usr/bin/env bash
set -euo pipefail

apk="$1"
test_apk="$2"
out="$3"
pkg=com.bushmeshmain.radioredesign
runner="$pkg.test/androidx.test.runner.AndroidJUnitRunner"
mkdir -p "$out"

adb shell getprop ro.build.version.sdk | tr -d '\r' | tee "$out/api-level.txt"
grep -qx 36 "$out/api-level.txt"
adb shell input keyevent 82
adb install "$apk"
adb install "$test_apk"

run_test() {
  local class="$1"
  local label="$2"
  adb shell am instrument -w -r -e class "com.bushmeshmain.radio.$class" "$runner" | tee "$out/$label.txt"
  grep -Eq 'OK \([1-9][0-9]* tests?\)' "$out/$label.txt"
  if grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$out/$label.txt"; then exit 1; fi
}

launch() {
  local label="$1"
  adb shell am start -W -n "$pkg/com.bushmeshmain.MainActivity" | tee "$out/$label.txt"
  grep -q 'Status: ok' "$out/$label.txt"
  sleep 5
  test -n "$(adb shell pidof "$pkg" | tr -d '\r')"
}

# Isolated clean emulator. No automatic permission grant, no audio fixture
# or synthetic wake event. Native denial must not activate capture.
launch fresh-launch
run_test VoicePermissionDeniedTest voice-denied
run_test WakeServiceColdStartTest wake-cold-start
adb shell pm grant "$pkg" android.permission.RECORD_AUDIO
run_test VoiceSuspendedRecognitionTest voice-suspended
adb shell pm grant "$pkg" android.permission.POST_NOTIFICATIONS
run_test WakeServiceLifecycleTest wake-service-notification

# Start a real microphone-type FGS with a non-recording fixture in the
# instrumentation process. Verify its ready marker before externally killing
# or revoking it. The force-stop invocation is intentionally not a passing
# instrumentation run; the subsequent cold-start check is the acceptance gate.
interrupt_fixture() {
  local mode="$1"
  adb logcat -c
  timeout 90s adb shell am instrument -w -r -e class com.bushmeshmain.radio.WakeServiceInterruptedProcessTest "$runner" > "$out/wake-$mode-interrupted.txt" 2>&1 &
  local task=$!
  local ready=0
  for i in $(seq 1 80); do
    if adb logcat -d -s BushMeshWakeLifecycle:I '*:S' | grep -q FIXTURE_READY_NO_MICROPHONE; then ready=1; break; fi
    if ! kill -0 "$task" 2>/dev/null; then break; fi
    sleep 0.5
  done
  if [ "$ready" != 1 ]; then
    wait "$task" || true
    cat "$out/wake-$mode-interrupted.txt"
    return 1
  fi
  adb logcat -d -s BushMeshWakeLifecycle:I '*:S' > "$out/wake-$mode-ready.txt"
  if [ "$mode" = force-stop ]; then
    adb shell am force-stop "$pkg"
    wait "$task" || true
    test -z "$(adb shell pidof "$pkg" | tr -d '\r')"
  else
    adb shell pm revoke "$pkg" android.permission.RECORD_AUDIO
    wait "$task" || true
    if [ -n "$(adb shell pidof "$pkg" | tr -d '\r')" ]; then
      adb logcat -d -s BushMeshWakeLifecycle:I '*:S' | tee "$out/wake-revoke-observed.txt"
      grep -q FIXTURE_STOPPED_PERMISSION_LOST "$out/wake-revoke-observed.txt"
    fi
  fi
}
interrupt_fixture force-stop
launch wake-force-stop-relaunch
run_test WakeServiceColdStartTest wake-post-force-stop
interrupt_fixture revoke

# Permission revocation may terminate the process. Relaunch and verify wake
# remains unavailable and recognition denies access without a new grant.
adb shell pm revoke "$pkg" android.permission.RECORD_AUDIO
adb shell am force-stop "$pkg"
launch revoked-launch
run_test VoicePermissionDeniedTest voice-revoked
run_test WakeServiceColdStartTest wake-post-revocation-cold-start
printf '%s\n' 'API36 finite voice lifecycle and synthetic hands-free service notification/stop/cold-start passed. No wake microphone or acoustic detector tested.' | tee "$out/result.txt"
