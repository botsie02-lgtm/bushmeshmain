#!/usr/bin/env bash
set -euo pipefail
app="$1"
test_apk="$2"
out="$3"
pkg=com.bushmeshmain.radioredesign
runner="$pkg.test/androidx.test.runner.AndroidJUnitRunner"
mkdir -p "$out"
adb shell getprop ro.build.version.sdk | tr -d '\r' | tee "$out/api-level.txt"
grep -qx 36 "$out/api-level.txt"
adb shell getprop ro.product.cpu.abi | tr -d '\r' | tee "$out/device-abi.txt"
adb shell getconf PAGE_SIZE | tr -d '\r' | tee "$out/page-size.txt"
adb install "$app"
adb install "$test_apk"
# No RECORD_AUDIO grant, model download or microphone activation; actual
# fixture recognition is entirely local. Keep networking disabled during it.
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
adb shell settings get global airplane_mode_on | tr -d '\r' | tee "$out/airplane-mode.txt"
grep -qx 1 "$out/airplane-mode.txt"
adb logcat -c
trap 'adb logcat -d -s BushMeshWakeEval:I "*:S" > "$out/audio-metrics.txt" || true' EXIT
adb shell am instrument -w -r -e class com.bushmeshmain.radio.WakeAudioQualificationTest "$runner" | tee "$out/instrumentation.txt"
grep -Eq 'OK \(2 tests\)' "$out/instrumentation.txt"
if grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$out/instrumentation.txt"; then exit 1; fi
adb logcat -d -s BushMeshWakeEval:I "*:S" | tee "$out/audio-metrics.txt"
grep -q 'WAKE_AUDIO_EVAL mode=unconstrained' "$out/audio-metrics.txt"
grep -q 'WAKE_AUDIO_EVAL mode=grammar' "$out/audio-metrics.txt"
