import {
  BUSHMESH_DEFAULT_CAPABILITIES,
  BUSHMESH_PROTOCOL_VERSION,
  BUSHMESH_TEXT_DICTIONARY_VERSION,
  BushMeshNodeHello,
  BushMeshNodeRole,
} from '../protocol';

function hexToBytes(hex: string): number[] {
  const normalized = hex.replace(/[^0-9a-f]/gi, '').toLowerCase();

  if (normalized.length < 2 || normalized.length % 2 !== 0) {
    throw new Error('MeshCore public key is not valid hexadecimal data.');
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

export function deriveBushMeshNodeId(publicKeyHex: string): number {
  const bytes = hexToBytes(publicKeyHex);
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash === 0 ? 1 : hash;
}

export function createBushMeshNodeHelloFromPublicKey(
  publicKeyHex: string,
  options?: {
    role?: BushMeshNodeRole;
    batteryPercent?: number;
    capabilities?: number;
  },
): BushMeshNodeHello {
  return {
    nodeId: deriveBushMeshNodeId(publicKeyHex),
    capabilities: options?.capabilities ?? BUSHMESH_DEFAULT_CAPABILITIES,
    role: options?.role ?? BushMeshNodeRole.Vehicle,
    protocolMinVersion: BUSHMESH_PROTOCOL_VERSION,
    protocolMaxVersion: BUSHMESH_PROTOCOL_VERSION,
    batteryPercent: options?.batteryPercent,
    dictionaryVersion: BUSHMESH_TEXT_DICTIONARY_VERSION,
  };
}

export function extractMeshCorePublicKey(parsedLines?: string[]): string | null {
  const line = parsedLines?.find(value => value.startsWith('Public Key:'));
  const key = line?.slice('Public Key:'.length).trim() ?? '';
  return key.length > 0 ? key : null;
}
