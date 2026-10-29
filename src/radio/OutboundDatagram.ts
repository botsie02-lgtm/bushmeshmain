export type OutboundPriority =
  | 'safety'
  | 'control'
  | 'message'
  | 'position'
  | 'bulk';

export type OutboundRetryPolicy = {
  maxAttempts: number;
};

/**
 * Runtime-neutral handoff from an application/protocol runtime to radio-core.
 *
 * The payload is already encoded before it crosses this boundary. Radio-core
 * owns queueing, retry, expiry and transport acceptance only; it does not
 * interpret or construct protocol packets.
 */
export type OutboundDatagramEnvelope = {
  channelIndex: number;
  dataType: number;
  payload: Uint8Array;
  priority: OutboundPriority;
  expiresAtMs: number | null;
  retryPolicy: OutboundRetryPolicy;
  identityRef: string | null;
  description: string;
  createdAtMs?: number;
};
