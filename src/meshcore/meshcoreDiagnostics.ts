const CHANNEL_INFO_PACKET_TYPE = 0x12;
const CHANNEL_SECRET_START = 34;
const CHANNEL_SECRET_BYTES = 16;
const EMPTY_CHANNEL_SECRET = '00000000000000000000000000000000';

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

  return redacted;
}

export function redactMeshCoreParsedLines(
  packetType: number | null,
  lines: string[] | undefined,
): string[] | undefined {
  if (!lines || packetType !== CHANNEL_INFO_PACKET_TYPE) {
    return lines ? [...lines] : undefined;
  }

  return lines.map(line => {
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
