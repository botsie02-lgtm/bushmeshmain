import {
  MeshCoreRadioParams,
  validateMeshCoreRadioParams,
  validateMeshCoreTxPower,
  verifyMeshCoreRadioParams,
  verifyMeshCoreTxPower,
} from '../meshcore/meshcoreRadioSettings';
import {MeshCoreSelfInfo} from '../meshcore/meshcoreSelfInfo';

export const MESHCORE_REGION_CATALOG_URL = 'https://api.meshcore.nz/api/v1/config';
export const MESHCORE_REGION_DOCS_URL = 'https://docs.meshcore.io/radio_presets/';

export type RadioProfileWithTx = MeshCoreRadioParams & {txPowerDbm: number};

export type RegionRadioPreset = {
  id: string;
  label: string;
  region: string;
  description: string;
  settings: MeshCoreRadioParams;
  /** MeshCore's published radio presets do not promise a TX-power setting. */
  txPolicy: 'retain-verified-device-power';
  /** May need a separate device command; the current BushMesh port does not write it. */
  pathHashSize: number | null;
  source: 'meshcore-api' | 'meshcore-doc-example';
  sourceUrl: string;
  sourceRevision: string;
};

export type RegionCatalog = {
  schemaVersion: 1;
  source: RegionRadioPreset['source'];
  sourceUrl: string;
  revision: string;
  retrievedAt: string | null;
  info: string;
  profiles: RegionRadioPreset[];
  rejectedEntries: number;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function numeric(value: unknown, label: string): number {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'string' && !value.trim())
  ) {
    throw new Error(label + ' is missing.');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(label + ' is not finite.');
  return parsed;
}

function profileId(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hashRevision(text: string): string {
  // Stable catalog change marker, not a security/content-authentication hash.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return 'fnv1a-' + (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Parse the configuration that official MeshCore apps download. Do not parse
 * description strings for values; take the four structured RF fields only.
 * Invalid or incomplete entries are omitted rather than converted to guesses.
 */
export function parseMeshCoreRegionCatalog(
  payload: unknown,
  retrievedAt: string,
): RegionCatalog {
  const settings = object(object(payload)?.config)?.suggested_radio_settings;
  const record = object(settings);
  if (!record || !Array.isArray(record.entries)) {
    throw new Error('MeshCore config has no suggested_radio_settings.entries array.');
  }
  if (record.entries.length > 256) throw new Error('MeshCore preset list is too large.');

  const parsed: Array<Omit<RegionRadioPreset, 'sourceRevision'>> = [];
  const ids = new Set<string>();
  let rejectedEntries = 0;
  for (const raw of record.entries) {
    try {
      const entry = object(raw);
      if (!entry || typeof entry.title !== 'string' || !entry.title.trim() ||
          entry.title.length > 100) throw new Error('Invalid title');
      const id = profileId(entry.title);
      if (!id || ids.has(id)) throw new Error('Duplicate or invalid preset ID');
      const settingsWire = validateMeshCoreRadioParams({
        frequencyMhz: numeric(entry.frequency, 'Frequency'),
        bandwidthKhz: numeric(entry.bandwidth, 'Bandwidth'),
        spreadingFactor: numeric(entry.spreading_factor, 'Spreading factor'),
        codingRate: numeric(entry.coding_rate, 'Coding rate'),
      });
      const network = object(entry.network_settings);
      const pathHash = network?.path_hash_size;
      const pathHashSize =
        pathHash === undefined || pathHash === null
          ? null : numeric(pathHash, 'Path hash size');
      if (pathHashSize !== null &&
          (!Number.isInteger(pathHashSize) || pathHashSize < 1 || pathHashSize > 3)) {
        throw new Error('Unsupported path hash size');
      }
      const label = entry.title.trim();
      ids.add(id);
      parsed.push({
        id,
        label,
        region: label.split('(')[0].trim(),
        description: typeof entry.description === 'string'
          ? entry.description.slice(0, 180) : '',
        settings: {
          frequencyMhz: settingsWire.frequencyMhz,
          bandwidthKhz: settingsWire.bandwidthKhz,
          spreadingFactor: settingsWire.spreadingFactor,
          codingRate: settingsWire.codingRate,
        },
        txPolicy: 'retain-verified-device-power',
        pathHashSize,
        source: 'meshcore-api',
        sourceUrl: MESHCORE_REGION_CATALOG_URL,
      });
    } catch {
      rejectedEntries += 1;
    }
  }
  if (!parsed.length) throw new Error('MeshCore returned no valid complete radio presets.');
  const revision = hashRevision(JSON.stringify(parsed));
  return {
    schemaVersion: 1,
    source: 'meshcore-api',
    sourceUrl: MESHCORE_REGION_CATALOG_URL,
    revision,
    retrievedAt,
    info: typeof record.info_message === 'string'
      ? record.info_message.slice(0, 250) : 'Community-suggested radio settings.',
    profiles: parsed.map(p => ({...p, sourceRevision: revision})),
    rejectedEntries,
  };
}

/**
 * Only an offline documentation EXAMPLE, not a claim of current live settings.
 * MeshCore can revise the server catalog independently of firmware/app builds.
 * The documentation's sample lists CR7; local community advice may differ.
 */
export const MESHCORE_DOCUMENTED_EXAMPLE: RegionCatalog = {
  schemaVersion: 1,
  source: 'meshcore-doc-example',
  sourceUrl: MESHCORE_REGION_DOCS_URL,
  revision: 'docs-example-reviewed-2026-11-09',
  retrievedAt: null,
  info: 'OFFLINE DOCUMENTATION EXAMPLE — not live MeshCore presets. Check with your local network.',
  rejectedEntries: 0,
  profiles: [{
    id: 'australia-narrow',
    label: 'Australia (Narrow)',
    region: 'Australia',
    description: 'Example in official MeshCore radio-preset documentation.',
    settings: {
      frequencyMhz: 916.575,
      bandwidthKhz: 62.5,
      spreadingFactor: 7,
      codingRate: 7,
    },
    txPolicy: 'retain-verified-device-power',
    pathHashSize: null,
    source: 'meshcore-doc-example',
    sourceUrl: MESHCORE_REGION_DOCS_URL,
    sourceRevision: 'docs-example-reviewed-2026-11-09',
  }],
};

export async function loadLiveMeshCoreRegionCatalog(
  request: typeof fetch = fetch,
): Promise<RegionCatalog> {
  const response = await request(MESHCORE_REGION_CATALOG_URL, {
    headers: {'User-Agent': 'BushMesh/1.0 (radio profile settings)', Accept: 'application/json'},
  });
  if (!response.ok) throw new Error('MeshCore preset API returned HTTP ' + response.status + '.');
  return parseMeshCoreRegionCatalog(await response.json(), new Date().toISOString());
}

export function readCompleteDeviceProfile(info: MeshCoreSelfInfo): RadioProfileWithTx {
  if (info.frequencyMhz === null || info.bandwidthKhz === null ||
      info.spreadingFactor === null || info.codingRate === null) {
    throw new Error('Read complete SELF_INFO radio settings before changing the node.');
  }
  const params = validateMeshCoreRadioParams({
    frequencyMhz: info.frequencyMhz,
    bandwidthKhz: info.bandwidthKhz,
    spreadingFactor: info.spreadingFactor,
    codingRate: info.codingRate,
  });
  return {
    frequencyMhz: params.frequencyMhz,
    bandwidthKhz: params.bandwidthKhz,
    spreadingFactor: params.spreadingFactor,
    codingRate: params.codingRate,
    txPowerDbm: validateMeshCoreTxPower(info.txPower, info.maxTxPower),
  };
}

export function proposeRegionProfile(
  preset: RegionRadioPreset,
  verifiedCurrent: MeshCoreSelfInfo,
): RadioProfileWithTx {
  const current = readCompleteDeviceProfile(verifiedCurrent);
  const params = validateMeshCoreRadioParams(preset.settings);
  return {
    frequencyMhz: params.frequencyMhz,
    bandwidthKhz: params.bandwidthKhz,
    spreadingFactor: params.spreadingFactor,
    codingRate: params.codingRate,
    txPowerDbm: validateMeshCoreTxPower(current.txPowerDbm, verifiedCurrent.maxTxPower),
  };
}

export function validateProposedProfile(
  profile: RadioProfileWithTx,
  maxTxPower: number | null | undefined,
): RadioProfileWithTx {
  const valid = validateMeshCoreRadioParams(profile);
  return {
    frequencyMhz: valid.frequencyMhz,
    bandwidthKhz: valid.bandwidthKhz,
    spreadingFactor: valid.spreadingFactor,
    codingRate: valid.codingRate,
    txPowerDbm: validateMeshCoreTxPower(profile.txPowerDbm, maxTxPower),
  };
}

export function assertReadBackMatches(
  proposed: RadioProfileWithTx,
  actual: MeshCoreSelfInfo,
): void {
  verifyMeshCoreRadioParams(validateMeshCoreRadioParams(proposed), actual);
  verifyMeshCoreTxPower(proposed.txPowerDbm, actual);
}

export type ProfileComparisonRow = {
  label: string;
  current: string;
  proposed: string;
  changed: boolean;
};
export function compareRadioProfiles(
  current: RadioProfileWithTx,
  proposed: RadioProfileWithTx,
): ProfileComparisonRow[] {
  const rows: Array<{label: string; key: keyof RadioProfileWithTx; unit: string}> = [
    {label: 'Frequency', key: 'frequencyMhz', unit: ' MHz'},
    {label: 'Bandwidth', key: 'bandwidthKhz', unit: ' kHz'},
    {label: 'Spreading factor', key: 'spreadingFactor', unit: ''},
    {label: 'Coding rate', key: 'codingRate', unit: ''},
    {label: 'TX power', key: 'txPowerDbm', unit: ' dBm'},
  ];
  return rows.map(row => ({
    label: row.label,
    current: String(current[row.key]) + row.unit,
    proposed: String(proposed[row.key]) + row.unit,
    changed: current[row.key] !== proposed[row.key],
  }));
}
