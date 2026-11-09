const CHANNEL_INFO_PACKET_TYPE = 0x12;
const CHANNEL_SECRET_START = 34;
const CHANNEL_SECRET_BYTES = 16;
const EMPTY_CHANNEL_SECRET = '00000000000000000000000000000000';
const CHANNEL_RECEIVE_TYPES = new Set([0x08, 0x11]);
const CONTACT_RECEIVE_TYPES = new Set([0x07, 0x10]);

/**
 * Channel-info packets carry the full 16-byte MeshCore channel secret. Raw BLE
 * bytes are required briefly for protocol parsing, but must not escape into
 * normal app logs, diagnostics cards, crash reports or shared React state.
 */
export function redactMeshCoreDiagnosticBytes(bytes: number[]): number[] {
  const redacted = [...bytes];

  if (
    redacted[0] === CHANNEL_INFO_PACKET_TYPE &&
    redacted.length >= CHANNEL_SECRET_START + CHANNEL_SECRET_BYTES
  ) {
    for (
      let index = CHANNEL_SECRET_START;
      index < CHANNEL_SECRET_START + CHANNEL_SECRET_BYTES;
      index += 1
    ) {
      redacted[index] = 0;
    }
  }

  // A MeshCore receive frame carries user text after a fixed header.
  // Scrub plaintext before any diagnostic logging/export. Parsers still
  // receive the original bytes separately for application delivery.
  const kind = redacted[0];
  const channelOffset = kind === 0x08 ? 8 : kind === 0x11 ? 11 : null;
  const contactOffset = kind === 0x07 ? 13 : kind === 0x10 ? 16 : null;
  const textOffset = channelOffset ?? contactOffset;
  if (textOffset !== null && redacted.length >= textOffset) {
    redacted.fill(0, textOffset);
  }
  return redacted;
}

export function redactMeshCoreParsedLines(
  packetType: number | null,
  lines: string[] | undefined,
): string[] | undefined {
  if (!lines) return undefined;
  if (packetType !== CHANNEL_INFO_PACKET_TYPE &&
      !CHANNEL_RECEIVE_TYPES.has(packetType ?? -1) &&
      !CONTACT_RECEIVE_TYPES.has(packetType ?? -1)) {
    return [...lines];
  }

  return lines.map(line => {
    if ((CHANNEL_RECEIVE_TYPES.has(packetType ?? -1) ||
         CONTACT_RECEIVE_TYPES.has(packetType ?? -1)) &&
        line.startsWith('Message:')) return 'Message: [redacted]';
    if (!line.startsWith('Secret:')) {
      return line;
    }

    const value = line.slice('Secret:'.length).trim();
    if (value === 'Empty / Public' || value === EMPTY_CHANNEL_SECRET) {
      return 'Secret: Empty / Public';
    }

    return 'Secret: Configured (redacted)';
  });
}
