import {
  AuthorizedConvoyDirectory,
  AuthorizedConvoyMembership,
  MemoryActiveConvoySelectionStore,
  checkedMembership,
  isActiveConvoySelection,
  listSelectableConvoys,
  resolveConvoySelection,
  restoreActiveConvoy,
  selectionFor,
  unavailableConvoyDirectory,
} from '../src/app/activeContext/operationalConvoy';

const member: AuthorizedConvoyMembership = {
  convoyId: 'C0FFEE1200AB1234',
  displayName: 'High Country Patrol',
  localIdentityRef: 'LOCAL_ID_1',
  authorizationState: 'authorized',
  verifiedBy: 'security-v1',
  membershipRecordRef: 'verified-record-42',
};

function directory(
  records: readonly AuthorizedConvoyMembership[] = [member],
): AuthorizedConvoyDirectory {
  return {
    async listAuthorized() {
      return records;
    },
    async resolveAuthorized(id, identity) {
      return records.find(record =>
        record.convoyId === id && record.localIdentityRef === identity,
      ) ?? null;
    },
  };
}

test('no implicit public MeshCore channel, contact or carrier invite becomes an operational convoy', async () => {
  const store = new MemoryActiveConvoySelectionStore({
    convoyId: member.convoyId,
    convoyName: member.displayName,
    channelIndex: 0,
    secretHex: '00000000000000000000000000000000',
  });
  expect(await restoreActiveConvoy(store, directory(), 'LOCAL_ID_1')).toBeNull();
  expect(await store.load()).toBeNull();
  expect(await listSelectableConvoys(unavailableConvoyDirectory, 'LOCAL_ID_1')).toEqual([]);
  expect(await resolveConvoySelection(member.convoyId, 'LOCAL_ID_1', unavailableConvoyDirectory)).toBeNull();
});

test('selection stores only ID and public identity reference, never credentials', () => {
  const selection = selectionFor(member);
  expect(Object.keys(selection).sort()).toEqual([
    'convoyId',
    'localIdentityRef',
    'schema',
    'version',
  ]);
  expect(JSON.stringify(selection)).not.toContain('secretHex');
  expect(JSON.stringify(selection)).not.toContain('membershipRecordRef');
  expect(isActiveConvoySelection(selection)).toBe(true);
  expect(isActiveConvoySelection({...selection, psk: 'secret'})).toBe(false);
});

test('app restart restores only with matching identity and freshly verified membership', async () => {
  const store = new MemoryActiveConvoySelectionStore();
  await store.save(selectionFor(member));
  const firstLaunch = await restoreActiveConvoy(store, directory(), 'LOCAL_ID_1');
  expect(firstLaunch).toEqual(member);

  // A new provider/application instance can only restore after revalidation.
  const secondLaunch = await restoreActiveConvoy(store, directory(), 'LOCAL_ID_1');
  expect(secondLaunch).toEqual(member);

  expect(await restoreActiveConvoy(store, directory([]), 'LOCAL_ID_1')).toBeNull();
  expect(await store.load()).toBeNull();
});

test('missing radio identity never activates; identity rotation clears incompatible selection', async () => {
  const store = new MemoryActiveConvoySelectionStore(selectionFor(member));
  expect(await restoreActiveConvoy(store, directory(), null)).toBeNull();
  expect(await store.load()).toEqual(selectionFor(member));
  expect(await restoreActiveConvoy(store, directory(), 'DIFFERENT_ID')).toBeNull();
  expect(await store.load()).toBeNull();
});

test('rejected, forged or carrier-only membership entries never pass the trust boundary', async () => {
  const bad = [
    {...member, authorizationState: 'pending'},
    {...member, verifiedBy: 'meshcore-channel'},
    {...member, membershipRecordRef: ''},
    {...member, localIdentityRef: 'OTHER_RADIO'},
    {...member, convoyId: 'OTHER_CONVOY'},
  ];
  for (const record of bad) {
    expect(checkedMembership(record, member.convoyId, 'LOCAL_ID_1')).toBeNull();
  }
  expect(await resolveConvoySelection(
    member.convoyId,
    'LOCAL_ID_1',
    directory([{...member, authorizationState: 'authorized'}]),
  )).toEqual(member);
});

test('selection choices exclude mismatched identities and invalid/unverified records', async () => {
  const values = await listSelectableConvoys(directory([
    member,
    member,
    {...member, convoyId: 'B2', displayName: 'Other Group'},
    {...member, convoyId: 'A3', localIdentityRef: 'FOREIGN_DEVICE'},
    {...member, convoyId: 'D4', verifiedBy: 'security-v1'},
  ]), 'LOCAL_ID_1');
  expect(values.map(value => value.convoyId)).toEqual(['C0FFEE1200AB1234', 'B2', 'D4'].sort((a, b) => {
    const names: Record<string, string> = {
      C0FFEE1200AB1234: 'High Country Patrol',
      B2: 'Other Group',
      D4: 'High Country Patrol',
    };
    return names[a].localeCompare(names[b]);
  }));
});
