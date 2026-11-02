import {Buffer} from 'buffer';

import {assertBytes, decodeVarUint, encodeVarUint} from './codec';

export const BUSHMESH_TEXT_DICTIONARY_VERSION = 1;

// Dictionary IDs are part of the over-the-air protocol. Append new entries, but
// do not reorder or remove existing entries once devices depend on them.
export const BUSHMESH_TEXT_DICTIONARY: readonly string[] = [
  '',
  'heading back to ',
  'Heading back to ',
  'meet me at ',
  'Meet me at ',
  'back to ',
  'location',
  'battery',
  'vehicle',
  'camp',
  'home',
  'water',
  'medical',
  'help',
  'returning',
  'Returning',
  'arrived',
  'Arrived',
  'need ',
  'Need ',
  'ETA ',
  'eta ',
  ' minutes',
  ' minute',
  'where are you',
  'Where are you',
  'I am ',
  'i am ',
  'safe',
  'problem',
  'the ',
  'and ',
  'you',
  ' to ',
  ' at ',
  ' in ',
  ' now',
  ' yes',
  ' no',
  ' ok',
  'YES',
  'NO',
  'OK',
  'north',
  'south',
  'east',
  'west',
  'km',
  'metres',
  'meters',
  'track',
  'route',
  'checkpoint',
  'rendezvous',
  'emergency',
  'Emergency',
  'assistance',
  'food',
  'fuel',
  'phone',
  'radio',
  'signal',
  'copy',
  'received',
] as const;

const RAW_LITERAL = 0x00;

const dictionaryMatches = BUSHMESH_TEXT_DICTIONARY.map((value, id) => ({
  id,
  value,
}))
  .filter(entry => entry.id > 0 && entry.value.length > 0)
  .sort((a, b) => b.value.length - a.value.length);

function flushLiteral(literal: string, output: number[]): void {
  if (!literal) {
    return;
  }

  const bytes = Array.from(Buffer.from(literal, 'utf8'));
  output.push(RAW_LITERAL, ...encodeVarUint(bytes.length), ...bytes);
}

export function encodeDictionaryText(text: string): number[] {
  const output: number[] = [];
  let literal = '';
  let cursor = 0;

  while (cursor < text.length) {
    const match = dictionaryMatches.find(entry =>
      text.startsWith(entry.value, cursor),
    );

    if (!match) {
      literal += text[cursor];
      cursor += 1;
      continue;
    }

    flushLiteral(literal, output);
    literal = '';
    output.push(match.id);
    cursor += match.value.length;
  }

  flushLiteral(literal, output);
  return output;
}

export function decodeDictionaryText(bytes: number[]): string {
  assertBytes(bytes, 'dictionary payload');
  let cursor = 0;
  let text = '';

  while (cursor < bytes.length) {
    const token = bytes[cursor];
    cursor += 1;

    if (token === RAW_LITERAL) {
      const length = decodeVarUint(bytes, cursor);
      cursor = length.nextOffset;
      const end = cursor + length.value;

      if (end > bytes.length) {
        throw new Error('Dictionary text literal is truncated.');
      }

      text += Buffer.from(bytes.slice(cursor, end)).toString('utf8');
      cursor = end;
      continue;
    }

    const value = BUSHMESH_TEXT_DICTIONARY[token];

    if (value === undefined || token === 0) {
      throw new Error(`Unknown dictionary token ${token}.`);
    }

    text += value;
  }

  return text;
}

export type DictionaryCompressionResult = {
  rawBytes: number[];
  dictionaryBytes: number[];
  useDictionary: boolean;
  savingsBytes: number;
};

export function compareDictionaryCompression(
  text: string,
): DictionaryCompressionResult {
  const rawBytes = Array.from(Buffer.from(text, 'utf8'));
  const dictionaryBytes = encodeDictionaryText(text);

  return {
    rawBytes,
    dictionaryBytes,
    useDictionary: dictionaryBytes.length < rawBytes.length,
    savingsBytes: Math.max(0, rawBytes.length - dictionaryBytes.length),
  };
}
