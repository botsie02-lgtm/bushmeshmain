import {
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';

export enum BushMeshCapability {
  DictionaryText = 1 << 0,
  SemanticMessages = 1 << 1,
  Fragmentation = 1 << 2,
  SelectiveAck = 1 << 3,
  StoreAndForward = 1 << 4,
  BloomSync = 1 << 5,
  LocationDelta = 1 << 6,
  BinaryTransport = 1 << 7,
  FileTransfer = 1 << 8,
  LinkRouting = 1 << 9,
  VoiceTextPipeline = 1 << 10,
  SensorDelta = 1 << 11,
  CompressedBinary = 1 << 12,
}

export enum BushMeshNodeRole {
  Handheld = 0,
  Router = 1,
  Vehicle = 2,
  BaseStation = 3,
  Sensor = 4,
}

export const BUSHMESH_DEFAULT_CAPABILITIES =
  BushMeshCapability.DictionaryText |
  BushMeshCapability.SemanticMessages |
  BushMeshCapability.Fragmentation |
  BushMeshCapability.SelectiveAck |
  BushMeshCapability.StoreAndForward |
  BushMeshCapability.BloomSync |
  BushMeshCapability.LocationDelta |
  BushMeshCapability.SensorDelta;

export type BushMeshNodeHello = {
  nodeId: number;
  capabilities: number;
  role: BushMeshNodeRole | number;
  protocolMinVersion: number;
  protocolMaxVersion: number;
  batteryPercent?: number;
  dictionaryVersion?: number;
};

export function hasBushMeshCapability(
  capabilities: number,
  capability: BushMeshCapability,
): boolean {
  return (capabilities & capability) !== 0;
}

export function negotiateBushMeshCapabilities(
  localCapabilities: number,
  remoteCapabilities: number,
): number {
  return localCapabilities & remoteCapabilities;
}

export function encodeNodeHello(hello: BushMeshNodeHello): number[] {
  assertIntegerInRange(hello.nodeId, 0, 0xffffffff, 'Node ID');
  assertIntegerInRange(hello.capabilities, 0, 0x7fffffff, 'Capabilities');
  assertIntegerInRange(hello.role, 0, 15, 'Node role');
  assertIntegerInRange(
    hello.protocolMinVersion,
    0,
    15,
    'Minimum protocol version',
  );
  assertIntegerInRange(
    hello.protocolMaxVersion,
    hello.protocolMinVersion,
    15,
    'Maximum protocol version',
  );

  const hasBattery = hello.batteryPercent !== undefined;
  const hasDictionaryVersion = hello.dictionaryVersion !== undefined;

  if (hasBattery) {
    assertIntegerInRange(hello.batteryPercent!, 0, 100, 'Battery percentage');
  }
  if (hasDictionaryVersion) {
    assertIntegerInRange(hello.dictionaryVersion!, 0, 255, 'Dictionary version');
  }

  const versionByte =
    (hello.protocolMinVersion << 4) | hello.protocolMaxVersion;
  const roleFlags =
    (hello.role << 1) |
    (hasBattery ? 0x01 : 0) |
    (hasDictionaryVersion ? 0x80 : 0);

  return [
    versionByte,
    roleFlags,
    ...encodeVarUint(hello.nodeId),
    ...encodeVarUint(hello.capabilities),
    ...(hasBattery ? [hello.batteryPercent!] : []),
    ...(hasDictionaryVersion ? [hello.dictionaryVersion!] : []),
  ];
}

export function decodeNodeHello(bytes: number[]): BushMeshNodeHello {
  assertBytes(bytes);

  if (bytes.length < 4) {
    throw new Error('Node hello payload is too short.');
  }

  const versionByte = bytes[0];
  const roleFlags = bytes[1];
  const nodeId = decodeVarUint(bytes, 2);
  const capabilities = decodeVarUint(bytes, nodeId.nextOffset);
  const hasBattery = (roleFlags & 0x01) !== 0;
  const hasDictionaryVersion = (roleFlags & 0x80) !== 0;
  let cursor = capabilities.nextOffset;
  let batteryPercent: number | undefined;
  let dictionaryVersion: number | undefined;

  if (hasBattery) {
    batteryPercent = bytes[cursor];
    if (batteryPercent === undefined || batteryPercent > 100) {
      throw new Error('Node hello battery percentage is invalid.');
    }
    cursor += 1;
  }

  if (hasDictionaryVersion) {
    dictionaryVersion = bytes[cursor];
    if (dictionaryVersion === undefined) {
      throw new Error('Node hello dictionary version is missing.');
    }
    cursor += 1;
  }

  if (bytes.length !== cursor) {
    throw new Error('Unexpected bytes after node hello payload.');
  }

  return {
    nodeId: nodeId.value,
    capabilities: capabilities.value,
    role: (roleFlags >> 1) & 0x0f,
    protocolMinVersion: versionByte >> 4,
    protocolMaxVersion: versionByte & 0x0f,
    batteryPercent,
    dictionaryVersion,
  };
}

export type BushMeshPing = {
  nonce: number;
  senderTimeSeconds?: number;
  response?: boolean;
};

export function encodePing(ping: BushMeshPing): number[] {
  assertIntegerInRange(ping.nonce, 0, 0xffffffff, 'Ping nonce');
  const hasTime = ping.senderTimeSeconds !== undefined;

  if (hasTime) {
    assertIntegerInRange(
      ping.senderTimeSeconds!,
      0,
      0xffffffff,
      'Ping sender time',
    );
  }

  const flags = (hasTime ? 0x01 : 0) | (ping.response ? 0x02 : 0);

  return [
    flags,
    ...encodeVarUint(ping.nonce),
    ...(hasTime ? encodeVarUint(ping.senderTimeSeconds!) : []),
  ];
}

export function decodePing(bytes: number[]): BushMeshPing {
  assertBytes(bytes);

  if (bytes.length < 2) {
    throw new Error('Ping payload is too short.');
  }

  const hasTime = (bytes[0] & 0x01) !== 0;
  const response = (bytes[0] & 0x02) !== 0;
  const nonce = decodeVarUint(bytes, 1);
  let cursor = nonce.nextOffset;
  let senderTimeSeconds: number | undefined;

  if (hasTime) {
    const senderTime = decodeVarUint(bytes, cursor);
    senderTimeSeconds = senderTime.value;
    cursor = senderTime.nextOffset;
  }

  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after ping payload.');
  }

  return {nonce: nonce.value, senderTimeSeconds, response};
}

export function createPong(
  ping: BushMeshPing,
  senderTimeSeconds?: number,
): BushMeshPing {
  if (ping.response) {
    throw new Error('Cannot create a PONG in response to another PONG.');
  }

  return {
    nonce: ping.nonce,
    senderTimeSeconds,
    response: true,
  };
}
