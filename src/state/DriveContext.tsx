import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {subscribeBushMeshInboundMessages} from '../bushmesh/inboundBus';
import {
  BushMeshMessageType,
  BushMeshQuickActionCode,
} from '../bushmesh/protocol';
import {Coordinate} from '../convoy/convoy';
import {
  OperationalMarker,
  operationalMarkerFromQuickAction,
} from '../convoy/operationalMarkers';
import {getQuickActionDefinition} from '../drive/quickActions';

export type DriveAlertSource =
  | 'radio'
  | 'local-preview'
  | 'local-queued'
  | 'local-accepted'
  | 'local-failed';

export type DriveAlert = {
  id: string;
  senderId: string;
  action: BushMeshQuickActionCode;
  label: string;
  description: string;
  channelIndex: number | null;
  latitude: number | null;
  longitude: number | null;
  receivedAtMs: number;
  packetTimestampSeconds: number;
  expiresAtMs: number | null;
  snrDb: number | null;
  pathLength: number | null;
  source: DriveAlertSource;
};

type DriveContextValue = {
  alerts: DriveAlert[];
  latestAlert: DriveAlert | null;
  operationalMarkers: OperationalMarker[];
  recordLocalQuickAction: (
    action: BushMeshQuickActionCode,
    location: Coordinate | null | undefined,
    source: Exclude<DriveAlertSource, 'radio'>,
    senderId?: string,
    channelIndex?: number | null,
  ) => DriveAlert;
  previewQuickAction: (
    action: BushMeshQuickActionCode,
    location?: Coordinate | null,
  ) => DriveAlert;
  dismissAlert: (id: string) => void;
  clearAlerts: () => void;
};

const DriveContext = createContext<DriveContextValue | null>(null);

function buildAlertId(senderId: string, sequence: number): string {
  return `${senderId}-${sequence}`;
}

export function DriveProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [alerts, setAlerts] = useState<DriveAlert[]>([]);

  useEffect(() => {
    return subscribeBushMeshInboundMessages(message => {
      if (message.type !== BushMeshMessageType.QuickAction) {
        return;
      }

      const action = message.action;
      const definition = getQuickActionDefinition(action.action);
      const receivedAtMs = Date.now();
      const ttlSeconds = action.ttlSeconds || definition.defaultTtlSeconds;
      const alert: DriveAlert = {
        id: buildAlertId(action.senderId, action.sequence),
        senderId: action.senderId,
        action: action.action,
        label: definition.label,
        description: definition.description,
        channelIndex: message.channelIndex,
        latitude: action.latitude,
        longitude: action.longitude,
        receivedAtMs,
        packetTimestampSeconds: action.timestampSeconds,
        expiresAtMs:
          ttlSeconds > 0
            ? action.timestampSeconds * 1000 + ttlSeconds * 1000
            : null,
        snrDb: message.snrDb,
        pathLength: message.pathLength,
        source: 'radio',
      };

      setAlerts(current => {
        if (current.some(item => item.id === alert.id)) {
          return current;
        }

        return [alert, ...current].slice(0, 50);
      });
    });
  }, []);

  const recordLocalQuickAction = useCallback(
    (
      action: BushMeshQuickActionCode,
      location: Coordinate | null | undefined,
      source: Exclude<DriveAlertSource, 'radio'>,
      senderId = 'LOCAL',
      channelIndex: number | null = null,
    ): DriveAlert => {
      const now = Date.now();
      const definition = getQuickActionDefinition(action);
      const localAlert: DriveAlert = {
        id: `${source}-${now}-${action}`,
        senderId,
        action,
        label: definition.label,
        description: definition.description,
        channelIndex,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        receivedAtMs: now,
        packetTimestampSeconds: Math.floor(now / 1000),
        expiresAtMs:
          definition.defaultTtlSeconds > 0
            ? now + definition.defaultTtlSeconds * 1000
            : null,
        snrDb: null,
        pathLength: null,
        source,
      };

      setAlerts(current => [localAlert, ...current].slice(0, 50));
      return localAlert;
    },
    [],
  );

  const previewQuickAction = useCallback(
    (
      action: BushMeshQuickActionCode,
      location?: Coordinate | null,
    ): DriveAlert =>
      recordLocalQuickAction(action, location, 'local-preview', 'LOCAL-PREVIEW'),
    [recordLocalQuickAction],
  );

  const dismissAlert = useCallback((id: string) => {
    setAlerts(current => current.filter(alert => alert.id !== id));
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const latestAlert = alerts[0] ?? null;
  const operationalMarkers = useMemo(
    () =>
      alerts
        .map(alert =>
          operationalMarkerFromQuickAction({
            id: alert.id,
            senderId: alert.senderId,
            action: alert.action,
            latitude: alert.latitude,
            longitude: alert.longitude,
            receivedAtMs: alert.receivedAtMs,
            expiresAtMs: alert.expiresAtMs,
          }),
        )
        .filter((marker): marker is OperationalMarker => marker !== null),
    [alerts],
  );

  const value = useMemo<DriveContextValue>(
    () => ({
      alerts,
      latestAlert,
      operationalMarkers,
      recordLocalQuickAction,
      previewQuickAction,
      dismissAlert,
      clearAlerts,
    }),
    [
      alerts,
      latestAlert,
      operationalMarkers,
      recordLocalQuickAction,
      previewQuickAction,
      dismissAlert,
      clearAlerts,
    ],
  );

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>;
}

export function useDrive(): DriveContextValue {
  const context = useContext(DriveContext);
  if (!context) {
    throw new Error('useDrive must be used inside DriveProvider');
  }
  return context;
}
