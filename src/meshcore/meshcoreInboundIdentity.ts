import {Buffer} from 'buffer';
import {ParsedChannelMessage} from './meshcoreParsers';

/**
 * Deterministic content fingerprint for a *single MeshCore channel message*.
 * SNR, path and the V3/legacy envelope are excluded: those may change when
 * the same queued message is replayed. The channel, firmware timestamp,
 * message type and text all participate. No raw payload is exposed in the ID.
 */
const K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];
function rotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
export function meshCoreSha256Hex(source: Uint8Array): string {
  const sourceLength = source.length;
  const paddedLength = Math.ceil((sourceLength + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[sourceLength] = 0x80;
  // SHA-256 length in bits, split into two BE uint32 for normal message sizes.
  const bitHigh = Math.floor(sourceLength / 0x20000000);
  const bitLow = (sourceLength * 8) >>> 0;
  const end = paddedLength - 8;
  for (let i = 0; i < 4; i += 1) {
    bytes[end + i] = (bitHigh >>> (24 - i * 8)) & 0xff;
    bytes[end + 4 + i] = (bitLow >>> (24 - i * 8)) & 0xff;
  }
  const state = [
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
  ];
  const w = new Array<number>(64);
  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    for (let j = 0; j < 16; j += 1) {
      const off = chunk + j * 4;
      w[j] = ((bytes[off] << 24) | (bytes[off + 1] << 16) |
        (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
    }
    for (let j = 16; j < 64; j += 1) {
      const x = w[j - 15], y = w[j - 2];
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = state;
    for (let j = 0; j < 64; j += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[j] + w[j]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    for (const [i, value] of [a,b,c,d,e,f,g,h].entries()) {
      state[i] = (state[i] + value) >>> 0;
    }
  }
  return state.map(value => value.toString(16).padStart(8, '0')).join('');
}
export function meshCoreInboundMessageId(message: ParsedChannelMessage): string {
  const content = JSON.stringify([
    'meshcore-channel-text-v1', message.channelIndex, message.timestamp,
    message.textType, message.text.trim(),
  ]);
  return 'meshcore-in-' + meshCoreSha256Hex(Buffer.from(content, 'utf8'));
}
