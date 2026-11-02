export type BushMeshPacketClock = {
  timestampSeconds: number;
  sequence: number;
};

export type BushMeshPacketOrder = 'newer' | 'duplicate' | 'older';

const UINT16_MODULUS = 0x10000;
const UINT16_HALF_RANGE = 0x8000;

function validateClock(clock: BushMeshPacketClock): void {
  if (!Number.isFinite(clock.timestampSeconds) || clock.timestampSeconds < 0) {
    throw new Error('Bushmesh packet timestamp must be a non-negative number.');
  }

  if (!Number.isInteger(clock.sequence) || clock.sequence < 0 || clock.sequence > 0xffff) {
    throw new Error('Bushmesh packet sequence must be a uint16 value.');
  }
}

/**
 * Orders application packets without assuming uint16 sequence numbers grow
 * forever. Timestamps are authoritative across app/radio restarts; sequence is
 * only used to order packets sharing the same timestamp second.
 */
export function compareBushMeshPacketClock(
  current: BushMeshPacketClock,
  incoming: BushMeshPacketClock,
): BushMeshPacketOrder {
  validateClock(current);
  validateClock(incoming);

  if (incoming.timestampSeconds > current.timestampSeconds) {
    return 'newer';
  }
  if (incoming.timestampSeconds < current.timestampSeconds) {
    return 'older';
  }
  if (incoming.sequence === current.sequence) {
    return 'duplicate';
  }

  const forwardDistance =
    (incoming.sequence - current.sequence + UINT16_MODULUS) % UINT16_MODULUS;

  return forwardDistance > 0 && forwardDistance < UINT16_HALF_RANGE
    ? 'newer'
    : 'older';
}

export function isNewerBushMeshPacket(
  current: BushMeshPacketClock | null | undefined,
  incoming: BushMeshPacketClock,
): boolean {
  if (!current) {
    validateClock(incoming);
    return true;
  }

  return compareBushMeshPacketClock(current, incoming) === 'newer';
}
