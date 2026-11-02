import type {
  BushMeshSecurityAdapter,
  BushMeshSecurityProtectionRequest,
  BushMeshSecurityProtectionResult,
  BushMeshSecurityUnprotectionRequest,
  BushMeshSecurityUnprotectionResult,
} from '../bushmesh/runtime/public';
import type {
  DirectSessionManager,
  EncryptedDirectMessage,
  EncryptedGroupMessage,
  GroupKeyManager,
  SecurityProtocolContext,
} from '../security';

type DirectSessionSecurityPort = Pick<DirectSessionManager, 'encrypt' | 'decrypt'>;
type GroupSecurityPort = Pick<GroupKeyManager, 'encrypt' | 'decrypt'>;

function toSecurityContext(
  request:
    | BushMeshSecurityProtectionRequest
    | BushMeshSecurityUnprotectionRequest,
): SecurityProtocolContext {
  return {
    protocolVersion: request.context.protocolVersion,
    authenticatedHeader: Uint8Array.from(request.context.authenticatedHeader),
  };
}

/**
 * Integration-owned adapter between the canonical BushMesh runtime Security
 * port and the frozen Security v1 managers. It deliberately performs no wire
 * encoding, key handling, nonce management or routing decisions of its own.
 */
export class BushMeshSecurityV1Adapter implements BushMeshSecurityAdapter {
  constructor(
    private readonly directSessions: DirectSessionSecurityPort,
    private readonly groups: GroupSecurityPort,
  ) {}

  async protect(
    request: BushMeshSecurityProtectionRequest,
  ): Promise<BushMeshSecurityProtectionResult> {
    const context = toSecurityContext(request);

    if (request.association.kind === 'direct-session') {
      const message = await this.directSessions.encrypt(
        request.association.sessionId,
        request.plaintextWireBytes,
        context,
      );
      return {
        protectedPayload: {kind: 'direct', message},
        securityVersion: message.securityVersion,
      };
    }

    if (request.association.kind === 'group') {
      const message = await this.groups.encrypt(
        request.association.groupId,
        request.plaintextWireBytes,
        context,
      );
      return {
        protectedPayload: {kind: 'group', message},
        securityVersion: message.securityVersion,
      };
    }

    throw new Error(
      'BushMesh Security v1 payload protection requires a direct-session or group association.',
    );
  }

  async unprotect(
    request: BushMeshSecurityUnprotectionRequest,
  ): Promise<BushMeshSecurityUnprotectionResult> {
    const context = toSecurityContext(request);

    if (request.protectedPayload.kind === 'direct') {
      const message = request.protectedPayload.message as EncryptedDirectMessage;
      const plaintextWireBytes = await this.directSessions.decrypt(
        message,
        context,
      );
      return {
        plaintextWireBytes,
        association: {
          kind: 'direct-session',
          sessionId: message.sessionId,
        },
        securityVersion: message.securityVersion,
      };
    }

    const message = request.protectedPayload.message as EncryptedGroupMessage;
    const plaintextWireBytes = await this.groups.decrypt(message, context);
    return {
      plaintextWireBytes,
      association: {kind: 'group', groupId: message.groupId},
      securityVersion: message.securityVersion,
    };
  }
}
