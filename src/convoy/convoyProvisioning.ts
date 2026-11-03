import {Buffer} from 'buffer';

import {
  MeshCoreChannelProvisioningPort,
  MeshCoreProvisionedChannel,
  provisionMeshCoreChannel,
} from '../meshcore/meshcoreProvisioning';
import {
  meshCoreSecretFromHex,
  meshCoreSecretToHex,
} from '../meshcore/meshcoreChannelInfo';

const INVITE_PREFIX = 'BUSHMESH-CONVOY-1:';

export type BushMeshConvoyInviteV1 = {
  schema: 'bushmesh-convoy-invite';
  version: 1;
  convoy: {
    id: string;
    name: string;
  };
  carrier: {
    kind: 'meshcore-channel';
    channelName: string;
    secretHex: string;
  };
  security: {
    contract: 'bushmesh-security-v1';
    enrollment: null;
  };
};

export type BushMeshConvoyEnrollment = {
  convoyId: string;
  convoyName: string;
  channel: MeshCoreProvisionedChannel;
  invite: string;
};

function bytesToId(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function encodeBushMeshConvoyInvite(
  invite: BushMeshConvoyInviteV1,
): string {
  return `${INVITE_PREFIX}${Buffer.from(JSON.stringify(invite), 'utf8').toString(
    'base64',
  )}`;
}

export function decodeBushMeshConvoyInvite(
  value: string,
): BushMeshConvoyInviteV1 {
  const trimmed = value.trim();
  if (!trimmed.startsWith(INVITE_PREFIX)) {
    throw new Error('This is not a supported BushMesh convoy invite.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(trimmed.slice(INVITE_PREFIX.length), 'base64').toString('utf8'),
    );
  } catch {
    throw new Error('BushMesh convoy invite is malformed.');
  }

  const candidate = parsed as Partial<BushMeshConvoyInviteV1>;
  if (
    candidate.schema !== 'bushmesh-convoy-invite' ||
    candidate.version !== 1 ||
    candidate.carrier?.kind !== 'meshcore-channel' ||
    candidate.security?.contract !== 'bushmesh-security-v1' ||
    candidate.security?.enrollment !== null ||
    typeof candidate.convoy?.id !== 'string' ||
    !candidate.convoy.id.trim() ||
    typeof candidate.convoy?.name !== 'string' ||
    !candidate.convoy.name.trim() ||
    typeof candidate.carrier?.channelName !== 'string' ||
    !candidate.carrier.channelName.trim() ||
    typeof candidate.carrier?.secretHex !== 'string'
  ) {
    throw new Error('BushMesh convoy invite has unsupported or incomplete metadata.');
  }

  // Validates exactly 16 carrier-secret bytes. This is intentionally distinct
  // from Security v1 group-key material.
  meshCoreSecretFromHex(candidate.carrier.secretHex);
  return candidate as BushMeshConvoyInviteV1;
}

export async function createBushMeshConvoy(
  port: MeshCoreChannelProvisioningPort,
  input: {
    convoyName: string;
    channelName?: string;
    channelIndex?: number | null;
    randomBytes: (length: number) => Promise<Uint8Array>;
  },
): Promise<BushMeshConvoyEnrollment> {
  const convoyName = input.convoyName.trim();
  if (!convoyName) throw new Error('Convoy name cannot be empty.');
  const channelName = (input.channelName ?? `BM ${convoyName}`).trim();
  const convoyIdBytes = await input.randomBytes(8);
  if (convoyIdBytes.length !== 8) {
    throw new Error('Secure convoy id generation returned an invalid length.');
  }
  const convoyId = bytesToId(convoyIdBytes);
  const channel = await provisionMeshCoreChannel(port, {
    channelName,
    channelIndex: input.channelIndex,
    randomBytes: input.randomBytes,
  });

  const inviteObject: BushMeshConvoyInviteV1 = {
    schema: 'bushmesh-convoy-invite',
    version: 1,
    convoy: {id: convoyId, name: convoyName},
    carrier: {
      kind: 'meshcore-channel',
      channelName: channel.channelName,
      secretHex: meshCoreSecretToHex(channel.secret),
    },
    security: {
      contract: 'bushmesh-security-v1',
      enrollment: null,
    },
  };

  return {
    convoyId,
    convoyName,
    channel,
    invite: encodeBushMeshConvoyInvite(inviteObject),
  };
}

export async function joinBushMeshConvoy(
  port: MeshCoreChannelProvisioningPort,
  input: {
    invite: string;
    channelIndex?: number | null;
  },
): Promise<BushMeshConvoyEnrollment> {
  const decoded = decodeBushMeshConvoyInvite(input.invite);
  const channel = await provisionMeshCoreChannel(port, {
    channelName: decoded.carrier.channelName,
    secret: meshCoreSecretFromHex(decoded.carrier.secretHex),
    channelIndex: input.channelIndex,
  });
  return {
    convoyId: decoded.convoy.id,
    convoyName: decoded.convoy.name,
    channel,
    invite: input.invite.trim(),
  };
}
