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
import {getQuickActionDefinition} from '../drive/quickActions';

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
  source: 'radio' | 'local-preview';
};

type DriveContextValue = {
  alerts: DriveAlert[];
  latestAlert: DriveAlert | null;
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
          ttlSeconds > 0 ? action.timestampSeconds * 1000 + ttlSeconds * 1000 : null,
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

  const previewQuickAction = useCallback(
    (
      action: BushMeshQuickActionCode,
      location?: Coordinate | null,
    ): DriveAlert => {
      const now = Date.now();
      const definition = getQuickActionDefinition(action);
      const preview: DriveAlert = {
        id: `preview-${now}-${action}`,
        senderId: 'LOCAL-PREVIEW',
        action,
        label: definition.label,
        description: definition.description,
        channelIndex: null,
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
        source: 'local-preview',
      };

      setAlerts(current => [preview, ...current].slice(0, 50));
      return preview;
    },
    [],
  );

  const dismissAlert = useCallback((id: string) => {
    setAlerts(current => current.filter(alert => alert.id !== id));
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const latestAlert = alerts[0] ?? null;

  const value = useMemo<DriveContextValue>(
    () => ({
      alerts,
      latestAlert,
      previewQuickAction,
      dismissAlert,
      clearAlerts,
    }),
    [alerts, latestAlert, previewQuickAction, dismissAlert, clearAlerts],
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
