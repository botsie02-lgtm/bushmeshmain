#!/usr/bin/env python3
"""Static pre-activation checks; not a proof of security or RF correctness."""
from pathlib import Path
import wave4_security_gate

ROOT = Path(__file__).resolve().parents[2]
def read(p):
    return (ROOT / p).read_text(encoding="utf-8")

wave4_security_gate.verify(ROOT)
assert not (ROOT / "src/security/v2").exists(), "Unapproved Security v2 in staging"
assert not (ROOT / "android/securityw1research").exists(), "W1 research in operational tree"
assert not (ROOT / "android/app/src/main/java/com/bushmeshmain/securityv2").exists()
assert not (ROOT / "src/security/platform/androidProductionSecurity.ts").exists()
assert "disabled-pending-security-membership-and-node-binding" in read("src/convoy/fieldLocation/verifiedBoundary.ts")
shell = read("src/app/shell/AppShell.tsx")
assert "authorisedMembers={NO_AUTHORISED_MAP_MEMBER_POSITIONS}" in shell
assert "showChannelFieldTest" in shell
assert "const NO_AUTHORISED_MAP_MEMBER_POSITIONS: readonly ConvoyMapMember[] = [];" in shell
map_screen = read("src/screens/MapScreen.tsx")
assert "showChannelFieldTest = false" in map_screen
assert "fieldChannelPositions={fieldChannelPositions}" in map_screen
assert "authorisedMembers={authorisedMembers}" in map_screen
panel = read("src/convoy/fieldLocation/ConnectedChannelFieldLocation.tsx")
assert "useState(false)" in panel and "privacyWarningAccepted: true" in panel
assert "if (!consent || running.current" in panel and "AppState.currentState !== 'active'" in panel
assert "prior?.session.dispose()" in panel and "onPositions([])" in panel
assert "startNativeGps(" not in panel and "VerifiedConvoyTelemetry" not in panel
print("Wave 5 static guard PASS: disabled security, empty verified roster, opt-in diagnostics.")
