/**
 * Bounded, non-sensitive diagnostic classification for MeshCore channel text
 * submission. Never store or display arbitrary BLE/native error strings in
 * Radio History; those strings may contain unrelated device data.
 */
export type ChannelSubmissionFailure = {
  reason: 'firmware-error' | 'timeout' | 'disconnected' | 'write-error' | 'unknown';
  firmwareCode?: number;
};

export const CHANNEL_SUBMISSION_FAILURE_REASONS = [
  'firmware-error',
  'timeout',
  'disconnected',
  'write-error',
  'unknown',
] as const;

export function classifyChannelSubmissionFailure(error: unknown): ChannelSubmissionFailure {
  const message = error instanceof Error ? error.message : '';
  if (/PACKET_ERROR/i.test(message)) {
    // Native uses "(2)"; JS-GATT uses "(error code 2)".
    const match = /PACKET_ERROR\s*\((?:error code )?(\d{1,3})\)/i.exec(message);
    const code = match ? Number(match[1]) : null;
    return code !== null && Number.isInteger(code) && code >= 0 && code <= 255
      ? {reason: 'firmware-error', firmwareCode: code}
      : {reason: 'firmware-error'};
  }
  if (/timed out/i.test(message)) return {reason: 'timeout'};
  if (/disconnect|stopped|cancelled|not started|not active/i.test(message)) {
    return {reason: 'disconnected'};
  }
  if (/write|BLE|GATT/i.test(message)) return {reason: 'write-error'};
  return {reason: 'unknown'};
}

export function formatChannelSubmissionFailure(failure: ChannelSubmissionFailure): string {
  switch (failure.reason) {
    case 'firmware-error':
      return `MeshCore PACKET_ERROR (0x01)${failure.firmwareCode === undefined
        ? ''
        : `; firmware code ${failure.firmwareCode}`}. Radio submission rejected.`;
    case 'timeout':
      return 'No PACKET_OK (0x00) received before timeout. Acceptance unknown; the radio may have transmitted. Do not automatically resend.';
    case 'disconnected':
      return 'Radio disconnected or stopped during submission. Acceptance unknown; it may have transmitted.';
    case 'write-error':
      return 'BLE radio write failed. Acceptance not verified; do not automatically resend.';
    case 'unknown':
      return 'Radio submission could not be verified. No peer delivery confirmation.';
  }
}
