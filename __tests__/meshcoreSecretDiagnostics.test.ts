import {Buffer} from 'buffer';

import {
  redactMeshCoreDiagnosticBytes,
  redactMeshCoreParsedLines,
} from '../src/meshcore/meshcoreDiagnostics';
import {sanitizeNativeMeshCoreResponseForDiagnostics} from '../src/meshcore/NativeMeshCoreSessionCoordinator';

function channelInfo(secret: number[]): number[] {
  const name = Array.from(Buffer.from('Private Convoy', 'utf8'));
  return [
    0x12,
    1,
    ...name,
    ...new Array(32 - name.length).fill(0),
    ...secret,
  ];
}

describe('MeshCore channel secret diagnostics', () => {
  it('zeros all 16 channel-secret bytes before ordinary raw-frame logging', () => {
    const secret = Array.from({length: 16}, (_, index) => 0xa0 + index);
    const redacted = redactMeshCoreDiagnosticBytes(channelInfo(secret));
    expect(redacted.slice(34, 50)).toEqual(new Array(16).fill(0));
    expect(redacted).not.toEqual(channelInfo(secret));
  });

  it('replaces parsed secret text with a redacted marker', () => {
    expect(
      redactMeshCoreParsedLines(0x12, [
        'Channel Index: 1',
        'Channel Name: Private Convoy',
        `Secret: ${'A5'.repeat(16)}`,
      ]),
    ).toEqual([
      'Channel Index: 1',
      'Channel Name: Private Convoy',
      'Secret: Configured (redacted)',
    ]);
  });

  it('never retains a raw channel secret in Android-native coordinator state or observer frames', () => {
    const secret = Array.from({length: 16}, (_, index) => 0xb0 + index);
    const originalBytes = channelInfo(secret);
    const sanitized = sanitizeNativeMeshCoreResponseForDiagnostics({
      packetType: 0x12,
      label: 'PACKET_CHANNEL_INFO',
      bytes: originalBytes,
      parsed: null,
      selfInfo: null,
      deviceInfo: null,
      channelData: null,
      receivedDatagram: null,
    });

    expect(sanitized.bytes.slice(34, 50)).toEqual(new Array(16).fill(0));
    expect(originalBytes.slice(34, 50)).toEqual(secret);
  });
});