import {Buffer} from 'buffer';

/**
 * DISTINCT from Protocol v1 and Security v1. Channel text is never a verified
 * sender identity, an authorized convoy position, or a delivery receipt.
 */
export const CHANNEL_FIELD_PREFIX = 'BMFL1';
export const CHANNEL_FIELD_MAX_UTF8_BYTES = 110;
export const CHANNEL_FIELD_MAX_FIX_AGE_MS = 30_000;
export const CHANNEL_FIELD_MAX_MESSAGE_AGE_MS = 90_000;
export const CHANNEL_FIELD_MAX_FUTURE_MS = 5_000;

export type UnverifiedChannelPositionWire = {
  /** Sender-chosen, per-manual-session nonce, NOT an authentication identity. */
  session: string;
  sequence: number;
  issuedAtMs: number;
  latitude: number;
  longitude: number;
  /** Sender-claimed label; always displayed as UNVERIFIED. */
  claimedLabel: string;
};

const TOKEN = /^[a-f0-9]{24}$/;
const LABEL = /^[A-Za-z0-9_-]{1,12}$/;
const POSITIVE_DECIMAL = /^(0|[1-9][0-9]*)$/;
const SIGNED_DECIMAL = /^-?(0|[1-9][0-9]*)$/;
const MAX_U32 = 0xffffffff;

function whole(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function channelFieldSessionToken(bytes: Uint8Array): string {
  if (bytes.length !== 12) {
    throw new Error('Field-test session requires 12 secure random bytes.');
  }
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function encodeUnverifiedChannelPosition(value: UnverifiedChannelPositionWire): string {
  if (!TOKEN.test(value.session) ||
      !whole(value.sequence, 1, MAX_U32) ||
      !whole(value.issuedAtMs, 1, 9_999_999_999_999) ||
      !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
      value.latitude < -90 || value.latitude > 90 ||
      value.longitude < -180 || value.longitude > 180 ||
      !LABEL.test(value.claimedLabel)) {
    throw new Error('Invalid unverified field position.');
  }
  const text = [
    CHANNEL_FIELD_PREFIX, value.session, String(value.sequence),
    String(value.issuedAtMs), String(Math.round(value.latitude * 100_000)),
    String(Math.round(value.longitude * 100_000)), value.claimedLabel,
  ].join('|');
  if (Buffer.byteLength(text, 'utf8') > CHANNEL_FIELD_MAX_UTF8_BYTES) {
    throw new Error('Field position exceeds channel text capacity.');
  }
  return text;
}

/** Strict, bounded ASCII protocol used ONLY by the opt-in field-test adapter. */
export function decodeUnverifiedChannelPosition(text: string): UnverifiedChannelPositionWire | null {
  if (typeof text !== 'string' ||
      Buffer.byteLength(text, 'utf8') > CHANNEL_FIELD_MAX_UTF8_BYTES ||
      text.length < 20) return null;
  const parts = text.split('|');
  if (parts.length !== 7 || parts[0] !== CHANNEL_FIELD_PREFIX ||
      !TOKEN.test(parts[1]) || !POSITIVE_DECIMAL.test(parts[2]) ||
      !POSITIVE_DECIMAL.test(parts[3]) || !SIGNED_DECIMAL.test(parts[4]) ||
      !SIGNED_DECIMAL.test(parts[5]) || !LABEL.test(parts[6])) return null;
  const sequence = Number(parts[2]);
  const issuedAtMs = Number(parts[3]);
  const latE5 = Number(parts[4]);
  const lonE5 = Number(parts[5]);
  if (!whole(sequence, 1, MAX_U32) ||
      !whole(issuedAtMs, 1, 9_999_999_999_999) ||
      !whole(latE5, -9_000_000, 9_000_000) ||
      !whole(lonE5, -18_000_000, 18_000_000)) return null;
  return {
    session: parts[1],
    sequence,
    issuedAtMs,
    latitude: latE5 / 100_000,
    longitude: lonE5 / 100_000,
    claimedLabel: parts[6],
  };
}
