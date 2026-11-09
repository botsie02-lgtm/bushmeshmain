/**
 * Transport-neutral shell contract. A MeshCore channel, PSK, invite, contact,
 * or unverified position is NEVER a membership credential.
 *
 * Integration must supply this directory from Security v1's authenticated
 * membership lifecycle. The shell does not implement membership verification.
 */
export type AuthorizedConvoyMembership = {
  convoyId: string;
  displayName: string;
  localIdentityRef: string;
  authorizationState: 'authorized';
  verifiedBy: 'security-v1';
  /** Opaque reference to a verified membership record; never a secret or key. */
  membershipRecordRef: string;
};

export type ActiveConvoySelectionV1 = {
  schema: 'bushmesh-active-convoy-selection';
  version: 1;
  convoyId: string;
  localIdentityRef: string;
};

export interface AuthorizedConvoyDirectory {
  listAuthorized(localIdentityRef: string): Promise<readonly AuthorizedConvoyMembership[]>;
  resolveAuthorized(
    convoyId: string,
    localIdentityRef: string,
  ): Promise<AuthorizedConvoyMembership | null>;
  /** Security v1 notifies on revocation, identity rotation or trust changes. */
  subscribeInvalidations?: (listener: () => void) => () => void;
}

export interface ActiveConvoySelectionStore {
  load(): Promise<unknown>;
  save(value: ActiveConvoySelectionV1): Promise<void>;
  clear(): Promise<void>;
  /** False means navigation choice is session-only, not restart-durable. */
  isDurable(): boolean;
}

export const unavailableConvoyDirectory: AuthorizedConvoyDirectory = {
  async listAuthorized() {
    return [];
  },
  async resolveAuthorized() {
    return null;
  },
};

function validRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9_.:-]+$/.test(value)
  );
}

export function isActiveConvoySelection(
  value: unknown,
): value is ActiveConvoySelectionV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  return (
    keys.join(',') === 'convoyId,localIdentityRef,schema,version' &&
    candidate.schema === 'bushmesh-active-convoy-selection' &&
    candidate.version === 1 &&
    validRef(candidate.convoyId) &&
    validRef(candidate.localIdentityRef)
  );
}

export function checkedMembership(
  membership: unknown,
  convoyId: string | null,
  localIdentityRef: string,
): AuthorizedConvoyMembership | null {
  if (
    typeof membership !== 'object' ||
    membership === null ||
    Array.isArray(membership)
  ) {
    return null;
  }
  const candidate = membership as Record<string, unknown>;
  if (
    !validRef(candidate.convoyId) ||
    (convoyId !== null && candidate.convoyId !== convoyId) ||
    candidate.localIdentityRef !== localIdentityRef ||
    candidate.authorizationState !== 'authorized' ||
    candidate.verifiedBy !== 'security-v1' ||
    !validRef(candidate.membershipRecordRef) ||
    typeof candidate.displayName !== 'string' ||
    candidate.displayName.trim().length === 0 ||
    candidate.displayName.length > 120
  ) {
    return null;
  }
  return {
    convoyId: candidate.convoyId,
    displayName: candidate.displayName.trim(),
    localIdentityRef,
    authorizationState: 'authorized',
    verifiedBy: 'security-v1',
    membershipRecordRef: candidate.membershipRecordRef,
  };
}

export function selectionFor(
  membership: AuthorizedConvoyMembership,
): ActiveConvoySelectionV1 {
  return {
    schema: 'bushmesh-active-convoy-selection',
    version: 1,
    convoyId: membership.convoyId,
    localIdentityRef: membership.localIdentityRef,
  };
}

/**
 * Restore is fail-closed: the stored value alone never authorizes membership.
 * Identity and a live, independently validated Security v1 record are required.
 * No radio/carrier state is consulted here.
 */
export async function restoreActiveConvoy(
  store: ActiveConvoySelectionStore,
  directory: AuthorizedConvoyDirectory,
  localIdentityRef: string | null,
): Promise<AuthorizedConvoyMembership | null> {
  const saved = await store.load();
  if (saved === null || saved === undefined) {
    return null;
  }
  // Identity may not have finished loading; retry once it is available.
  if (!localIdentityRef) {
    return null;
  }
  if (!isActiveConvoySelection(saved) || saved.localIdentityRef !== localIdentityRef) {
    await store.clear();
    return null;
  }
  const membership = checkedMembership(
    await directory.resolveAuthorized(saved.convoyId, localIdentityRef),
    saved.convoyId,
    localIdentityRef,
  );
  if (!membership) {
    await store.clear();
  }
  return membership;
}

export async function resolveConvoySelection(
  convoyId: string,
  localIdentityRef: string | null,
  directory: AuthorizedConvoyDirectory,
): Promise<AuthorizedConvoyMembership | null> {
  if (!localIdentityRef || !validRef(convoyId)) {
    return null;
  }
  return checkedMembership(
    await directory.resolveAuthorized(convoyId, localIdentityRef),
    convoyId,
    localIdentityRef,
  );
}

export async function listSelectableConvoys(
  directory: AuthorizedConvoyDirectory,
  localIdentityRef: string | null,
): Promise<AuthorizedConvoyMembership[]> {
  if (!localIdentityRef) {
    return [];
  }
  const all = await directory.listAuthorized(localIdentityRef);
  const unique = new Map<string, AuthorizedConvoyMembership>();
  for (const item of all) {
    const checked = checkedMembership(item, null, localIdentityRef);
    if (checked) {
      unique.set(checked.convoyId, checked);
    }
  }
  return Array.from(unique.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

/** Test-only analogue: this does NOT survive actual process death. */
export class MemoryActiveConvoySelectionStore implements ActiveConvoySelectionStore {
  private value: unknown = null;

  constructor(initial: unknown = null) {
    this.value = initial;
  }

  async load(): Promise<unknown> {
    return this.value;
  }

  async save(value: ActiveConvoySelectionV1): Promise<void> {
    this.value = {...value};
  }

  async clear(): Promise<void> {
    this.value = null;
  }

  isDurable(): boolean {
    return false;
  }
}
