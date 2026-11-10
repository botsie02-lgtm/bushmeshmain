#!/usr/bin/env python3
"""Wave 4 pre-activation *static* fail-closed guard. Not a security proof.

A deliberate live security feature requires independent formal review and a
separately reviewed update to this safety guard. Do not bypass with a dummy
provider, role metadata, or a no-op test. It is deliberately limited to
known Wave 3 integration boundaries; full Jest/native/physical tests remain
mandatory.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]


def verify(root=ROOT):
    def read(path):
        return (root / path).read_text(encoding="utf-8")

    def check(condition, message):
        if not condition:
            raise AssertionError("WAVE4 SECURITY ACTIVATION BLOCKED: " + message)

    app = read("App.tsx")
    provider = read("src/app/activeContext/ActiveOperationalConvoyContext.tsx")
    contract = read("src/convoy/enrolmentV3/contract.ts")
    adapter = read("src/convoy/enrolmentV3/compatibility.ts")
    shell = read("src/app/shell/AppShell.tsx")
    ingress = read("src/convoy/membership/authenticatedPositionIngress.ts")
    ui = read("src/drive/fieldReadiness/FieldReadinessDashboard.tsx")
    types = read("src/security/types.ts")
    ports = read("src/security/ports.ts")
    map_view = read("src/maps/ConvoyMap.tsx")

    check(re.search(
        r"<ActiveOperationalConvoyProvider\s+localIdentityRef=\{snapshot\.identityRef\}\s*>",
        app,
    ) is not None, "App must not inject an unreviewed membership directory")
    check("directory = unavailableConvoyDirectory" in provider,
          "The authoritative fallback must remain unavailableConvoyDirectory")
    check(
        "SECURE_ENROLMENT_V3_ACTIVATION = 'disabled-pending-security-v2-review'" in contract,
        "Security v2 contract marker must stay disabled",
    )
    check(re.search(
        r"async executeIncrementalEnrolment\(\): Promise<never>\s*\{\s*throw new SecurityV2ContractUnavailable\(\);\s*\}",
        adapter,
    ) is not None, "Draft add-member operation must always fail closed")
    for prop in ("roster={null}", "verifiedAlerts={null}", "carrierBinding={null}"):
        check(shell.count(prop) >= 2, "Both Drive views must exclude untrusted " + prop)
    check("NOT TRANSMITTED" in ui, "Field Readiness must remain a local preview")
    check("embeddedNode !== authenticatedSource" in ingress and
          "inbound.protected !== true" in ingress and
          "!policy.authorisedSourceNodeIds.has(authenticatedSource)" in ingress,
          "Authenticated position must check protection, source equality and roster")
    check("PrivateKeyAlgorithm = 'Ed25519' | 'X25519'" in types,
          "Frozen Security v1 Ed25519/X25519 key formats must not change")
    for port in ("CryptoProvider", "SecureSecretStore", "SecurityMetadataStore"):
        check("export interface " + port in ports, "Missing v1 port " + port)
    check('label="VIEW PACK"' in map_view, "Verified offline VIEW PACK must survive")
    return True


if __name__ == "__main__":
    try:
        verify()
    except (AssertionError, OSError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    print("Wave 4 static integration guard PASS: disabled security, source-bound telemetry and offline map retained.")
    print("WARNING: static guard is NOT proof of cryptographic security or Android production provider.")
