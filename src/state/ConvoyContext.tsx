import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {subscribeBushMeshInboundMessages} from '../bushmesh/inboundBus';
import {BushMeshInboundMessage} from '../bushmesh/meshcoreBridge';
import {BushMeshMessageType} from '../bushmesh/protocol';
import {
  ConvoyVehicle,
  Coordinate,
  shouldReplaceVehiclePosition,
} from '../convoy/convoy';

type ConvoyContextValue = {
  vehicles: ConvoyVehicle[];
  localPosition: Coordinate | null;
  upsertBushMeshMessage: (message: BushMeshInboundMessage) => void;
  setLocalPosition: (position: Coordinate | null) => void;
  loadDemoConvoy: () => void;
  clearConvoy: () => void;
};

const ConvoyContext = createContext<ConvoyContextValue | null>(null);

export function ConvoyProvider({children}: {children: React.ReactNode}): React.JSX.Element {
  const [vehicles, setVehicles] = useState<ConvoyVehicle[]>([]);
  const [localPosition, setLocalPosition] = useState<Coordinate | null>(null);

  const upsertVehicle = useCallback((incoming: ConvoyVehicle) => {
    setVehicles(current => {
      const existing = current.find(vehicle => vehicle.id === incoming.id);
      if (!shouldReplaceVehiclePosition(existing, incoming)) {
        return current;
      }

      const withoutExisting = current.filter(vehicle => vehicle.id !== incoming.id);
      return [incoming, ...withoutExisting];
    });
  }, []);

  const upsertBushMeshMessage = useCallback(
    (message: BushMeshInboundMessage) => {
      if (message.type !== BushMeshMessageType.Position) {
        return;
      }

      const position = message.position;
      upsertVehicle({
        id: position.senderId,
        name: `Vehicle ${position.senderId.slice(-4)}`,
        latitude: position.latitude,
        longitude: position.longitude,
        altitudeMeters: position.altitudeMeters ?? null,
        speedKmh: position.speedKmh ?? 0,
        headingDegrees: position.headingDegrees ?? null,
        accuracyMeters: position.accuracyMeters ?? null,
        sequence: position.sequence,
        packetTimestampSeconds: position.timestampSeconds,
        receivedAtMs: Date.now(),
        snrDb: message.snrDb,
        pathLength: message.pathLength,
      });
    },
    [upsertVehicle],
  );

  useEffect(() => {
    return subscribeBushMeshInboundMessages(upsertBushMeshMessage);
  }, [upsertBushMeshMessage]);

  const loadDemoConvoy = useCallback(() => {
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const demoOrigin = {latitude: -37.5628, longitude: 146.2504};

    setLocalPosition(demoOrigin);
    setVehicles([
      {
        id: 'A1B2C3D4E501',
        name: 'Lead — Ranger',
        latitude: -37.5589,
        longitude: 146.2558,
        altitudeMeters: 1184,
        speedKmh: 34.6,
        headingDegrees: 42,
        accuracyMeters: 5,
        sequence: 44,
        packetTimestampSeconds: nowSeconds,
        receivedAtMs: now - 4_000,
        snrDb: 8.25,
        pathLength: 1,
        simulated: true,
      },
      {
        id: 'A1B2C3D4E502',
        name: 'Patrol',
        latitude: -37.5657,
        longitude: 146.2471,
        altitudeMeters: 1172,
        speedKmh: 28.1,
        headingDegrees: 218,
        accuracyMeters: 7,
        sequence: 31,
        packetTimestampSeconds: nowSeconds - 48,
        receivedAtMs: now - 48_000,
        snrDb: 4.5,
        pathLength: 2,
        simulated: true,
      },
      {
        id: 'A1B2C3D4E503',
        name: 'Jimny',
        latitude: -37.5712,
        longitude: 146.2395,
        altitudeMeters: 1159,
        speedKmh: 0,
        headingDegrees: 205,
        accuracyMeters: 11,
        sequence: 19,
        packetTimestampSeconds: nowSeconds - 185,
        receivedAtMs: now - 185_000,
        snrDb: 1.75,
        pathLength: 3,
        simulated: true,
      },
    ]);
  }, []);

  const clearConvoy = useCallback(() => {
    setVehicles([]);
    setLocalPosition(null);
  }, []);

  const value = useMemo<ConvoyContextValue>(
    () => ({
      vehicles,
      localPosition,
      upsertBushMeshMessage,
      setLocalPosition,
      loadDemoConvoy,
      clearConvoy,
    }),
    [vehicles, localPosition, upsertBushMeshMessage, loadDemoConvoy, clearConvoy],
  );

  return <ConvoyContext.Provider value={value}>{children}</ConvoyContext.Provider>;
}

export function useConvoy(): ConvoyContextValue {
  const context = useContext(ConvoyContext);
  if (!context) {
    throw new Error('useConvoy must be used inside ConvoyProvider');
  }
  return context;
}
