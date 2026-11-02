export const BUSHMESH_FIELD_DIAGNOSTICS_SCHEMA_VERSION = 1;

export type FieldDiagnosticsCoordinate = {
  latitude: number;
  longitude: number;
};

export type FieldDiagnosticsRadioProfile = {
  frequencyMhz: number | null;
  spreadingFactor: number | null;
  bandwidthKhz: number | null;
  codingRate: number | null;
  txPowerDbm: number | null;
};

export type FieldDiagnosticsInput = {
  capturedAtMs?: number;
  appConnectionStatus: string;
  radioTransportReady: boolean;
  radioIdentityRef: string | null;
  radioProfile: FieldDiagnosticsRadioProfile | null;
  radioRuntimeRequested: boolean;
  nativeRuntimeRunning: boolean;
  nativeRuntimeOwnership: string;
  queuedCount: number;
  inflightCount: number;
  acceptedCount: number;
  failedCount: number;
  cancelledCount: number;
  activeChannelIndex: string | null;
  channelCount: number;
  messageCount: number;
  contactCount: number;
  batteryMv: number | null;
  storagePercent: number | null;
  localPosition: FieldDiagnosticsCoordinate | null;
  convoyVehicleCount: number;
  staleVehicleCount: number;
  lostVehicleCount: number;
  activeRecoveryIncidentCount: number;
  recoveredIncidentCount: number;
  readyMapPackCount: number;
  tripCoverageComplete: boolean;
  tripCoveredPointCount: number;
  tripTotalPointCount: number;
  contactPersistenceStatus: string;
  messagePersistenceStatus: string;
  outboxPersistenceStatus: string;
  mapPersistenceStatus: string;
};

export type BushMeshFieldDiagnosticsReport = {
  schemaVersion: number;
  capturedAt: string;
  privacy: {
    exactLocationIncluded: false;
    messageContentIncluded: false;
    channelSecretsIncluded: false;
    contactNamesIncluded: false;
    fullRadioIdentityIncluded: false;
  };
  radio: {
    appConnectionStatus: string;
    transportReady: boolean;
    identityHint: string | null;
    runtimeRequested: boolean;
    nativeRuntimeRunning: boolean;
    nativeRuntimeOwnership: string;
    profile: FieldDiagnosticsRadioProfile | null;
    outbox: {
      queued: number;
      inflight: number;
      accepted: number;
      failed: number;
      cancelled: number;
    };
  };
  data: {
    activeChannelIndex: string | null;
    channelCount: number;
    messageCount: number;
    contactCount: number;
    batteryMv: number | null;
    storagePercent: number | null;
  };
  location: {
    available: boolean;
    coarse: FieldDiagnosticsCoordinate | null;
    precisionDegrees: 0.01;
  };
  convoy: {
    vehicleCount: number;
    staleVehicleCount: number;
    lostVehicleCount: number;
    activeRecoveryIncidentCount: number;
    recoveredIncidentCount: number;
  };
  maps: {
    readyPackCount: number;
    tripCoverageComplete: boolean;
    coveredPointCount: number;
    totalPointCount: number;
  };
  persistence: {
    contacts: string;
    messages: string;
    outbox: string;
    maps: string;
  };
};

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function coarseCoordinate(
  coordinate: FieldDiagnosticsCoordinate | null,
): FieldDiagnosticsCoordinate | null {
  if (!coordinate) {
    return null;
  }

  if (
    !Number.isFinite(coordinate.latitude) ||
    !Number.isFinite(coordinate.longitude) ||
    coordinate.latitude < -90 ||
    coordinate.latitude > 90 ||
    coordinate.longitude < -180 ||
    coordinate.longitude > 180
  ) {
    return null;
  }

  return {
    latitude: Math.round(coordinate.latitude * 100) / 100,
    longitude: Math.round(coordinate.longitude * 100) / 100,
  };
}

/**
 * Returns only a short suffix of the radio identity. MeshCore public keys are
 * not secret, but support reports should not unnecessarily become durable
 * identifiers for a vehicle or user.
 */
export function diagnosticIdentityHint(identityRef: string | null): string | null {
  if (!identityRef) {
    return null;
  }
  const normalized = identityRef.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return `…${normalized.slice(-6)}`;
}

export function createFieldDiagnosticsReport(
  input: FieldDiagnosticsInput,
): BushMeshFieldDiagnosticsReport {
  const capturedAtMs = input.capturedAtMs ?? Date.now();
  const coarse = coarseCoordinate(input.localPosition);

  return {
    schemaVersion: BUSHMESH_FIELD_DIAGNOSTICS_SCHEMA_VERSION,
    capturedAt: new Date(capturedAtMs).toISOString(),
    privacy: {
      exactLocationIncluded: false,
      messageContentIncluded: false,
      channelSecretsIncluded: false,
      contactNamesIncluded: false,
      fullRadioIdentityIncluded: false,
    },
    radio: {
      appConnectionStatus: input.appConnectionStatus,
      transportReady: input.radioTransportReady,
      identityHint: diagnosticIdentityHint(input.radioIdentityRef),
      runtimeRequested: input.radioRuntimeRequested,
      nativeRuntimeRunning: input.nativeRuntimeRunning,
      nativeRuntimeOwnership: input.nativeRuntimeOwnership,
      profile: input.radioProfile
        ? {
            frequencyMhz: finiteOrNull(input.radioProfile.frequencyMhz),
            spreadingFactor: finiteOrNull(input.radioProfile.spreadingFactor),
            bandwidthKhz: finiteOrNull(input.radioProfile.bandwidthKhz),
            codingRate: finiteOrNull(input.radioProfile.codingRate),
            txPowerDbm: finiteOrNull(input.radioProfile.txPowerDbm),
          }
        : null,
      outbox: {
        queued: nonNegativeInteger(input.queuedCount),
        inflight: nonNegativeInteger(input.inflightCount),
        accepted: nonNegativeInteger(input.acceptedCount),
        failed: nonNegativeInteger(input.failedCount),
        cancelled: nonNegativeInteger(input.cancelledCount),
      },
    },
    data: {
      activeChannelIndex: input.activeChannelIndex,
      channelCount: nonNegativeInteger(input.channelCount),
      messageCount: nonNegativeInteger(input.messageCount),
      contactCount: nonNegativeInteger(input.contactCount),
      batteryMv: finiteOrNull(input.batteryMv),
      storagePercent: finiteOrNull(input.storagePercent),
    },
    location: {
      available: coarse !== null,
      coarse,
      precisionDegrees: 0.01,
    },
    convoy: {
      vehicleCount: nonNegativeInteger(input.convoyVehicleCount),
      staleVehicleCount: nonNegativeInteger(input.staleVehicleCount),
      lostVehicleCount: nonNegativeInteger(input.lostVehicleCount),
      activeRecoveryIncidentCount: nonNegativeInteger(
        input.activeRecoveryIncidentCount,
      ),
      recoveredIncidentCount: nonNegativeInteger(input.recoveredIncidentCount),
    },
    maps: {
      readyPackCount: nonNegativeInteger(input.readyMapPackCount),
      tripCoverageComplete: input.tripCoverageComplete,
      coveredPointCount: nonNegativeInteger(input.tripCoveredPointCount),
      totalPointCount: nonNegativeInteger(input.tripTotalPointCount),
    },
    persistence: {
      contacts: input.contactPersistenceStatus,
      messages: input.messagePersistenceStatus,
      outbox: input.outboxPersistenceStatus,
      maps: input.mapPersistenceStatus,
    },
  };
}

export function serializeFieldDiagnosticsReport(
  report: BushMeshFieldDiagnosticsReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
