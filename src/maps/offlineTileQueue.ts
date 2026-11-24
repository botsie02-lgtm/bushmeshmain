/**
 * Viewport-scoped, offline-only tile request scheduler.
 * The native reader remains the authority for archived tile verification.
 * Bounds JS base64 retention/read concurrency and discards stale results.
 */
export type OfflineTileRequest = {
  key: string; z: number; x: number; y: number; left: number; top: number;
};
export type OfflineTileView = {uris: Record<string, string>; missingKeys: string[]};
export const OFFLINE_TILE_MAX_ACTIVE = 4;
export const OFFLINE_TILE_MAX_CACHED = 20;

export function tileRequestsNearestCentre<T extends OfflineTileRequest>(
  requests: readonly T[], width: number, height: number,
): T[] {
  const midX = width / 2;
  const midY = height / 2;
  return [...requests].sort((a,b) => {
    const ax = a.left + 128 - midX; const ay = a.top + 128 - midY;
    const bx = b.left + 128 - midX; const by = b.top + 128 - midY;
    return ax * ax + ay * ay - bx * bx - by * by;
  });
}

export class BoundedOfflineTileQueue<T extends OfflineTileRequest> {
  private scope: string | null = null;
  private epoch = 0;
  private active = 0;
  private disposed = false;
  private desired: readonly T[] = [];
  private desiredKeys = new Set<string>();
  private inFlight = new Set<string>();
  private cached = new Map<string, string>();
  private missing = new Set<string>();
  private signature = '';

  constructor(
    private readonly read: (request: T) => Promise<string | null>,
    private readonly publish: (view: OfflineTileView) => void,
    private readonly accepts: (uri: string) => boolean,
  ) {}

  update(scope: string | null, requests: readonly T[]): void {
    if (this.disposed) return;
    if (this.scope !== scope) {
      this.scope = scope; this.epoch++;
      this.cached.clear(); this.missing.clear(); this.inFlight.clear();
      this.signature = '';
    }
    this.desired = scope ? requests.slice(0, OFFLINE_TILE_MAX_CACHED) : [];
    this.desiredKeys = new Set(this.desired.map(r => r.key));
    // Discard offscreen data URI references; limit memory even on long pans.
    for (const key of this.cached.keys()) {
      if (!this.desiredKeys.has(key)) this.cached.delete(key);
    }
    for (const key of this.missing) {
      if (!this.desiredKeys.has(key)) this.missing.delete(key);
    }
    this.emit();
    this.pump();
  }

  private emit(): void {
    const uris: Record<string, string> = {};
    const missingKeys: string[] = [];
    for (const request of this.desired) {
      const uri = this.cached.get(request.key);
      if (uri) uris[request.key] = uri;
      else if (this.missing.has(request.key)) missingKeys.push(request.key);
    }
    const signature = String(this.epoch) + '/' + this.desired.map(r =>
      r.key + ':' + (this.cached.has(r.key) ? 'ready' :
        this.missing.has(r.key) ? 'missing' : 'pending')).join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.publish({uris, missingKeys});
    }
  }

  private pump(): void {
    if (this.disposed || !this.scope) return;
    for (const request of this.desired) {
      if (this.active >= OFFLINE_TILE_MAX_ACTIVE) break;
      if (this.cached.has(request.key) || this.missing.has(request.key) ||
        this.inFlight.has(request.key)) continue;
      const epoch = this.epoch;
      this.active++;
      this.inFlight.add(request.key);
      Promise.resolve().then(() => this.read(request)).then(
        uri => {
          if (this.disposed || epoch !== this.epoch) return;
          if (uri && this.accepts(uri) && this.desiredKeys.has(request.key)) {
            this.cached.set(request.key, uri);
          } else if (this.desiredKeys.has(request.key)) {
            this.missing.add(request.key);
          }
        },
        () => {
          if (!this.disposed && epoch === this.epoch &&
            this.desiredKeys.has(request.key)) this.missing.add(request.key);
        },
      ).finally(() => {
        this.active--;
        // An old archive must never unregister a same-key new request.
        if (epoch === this.epoch) this.inFlight.delete(request.key);
        if (!this.disposed) { this.emit(); this.pump(); }
      });
    }
  }

  /** Explicit user retry; no automatic repeated work for absent archive tiles. */
  retryVisible(): void {
    if (this.disposed) return;
    this.cached.clear();
    this.missing.clear();
    this.signature = '';
    this.emit();
    this.pump();
  }

  dispose(): void {
    this.disposed = true; this.epoch++;
    this.desired = []; this.desiredKeys.clear();
    this.cached.clear(); this.missing.clear(); this.inFlight.clear();
  }
}
