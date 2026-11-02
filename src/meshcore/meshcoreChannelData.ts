export const MESHCORE_RESP_CHANNEL_DATA_RECV = 0x1b;

export type MeshCoreChannelDataFrame = {
  snrDb: number;
  channelIndex: number;
  pathLength: number;
  dataType: number;
  payload: Uint8Array;
};

/**
 * Parses MeshCore RESP_CODE_CHANNEL_DATA_RECV (0x1B).
 *
 * Layout:
 *  byte 0      response code
 *  byte 1      signed SNR * 4
 *  bytes 2-3   reserved
 *  byte 4      channel index
 *  byte 5      path metadata
 *  bytes 6-7   data type, little-endian
 *  byte 8      payload length
 *  bytes 9...  payload
 */
export function parseMeshCoreChannelDataFrame(
  bytes: number[] | Uint8Array,
): MeshCoreChannelDataFrame | null {
  const frame = Uint8Array.from(bytes);

  if (frame.length === 0 || frame[0] !== MESHCORE_RESP_CHANNEL_DATA_RECV) {
    return null;
  }

  if (frame.length < 9) {
    throw new Error('MeshCore channel-data frame is shorter than 9 bytes.');
  }

  const payloadLength = frame[8];
  const expectedLength = 9 + payloadLength;

  if (frame.length !== expectedLength) {
    throw new Error(
      `MeshCore channel-data frame length ${frame.length} does not match declared payload length ${payloadLength}.`,
    );
  }

  const snrByte = frame[1] > 127 ? frame[1] - 256 : frame[1];
  const dataType = frame[6] | (frame[7] << 8);

  return {
    snrDb: snrByte / 4,
    channelIndex: frame[4],
    pathLength: frame[5],
    dataType,
    payload: frame.slice(9),
  };
}
