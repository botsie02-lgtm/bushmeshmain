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
adb shell pm grant "$pkg" android.permission.RECORD_AUDIO
run_test VoiceSuspendedRecognitionTest voice-suspended

# Permission revocation may terminate the process. Relaunch and verify wake
# remains unavailable and recognition denies access without a new grant.
adb shell pm revoke "$pkg" android.permission.RECORD_AUDIO
adb shell am force-stop "$pkg"
launch revoked-launch
run_test VoicePermissionDeniedTest voice-revoked
printf '%s\n' 'API36 permission denial, suspension, revocation and relaunch passed. No recorded-audio wake recognition tested.' | tee "$out/result.txt"
