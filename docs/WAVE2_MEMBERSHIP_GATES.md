# Wave 2 authenticated convoy integration gates

This staging build contains the authenticated membership **foundation** from
`feature/convoy-membership-v2`, but does **not** activate it in AppProviders.
The live `ActiveOperationalConvoyProvider` deliberately uses
`unavailableConvoyDirectory`, which returns an empty roster and no active
authorization. A MeshCore carrier channel (including slot 4), its PSK,
contacts, local metadata, invitations, roles, and unverified radio positions
cannot grant membership.

## Production prerequisites before activation

- A durable Android Keystore/StrongBox-appropriate Security v1 asymmetric
  private-key provider with nonexportable handles, plus production atomic
  `SecurityMetadataStore` and Keystore-protected `SecureSecretStore`.
  Android app-preferences encryption is NOT a substitute for these stores.
- A singleton Security v1 identity, pairing/trust, group-key and direct-session
  lifecycle with restart/rotation/revocation invalidation and durable replay
  counters. The in-memory WebCrypto test harness is test-only.
- Signed/AEAD authenticated enrollment and *incremental* Security v1 group
  roster/key update. The frozen group manager has no addMember mutation.
  An approved join request must remain `approved-awaiting-security` and
  cannot grant keys, roster rights, or authorisation.
- Remote owner/admin grants, owner transfer, revocation propagation, and
  production secure metadata persistence remain unavailable until their
  independently verified Security v1 contracts exist.
- Authenticated canonical convoy Location decoding, identity-scoped source
  mapping and position/alert projection before any Drive roster is passed.

`acceptAuthenticatedConvoyPosition` is a pure fail-closed application ingress
guard. It rejects group/source/embedded-node mismatches, plaintext and unknown
roster mappings **without** modifying the convoy tracker. It is not used as an
authentication provider and is intentionally not connected to live telemetry
until the above Security v1 prerequisites are implemented.

The existing radio connection, native send, 0x83 inbound queue, encrypted
Radio History, GPS and BLE lifecycle remain unchanged.
