import {Buffer} from 'buffer';
import {SecurityError} from './errors';

export function utf8(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'utf8'));
}

export function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function fromBase64Url(value: string, expectedLength?: number): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new SecurityError('INVALID_INPUT', 'Invalid base64url input');
  }
  const padding = (4 - (value.length % 4)) % 4;
  const decoded = Uint8Array.from(
    Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding), 'base64'),
  );
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new SecurityError(
      'INVALID_INPUT',
      `Expected ${expectedLength} bytes but received ${decoded.length}`,
    );
  }
  return decoded;
}

export function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((sum, value) => sum + value.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

export function u32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new SecurityError('INVALID_INPUT', 'u32 value out of range');
  }
  const output = new Uint8Array(4);
  output[0] = (value >>> 24) & 0xff;
  output[1] = (value >>> 16) & 0xff;
  output[2] = (value >>> 8) & 0xff;
  output[3] = value & 0xff;
  return output;
}

export function u64be(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new SecurityError('INVALID_INPUT', 'u64 value out of range');
  }
  const output = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

export function encodeFields(domain: string, fields: Uint8Array[]): Uint8Array {
  const encoded: Uint8Array[] = [];
  const domainBytes = utf8(domain);
  encoded.push(u32be(domainBytes.length), domainBytes);
  for (const field of fields) {
    encoded.push(u32be(field.length), field);
  }
  return concatBytes(...encoded);
}

export function encodeNumberList(values: number[]): Uint8Array {
  const unique = [...new Set(values)];
  if (unique.length !== values.length) {
    throw new SecurityError('INVALID_INPUT', 'Version list contains duplicates');
  }
  return concatBytes(u32be(values.length), ...values.map(u32be));
}

export function wipe(value: Uint8Array | undefined): void {
  value?.fill(0);
}

export function parseCounter(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new SecurityError('INVALID_INPUT', 'Invalid monotonic counter');
  }
  const counter = BigInt(value);
  if (counter > 0xffffffffffffffffn) {
    throw new SecurityError('INVALID_INPUT', 'Counter exceeds u64 range');
  }
  return counter;
}
