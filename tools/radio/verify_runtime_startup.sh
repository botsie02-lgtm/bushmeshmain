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
  local class="$1"
  adb shell am instrument -w -r -e class "com.bushmeshmain.radio.$class" "$runner" | tee "$out/smoke-$class.txt"
  grep -Eq 'OK \([1-9][0-9]* tests?\)' "$out/smoke-$class.txt"
  if grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$out/smoke-$class.txt"; then exit 1; fi
}
run_test RuntimeLifecycleDeniedTest
run_test ConversationMenuUiTest
# Grants are only test-environment setup, after the ungranted smoke.
adb shell pm grant "$pkg" android.permission.BLUETOOTH_CONNECT
adb shell pm grant "$pkg" android.permission.ACCESS_FINE_LOCATION
adb shell svc bluetooth disable
adb shell cmd location set-location-enabled true
sleep 3
run_test RuntimeLifecycleGrantedTest
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
printf 'Fresh install and post-revocation launch survived; native lifecycle tests passed.\n' | tee "$out/smoke-result.txt"
