#!/usr/bin/env bash
set -euo pipefail
apk="$1"
test_apk="$2"
out="$3"
pkg=com.bushmeshmain.radioredesign
runner="$pkg.test/androidx.test.runner.AndroidJUnitRunner"
mkdir -p "$out"
trap 'adb logcat -d -b crash > "$out/smoke-crash-log.txt" || true; adb logcat -d -t 2000 > "$out/smoke-logcat.txt" || true; if [ ! -s "$out/smoke-native-history-scale.txt" ]; then adb logcat -d -s BushMeshHistoryScale:I | tee "$out/smoke-native-history-scale.txt" || true; fi' EXIT
adb shell getprop ro.build.version.sdk | tr -d '\r' | tee "$out/smoke-api.txt"
grep -qx 36 "$out/smoke-api.txt"
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
run_test RuntimeLifecycleDeniedTest
run_test ConversationMenuUiTest
# Force a visible software IME even with the emulator's hardware keyboard.
adb shell settings put secure show_ime_with_hard_keyboard 1
# Three predetermined independent executions, not retry-until-pass.
# A fresh process and exact catalogue restoration isolate each execution.
# Remove only synthetic screenshots, never app data or production preferences.
keyboard_result=0
keyboard_passes=0
adb shell settings get secure default_input_method | tee "$out/smoke-keyboard-input-method.txt"
: > "$out/smoke-keyboard-qualification.txt"
for round in 1 2 3; do
  round_result=0
  adb shell am force-stop "$pkg"
  adb shell "rm -f /sdcard/Android/data/$pkg/files/keyboard-*.png"
  # Scope each round's transition evidence; retain earlier crash logs.
  adb logcat -d -b crash > "$out/smoke-keyboard-before-$round-crash.txt"
  adb logcat -c
  run_test RadioComposerKeyboardUiTest "-run-$round" || round_result=$?
  transitions="$out/smoke-keyboard-transitions-run-$round.txt"
  adb logcat -d -s BushMeshRadioIme:I BushMeshKeyboardTest:I ImeTracker:I InsetsController:D FrameTracker:W > "$transitions" || round_result=1
  grep -Fq 'FIXTURE_RESTORED_EXACT' "$transitions" || round_result=1
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
run_test VoicePermissionDeniedTest
grep -Fq 'modelInspectionNeverAcquiresMicrophoneOrRequestsCapture' "$out/smoke-VoicePermissionDeniedTest.txt"
grep -Fq 'OK (2 tests)' "$out/smoke-VoicePermissionDeniedTest.txt"
# Grants are only test-environment setup, after the ungranted smoke.
adb shell pm grant "$pkg" android.permission.BLUETOOTH_CONNECT
adb shell pm grant "$pkg" android.permission.ACCESS_FINE_LOCATION
adb shell pm grant "$pkg" android.permission.RECORD_AUDIO
adb shell svc bluetooth disable
adb shell cmd location set-location-enabled true
sleep 3
run_test RuntimeLifecycleGrantedTest
run_test VoiceSuspendedRecognitionTest
run_test ProtectedChannelKeyWindowTest
run_test ProtectedInvitationWindowTest
run_test HistoryNativeStorageTest
adb logcat -d -s BushMeshHistoryScale:I | tee "$out/smoke-native-history-scale.txt"
for count in 1000 10000; do grep -Fq "RADIO_HISTORY_NATIVE_SCALE count=$count status=committed " "$out/smoke-native-history-scale.txt"; done
grep -Fq "RADIO_HISTORY_NATIVE_SCALE count=50000 status=capacity_rejected " "$out/smoke-native-history-scale.txt"
# Revocation can kill the app process on Android. Check the actual relaunch
# and denied release paths rather than assuming an in-process callback.
adb shell pm revoke "$pkg" android.permission.BLUETOOTH_CONNECT
adb shell pm revoke "$pkg" android.permission.ACCESS_FINE_LOCATION
adb shell pm revoke "$pkg" android.permission.RECORD_AUDIO
adb shell am force-stop "$pkg"
adb logcat -c
adb shell am start -W -n "$pkg/com.bushmeshmain.MainActivity" | tee "$out/smoke-revoked-launch.txt"
grep -q 'Status: ok' "$out/smoke-revoked-launch.txt"
sleep 5
pid="$(adb shell pidof "$pkg" | tr -d '\r')"
test -n "$pid"
sleep 25
test "$(adb shell pidof "$pkg" | tr -d '\r')" = "$pid"
adb logcat -d -b crash > "$out/smoke-revoked-crash.txt"
if grep -Fq "$pkg" "$out/smoke-revoked-crash.txt"; then exit 1; fi
run_test RuntimeLifecycleDeniedTest
run_test VoicePermissionDeniedTest
grep -Fq 'modelInspectionNeverAcquiresMicrophoneOrRequestsCapture' "$out/smoke-VoicePermissionDeniedTest.txt"
grep -Fq 'OK (2 tests)' "$out/smoke-VoicePermissionDeniedTest.txt"
if [ "$keyboard_result" -ne 0 ]; then
  printf 'Keyboard qualification failed; subsequent native regression gates executed.\n' | tee "$out/smoke-result.txt"
  exit "$keyboard_result"
fi
printf 'Fresh install and post-revocation launch survived; native lifecycle tests passed.\n' | tee "$out/smoke-result.txt"
