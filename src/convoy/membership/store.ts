import {Buffer} from 'buffer';
import type {SecureSecretStore} from '../../security/ports';
import {
  ConvoyMembershipSnapshot,
  emptyConvoyMembershipSnapshot,
  parseConvoyMembershipSnapshot,
} from './model';

/**
 * Storage must use durable, atomic replacement and protected at-rest storage.
 * One ConvoyMembershipService must own writes per profile; no cross-process CAS
 * is provided by Security v1's SecureSecretStore interface.
 */
export interface ConvoyMembershipStore {
  load(): Promise<ConvoyMembershipSnapshot>;
  save(value: ConvoyMembershipSnapshot): Promise<void>;
  isDurable(): boolean;
}

/** Test/session-only implementation; never claim that it survives restart. */
export class MemoryConvoyMembershipStore implements ConvoyMembershipStore {
  private value = emptyConvoyMembershipSnapshot();

  async load(): Promise<ConvoyMembershipSnapshot> {
    return parseConvoyMembershipSnapshot(this.value);
  }

  async save(value: ConvoyMembershipSnapshot): Promise<void> {
    this.value = parseConvoyMembershipSnapshot(value);
  }

  isDurable(): boolean {
    return false;
  }
}

/**
 * Security-v1-backed encrypted/protected storage adapter. Requires an actual
 * provisioned SecureSecretStore; never uses carrier settings or AsyncStorage.
 * A production provider must guarantee atomic durable setSecret() replacement.
 * Saved metadata is NOT proof of membership; every read is reverified against
 * the Security v1 group epoch and local identity.
 */
export class SecureConvoyMembershipStore implements ConvoyMembershipStore {
  private readonly key = 'bushmesh/convoy/membership/v2';

  constructor(
    private readonly secrets: SecureSecretStore,
    private readonly durable = false,
  ) {}

  async load(): Promise<ConvoyMembershipSnapshot> {
    const raw = await this.secrets.getSecret(this.key);
    if (raw === null) {
      return emptyConvoyMembershipSnapshot();
    }
    try {
      if (raw.length > 131072) {
        throw new Error('Oversized membership snapshot');
      }
      return parseConvoyMembershipSnapshot(JSON.parse(Buffer.from(raw).toString('utf8')));
    } finally {
      raw.fill(0);
    }
  }

  async save(value: ConvoyMembershipSnapshot): Promise<void> {
    const checked = parseConvoyMembershipSnapshot(value);
    const raw = new Uint8Array(Buffer.from(JSON.stringify(checked), 'utf8'));
    try {
      if (raw.length > 131072) {
        throw new Error('Oversized membership snapshot');
      }
      await this.secrets.setSecret(this.key, raw);
    } finally {
      raw.fill(0);
    }
  }

  isDurable(): boolean {
    // Explicit production opt-in; do not infer durability from the interface.
    return this.durable;
  }
}
