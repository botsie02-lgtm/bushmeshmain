import {decodeBushMeshWire} from '../protocol';

export type BushMeshTraceDirection = 'tx' | 'rx' | 'event' | 'error';

export type BushMeshTraceEntry = {
  id: number;
  at: number;
  direction: BushMeshTraceDirection;
  channelIndex?: number;
  label: string;
  detail?: string;
  messageId?: number;
  packetType?: number;
  priority?: number;
  compression?: number;
  ttlHops?: number | null;
  byteLength?: number;
  hex?: string;
};

export class BushMeshTraceBuffer {
  private readonly entries: BushMeshTraceEntry[] = [];
  private nextId = 1;

  constructor(private readonly capacity = 250) {
    if (!Number.isInteger(capacity) || capacity < 10 || capacity > 5000) {
      throw new Error('BushMesh trace capacity must be from 10 to 5000 entries.');
    }
  }

  recordWire(
    direction: Extract<BushMeshTraceDirection, 'tx' | 'rx'>,
    channelIndex: number,
    wireBytes: number[],
    label = 'BushMesh wire frame',
    at = Date.now(),
  ): BushMeshTraceEntry {
    const decoded = decodeBushMeshWire(wireBytes);
    return this.push({
      direction,
      channelIndex,
      label,
      messageId: decoded.envelope.messageId,
      packetType: decoded.envelope.type,
      priority: decoded.envelope.priority,
      compression: decoded.envelope.compression,
      ttlHops: decoded.envelope.ttlHops,
      byteLength: wireBytes.length,
      hex: wireBytes
        .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
        .join(' '),
      at,
    });
  }

  recordEvent(
    label: string,
    detail?: string,
    options?: {
      direction?: Extract<BushMeshTraceDirection, 'event' | 'error'>;
      channelIndex?: number;
      at?: number;
    },
  ): BushMeshTraceEntry {
    return this.push({
      direction: options?.direction ?? 'event',
      channelIndex: options?.channelIndex,
      label,
      detail,
      at: options?.at ?? Date.now(),
    });
  }

  list(limit = this.capacity): BushMeshTraceEntry[] {
    const safeLimit = Math.max(0, Math.min(this.capacity, Math.floor(limit)));
    return this.entries.slice(-safeLimit).reverse().map(entry => ({...entry}));
  }

  exportText(limit = this.capacity): string {
    return this.list(limit)
      .reverse()
      .map(entry => {
        const timestamp = new Date(entry.at).toISOString();
        const channel =
          entry.channelIndex === undefined ? '' : ` ch=${entry.channelIndex}`;
        const message =
          entry.messageId === undefined ? '' : ` msg=${entry.messageId}`;
        const type =
          entry.packetType === undefined ? '' : ` type=${entry.packetType}`;
        const ttl = entry.ttlHops == null ? '' : ` ttl=${entry.ttlHops}`;
        const detail = entry.detail ? ` ${entry.detail}` : '';
        const hex = entry.hex ? `\n  ${entry.hex}` : '';
        return `${timestamp} ${entry.direction.toUpperCase()}${channel}${message}${type}${ttl} ${entry.label}${detail}${hex}`;
      })
      .join('\n');
  }

  exportJson(limit = this.capacity): string {
    return JSON.stringify(this.list(limit).reverse(), null, 2);
  }

  clear(): void {
    this.entries.length = 0;
  }

  size(): number {
    return this.entries.length;
  }

  private push(
    entry: Omit<BushMeshTraceEntry, 'id'>,
  ): BushMeshTraceEntry {
    const stored: BushMeshTraceEntry = {
      id: this.nextId++,
      ...entry,
    };
    this.entries.push(stored);

    while (this.entries.length > this.capacity) {
      this.entries.shift();
    }

    return {...stored};
  }
}
