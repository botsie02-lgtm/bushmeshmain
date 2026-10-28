import {
  BushMeshConvoyRole,
  BushMeshConvoyStatus,
  applyConvoyLocationDelta,
} from '../protocol';

export type BushMeshConvoyMemberHealth = 'active' | 'stale' | 'lost';

export type BushMeshConvoyMember = {
  status: BushMeshConvoyStatus;
  firstSeenAt: number;
  lastSeenAt: number;
  health: BushMeshConvoyMemberHealth;
  gapFromPreviousMetres: number | null;
};

export type BushMeshConvoyIssue = {
  type:
    | 'stale-member'
    | 'lost-member'
    | 'hazard'
    | 'large-gap'
    | 'stopped-member'
    | 'order-conflict';
  nodeId: number;
  orderIndex: number;
  detail: string;
};

export type BushMeshConvoySnapshot = {
  convoyId: number;
  generatedAt: number;
  members: BushMeshConvoyMember[];
  issues: BushMeshConvoyIssue[];
  healthy: boolean;
  leadNodeId: number | null;
  tailNodeId: number | null;
  largestGapMetres: number | null;
};

type StoredMember = {
  status: BushMeshConvoyStatus;
  firstSeenAt: number;
  lastSeenAt: number;
};

const EARTH_RADIUS_METRES = 6_371_000;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMetres(
  a: {latitude: number; longitude: number},
  b: {latitude: number; longitude: number},
): number {
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isNewerSequence(current: number, incoming: number): boolean {
  if (current === incoming) {
    return false;
  }

  const delta = (incoming - current) >>> 0;
  return delta > 0 && delta < 0x80000000;
}

export class BushMeshConvoyTracker {
  private readonly membersByConvoy = new Map<number, Map<number, StoredMember>>();

  constructor(
    private readonly staleAfterMs = 30_000,
    private readonly lostAfterMs = 90_000,
    private readonly largeGapMetres = 1_000,
  ) {
    if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
      throw new Error('Convoy stale timeout must be greater than zero.');
    }
    if (!Number.isFinite(lostAfterMs) || lostAfterMs <= staleAfterMs) {
      throw new Error('Convoy lost timeout must be greater than stale timeout.');
    }
    if (!Number.isFinite(largeGapMetres) || largeGapMetres <= 0) {
      throw new Error('Convoy large-gap distance must be greater than zero.');
    }
  }

  accept(status: BushMeshConvoyStatus, receivedAt = Date.now()): boolean {
    let convoy = this.membersByConvoy.get(status.convoyId);
    if (!convoy) {
      convoy = new Map<number, StoredMember>();
      this.membersByConvoy.set(status.convoyId, convoy);
    }

    const existing = convoy.get(status.nodeId);
    if (existing && !isNewerSequence(existing.status.sequence, status.sequence)) {
      return false;
    }

    let location = status.location ? {...status.location} : undefined;
    if (!location && status.locationDelta && existing?.status.location) {
      location = applyConvoyLocationDelta(
        existing.status.location,
        status.locationDelta,
      );
    }

    // Optional telemetry fields are sparse by design. Preserve the most recent
    // known value when a compact heartbeat omits an unchanged field. Delta
    // coordinates are normalised into an ordinary absolute location here so
    // routing/UI code never needs to understand the wire compression scheme.
    const mergedStatus: BushMeshConvoyStatus = {
      ...status,
      location:
        location ??
        (existing?.status.location ? {...existing.status.location} : undefined),
      locationDelta: undefined,
      speedKph: status.speedKph ?? existing?.status.speedKph,
      headingDegrees:
        status.headingDegrees ?? existing?.status.headingDegrees,
      batteryPercent:
        status.batteryPercent ?? existing?.status.batteryPercent,
    };

    convoy.set(status.nodeId, {
      status: mergedStatus,
      firstSeenAt: existing?.firstSeenAt ?? receivedAt,
      lastSeenAt: receivedAt,
    });

    return true;
  }

  snapshot(convoyId: number, now = Date.now()): BushMeshConvoySnapshot {
    const stored = Array.from(this.membersByConvoy.get(convoyId)?.values() ?? [])
      .sort(
        (a, b) =>
          a.status.orderIndex - b.status.orderIndex ||
          a.status.nodeId - b.status.nodeId,
      );

    const issues: BushMeshConvoyIssue[] = [];
    const members: BushMeshConvoyMember[] = [];
    let previousWithLocation: StoredMember | null = null;
    let largestGapMetres: number | null = null;

    for (const member of stored) {
      const ageMs = Math.max(0, now - member.lastSeenAt);
      const health: BushMeshConvoyMemberHealth =
        ageMs >= this.lostAfterMs
          ? 'lost'
          : ageMs >= this.staleAfterMs
            ? 'stale'
            : 'active';

      let gapFromPreviousMetres: number | null = null;
      if (
        health !== 'lost' &&
        member.status.location &&
        previousWithLocation?.status.location
      ) {
        gapFromPreviousMetres = Math.round(
          distanceMetres(
            previousWithLocation.status.location,
            member.status.location,
          ),
        );
        largestGapMetres = Math.max(largestGapMetres ?? 0, gapFromPreviousMetres);

        if (gapFromPreviousMetres >= this.largeGapMetres) {
          issues.push({
            type: 'large-gap',
            nodeId: member.status.nodeId,
            orderIndex: member.status.orderIndex,
            detail: `Gap to previous located vehicle is approximately ${gapFromPreviousMetres} m.`,
          });
        }
      }

      if (health !== 'lost' && member.status.location) {
        previousWithLocation = member;
      }

      if (health === 'stale') {
        issues.push({
          type: 'stale-member',
          nodeId: member.status.nodeId,
          orderIndex: member.status.orderIndex,
          detail: `No convoy update for ${Math.round(ageMs / 1000)} seconds.`,
        });
      } else if (health === 'lost') {
        issues.push({
          type: 'lost-member',
          nodeId: member.status.nodeId,
          orderIndex: member.status.orderIndex,
          detail: `Convoy member has been silent for ${Math.round(ageMs / 1000)} seconds.`,
        });
      }

      if (member.status.hazard) {
        issues.push({
          type: 'hazard',
          nodeId: member.status.nodeId,
          orderIndex: member.status.orderIndex,
          detail: 'Vehicle has raised its convoy hazard flag.',
        });
      }

      if (member.status.stopped && health === 'active') {
        issues.push({
          type: 'stopped-member',
          nodeId: member.status.nodeId,
          orderIndex: member.status.orderIndex,
          detail: 'Vehicle reports that it is stopped.',
        });
      }

      members.push({
        status: {
          ...member.status,
          location: member.status.location
            ? {...member.status.location}
            : undefined,
          locationDelta: undefined,
        },
        firstSeenAt: member.firstSeenAt,
        lastSeenAt: member.lastSeenAt,
        health,
        gapFromPreviousMetres,
      });
    }

    const activeByOrder = new Map<number, BushMeshConvoyMember[]>();
    for (const member of members) {
      if (member.health === 'lost') {
        continue;
      }
      const samePosition = activeByOrder.get(member.status.orderIndex) ?? [];
      samePosition.push(member);
      activeByOrder.set(member.status.orderIndex, samePosition);
    }

    for (const [orderIndex, conflicting] of activeByOrder.entries()) {
      if (conflicting.length < 2) {
        continue;
      }

      const labels = conflicting
        .map(item => item.status.nodeId.toString(16).padStart(8, '0'))
        .join(', ');
      for (const member of conflicting) {
        issues.push({
          type: 'order-conflict',
          nodeId: member.status.nodeId,
          orderIndex,
          detail: `Multiple active vehicles claim convoy position ${orderIndex}: ${labels}.`,
        });
      }
    }

    const lead = members.find(
      member => member.status.role === BushMeshConvoyRole.Lead,
    );
    const tail = [...members]
      .reverse()
      .find(member => member.status.role === BushMeshConvoyRole.Tail);

    return {
      convoyId,
      generatedAt: now,
      members,
      issues,
      healthy: issues.every(
        issue =>
          issue.type !== 'lost-member' &&
          issue.type !== 'hazard' &&
          issue.type !== 'large-gap' &&
          issue.type !== 'order-conflict',
      ),
      leadNodeId: lead?.status.nodeId ?? members[0]?.status.nodeId ?? null,
      tailNodeId:
        tail?.status.nodeId ?? members[members.length - 1]?.status.nodeId ?? null,
      largestGapMetres,
    };
  }

  /**
   * Returns active intermediary nodes in convoy order between source and
   * destination. This is intentionally a relay hint rather than a hard route:
   * the radio/link layer can still reject candidates with poor live link data.
   */
  relayCandidates(
    convoyId: number,
    sourceNodeId: number,
    destinationNodeId: number,
    now = Date.now(),
  ): number[] {
    const snapshot = this.snapshot(convoyId, now);
    const source = snapshot.members.find(
      member => member.status.nodeId === sourceNodeId,
    );
    const destination = snapshot.members.find(
      member => member.status.nodeId === destinationNodeId,
    );

    if (!source || !destination) {
      return [];
    }

    const low = Math.min(source.status.orderIndex, destination.status.orderIndex);
    const high = Math.max(source.status.orderIndex, destination.status.orderIndex);
    const descending = source.status.orderIndex > destination.status.orderIndex;

    const candidates = snapshot.members
      .filter(
        member =>
          member.health === 'active' &&
          !member.status.hazard &&
          member.status.nodeId !== sourceNodeId &&
          member.status.nodeId !== destinationNodeId &&
          member.status.orderIndex > low &&
          member.status.orderIndex < high,
      )
      .sort((a, b) => a.status.orderIndex - b.status.orderIndex)
      .map(member => member.status.nodeId);

    return descending ? candidates.reverse() : candidates;
  }

  prune(now = Date.now(), forgetAfterMs = 30 * 60 * 1000): number {
    let removed = 0;

    for (const [convoyId, convoy] of this.membersByConvoy.entries()) {
      for (const [nodeId, member] of convoy.entries()) {
        if (now - member.lastSeenAt >= forgetAfterMs) {
          convoy.delete(nodeId);
          removed += 1;
        }
      }
      if (convoy.size === 0) {
        this.membersByConvoy.delete(convoyId);
      }
    }

    return removed;
  }

  clear(convoyId?: number): void {
    if (convoyId === undefined) {
      this.membersByConvoy.clear();
      return;
    }
    this.membersByConvoy.delete(convoyId);
  }
}
