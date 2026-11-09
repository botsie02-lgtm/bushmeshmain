import {BushMeshQuickActionCode} from '../../bushmesh/legacyProtocol';
import type {Coordinate} from '../../convoy/convoy';
import {getQuickActionDefinition} from '../quickActions';
import type {DriveDashboardModel} from './driveDashboardModel';
import type {TransmissionAttemptResult} from '../../radio/BushMeshTransmissionController';

export const DASHBOARD_ACTIONS: readonly BushMeshQuickActionCode[] = [
  BushMeshQuickActionCode.Stop,
  BushMeshQuickActionCode.Hazard,
  BushMeshQuickActionCode.Help,
  BushMeshQuickActionCode.Regroup,
];

export type DashboardActionDecision =
  | {mode: 'preview'; reason: string}
  | {
      mode: 'send';
      channelIndex: number;
      position: Coordinate;
      ttlSeconds: number;
    };

export type DashboardActionResult = {
  kind: 'preview' | 'queued' | 'accepted' | 'failed';
  message: string;
};

export type DashboardActionPorts = {
  previewQuickAction: (action: BushMeshQuickActionCode, location: Coordinate | null) => void;
  recordLocalQuickAction: (
    action: BushMeshQuickActionCode,
    location: Coordinate,
    source: 'local-accepted' | 'local-queued' | 'local-failed',
    senderId: string,
    channelIndex: number,
  ) => void;
  queueDriverAction: (input: {
    channelIndex: number;
    sequence: number;
    action: BushMeshQuickActionCode;
    latitude: number;
    longitude: number;
    ttlSeconds: number;
  }) => {id: string};
  drainOnce: () => Promise<TransmissionAttemptResult>;
  identityRef: string | null;
};

export function decideDashboardAction(
  action: BushMeshQuickActionCode,
  model: DriveDashboardModel,
): DashboardActionDecision {
  if (!DASHBOARD_ACTIONS.includes(action)) {
    throw new Error('Unsupported dashboard quick action.');
  }
  if (!model.actionAvailability.canTransmit ||
    model.actionAvailability.channelIndex === null ||
    !model.gps.fix || model.gps.freshness !== 'live' ||
    model.gps.simulated) {
    return {
      mode: 'preview',
      reason: model.actionAvailability.reason ||
        'Fresh, real location and authorised carrier binding are required.',
    };
  }
  const definition = getQuickActionDefinition(action);
  return {
    mode: 'send',
    channelIndex: model.actionAvailability.channelIndex,
    position: {
      latitude: model.gps.fix.latitude,
      longitude: model.gps.fix.longitude,
    },
    ttlSeconds: definition.defaultTtlSeconds,
  };
}

/**
 * Uses the existing application radio queue. "accepted" is only reported when
 * the drain result names the entry just queued, NOT an unrelated outbox entry.
 * Radio acceptance never implies peer receipt/delivery.
 */
export async function performDashboardAction(
  action: BushMeshQuickActionCode,
  model: DriveDashboardModel,
  sequence: number,
  ports: DashboardActionPorts,
): Promise<DashboardActionResult> {
  const decision = decideDashboardAction(action, model);
  if (decision.mode === 'preview' || !ports.identityRef ||
    !Number.isInteger(sequence) || sequence < 1 || sequence > 65535) {
    ports.previewQuickAction(action, null);
    return {
      kind: 'preview',
      message: 'LOCAL PREVIEW ONLY — ' + (decision.mode === 'preview'
        ? decision.reason : 'Radio identity or sequence is unavailable.'),
    };
  }

  const {position, channelIndex, ttlSeconds} = decision;
  let queued: {id: string};
  try {
    queued = ports.queueDriverAction({
      channelIndex,
      sequence,
      action,
      latitude: position.latitude,
      longitude: position.longitude,
      ttlSeconds,
    });
  } catch {
    ports.recordLocalQuickAction(
      action, position, 'local-failed', ports.identityRef, channelIndex,
    );
    return {
      kind: 'failed',
      message: 'ACTION NOT QUEUED — radio submission failed. No delivery confirmed.',
    };
  }

  try {
    const attempt = await ports.drainOnce();
    // The queue can hold earlier traffic. Never misattribute its acceptance.
    if (attempt.entry?.id !== queued.id) {
      ports.recordLocalQuickAction(
        action, position, 'local-queued', ports.identityRef, channelIndex,
      );
      return {
        kind: 'queued',
        message: 'ACTION QUEUED — radio processed other traffic. Delivery unconfirmed.',
      };
    }
    if (attempt.outcome === 'accepted') {
      ports.recordLocalQuickAction(
        action, position, 'local-accepted', ports.identityRef, channelIndex,
      );
      return {
        kind: 'accepted',
        message: 'RADIO ACCEPTED — peer delivery has NOT been confirmed.',
      };
    }
    if (attempt.outcome === 'failed') {
      ports.recordLocalQuickAction(
        action, position, 'local-failed', ports.identityRef, channelIndex,
      );
      return {
        kind: 'failed',
        message: 'RADIO FAILED — action was not confirmed delivered.',
      };
    }
    ports.recordLocalQuickAction(
      action, position, 'local-queued', ports.identityRef, channelIndex,
    );
    return {
      kind: 'queued',
      message: 'ACTION QUEUED — retry pending, delivery unconfirmed.',
    };
  } catch {
    ports.recordLocalQuickAction(
      action, position, 'local-queued', ports.identityRef, channelIndex,
    );
    return {
      kind: 'queued',
      message: 'ACTION QUEUED — radio outcome unknown. Check queue before resending.',
    };
  }
}
