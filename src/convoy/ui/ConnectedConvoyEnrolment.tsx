import React from 'react';
import {ConvoyEnrolmentScreen} from './ConvoyEnrolmentScreen';
import type {ConvoyEnrolmentScreenProps} from './ConvoyEnrolmentScreen';
import {
  useConvoyEnrolmentUi,
  type ConvoyEnrolmentUiDependencies,
} from './useConvoyEnrolmentUi';

/**
 * Staging adapter for the existing Convoy tab; no AppShell files are changed.
 * The production Security/ConvoyMembershipService singleton is an explicit
 * dependency, NOT silently synthesized from MeshCore contacts or channels.
 */
export type ConnectedConvoyEnrolmentProps =
  ConvoyEnrolmentUiDependencies &
  Pick<ConvoyEnrolmentScreenProps, 'onOpenDrive' | 'onOpenMap'>;

export function ConnectedConvoyEnrolment(
  props: ConnectedConvoyEnrolmentProps,
): React.JSX.Element {
  const state = useConvoyEnrolmentUi(props);
  return (
    <ConvoyEnrolmentScreen
      view={state.view}
      busy={state.busy}
      notice={state.notice}
      onRefresh={() => {state.refresh().catch(() => undefined);}}
      onCreate={name => {state.create(name).catch(() => undefined);}}
      onSelect={convoyId => {state.select(convoyId).catch(() => undefined);}}
      onPrepareInvite={(deviceId, fingerprint, expiresAt) => {
        state.prepareInvite(deviceId, fingerprint, expiresAt).catch(() => undefined);
      }}
      onCancelInvite={id => {state.cancelInvite(id).catch(() => undefined);}}
      onApprove={id => {state.approve(id).catch(() => undefined);}}
      onReject={id => {state.reject(id).catch(() => undefined);}}
      onRemoveMember={deviceId => {state.remove(deviceId).catch(() => undefined);}}
      onRequestJoin={id => {state.requestJoin(id).catch(() => undefined);}}
      onOpenDrive={props.onOpenDrive}
      onOpenMap={props.onOpenMap}
    />
  );
}
