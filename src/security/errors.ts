export type SecurityErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'DOWNGRADE_DETECTED'
  | 'DUPLICATE_IDENTITY'
  | 'EXPIRED_KEY'
  | 'IDENTITY_CORRUPT'
  | 'INVALID_INPUT'
  | 'KEY_NOT_FOUND'
  | 'NONCE_EXHAUSTED'
  | 'PEER_NOT_TRUSTED'
  | 'PEER_REVOKED'
  | 'REPLAY_DETECTED'
  | 'ROTATED_KEY'
  | 'SESSION_NOT_FOUND'
  | 'UNSUPPORTED_VERSION';

export class SecurityError extends Error {
  readonly code: SecurityErrorCode;

  constructor(code: SecurityErrorCode, message: string) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

export function isSecurityError(error: unknown, code?: SecurityErrorCode): error is SecurityError {
  return error instanceof SecurityError && (code === undefined || error.code === code);
}
