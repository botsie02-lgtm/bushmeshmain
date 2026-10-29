import {WebCryptoProvider, type WebCryptoLike} from '../src/security/webCryptoProvider';
import {IdentityManager} from '../src/security/identity';
import {PeerTrustManager} from '../src/security/trust';
import {VersionPolicy} from '../src/security/versionPolicy';
import {
  InMemorySecretStore,
  InMemorySecurityMetadataStore,
} from '../src/security/testing/InMemorySecurityStores';
import type {SecurityClock} from '../src/security/ports';

const nodeWebCrypto = require('crypto').webcrypto as WebCryptoLike;

export class TestClock implements SecurityClock {
  constructor(private value = 1_800_000_000_000) {}
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

export function createSecurityNode(clock = new TestClock()) {
  const crypto = new WebCryptoProvider(nodeWebCrypto);
  const secrets = new InMemorySecretStore();
  const metadata = new InMemorySecurityMetadataStore();
  const identity = new IdentityManager(crypto, secrets, metadata, clock);
  const versions = new VersionPolicy([1], [1], 1, 1);
  const trust = new PeerTrustManager(crypto, metadata, identity, clock);
  return {crypto, secrets, metadata, identity, versions, trust, clock};
}

export async function mutuallyTrust(a: ReturnType<typeof createSecurityNode>, b: ReturnType<typeof createSecurityNode>) {
  const aIdentity = await a.identity.loadOrCreate();
  const bIdentity = await b.identity.loadOrCreate();
  await a.trust.observe(bIdentity);
  await a.trust.trust(bIdentity.deviceId, bIdentity.fingerprint);
  await b.trust.observe(aIdentity);
  await b.trust.trust(aIdentity.deviceId, aIdentity.fingerprint);
  return {aIdentity, bIdentity};
}
