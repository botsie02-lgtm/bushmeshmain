import {Buffer} from 'buffer';
import {decodeChatInvite, encodeChatInvite, validateChatName} from '../src/radio/chatManagement/chatInvitations';

const secretHex = 'AB'.repeat(16);
const prefix = 'BUSHMESH-CHAT-1:';
const payload = (value: unknown) => prefix + Buffer.from(JSON.stringify(value)).toString('base64');

describe('MeshCore private invitation', () => {
  it('round trips a Unicode name and accepts legacy name/key invitation', () => {
    expect(decodeChatInvite(encodeChatInvite({name: 'Café trip', secretHex: secretHex.toLowerCase()})))
      .toEqual({name: 'Café trip', secretHex});
    expect(decodeChatInvite('MeshCore private channel\nName: Camp\nKey: ' + secretHex))
      .toEqual({name: 'Camp', secretHex});
  });
  it.each(['', 'BUSHMESH-CONVOY-1:AAAA', prefix + '%%%%', prefix + 'A', 'A'.repeat(513)])(
    'rejects unsupported or malformed input without echoing it', value => {
      expect(() => decodeChatInvite(value)).toThrow();
    },
  );
  it('rejects zero, malformed, extra fields and invalid names', () => {
    for (const candidate of [
      {name: 'Camp', secretHex: '0'.repeat(32)},
      {name: 'Camp', secretHex: 'bad'},
      {name: 'Camp', secretHex, owner: true},
      {name: 'Camp\nKey', secretHex},
      {name: 'é'.repeat(16), secretHex},
      {name: 123, secretHex},
      {name: 'Camp', secretHex: 123},
    ]) {
      expect(() => decodeChatInvite(payload(candidate))).toThrow('Invalid channel invitation');
    }
  });
  it('counts UTF-8 bytes and rejects control characters', () => {
    expect(validateChatName('é'.repeat(15))).toBe('é'.repeat(15));
    expect(() => validateChatName('é'.repeat(16))).toThrow();
    expect(() => validateChatName('hello\0world')).toThrow();
    expect(() => validateChatName('hello\nworld')).toThrow();
  });
});
