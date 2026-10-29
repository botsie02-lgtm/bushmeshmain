import {concatBytes, fromBase64Url, u64be} from './bytes';
import {SecurityError} from './errors';
import type {SecurityMetadataStore} from './ports';

export class NonceManager {
  constructor(private readonly metadata: SecurityMetadataStore) {}

  async next(scope: string, prefixBase64Url: string): Promise<{counter: bigint; nonce: Uint8Array}> {
    const prefix = fromBase64Url(prefixBase64Url, 4);
    const highWatermark = await this.metadata.getNonceHighWatermark(scope);
    const counter = await this.metadata.reserveNonceCounter(scope, highWatermark);
    if (counter <= highWatermark) {
      throw new SecurityError(
        'COUNTER_ROLLBACK',
        'Nonce reservation did not advance beyond the persisted high-watermark',
      );
    }
    if (counter > 0xffffffffffffffffn) {
      throw new SecurityError('NONCE_EXHAUSTED', 'Nonce counter exhausted');
    }
    await this.metadata.advanceNonceHighWatermark(scope, counter);
    return {counter, nonce: concatBytes(prefix, u64be(counter))};
  }

  fromCounter(prefixBase64Url: string, counter: bigint): Uint8Array {
    return concatBytes(fromBase64Url(prefixBase64Url, 4), u64be(counter));
  }
}

export class ReplayProtector {
  constructor(
    private readonly metadata: SecurityMetadataStore,
    private readonly windowSize = 128,
  ) {
    if (!Number.isSafeInteger(windowSize) || windowSize < 8 || windowSize > 1024) {
      throw new SecurityError('INVALID_INPUT', 'Replay window must be between 8 and 1024');
    }
  }

  async assertFresh(scope: string, counter: bigint): Promise<void> {
    const accepted = await this.metadata.acceptReplayCounter(scope, counter, this.windowSize);
    if (!accepted) {
      throw new SecurityError('REPLAY_DETECTED', 'Message counter was already seen or is too old');
    }
  }
}
