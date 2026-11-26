import {Buffer} from 'buffer';

const PREFIX = 'BUSHMESH-CHAT-1:';
const MAX_INVITE = 512;
export type ChatInvite = {name: string; secretHex: string};

export function validateChatName(value: string): string {
  if (typeof value !== 'string') throw new Error('Invalid channel name.');
  const name = value.trim();
  if (!name || Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || Buffer.byteLength(name, 'utf8') > 31 ||
      Buffer.from(name, 'utf8').toString('utf8') !== name) {
    throw new Error('Use a channel name of 1–31 UTF-8 bytes without control characters.');
  }
  return name;
}

export function validateChatInvite(input: ChatInvite): ChatInvite {
  if (typeof input.name !== 'string' || typeof input.secretHex !== 'string') {
    throw new Error('Invalid channel invitation.');
  }
  const name = validateChatName(input.name);
  const secretHex = input.secretHex.trim().toUpperCase();
  if (!/^[A-F0-9]{32}$/.test(secretHex) || /^0{32}$/.test(secretHex)) {
    throw new Error('Enter a non-zero 32-character private channel key.');
  }
  return {name, secretHex};
}

/** Sensitive output, for explicit OS share only; base64 is not encryption. */
export function encodeChatInvite(input: ChatInvite): string {
  const {name, secretHex} = validateChatInvite(input);
  return PREFIX + Buffer.from(JSON.stringify({name, secretHex}), 'utf8').toString('base64');
}

export function decodeChatInvite(value: string): ChatInvite {
  if (typeof value !== 'string' || value.length > MAX_INVITE) throw new Error('Invalid channel invitation.');
  const trimmed = value.trim();
  if (trimmed.length > MAX_INVITE) throw new Error('Invalid channel invitation.');
  // Accept the earlier human-readable invitation as well.
  const old = /^MeshCore private channel\r?\nName: ([^\r\n]+)\r?\nKey: ([a-f0-9]{32})$/i.exec(trimmed);
  if (old) return validateChatInvite({name: old[1], secretHex: old[2]});
  if (!trimmed.startsWith(PREFIX)) throw new Error('Not a BushMesh chat invitation.');
  const payload = trimmed.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw new Error('Invalid channel invitation.');
  try {
    const decoded = Buffer.from(payload, 'base64');
    if (decoded.toString('base64') !== payload) throw new Error();
    const obj = JSON.parse(decoded.toString('utf8'));
    if (!obj || Object.keys(obj).length !== 2) throw new Error();
    return validateChatInvite(obj);
  } catch {
    throw new Error('Invalid channel invitation. Ask the sender for a new copy.');
  }
}

export type ChatOperationFailureCode = 'duplicate' | 'full' | 'partial' | 'invalid' | 'storage' | 'stale';
export class ChatOperationError extends Error {
  constructor(readonly code: ChatOperationFailureCode, message: string) {
    super(message);
    this.name = 'ChatOperationError';
  }
}
