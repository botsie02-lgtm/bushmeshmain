import React from 'react';

/**
 * Tabs in the current shell are not navigators; inactive screens must therefore
 * be unmounted explicitly. Hiding with display:none leaves effects, BLE/GPS
 * watches, listeners and timers alive.
 */
export function ScreenMountGate({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}): React.JSX.Element | null {
  return active ? <>{children}</> : null;
}
