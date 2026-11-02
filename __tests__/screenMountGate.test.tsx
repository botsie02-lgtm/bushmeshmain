import React, {useEffect} from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {ScreenMountGate} from '../src/app/ScreenMountGate';

describe('ScreenMountGate', () => {
  test('inactive screens unmount and release subscriptions', async () => {
    let mounts = 0;
    let cleanups = 0;

    function ResourceProbe(): React.JSX.Element | null {
      useEffect(() => {
        mounts += 1;
        return () => {
          cleanups += 1;
        };
      }, []);
      return null;
    }

    let renderer: ReactTestRenderer.ReactTestRenderer | null = null;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ScreenMountGate active={true}>
          <ResourceProbe />
        </ScreenMountGate>,
      );
    });
    expect(mounts).toBe(1);
    expect(cleanups).toBe(0);

    await ReactTestRenderer.act(() => {
      renderer?.update(
        <ScreenMountGate active={false}>
          <ResourceProbe />
        </ScreenMountGate>,
      );
    });
    expect(cleanups).toBe(1);

    await ReactTestRenderer.act(() => {
      renderer?.update(
        <ScreenMountGate active={true}>
          <ResourceProbe />
        </ScreenMountGate>,
      );
    });
    expect(mounts).toBe(2);

    await ReactTestRenderer.act(() => {
      renderer?.unmount();
    });
    expect(cleanups).toBe(2);
  });
});
