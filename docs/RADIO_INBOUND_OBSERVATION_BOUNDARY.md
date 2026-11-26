# Radio inbound observation boundary

Baseline: 73ed08beb56f120dfcd3725db16f0ae986abab12.

## Protocol evidence
- https://github.com/meshcore-dev/MeshCore/blob/main/docs/companion_protocol.md
- https://github.com/meshcore-dev/MeshCore/blob/main/examples/companion_radio/MyMesh.cpp
- https://github.com/meshcore-dev/MeshCore/wiki/Companion-Radio-Protocol

Ordinary 0x08/0x11 receive frames contain slot, path, text type, timestamp, text and (V3) SNR; they do not carry the original PSK generation, authenticated sender or unique receive ID. 0x83 is a queue hint, not a message identity. 0x0a empty is a local queue observation, not an authentication proof. Firmware queue records can predate a host session.

## Implemented tier

Only a reply observed during the serialized sync-next command after an empty reply from a command started under the same verified, persisted catalogue binding can receive a local-observation association. Both existing transports forward their command boundary events; no additional queue consumer is introduced. Catalogue incarnation, radio identity and channel metadata are captured before persistence. The same encrypted snapshot retains outgoing and incoming records. Previously stored ambiguous records are not migrated into conversations. The UI differentiates local observation from verified history.

The binding is invalidated by session identity changes, known channel mutations and queue errors. An unsolicited frame, startup backlog or missing protected catalogue remains separate. Configuration is verified through a full channel readback, not inferred from slot/name or firmware timestamps. Association is not original key provenance and does not authenticate a sender.

## Remaining limitations

Out-of-band rekeys between local readbacks cannot be detected by this protocol; a transient change and restoration may never be observable. Native buffered frames have no firmware transaction ID. A delayed stale response matching a command cannot be cryptographically excluded. The recorded association therefore denotes last locally verified configuration and queue observation, never historical proof. Further work should examine a post-receive exact readback and native generation fencing before stronger notification, deletion or export policies.

The legacy content fingerprint still cannot distinguish identical legitimate messages with identical timestamp/type/slot/text; cross-radio identity and queue occurrence handling require a separately tested migration. Do not infer sender identity or fabricate delivery/read receipts. Snapshot remains version 1 with a versioned optional association record; old snapshots remain readable; no bulk database migration is attempted. Whole-history encrypted rewrites remain a scalability concern. Persistence-first application inbox acknowledgement is preserved; firmware dequeue itself is not a transactional acknowledgement.
