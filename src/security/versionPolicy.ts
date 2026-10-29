import {SecurityError} from './errors';

function normalize(values: number[]): number[] {
  if (values.length === 0 || values.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new SecurityError('INVALID_INPUT', 'Version lists must contain positive integers');
  }
  if (new Set(values).size !== values.length) {
    throw new SecurityError('INVALID_INPUT', 'Version lists cannot contain duplicates');
  }
  return [...values].sort((a, b) => b - a);
}

export class VersionPolicy {
  readonly supportedSecurityVersions: number[];
  readonly supportedProtocolVersions: number[];

  constructor(
    securityVersions: number[],
    protocolVersions: number[],
    readonly minimumSecurityVersion = 1,
    readonly minimumProtocolVersion = 1,
  ) {
    this.supportedSecurityVersions = normalize(securityVersions);
    this.supportedProtocolVersions = normalize(protocolVersions);
  }

  negotiateSecurity(remote: number[]): number {
    return this.negotiate(
      this.supportedSecurityVersions,
      normalize(remote),
      this.minimumSecurityVersion,
      'security',
    );
  }

  negotiateProtocol(remote: number[]): number {
    return this.negotiate(
      this.supportedProtocolVersions,
      normalize(remote),
      this.minimumProtocolVersion,
      'protocol',
    );
  }

  assertSelectedSecurity(remote: number[], selected: number): void {
    const expected = this.negotiateSecurity(remote);
    if (selected !== expected) {
      throw new SecurityError(
        'DOWNGRADE_DETECTED',
        `Expected security version ${expected} but peer selected ${selected}`,
      );
    }
  }

  assertSelectedProtocol(remote: number[], selected: number): void {
    const expected = this.negotiateProtocol(remote);
    if (selected !== expected) {
      throw new SecurityError(
        'DOWNGRADE_DETECTED',
        `Expected protocol version ${expected} but peer selected ${selected}`,
      );
    }
  }

  assertProtocolContext(selected: number, actual: number): void {
    if (actual !== selected) {
      throw new SecurityError(
        'DOWNGRADE_DETECTED',
        `Protected session expects protocol version ${selected}, received ${actual}`,
      );
    }
  }

  private negotiate(local: number[], remote: number[], minimum: number, label: string): number {
    const selected = local.find(value => value >= minimum && remote.includes(value));
    if (selected === undefined) {
      throw new SecurityError('UNSUPPORTED_VERSION', `No compatible ${label} version`);
    }
    return selected;
  }
}

export const securityV1VersionPolicy = new VersionPolicy([1], [1], 1, 1);
