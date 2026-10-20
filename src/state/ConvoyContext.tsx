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
  BuddyTail,
  appendBuddyTailPoint,
} from '../convoy/buddyTails';
import {
  ConvoyVehicle,
  Coordinate,
  shouldReplaceVehiclePosition,
} from '../convoy/convoy';
import {FieldNavigationTarget} from '../convoy/fieldTarget';
import {useBushMesh} from './BushMeshContext';

type ConvoyContextValue = {
  vehicles: ConvoyVehicle[];
  buddyTails: BuddyTail[];
  localPosition: Coordinate | null;
  navigationTargetVehicleId: string | null;
  navigationTargetVehicle: ConvoyVehicle | null;
  navigationFieldTarget: FieldNavigationTarget | null;
  getBuddyTail: (vehicleId: string) => BuddyTail | null;
  upsertBushMeshMessage: (message: BushMeshInboundMessage) => void;
  setLocalPosition: (position: Coordinate | null) => void;
  setNavigationTarget: (vehicleId: string) => void;
  setNavigationFieldTarget: (target: FieldNavigationTarget) => void;
  clearNavigationTarget: () => void;
  loadDemoConvoy: () => void;
  clearConvoy: () => void;
};

const ConvoyContext = createContext<ConvoyContextValue | null>(null);

export function ConvoyProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {contacts} = useBushMesh();
  const [vehicles, setVehicles] = useState<ConvoyVehicle[]>([]);
  const [buddyTailMap, setBuddyTailMap] = useState<Record<string, BuddyTail>>({});
  const [localPosition, setLocalPosition] = useState<Coordinate | null>(null);
  const [navigationTargetVehicleId, setNavigationTargetVehicleId] = useState<
    string | null
  >(null);
  const [navigationFieldTarget, setNavigationFieldTargetState] = useState<
    FieldNavigationTarget | null
  >(null);

  const contactNames = useMemo(() => {
    const names = new Map<string, string>();
    contacts.forEach(contact => {
      const name = contact.name.trim();
      if (name) {
        names.set(contact.publicKeyPrefix.toUpperCase(), name);
      }
    });
    return names;
  }, [contacts]);

  const resolvedVehicleName = useCallback(
    (identityRef: string): string => {
      return (
        contactNames.get(identityRef.toUpperCase()) ??
        `Vehicle ${identityRef.slice(-4)}`
      );
    },
    [contactNames],
  );

  const upsertVehicle = useCallback((incoming: ConvoyVehicle) => {
    setVehicles(current => {
      const existing = current.find(vehicle => vehicle.id === incoming.id);
      if (!shouldReplaceVehiclePosition(existing, incoming)) {
        return current;
      }

      const withoutExisting = current.filter(vehicle => vehicle.id !== incoming.id);
      return [incoming, ...withoutExisting];
    });

    setBuddyTailMap(current => {
      const updated = appendBuddyTailPoint(current[incoming.id], incoming);
      if (updated.points === current[incoming.id]?.points) {
        return current;
      }
      return {...current, [incoming.id]: updated};
    });
  }, []);

  const upsertBushMeshMessageAt = useCallback(
    (message: BushMeshInboundMessage, receivedAtMs: number) => {
      if (message.type !== BushMeshMessageType.Position) {
        return;
      }

      const position = message.position;
      upsertVehicle({
        id: position.senderId,
        name: resolvedVehicleName(position.senderId),
        latitude: position.latitude,
        longitude: position.longitude,
        altitudeMeters: position.altitudeMeters ?? null,
        speedKmh: position.speedKmh ?? 0,
        headingDegrees: position.headingDegrees ?? null,
        accuracyMeters: position.accuracyMeters ?? null,
        sequence: position.sequence,
        packetTimestampSeconds: position.timestampSeconds,
        receivedAtMs,
        snrDb: message.snrDb,
        pathLength: message.pathLength,
      });
    },
    [resolvedVehicleName, upsertVehicle],
  );

  const upsertBushMeshMessage = useCallback(
    (message: BushMeshInboundMessage) => {
      upsertBushMeshMessageAt(message, Date.now());
    },
    [upsertBushMeshMessageAt],
  );

  useEffect(() => {
    return subscribeBushMeshInboundMessages((message, metadata) => {
      upsertBushMeshMessageAt(message, metadata.receivedAtMs);
    });
  }, [upsertBushMeshMessageAt]);

  useEffect(() => {
    if (contactNames.size === 0) {
      return;
    }

    setVehicles(current => {
      let changed = false;
      const next = current.map(vehicle => {
        if (vehicle.simulated) {
          return vehicle;
        }

        const contactName = contactNames.get(vehicle.id.toUpperCase());
        if (!contactName || contactName === vehicle.name) {
          return vehicle;
        }

        changed = true;
        return {...vehicle, name: contactName};
      });

      return changed ? next : current;
    });
  }, [contactNames]);

  const setNavigationTarget = useCallback((vehicleId: string) => {
    setNavigationFieldTargetState(null);
    setNavigationTargetVehicleId(vehicleId);
  }, []);

  const setNavigationFieldTarget = useCallback(
    (target: FieldNavigationTarget) => {
      setNavigationTargetVehicleId(null);
      setNavigationFieldTargetState({...target});
    },
    [],
  );

  const clearNavigationTarget = useCallback(() => {
    setNavigationTargetVehicleId(null);
    setNavigationFieldTargetState(null);
  }, []);

  const loadDemoConvoy = useCallback(() => {
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    const demoOrigin = {latitude: -37.5628, longitude: 146.2504};
    const demoVehicles: ConvoyVehicle[] = [
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
    ];

    const demoTails: Record<string, BuddyTail> = {};
    demoVehicles.forEach(vehicle => {
      demoTails[vehicle.id] = appendBuddyTailPoint(undefined, vehicle, now);
    });

    clearNavigationTarget();
    setLocalPosition(demoOrigin);
    setVehicles(demoVehicles);
    setBuddyTailMap(demoTails);
  }, [clearNavigationTarget]);

  const clearConvoy = useCallback(() => {
    setVehicles([]);
    setBuddyTailMap({});
    setLocalPosition(null);
    clearNavigationTarget();
  }, [clearNavigationTarget]);

  const navigationTargetVehicle = useMemo(
    () =>
      navigationTargetVehicleId
        ? vehicles.find(vehicle => vehicle.id === navigationTargetVehicleId) ?? null
        : null,
    [vehicles, navigationTargetVehicleId],
  );

  const buddyTails = useMemo(() => Object.values(buddyTailMap), [buddyTailMap]);

  const getBuddyTail = useCallback(
    (vehicleId: string): BuddyTail | null => buddyTailMap[vehicleId] ?? null,
    [buddyTailMap],
  );

  const value = useMemo<ConvoyContextValue>(
    () => ({
      vehicles,
      buddyTails,
      localPosition,
      navigationTargetVehicleId,
      navigationTargetVehicle,
      navigationFieldTarget,
      getBuddyTail,
      upsertBushMeshMessage,
      setLocalPosition,
      setNavigationTarget,
      setNavigationFieldTarget,
      clearNavigationTarget,
      loadDemoConvoy,
      clearConvoy,
    }),
    [
      vehicles,
      buddyTails,
      localPosition,
      navigationTargetVehicleId,
      navigationTargetVehicle,
      navigationFieldTarget,
      getBuddyTail,
      upsertBushMeshMessage,
      setNavigationTarget,
      setNavigationFieldTarget,
      clearNavigationTarget,
      loadDemoConvoy,
      clearConvoy,
    ],
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
