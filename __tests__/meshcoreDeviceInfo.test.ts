import {parseMeshCoreDeviceInfo} from '../src/meshcore/meshcoreDeviceInfo';

function writeText(target: number[], offset: number, length: number, value: string) {
  const bytes = Array.from(Buffer.from(value, 'utf8')).slice(0, length);
  for (let index = 0; index < bytes.length; index += 1) {
    target[offset + index] = bytes[index];
  }
}

describe('parseMeshCoreDeviceInfo', () => {
  test('parses firmware v3+ capability fields', () => {
    const frame = new Array<number>(82).fill(0);
    frame[0] = 0x0d;
    frame[1] = 13;
    frame[2] = 32;
    frame[3] = 8;
    frame[4] = 0x78;
    frame[5] = 0x56;
    frame[6] = 0x34;
    frame[7] = 0x12;
    writeText(frame, 8, 12, 'build-abc');
    writeText(frame, 20, 40, 'Heltec V3');
    writeText(frame, 60, 20, '1.2.3');
    frame[80] = 1;
    frame[81] = 2;

    expect(parseMeshCoreDeviceInfo(frame)).toEqual({
      firmwareVersion: 13,
      maxContacts: 64,
      maxChannels: 8,
      blePin: 0x12345678,
      firmwareBuild: 'build-abc',
      model: 'Heltec V3',
      version: '1.2.3',
      clientRepeat: 1,
      pathHashMode: 2,
    });
  });

  test('keeps capability fields nullable for older/short responses', () => {
    expect(parseMeshCoreDeviceInfo([0x0d, 2])).toEqual({
      firmwareVersion: 2,
      maxContacts: null,
      maxChannels: null,
      blePin: null,
      firmwareBuild: null,
      model: null,
      version: null,
      clientRepeat: null,
      pathHashMode: null,
    });
  });

  test('ignores non-device-info packets', () => {
    expect(parseMeshCoreDeviceInfo([0x05, 13])).toBeNull();
  });
});
