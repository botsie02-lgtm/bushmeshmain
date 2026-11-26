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

Out-of-band rekeys between local readbacks cannot be detected by this protocol; a transient change and restoration may never be observable. Native buffered frames have no firmware transaction ID. A delayed stale response matching a command cannot be cryptographically excluded. The recorded association therefore denotes last locally verified configuration and queue observation, never historical proof. A post-receive exact slot readback is required before durable association. If the HMAC configuration identity differs, the binding is invalidated and normal catalogue refresh is requested. A failure or race degrades to an unassociated record. Native generation fencing remains necessary before stronger notification, deletion or export policies.

New matched queue responses on a known radio receive a distinct locally generated occurrence ID; the inbox retains it across storage retries. Equal legitimate replies to different serialized requests therefore remain distinct. Unmatched observations use a radio-scoped content fingerprint and remain quarantined; replayed unmatched events do not create conversation bubbles. Without a firmware packet ID, a duplicated frame that impersonates a new matched reply cannot be distinguished from a legitimate repeated message. Old IDs are preserved rather than rewritten; an upgrade-time repeat of a legacy event may remain as a separate unassociated record. Do not infer sender identity or fabricate delivery/read receipts. Snapshot remains version 1 with a versioned optional association record; old snapshots remain readable; no bulk database migration is attempted. Whole-history encrypted rewrites remain a scalability concern. Persistence-first application inbox acknowledgement is preserved; firmware dequeue itself is not a transactional acknowledgement.
