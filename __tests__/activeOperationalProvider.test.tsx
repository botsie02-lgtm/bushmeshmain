import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  ActiveOperationalConvoyContextValue,
  ActiveOperationalConvoyProvider,
  useActiveOperationalConvoy,
} from '../src/app/activeContext/ActiveOperationalConvoyContext';
import {
  AuthorizedConvoyDirectory,
  AuthorizedConvoyMembership,
  MemoryActiveConvoySelectionStore,
} from '../src/app/activeContext/operationalConvoy';

const verified: AuthorizedConvoyMembership = {
  convoyId: 'C0FFEE1234AABBCC',
  displayName: 'Patrol One',
  localIdentityRef: 'OWN_DEVICE',
  authorizationState: 'authorized',
  verifiedBy: 'security-v1',
  membershipRecordRef: 'record-001',
};

let current: ActiveOperationalConvoyContextValue;

function Probe(): React.JSX.Element | null {
  current = useActiveOperationalConvoy();
  return null;
}

test('new provider instance rechecks membership before restoring active convoy', async () => {
  const store = new MemoryActiveConvoySelectionStore();
  let authorised = true;
  const source: AuthorizedConvoyDirectory = {
    async listAuthorized() {
      return authorised ? [verified] : [];
    },
    async resolveAuthorized(id, identity) {
      return authorised && id === verified.convoyId &&
        identity === verified.localIdentityRef ? verified : null;
    },
  };

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ActiveOperationalConvoyProvider
        localIdentityRef="OWN_DEVICE"
        store={store}
        directory={source}>
        <Probe />
      </ActiveOperationalConvoyProvider>,
    );
  });
  expect(current.activeConvoy).toBeNull();
  expect(current.selectableConvoys).toHaveLength(1);

  await ReactTestRenderer.act(async () => {
    expect(await current.selectConvoy(verified.convoyId)).toBe(true);
  });
  expect(current.activeConvoy?.convoyId).toBe(verified.convoyId);
  await ReactTestRenderer.act(async () => {renderer.unmount();});

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ActiveOperationalConvoyProvider
        localIdentityRef="OWN_DEVICE"
        store={store}
        directory={source}>
        <Probe />
      </ActiveOperationalConvoyProvider>,
    );
  });
  expect(current.activeConvoy?.convoyId).toBe(verified.convoyId);

  // An external revocation must invalidate the active operational context.
  authorised = false;
  await ReactTestRenderer.act(async () => {
    await current.refresh();
  });
  expect(current.activeConvoy).toBeNull();
  expect(await store.load()).toBeNull();
  await ReactTestRenderer.act(async () => {renderer.unmount();});
});

test('radio identity change hides old active convoy without waiting for effects', async () => {
  const store = new MemoryActiveConvoySelectionStore();
  const source: AuthorizedConvoyDirectory = {
    async listAuthorized() {return [verified];},
    async resolveAuthorized() {return verified;},
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ActiveOperationalConvoyProvider localIdentityRef="OWN_DEVICE" store={store} directory={source}>
        <Probe />
      </ActiveOperationalConvoyProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {
    await current.selectConvoy(verified.convoyId);
  });
  expect(current.activeConvoy).not.toBeNull();

  await ReactTestRenderer.act(async () => {
    renderer.update(
      <ActiveOperationalConvoyProvider localIdentityRef="OTHER_DEVICE" store={store} directory={source}>
        <Probe />
      </ActiveOperationalConvoyProvider>,
    );
  });
  expect(current.activeConvoy).toBeNull();
  expect(await store.load()).toBeNull();
  await ReactTestRenderer.act(async () => {renderer.unmount();});
});
