#!/usr/bin/env python3
"""Capture real Android Radio screens on an isolated test emulator.

No production device, channel keys, microphone, or radio hardware is needed.
Requires a booted emulator and the two signed APKs built from base and head.
"""
import argparse
import pathlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET


def adb(*args, **kwargs):
    return subprocess.run(["adb", *args], check=True, **kwargs)


def launch(apk):
    adb("install", "-r", str(apk))
    adb("shell", "am", "force-stop", "com.bushmeshmain")
    adb("shell", "monkey", "-p", "com.bushmeshmain",
        "-c", "android.intent.category.LAUNCHER", "1")


def tap_label(label):
    deadline = time.monotonic() + 100
    while time.monotonic() < deadline:
        try:
            adb("shell", "uiautomator", "dump", "/sdcard/radio-window.xml",
                timeout=12, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            xml = adb("exec-out", "cat", "/sdcard/radio-window.xml",
                      capture_output=True, timeout=5).stdout
            nodes = ET.fromstring(xml).iter("node")
            for node in nodes:
                if label not in (node.get("content-desc"), node.get("text")):
                    continue
                bounds = [int(x) for x in re.findall(r"\d+", node.get("bounds", ""))]
                if len(bounds) != 4 or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
                    continue
                x1, y1, x2, y2 = bounds
                adb("shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2))
                time.sleep(2)
                return
        except (subprocess.SubprocessError, ET.ParseError):
            pass
        time.sleep(2)
    raise RuntimeError("Could not locate visible Android control: " + label)


def screenshot(path):
    with path.open("wb") as output:
        adb("exec-out", "screencap", "-p", stdout=output)
    if not path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("Invalid screenshot: " + str(path))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-apk", type=pathlib.Path, required=True)
    parser.add_argument("--feature-apk", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    adb("shell", "wm", "size", "1080x2340")
    adb("shell", "wm", "density", "420")
    adb("shell", "settings", "put", "system", "font_scale", "1.0")
    adb("shell", "input", "keyevent", "82")
    launch(args.base_apk)
    tap_label("Radio")
    screenshot(args.output / "radio-before.png")
    launch(args.feature_apk)
    tap_label("Radio")
    screenshot(args.output / "radio-after.png")
    tap_label("Radio messaging settings")
    screenshot(args.output / "radio-settings.png")
    tap_label("Back to Radio")
    screenshot(args.output / "radio-returned.png")


if __name__ == "__main__":
    main()
