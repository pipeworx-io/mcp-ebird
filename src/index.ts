interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * eBird MCP — Cornell Lab of Ornithology citizen-science bird observations
 *
 * 1B+ bird sightings worldwide. Distinct from `inaturalist` (all taxa) and
 * `gbif` (occurrence aggregator) — eBird is ornithology-first with rich
 * region trees, notable-sighting flags, and species-specific endpoints.
 *
 * API: https://documenter.getpostman.com/view/664302/S1ENwy59
 * Auth: header `X-eBirdApiToken`. Free, register at ebird.org/api/keygen.
 *
 * Tools:
 * - recent_observations:  recent sightings in a region
 * - recent_notable:       only rare / out-of-range sightings
 * - nearby_observations:  sightings within a radius of a lat/lon
 * - find_species:         taxonomy search by common/scientific name
 * - list_subregions:      child regions of a region (e.g., US states inside US)
 */


const BASE_URL = 'https://api.ebird.org/v2';

const tools: McpToolExport['tools'] = [
  {
    name: 'recent_observations',
    description:
      'Recent bird sightings in a region. region_code is the eBird identifier — countries are 2-letter ("US", "GB"), states "US-CA", counties "US-CA-075", and birding hotspots use the "L<id>" code from eBird (e.g., "L99381"). Optionally filter to one species.',
    inputSchema: {
      type: 'object',
      properties: {
        region_code: { type: 'string', description: 'eBird region code' },
        species_code: { type: 'string', description: 'Optional eBird species code (use find_species to look up)' },
        back: { type: 'number', description: 'Days back (1-30, default 14)' },
        max_results: { type: 'number', description: '1-10000 (default 100)' },
        include_provisional: { type: 'boolean', description: 'Include unconfirmed observations (default false)' },
      },
      required: ['region_code'],
    },
  },
  {
    name: 'recent_notable',
    description:
      'Only notable (rare / out-of-range / first-of-season) sightings in a region. Sometimes the most interesting subset.',
    inputSchema: {
      type: 'object',
      properties: {
        region_code: { type: 'string', description: 'eBird region code' },
        back: { type: 'number', description: 'Days back (1-30, default 14)' },
        max_results: { type: 'number', description: '1-10000 (default 100)' },
        detail: { type: 'string', description: 'simple | full (default simple)' },
      },
      required: ['region_code'],
    },
  },
  {
    name: 'nearby_observations',
    description: 'Recent observations within a radius of a lat/lon. Useful for "what birds are around here right now."',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Latitude' },
        longitude: { type: 'number', description: 'Longitude' },
        dist_km: { type: 'number', description: 'Radius in km (1-50, default 25)' },
        back: { type: 'number', description: 'Days back (1-30, default 14)' },
        max_results: { type: 'number', description: '1-10000 (default 100)' },
        species_code: { type: 'string', description: 'Optional species filter' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'find_species',
    description:
      'Search the eBird taxonomy by common or scientific name. Returns the eBird species code needed by the observation tools.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Common or scientific name' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_subregions',
    description:
      'Child regions of a parent. region_type is "country", "subnational1" (states/provinces), or "subnational2" (counties). parent_region_code uses eBird codes ("world", "US", "US-CA").',
    inputSchema: {
      type: 'object',
      properties: {
        region_type: {
          type: 'string',
          description: 'country | subnational1 | subnational2',
          enum: ['country', 'subnational1', 'subnational2'],
        },
        parent_region_code: { type: 'string', description: 'Parent region (default "world")' },
      },
      required: ['region_type'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error(
      'eBird requires an API token. Contact the operator about platform credentials, or BYO via ?_apiKey=<token> after registering at https://ebird.org/api/keygen.',
    );
  }
  switch (name) {
    case 'recent_observations':
      return recentObservations(apiKey, args);
    case 'recent_notable':
      return recentNotable(apiKey, args);
    case 'nearby_observations':
      return nearbyObservations(apiKey, args);
    case 'find_species':
      return findSpecies(apiKey, reqStr(args, 'query', '"snowy owl"'));
    case 'list_subregions':
      return listSubregions(
        apiKey,
        reqStr(args, 'region_type', '"subnational1" (e.g., for US states)'),
        (args.parent_region_code as string) ?? 'world',
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing or empty. Pass a string like ${example}.`);
  }
  return v;
}

async function ebirdFetch<T>(apiKey: string, path: string, params: URLSearchParams): Promise<T> {
  const url = `${BASE_URL}${path}${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url, {
    headers: { 'X-eBirdApiToken': apiKey, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) throw new Error('eBird: unauthorized — check the API token');
  if (res.status === 404) throw new Error('eBird: not found (HTTP 404) — check region/species codes');
  if (res.status === 429) throw new Error('eBird: rate-limit (HTTP 429)');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eBird error: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface EbirdObservation {
  speciesCode?: string;
  comName?: string;
  sciName?: string;
  locId?: string;
  locName?: string;
  obsDt?: string;
  howMany?: number;
  lat?: number;
  lng?: number;
  obsValid?: boolean;
  obsReviewed?: boolean;
  locationPrivate?: boolean;
  subId?: string;
  exoticCategory?: string;
}

function normalizeObservation(o: EbirdObservation) {
  return {
    species_code: o.speciesCode ?? null,
    common_name: o.comName ?? null,
    scientific_name: o.sciName ?? null,
    location_id: o.locId ?? null,
    location: o.locName ?? null,
    latitude: o.lat ?? null,
    longitude: o.lng ?? null,
    observed_at: o.obsDt ?? null,
    count: o.howMany ?? null,
    valid: o.obsValid ?? null,
    reviewed: o.obsReviewed ?? null,
    private_location: o.locationPrivate ?? null,
    checklist_id: o.subId ?? null,
    exotic_category: o.exoticCategory ?? null,
  };
}

async function recentObservations(apiKey: string, args: Record<string, unknown>) {
  const region = reqStr(args, 'region_code', '"US-CA" or "L99381"');
  const params = new URLSearchParams({
    back: String(Math.min(30, Math.max(1, (args.back as number) ?? 14))),
    maxResults: String(Math.min(10000, Math.max(1, (args.max_results as number) ?? 100))),
  });
  if (args.include_provisional) params.set('includeProvisional', 'true');
  const path = args.species_code
    ? `/data/obs/${encodeURIComponent(region)}/recent/${encodeURIComponent(String(args.species_code))}`
    : `/data/obs/${encodeURIComponent(region)}/recent`;
  const data = await ebirdFetch<EbirdObservation[]>(apiKey, path, params);
  return { region_code: region, count: data.length, observations: data.map(normalizeObservation) };
}

async function recentNotable(apiKey: string, args: Record<string, unknown>) {
  const region = reqStr(args, 'region_code', '"US-MA"');
  const params = new URLSearchParams({
    back: String(Math.min(30, Math.max(1, (args.back as number) ?? 14))),
    maxResults: String(Math.min(10000, Math.max(1, (args.max_results as number) ?? 100))),
    detail: (args.detail as string) ?? 'simple',
  });
  const data = await ebirdFetch<EbirdObservation[]>(
    apiKey,
    `/data/obs/${encodeURIComponent(region)}/recent/notable`,
    params,
  );
  return { region_code: region, count: data.length, observations: data.map(normalizeObservation) };
}

async function nearbyObservations(apiKey: string, args: Record<string, unknown>) {
  const params = new URLSearchParams({
    lat: String(args.latitude),
    lng: String(args.longitude),
    dist: String(Math.min(50, Math.max(1, (args.dist_km as number) ?? 25))),
    back: String(Math.min(30, Math.max(1, (args.back as number) ?? 14))),
    maxResults: String(Math.min(10000, Math.max(1, (args.max_results as number) ?? 100))),
  });
  const path = args.species_code
    ? `/data/obs/geo/recent/${encodeURIComponent(String(args.species_code))}`
    : '/data/obs/geo/recent';
  const data = await ebirdFetch<EbirdObservation[]>(apiKey, path, params);
  return {
    center: { latitude: args.latitude, longitude: args.longitude },
    count: data.length,
    observations: data.map(normalizeObservation),
  };
}

async function findSpecies(apiKey: string, query: string) {
  const data = await ebirdFetch<{ code?: string; name?: string }[]>(
    apiKey,
    '/ref/taxa/search',
    new URLSearchParams({ q: query }),
  );
  return {
    query,
    count: data.length,
    species: data.map((s) => ({ species_code: s.code ?? null, name: s.name ?? null })),
  };
}

async function listSubregions(apiKey: string, regionType: string, parent: string) {
  const data = await ebirdFetch<{ code?: string; name?: string }[]>(
    apiKey,
    `/ref/region/list/${encodeURIComponent(regionType)}/${encodeURIComponent(parent)}`,
    new URLSearchParams(),
  );
  return {
    region_type: regionType,
    parent_region: parent,
    count: data.length,
    regions: data.map((r) => ({ code: r.code ?? null, name: r.name ?? null })),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
