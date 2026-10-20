import {
  BushMeshControlCommand,
  BushMeshDistressType,
  BushMeshSyncFrameKind,
  BushMeshTypedPacket,
} from '../protocol';
import {BushMeshRuntimeReceivedMessage} from './BushMeshNetworkRuntime';

function distressLabel(type: number): string {
  switch (type) {
    case BushMeshDistressType.Medical:
      return 'Medical assistance requested';
    case BushMeshDistressType.Injury:
      return 'Injury assistance requested';
    case BushMeshDistressType.Fire:
      return 'Fire alert';
    case BushMeshDistressType.Lost:
      return 'Person reported lost';
    case BushMeshDistressType.Vehicle:
      return 'Vehicle emergency';
    case BushMeshDistressType.NeedWater:
      return 'Water required';
    case BushMeshDistressType.Flood:
      return 'Flood hazard';
    case BushMeshDistressType.General:
      return 'Emergency assistance requested';
    default:
      return `Emergency type ${type}`;
  }
}

function renderTyped(packet: BushMeshTypedPacket): string | null {
  switch (packet.kind) {
    case 'distress': {
      const parts = [`🚨 ${distressLabel(packet.value.type)}`];
      if (packet.value.location) {
        parts.push(
          `${packet.value.location.latitude.toFixed(5)}, ${packet.value.location.longitude.toFixed(5)}`,
        );
      }
      if (packet.value.batteryPercent !== undefined) {
        parts.push(`Battery ${packet.value.batteryPercent}%`);
      }
      return parts.join(' • ');
    }

    case 'location':
      return `📍 Location ${packet.value.latitude.toFixed(5)}, ${packet.value.longitude.toFixed(5)}${
        packet.value.batteryPercent !== undefined
          ? ` • Battery ${packet.value.batteryPercent}%`
          : ''
      }`;

    case 'location-delta':
      return `📍 Location delta ${packet.value.northMetres >= 0 ? '+' : ''}${packet.value.northMetres} m north, ${packet.value.eastMetres >= 0 ? '+' : ''}${packet.value.eastMetres} m east`;

    case 'telemetry': {
      const values: string[] = [];
      if (packet.value.batteryPercent !== undefined) {
        values.push(`Battery ${packet.value.batteryPercent}%`);
      }
      if (packet.value.batteryMillivolts !== undefined) {
        values.push(`${(packet.value.batteryMillivolts / 1000).toFixed(2)} V`);
      }
      if (packet.value.temperatureC !== undefined) {
        values.push(`${packet.value.temperatureC.toFixed(1)} °C`);
      }
      if (packet.value.altitudeMetres !== undefined) {
        values.push(`Altitude ${Math.round(packet.value.altitudeMetres)} m`);
      }
      if (packet.value.speedMetresPerSecond !== undefined) {
        values.push(`Speed ${(packet.value.speedMetresPerSecond * 3.6).toFixed(1)} km/h`);
      }
      if (packet.value.headingDegrees !== undefined) {
        values.push(`Heading ${Math.round(packet.value.headingDegrees)}°`);
      }
      return values.length > 0 ? `Telemetry • ${values.join(' • ')}` : 'Telemetry update';
    }

    case 'device-info':
      return `BushMesh node ${packet.value.nodeId.toString(16).padStart(8, '0')} discovered`;

    case 'ping':
      return packet.value.response
        ? `BushMesh PONG ${packet.value.nonce}`
        : `BushMesh PING ${packet.value.nonce}`;

    case 'route':
      return `Route update • destination ${packet.value.destinationNodeId.toString(16).padStart(8, '0')} • ${packet.value.hopCount} hop(s) • quality ${Math.round(packet.value.pathQuality)}%`;

    case 'routed':
      return packet.value.destinationNodeId === undefined
        ? `Routed broadcast from ${packet.value.sourceNodeId.toString(16).padStart(8, '0')}`
        : `Routed packet ${packet.value.sourceNodeId.toString(16).padStart(8, '0')} → ${packet.value.destinationNodeId.toString(16).padStart(8, '0')}`;

    case 'command':
      switch (packet.value.command) {
        case BushMeshControlCommand.RequestLocation:
          return 'Location requested';
        case BushMeshControlCommand.RequestAbsoluteLocation:
          return 'Fresh absolute location requested';
        case BushMeshControlCommand.RequestNodeHello:
          return 'Node information requested';
        case BushMeshControlCommand.RequestSync:
          return `Sync requested for namespace ${packet.value.namespace}`;
        default:
          return 'BushMesh command received';
      }

    case 'sync':
      return packet.value.kind === BushMeshSyncFrameKind.Summary
        ? `Sync summary • namespace ${packet.value.namespace} • generation ${packet.value.generation}`
        : `Sync range request • namespace ${packet.value.namespace} • ${packet.value.ranges.length} range(s)`;

    case 'file':
      return 'BushMesh file-transfer frame';

    case 'other':
      return null;
  }
}

export function renderBushMeshReceivedMessage(
  message: BushMeshRuntimeReceivedMessage,
): string | null {
  return message.decoded.renderedText ?? renderTyped(message.typed);
}
