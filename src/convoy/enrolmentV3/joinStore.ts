import {Buffer} from 'buffer';
import type {SecureSecretStore} from '../../security/ports';
import {
  JoinObservationJournalV3,
  parseJoinObservationJournal,
} from './joinState';
import {assertReference} from './contract';

export interface JoinObservationStore {
  load(localIdentityRef: string): Promise<JoinObservationJournalV3>;
  save(journal: JoinObservationJournalV3): Promise<void>;
  isDurable(): boolean;
}

function fresh(localIdentityRef: string): JoinObservationJournalV3 {
  assertReference(localIdentityRef, 'journal identity');
  return {schema: 'bushmesh-enrolment-journal-v3', version: 3,
    localIdentityRef, records: []};
}

export class MemoryJoinObservationStore implements JoinObservationStore {
  private journal: JoinObservationJournalV3 | null = null;
  async load(localIdentityRef: string): Promise<JoinObservationJournalV3> {
    const stored = this.journal;
    if (stored && stored.localIdentityRef !== localIdentityRef) {
      throw new Error('Journal identity changed');
    }
    return stored ? parseJoinObservationJournal(stored) : fresh(localIdentityRef);
  }
  async save(journal: JoinObservationJournalV3): Promise<void> {
    this.journal = parseJoinObservationJournal(journal);
  }
  isDurable(): boolean {
    return false;
  }
}

/**
 * Protected, versioned observation metadata. Contains no group keys, nonces,
 * PSKs, cryptographic approval proofs or transmitted envelopes. The injected
 * provider must explicitly guarantee protected atomic, durable replacement.
 * This journal is NOT an anti-rollback anchor or a membership credential.
 */
export class ProtectedJoinObservationStore implements JoinObservationStore {
  private readonly key = 'bushmesh/convoy/enrolment-v3/observations';
  constructor(private readonly secrets: SecureSecretStore,
    private readonly durable = false) {}

  async load(localIdentityRef: string): Promise<JoinObservationJournalV3> {
    const bytes = await this.secrets.getSecret(this.key);
    if (!bytes) {
      return fresh(localIdentityRef);
    }
    try {
      if (bytes.length > 65536) {
        throw new Error('Oversized protected enrolment journal');
      }
      const parsed = parseJoinObservationJournal(JSON.parse(Buffer.from(bytes).toString('utf8')));
      if (parsed.localIdentityRef !== localIdentityRef) {
        throw new Error('Protected enrolment journal bound to another local identity');
      }
      return parsed;
    } finally {
      bytes.fill(0);
    }
  }

  async save(journal: JoinObservationJournalV3): Promise<void> {
    const safe = parseJoinObservationJournal(journal);
    const bytes = Uint8Array.from(Buffer.from(JSON.stringify(safe), 'utf8'));
    try {
      if (bytes.length > 65536) {
        throw new Error('Oversized protected enrolment journal');
      }
      await this.secrets.setSecret(this.key, bytes);
    } finally {
      bytes.fill(0);
    }
  }

  isDurable(): boolean {
    return this.durable;
  }
}
