import {Buffer} from 'buffer';

import {
  buildAddUpdateContactCommand,
  buildGetContactByKeyCommand,
  buildImportContactCommand,
  buildRemoveContactCommand,
} from '../src/meshcore/meshcoreCommands';

function decoded(command: string): number[] {
  return Array.from(Buffer.from(command, 'base64'));
}

describe('MeshCore contact management commands', () => {
  const publicKey = Array.from({length: 32}, (_, index) => index)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

  it('encodes exact full-key contact lookup', () => {
    const bytes = decoded(buildGetContactByKeyCommand(publicKey));
    expect(bytes).toHaveLength(33);
    expect(bytes[0]).toBe(0x1e);
    expect(bytes.slice(1)).toEqual(Array.from({length: 32}, (_, index) => index));
  });

  it('encodes exact full-key contact removal', () => {
    const bytes = decoded(buildRemoveContactCommand(publicKey));
    expect(bytes).toHaveLength(33);
    expect(bytes[0]).toBe(0x0f);
    expect(bytes.slice(1)).toEqual(Array.from({length: 32}, (_, index) => index));
  });

  it('encodes add/update contact with bounded path and padded UTF-8 name', () => {
    const bytes = decoded(
      buildAddUpdateContactCommand({
        publicKey,
        name: 'Heltec B',
        type: 0,
        flags: 2,
        outPath: Uint8Array.from([1, 2, 3]),
        lastAdvert: 0x01020304,
      }),
    );

    expect(bytes[0]).toBe(0x09);
    expect(bytes.slice(1, 33)).toEqual(Array.from({length: 32}, (_, index) => index));
    expect(bytes[33]).toBe(0);
    expect(bytes[34]).toBe(2);
    expect(bytes[35]).toBe(3);
    expect(bytes.slice(36, 39)).toEqual([1, 2, 3]);
    expect(bytes.slice(39, 100)).toEqual(new Array(61).fill(0));
    expect(Buffer.from(bytes.slice(100, 132)).toString('utf8').replace(/\0/g, '')).toBe(
      'Heltec B',
    );
    expect(bytes.slice(132, 136)).toEqual([4, 3, 2, 1]);
  });

  it('imports an opaque exported-contact payload without reinterpreting private identity material', () => {
    const payload = Uint8Array.from({length: 110}, (_, index) => index & 0xff);
    const withResponseCode = Uint8Array.from([0x0b, ...payload]);
    const bytes = decoded(buildImportContactCommand(withResponseCode));
    expect(bytes[0]).toBe(0x12);
    expect(bytes.slice(1)).toEqual(Array.from(payload));
  });

  it('rejects malformed keys and undersized imports', () => {
    expect(() => buildGetContactByKeyCommand('AABBCC')).toThrow(/exactly 32 bytes/i);
    expect(() => buildAddUpdateContactCommand({publicKey, name: 'x'.repeat(33)})).toThrow(
      /cannot exceed 32 UTF-8 bytes/i,
    );
    expect(() => buildImportContactCommand(new Uint8Array(40))).toThrow(/too short/i);
  });
});