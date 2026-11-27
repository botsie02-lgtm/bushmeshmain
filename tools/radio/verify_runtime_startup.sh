#!/usr/bin/env bash
set -euo pipefail
apk="$1"
test_apk="$2"
out="$3"
mode="${4:-all}"
case "$mode" in all|ui|native) ;; *) echo "Unknown qualification mode: $mode" >&2; exit 2;; esac
pkg=com.bushmeshmain.radioredesign
runner="$pkg.test/androidx.test.runner.AndroidJUnitRunner"
mkdir -p "$out"
trap 'adb logcat -d -b crash > "$out/smoke-crash-log.txt" || true; adb logcat -d -t 2000 > "$out/smoke-logcat.txt" || true; if [ ! -s "$out/smoke-native-history-scale.txt" ]; then adb logcat -d -s BushMeshHistoryScale:I | tee "$out/smoke-native-history-scale.txt" || true; fi' EXIT
adb shell getprop ro.build.version.sdk | tr -d '\r' | tee "$out/smoke-api.txt"
grep -qx 36 "$out/smoke-api.txt"
# This script may reset contaminated synthetic fixtures. Refuse physical devices.
case "$(adb get-serialno)" in emulator-*) ;; *) echo "CI emulator required" >&2; exit 2;; esac
adb shell getprop ro.kernel.qemu | tr -d '\r' | grep -qx 1
adb shell input keyevent 82
adb install "$apk"
adb install "$test_apk"
adb logcat -G 16M || true
adb logcat -c
# No -g and no permission grants before the fresh-install smoke.
adb shell am start -W -n "$pkg/com.bushmeshmain.MainActivity" | tee "$out/smoke-launch.txt"
grep -q 'Status: ok' "$out/smoke-launch.txt"
sleep 5
pid="$(adb shell pidof "$pkg" | tr -d '\r')"
test -n "$pid"
sleep 25
test "$(adb shell pidof "$pkg" | tr -d '\r')" = "$pid"
adb logcat -d -b crash > "$out/smoke-fresh-crash.txt"
if grep -Fq "$pkg" "$out/smoke-fresh-crash.txt"; then exit 1; fi
run_test() {
  local class="$1" suffix="${2:-}"
  local report="$out/smoke-$class$suffix.txt"
  adb shell am instrument -w -r -e class "com.bushmeshmain.radio.$class" "$runner" | tee "$report" || return 1
  grep -Eq 'OK \([1-9][0-9]* tests?\)' "$report" || return 1
  if grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$report"; then return 1; fi
}
overall=0
: > "$out/smoke-stage-results.txt"
record_stage() {
  local name="$1" result="$2"
  printf 'STAGE %s %s\n' "$name" "$result" | tee -a "$out/smoke-stage-results.txt"
  if [ "$result" != passed ]; then overall=1; fi
}
independent_test() {
  local class="$1" suffix="${2:-}"
  local name="$class$suffix"
  local result=0
  adb shell am force-stop "$pkg" || result=1
  if [ "$result" -eq 0 ]; then
    run_test "$class" "$suffix" || result=1
  fi
  adb logcat -d -b crash > "$out/smoke-$name-crash.txt" || result=1
  adb logcat -d -t 2000 > "$out/smoke-$name-logcat.txt" || result=1
  if [ "$result" -eq 0 ]; then record_stage "$name" passed; else record_stage "$name" failed; fi
  return "$result"
}
# Explicitly only the fresh isolated CI emulator may discard contaminated
# synthetic fixtures. Never use this on a physical device or shared install.
reset_synthetic_fixture() {
  adb shell am force-stop "$pkg" &&
    adb shell pm clear "$pkg" | grep -qx 'Success'
}
if [ "$mode" != ui ]; then
  independent_test RuntimeLifecycleDeniedTest || overall=1
fi
if [ "$mode" != native ]; then
menu_result=0
adb shell "rm -f /sdcard/Android/data/$pkg/files/menu-*.txt /sdcard/Android/data/$pkg/files/menu-*.png" || menu_result=1
independent_test ConversationMenuUiTest || menu_result=1
for name in $(adb shell "ls /sdcard/Android/data/$pkg/files/menu-*.txt /sdcard/Android/data/$pkg/files/menu-*.png 2>/dev/null" | tr -d '\r'); do
  adb pull "$name" "$out/" || menu_result=1
done
if ! grep -Fq 'FIXTURE_RESTORED_EXACT' "$out/menu-stages.txt"; then
  menu_result=1
  reset_synthetic_fixture || { record_stage menu-fixture-isolation failed; exit 1; }
fi
if [ "$menu_result" -eq 0 ]; then
  for stage in drive-before-fixture fixture-written radio-selected catalogue-ready alpha-menu back-dismissed bravo-menu button-dismissed backdrop-dismissed bravo-details details-returned complete; do
    test -s "$out/menu-$stage.txt" || menu_result=1
  done
fi
if [ "$menu_result" -eq 0 ]; then record_stage menu-evidence passed; else record_stage menu-evidence failed; fi
# Force a visible software IME even with the emulator's hardware keyboard.
if adb shell settings put secure show_ime_with_hard_keyboard 1; then record_stage keyboard-ime-setup passed; else record_stage keyboard-ime-setup failed; fi
# Three predetermined independent executions, not retry-until-pass.
# A fresh process and exact catalogue restoration isolate each execution.
# Remove only synthetic screenshots, never app data or production preferences.
keyboard_result=0
keyboard_passes=0
adb shell settings get secure default_input_method | tee "$out/smoke-keyboard-input-method.txt"
: > "$out/smoke-keyboard-qualification.txt"
for round in 1 2 3; do
  round_result=0
  adb shell am force-stop "$pkg" || round_result=1
  adb shell "rm -f /sdcard/Android/data/$pkg/files/keyboard-*.png" || round_result=1
  # Scope each round's transition evidence; retain earlier crash logs.
  adb logcat -d -b crash > "$out/smoke-keyboard-before-$round-crash.txt" || round_result=1
  adb logcat -c || round_result=1
  if [ "$round_result" -eq 0 ]; then run_test RadioComposerKeyboardUiTest "-run-$round" || round_result=$?; fi
  transitions="$out/smoke-keyboard-transitions-run-$round.txt"
  adb logcat -d -s BushMeshRadioIme:I BushMeshKeyboardTest:I ImeTracker:I InsetsController:D FrameTracker:W > "$transitions" || round_result=1
  adb logcat -d -b crash > "$out/smoke-keyboard-run-$round-crash.txt" || round_result=1
  adb logcat -d -t 2000 > "$out/smoke-keyboard-run-$round-logcat.txt" || round_result=1
  if ! grep -Fq 'FIXTURE_RESTORED_EXACT' "$transitions"; then
    round_result=1
    fixture_contaminated=1
  else
    fixture_contaminated=0
  fi
  grep -Fq 'KEY_EVENT_PROBE expected=' "$transitions" || round_result=1
  for screenshot in keyboard-closed.png keyboard-multiline.png keyboard-reopen-1.png keyboard-reopen-2.png keyboard-reopen-3.png keyboard-quick-message.png keyboard-final.png; do
    destination="$out/keyboard-run-$round-${screenshot#keyboard-}"
    if ! adb pull "/sdcard/Android/data/$pkg/files/$screenshot" "$destination" || [ ! -s "$destination" ]; then
      printf 'Missing keyboard screenshot in round %s: %s\n' "$round" "$screenshot" >&2
      round_result=1
    elif [ "$round" -eq 3 ]; then
      cp "$destination" "$out/$screenshot"
    fi
  done
  if [ "$fixture_contaminated" -eq 1 ]; then
    reset_synthetic_fixture || { record_stage keyboard-fixture-isolation failed; exit 1; }
  fi
  if [ "$round_result" -eq 0 ]; then
    keyboard_passes=$((keyboard_passes + 1))
    printf 'KEYBOARD_QUALIFICATION round=%s result=passed\n' "$round" | tee -a "$out/smoke-keyboard-qualification.txt"
  else
    keyboard_result=1
    printf 'KEYBOARD_QUALIFICATION round=%s result=failed\n' "$round" | tee -a "$out/smoke-keyboard-qualification.txt"
  fi
done
printf 'KEYBOARD_QUALIFICATION consecutive_required=3 passed=%s\n' "$keyboard_passes" | tee -a "$out/smoke-keyboard-qualification.txt"
test "$keyboard_passes" -eq 3 || keyboard_result=1
cat "$out"/smoke-keyboard-transitions-run-*.txt > "$out/smoke-keyboard-transitions.txt"
if [ "$keyboard_result" -eq 0 ]; then record_stage keyboard-three-rounds passed; else record_stage keyboard-three-rounds failed; fi
fi
if [ "$mode" != ui ]; then
voice_denied() {
  local suffix="$1"
  local result=0
  independent_test VoicePermissionDeniedTest "$suffix" || result=1
  grep -Fq 'modelInspectionNeverAcquiresMicrophoneOrRequestsCapture' "$out/smoke-VoicePermissionDeniedTest$suffix.txt" || result=1
  grep -Fq 'OK (2 tests)' "$out/smoke-VoicePermissionDeniedTest$suffix.txt" || result=1
  if [ "$result" -eq 0 ]; then record_stage "voice-model-inspection$suffix" passed; else record_stage "voice-model-inspection$suffix" failed; fi
}
voice_denied ""
# Permission-dependent groups have explicit prerequisites. A failed grant
# never permits a misleading successful test or a skip without failure.
granted=0
for permission in BLUETOOTH_CONNECT ACCESS_FINE_LOCATION RECORD_AUDIO; do
  adb shell pm grant "$pkg" "android.permission.$permission" || granted=1
done
adb shell svc bluetooth disable || granted=1
adb shell cmd location set-location-enabled true || granted=1
if [ "$granted" -eq 0 ]; then
  record_stage granted-setup passed
  independent_test RuntimeLifecycleGrantedTest || overall=1
  independent_test VoiceSuspendedRecognitionTest || overall=1
else
  record_stage granted-setup failed
  record_stage RuntimeLifecycleGrantedTest blocked
  record_stage VoiceSuspendedRecognitionTest blocked
fi
# These fixtures have no granted microphone/location prerequisite.
independent_test ProtectedChannelKeyWindowTest || overall=1
independent_test ProtectedInvitationWindowTest || overall=1
independent_test HistoryNativeStorageTest || overall=1
history_result=0
adb logcat -d -s BushMeshHistoryScale:I | tee "$out/smoke-native-history-scale.txt" || history_result=1
for count in 1000 10000; do grep -Fq "RADIO_HISTORY_NATIVE_SCALE count=$count status=committed " "$out/smoke-native-history-scale.txt" || history_result=1; done
grep -Fq "RADIO_HISTORY_NATIVE_SCALE count=50000 status=capacity_rejected " "$out/smoke-native-history-scale.txt" || history_result=1
if [ "$history_result" -eq 0 ]; then record_stage history-scale passed; else record_stage history-scale failed; fi
revoked=0
for permission in BLUETOOTH_CONNECT ACCESS_FINE_LOCATION RECORD_AUDIO; do
  adb shell pm revoke "$pkg" "android.permission.$permission" || revoked=1
done
if [ "$revoked" -eq 0 ]; then
  record_stage revoked-setup passed
  launch_result=0
  adb shell am force-stop "$pkg" || launch_result=1
  adb logcat -d -b crash > "$out/smoke-before-revocation-crash.txt" || launch_result=1
  adb logcat -c || launch_result=1
  adb shell am start -W -n "$pkg/com.bushmeshmain.MainActivity" | tee "$out/smoke-revoked-launch.txt" || launch_result=1
  grep -q 'Status: ok' "$out/smoke-revoked-launch.txt" || launch_result=1
  sleep 5
  pid="$(adb shell pidof "$pkg" | tr -d '\r')" || launch_result=1
  test -n "$pid" || launch_result=1
  sleep 25
  test "$(adb shell pidof "$pkg" | tr -d '\r')" = "$pid" || launch_result=1
  adb logcat -d -b crash > "$out/smoke-revoked-crash.txt" || launch_result=1
  if grep -Fq "$pkg" "$out/smoke-revoked-crash.txt"; then launch_result=1; fi
  if [ "$launch_result" -eq 0 ]; then record_stage revoked-launch passed; else record_stage revoked-launch failed; fi
  independent_test RuntimeLifecycleDeniedTest "-revoked" || overall=1
  voice_denied "-revoked"
else
  record_stage revoked-setup failed
  record_stage revoked-launch blocked
  record_stage RuntimeLifecycleDeniedTest-revoked blocked
  record_stage VoicePermissionDeniedTest-revoked blocked
fi
fi
if [ "$overall" -ne 0 ]; then
  printf 'Mandatory qualification failed; see per-stage evidence.\n' | tee "$out/smoke-result.txt"
  exit 1
fi
printf 'All mandatory %s qualification stages passed.\n' "$mode" | tee "$out/smoke-result.txt"
