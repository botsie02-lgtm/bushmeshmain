import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshPosition,
  BushMeshQuickAction,
  BushMeshQuickActionCode,
  encodeBushMeshPosition,
  encodeBushMeshQuickAction,
} from '../bushmesh/protocol';
import {
  BUSHMESH_FORMATION_MESSAGE_TYPE,
  BushMeshFormationShare,
  encodeBushMeshFormationShare,
} from '../bushmesh/formationProtocol';
import {
  BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS,
  BUSHMESH_POSITION_RESPONSE_FLAG,
  BushMeshPositionRequest,
  encodeBushMeshPositionRequest,
} from '../bushmesh/positionRequestProtocol';
import type {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {getQuickActionDefinition} from '../drive/quickActions';
import {BushMeshTransmissionController} from './BushMeshTransmissionController';

const FORMATION_SHARE_TTL_MS = 15 * 60 * 1000;

/**
 * Temporary adapter for the legacy Bushmesh packet encoders on this branch.
 *
 * All packet construction and packet-specific queue policy stays here so the
 * transmission controller remains reusable by the future canonical runtime.
 */
export class LegacyBushMeshOutboundAdapter {
  constructor(private readonly controller: BushMeshTransmissionController) {}

  enqueuePosition(
    channelIndex: number,
    position: BushMeshPosition,
    createdAtMs = Date.now(),
  ): BushMeshOutboxEntry {
    this.controller.cancelQueued(
      entry =>
        entry.priority === 'position' &&
        entry.identityRef === position.senderId &&
        entry.channelIndex === channelIndex,
    );

    const requestDriven =
      ((position.flags ?? 0) & BUSHMESH_POSITION_RESPONSE_FLAG) !== 0;
    const expiresAtMs = requestDriven
      ? createdAtMs + BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS * 1000
      : null;

    return this.controller.enqueueOutbound({
      channelIndex,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshPosition(position),
      priority: 'position',
      description: `${requestDriven ? 'Requested position' : 'Position'} ${position.sequence} from ${position.senderId}`,
      identityRef: position.senderId,
      expiresAtMs,
      createdAtMs,
      retryPolicy: {maxAttempts: 3},
    });
  }

  enqueueQuickAction(
    channelIndex: number,
    action: BushMeshQuickAction,
    createdAtMs = Date.now(),
  ): BushMeshOutboxEntry {
    const definition = getQuickActionDefinition(action.action);
    const priority =
      definition.priority === 'safety'
        ? 'safety'
        : definition.priority === 'control'
          ? 'control'
          : 'message';
    const ttlSeconds =
      action.ttlSeconds != null && action.ttlSeconds > 0
        ? action.ttlSeconds
        : definition.defaultTtlSeconds;

    return this.controller.enqueueOutbound({
      channelIndex,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshQuickAction(action),
      priority,
      description: `${definition.label} from ${action.senderId}`,
      identityRef: action.senderId,
      expiresAtMs: action.timestampSeconds * 1000 + ttlSeconds * 1000,
      createdAtMs,
      retryPolicy: {
        maxAttempts: action.action === BushMeshQuickActionCode.Ok ? 3 : 5,
      },
    });
  }

  enqueueFormationShare(
    channelIndex: number,
    share: BushMeshFormationShare,
    createdAtMs = Date.now(),
  ): BushMeshOutboxEntry {
    this.controller.cancelQueued(
      entry =>
        entry.identityRef === share.senderId &&
        entry.channelIndex === channelIndex &&
        entry.payload.length >= 2 &&
        entry.payload[1] === BUSHMESH_FORMATION_MESSAGE_TYPE,
    );

    return this.controller.enqueueOutbound({
      channelIndex,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshFormationShare(share),
      priority: 'control',
      description: `Formation revision ${share.revision} from ${share.senderId}`,
      identityRef: share.senderId,
      expiresAtMs: share.timestampSeconds * 1000 + FORMATION_SHARE_TTL_MS,
      createdAtMs,
      retryPolicy: {maxAttempts: 5},
    });
  }

  enqueuePositionRequest(
    channelIndex: number,
    request: BushMeshPositionRequest,
    createdAtMs = Date.now(),
  ): BushMeshOutboxEntry {
    const ttlSeconds =
      request.ttlSeconds ?? BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS;

    return this.controller.enqueueOutbound({
      channelIndex,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload: encodeBushMeshPositionRequest(request),
      priority: 'control',
      description: `Position request ${request.sequence} from ${request.senderId} to ${request.targetId}`,
      identityRef: request.senderId,
      expiresAtMs: request.timestampSeconds * 1000 + ttlSeconds * 1000,
      createdAtMs,
      retryPolicy: {maxAttempts: 4},
    });
  }
}
