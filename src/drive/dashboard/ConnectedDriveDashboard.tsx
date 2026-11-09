import React from 'react';
import {BushMeshQuickActionCode} from '../../bushmesh/legacyProtocol';
import {DriveDashboard} from './DriveDashboard';
import type {DriveDashboardProps} from './DriveDashboard';
import {
  useDriveDashboardController,
  type DriveDashboardTrustedInputs,
} from './useDriveDashboardController';

/**
 * Drop-in host for the five-tab App Shell. This is intentionally NOT wired
 * into AppShell or DriveScreen by this feature branch.
 */
export type ConnectedDriveDashboardProps = DriveDashboardTrustedInputs &
  Pick<DriveDashboardProps,
    'onOpenMap' | 'onOpenConvoy' | 'onOpenRadio' | 'onOpenDevice' |
    'onDismissVerifiedAlert' | 'showInlineMap'
  >;

export function ConnectedDriveDashboard(
  props: ConnectedDriveDashboardProps,
): React.JSX.Element {
  const controller = useDriveDashboardController({
    roster: props.roster ?? null,
    verifiedAlerts: props.verifiedAlerts ?? null,
    carrierBinding: props.carrierBinding ?? null,
  });

  const requestAction = (code: BushMeshQuickActionCode) => {
    controller.performAction(code).catch(() => undefined);
  };

  return (
    <DriveDashboard
      model={controller.model}
      packCatalog={controller.packCatalog}
      onOpenMap={props.onOpenMap}
      onOpenConvoy={props.onOpenConvoy}
      onOpenRadio={props.onOpenRadio}
      onOpenDevice={props.onOpenDevice}
      onDismissVerifiedAlert={props.onDismissVerifiedAlert}
      showInlineMap={props.showInlineMap}
      onQuickAction={requestAction}
      busyAction={controller.busyAction}
      actionResult={controller.actionResult}
    />
  );
}
