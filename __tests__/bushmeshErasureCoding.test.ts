import {
  createXorParityGroups,
  recoverSingleMissingChunk,
} from '../src/bushmesh/protocol';

describe('Bushmesh experimental XOR erasure coding', () => {
  test('recovers one missing chunk in a parity group', () => {
    const chunks = [
      [1, 2, 3, 4],
      [10, 11, 12, 13],
      [20, 21, 22, 23],
      [30, 31],
    ];
    const groups = createXorParityGroups(chunks, 4);
    expect(groups).toHaveLength(1);

    const recovered = recoverSingleMissingChunk(groups[0], [
      chunks[0],
      null,
      chunks[2],
      chunks[3],
    ]);
    expect(recovered).toEqual({chunkIndex: 1, bytes: chunks[1]});
  });

  test('does not pretend to recover when more than one chunk is missing', () => {
    const chunks = [[1, 2], [3, 4], [5, 6], [7, 8]];
    const group = createXorParityGroups(chunks, 4)[0];
    expect(recoverSingleMissingChunk(group, [chunks[0], null, null, chunks[3]])).toBeNull();
  });
});
