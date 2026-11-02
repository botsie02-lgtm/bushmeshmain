import type {
  BushMeshSecurityAdapter,
  BushMeshSecurityProtectionRequest,
  BushMeshSecurityProtectionResult,
  BushMeshSecurityUnprotectionRequest,
  BushMeshSecurityUnprotectionResult,
} from '../bushmesh/runtime/public';
import {
  isSecurityError,
  type DirectSessionManager,
  type EncryptedDirectMessage,
  type EncryptedGroupMessage,
  type GroupKeyManager,
  type SecurityErrorCode,
  type SecurityProtocolContext,
} from '../security';

type DirectSessionSecurityPort = Pick<DirectSessionManager, 'encrypt' | 'decrypt'>;
type GroupSecurityPort = Pick<GroupKeyManager, 'encrypt' | 'decrypt'>;
type SecurityScope = 'direct' | 'group';

export type BushMeshSecurityIntegrationFailureCode =
  | 'security-unavailable'
  | 'peer-revoked'
  | 'peer-not-trusted'
  | 'rotated-key'
  | 'replay-detected'
  | 'downgrade-detected'
  | 'counter-rollback'
  | 'direct-session-missing'
  | 'direct-session-expired'
  | 'group-state-missing'
  | 'group-state-expired'
  | 'authentication-failed'
  | 'unsupported-version'
  | 'security-failed';

const SECURITY_FAILURE_PREFIX = '[bushmesh-security:';

export class BushMeshSecurityIntegrationError extends Error {
  readonly code: BushMeshSecurityIntegrationFailureCode;
  readonly securityCode?: SecurityErrorCode;

  constructor(
    code: BushMeshSecurityIntegrationFailureCode,
    message: string,
    securityCode?: SecurityErrorCode,
  ) {
    super(`${SECURITY_FAILURE_PREFIX}${code}] ${message}`);
    this.name = 'BushMeshSecurityIntegrationError';
    this.code = code;
    this.securityCode = securityCode;
  }
}

export function bushMeshSecurityFailureCodeFromRuntimeError(
  error: string | null | undefined,
): BushMeshSecurityIntegrationFailureCode | null {
  if (!error?.startsWith(SECURITY_FAILURE_PREFIX)) {
    return null;
  }
  const end = error.indexOf(']');
  if (end < SECURITY_FAILURE_PREFIX.length) {
    return null;
  }
  const candidate = error.slice(SECURITY_FAILURE_PREFIX.length, end);
  switch (candidate) {
    case 'security-unavailable':
    case 'peer-revoked':
    case 'peer-not-trusted':
    case 'rotated-key':
    case 'replay-detected':
    case 'downgrade-detected':
    case 'counter-rollback':
    case 'direct-session-missing':
    case 'direct-session-expired':
    case 'group-state-missing':
    case 'group-state-expired':
    case 'authentication-failed':
    case 'unsupported-version':
    case 'security-failed':
      return candidate;
    default:
      return null;
  }
}

function mapSecurityFailure(
  error: unknown,
  scope: SecurityScope,
): BushMeshSecurityIntegrationError {
  if (error instanceof BushMeshSecurityIntegrationError) {
    return error;
  }
  if (!isSecurityError(error)) {
    return new BushMeshSecurityIntegrationError(
      'security-failed',
      error instanceof Error ? error.message : String(error),
    );
  }

  let code: BushMeshSecurityIntegrationFailureCode;
  switch (error.code) {
    case 'PEER_REVOKED':
      code = 'peer-revoked';
      break;
    case 'PEER_NOT_TRUSTED':
      code = 'peer-not-trusted';
      break;
    case 'ROTATED_KEY':
      code = 'rotated-key';
      break;
    case 'REPLAY_DETECTED':
      code = 'replay-detected';
      break;
    case 'DOWNGRADE_DETECTED':
      code = 'downgrade-detected';
      break;
    case 'COUNTER_ROLLBACK':
      code = 'counter-rollback';
      break;
    case 'SESSION_NOT_FOUND':
    case 'KEY_NOT_FOUND':
      code = scope === 'direct' ? 'direct-session-missing' : 'group-state-missing';
      break;
    case 'EXPIRED_KEY':
      code = scope === 'direct' ? 'direct-session-expired' : 'group-state-expired';
      break;
    case 'UNSUPPORTED_VERSION':
      code = 'unsupported-version';
      break;
    case 'AUTHENTICATION_FAILED':
      code = 'authentication-failed';
      break;
    default:
      code = 'security-failed';
      break;
  }
  return new BushMeshSecurityIntegrationError(code, error.message, error.code);
}

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
 * encoding, key handling, nonce management, trust or routing decisions itself.
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
      try {
        const message = await this.directSessions.encrypt(
          request.association.sessionId,
          request.plaintextWireBytes,
          context,
        );
        return {
          protectedPayload: {kind: 'direct', message},
          securityVersion: message.securityVersion,
        };
      } catch (error) {
        throw mapSecurityFailure(error, 'direct');
      }
    }

    if (request.association.kind === 'group') {
      try {
        const message = await this.groups.encrypt(
          request.association.groupId,
          request.plaintextWireBytes,
          context,
        );
        return {
          protectedPayload: {kind: 'group', message},
          securityVersion: message.securityVersion,
        };
      } catch (error) {
        throw mapSecurityFailure(error, 'group');
      }
    }

    throw new BushMeshSecurityIntegrationError(
      'security-failed',
      'BushMesh Security v1 payload protection requires a direct-session or group association.',
    );
  }

  async unprotect(
    request: BushMeshSecurityUnprotectionRequest,
  ): Promise<BushMeshSecurityUnprotectionResult> {
    const context = toSecurityContext(request);

    if (request.protectedPayload.kind === 'direct') {
      const message = request.protectedPayload.message as EncryptedDirectMessage;
      try {
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
      } catch (error) {
        throw mapSecurityFailure(error, 'direct');
      }
    }

    const message = request.protectedPayload.message as EncryptedGroupMessage;
    try {
      const plaintextWireBytes = await this.groups.decrypt(message, context);
      return {
        plaintextWireBytes,
        association: {kind: 'group', groupId: message.groupId},
        securityVersion: message.securityVersion,
      };
    } catch (error) {
      throw mapSecurityFailure(error, 'group');
    }
  }
}

/**
 * Application-lifetime binding point for frozen Security v1 managers. The
 * canonical runtime can be composed once even before a platform CryptoProvider
 * has supplied the managers. Protected traffic fails closed until bind() is
 * called; it never falls back to plaintext.
 */
export class BushMeshSecurityV1ManagerBinding {
  private directSessions: DirectSessionSecurityPort | null = null;
  private groups: GroupSecurityPort | null = null;

  private readonly directProxy: DirectSessionSecurityPort = {
    encrypt: (...args) => this.requireDirect().encrypt(...args),
    decrypt: (...args) => this.requireDirect().decrypt(...args),
  };

  private readonly groupProxy: GroupSecurityPort = {
    encrypt: (...args) => this.requireGroup().encrypt(...args),
    decrypt: (...args) => this.requireGroup().decrypt(...args),
  };

  readonly adapter = new BushMeshSecurityV1Adapter(
    this.directProxy,
    this.groupProxy,
  );

  bind(
    directSessions: DirectSessionSecurityPort,
    groups: GroupSecurityPort,
  ): () => void {
    this.directSessions = directSessions;
    this.groups = groups;
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      if (this.directSessions === directSessions) {
        this.directSessions = null;
      }
      if (this.groups === groups) {
        this.groups = null;
      }
    };
  }

  isBound(): boolean {
    return this.directSessions !== null && this.groups !== null;
  }

  private requireDirect(): DirectSessionSecurityPort {
    if (!this.directSessions) {
      throw new BushMeshSecurityIntegrationError(
        'security-unavailable',
        'Security v1 direct-session managers are not bound to the application runtime.',
      );
    }
    return this.directSessions;
  }

  private requireGroup(): GroupSecurityPort {
    if (!this.groups) {
      throw new BushMeshSecurityIntegrationError(
        'security-unavailable',
        'Security v1 group-key managers are not bound to the application runtime.',
      );
    }
    return this.groups;
  }
}

export const applicationBushMeshSecurityV1Binding =
  new BushMeshSecurityV1ManagerBinding();
export const applicationBushMeshSecurityV1Adapter =
  applicationBushMeshSecurityV1Binding.adapter;
