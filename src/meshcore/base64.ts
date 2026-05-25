import {Buffer} from 'buffer';

export function base64ToHex(value: string): string {
  return Buffer.from(value, 'base64')
    .toString('hex')
    .match(/.{1,2}/g)
    ?.join(' ')
    .toUpperCase() ?? '';
}