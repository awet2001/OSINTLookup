import {
  clampConfidence,
  normalizeObservedValue,
  type EntityKind,
  type Observation,
  type RelationshipHint,
} from './model';

export type Finding = {
  id: string;
  category: string;
  label: string;
  value: string;
  confidence: number;
  source: {
    name: string;
    kind: 'local-metadata' | 'licensed-provider';
    url?: string;
  };
  note?: string;
};

type ProviderConfig = {
  name: string;
  url: string;
  token?: string;
};

type RawObservation = {
  id?: unknown;
  entityKind?: unknown;
  field?: unknown;
  value?: unknown;
  confidence?: unknown;
  sourceUrl?: unknown;
  observedAt?: unknown;
  note?: unknown;
};

type RawRelationship = {
  from?: unknown;
  to?: unknown;
  type?: unknown;
  confidence?: unknown;
  sourceUrl?: unknown;
  note?: unknown;
};

type RawFinding = {
  category?: unknown;
  label?: unknown;
  value?: unknown;
  confidence?: unknown;
  sourceUrl?: unknown;
  note?: unknown;
};

type ProviderPayload = {
  observations?: unknown;
  relationships?: unknown;
  findings?: unknown;
};

const entityKinds = new Set<EntityKind>([
  'phone', 'person', 'organization', 'email', 'address', 'profile', 'domain', 'other',
]);

const clean = (value: unknown, max = 300): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'provider';

function parseProviderConfigs(): ProviderConfig[] {
  const json = process.env.LICENSED_PROVIDERS_JSON?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, 8).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const candidate = item as Record<string, unknown>;
        const name = clean(candidate.name, 100);
        const url = clean(candidate.url, 1000);
        const token = clean(candidate.token, 1000);
        if (!name || !url || !url.includes('{phone}')) return [];
        return [{ name, url, ...(token ? { token } : {}) }];
      });
    } catch {
      return [];
    }
  }

  const url = process.env.LICENSED_PROVIDER_URL?.trim();
  if (!url || !url.includes('{phone}')) return [];
  const name = process.env.LICENSED_PROVIDER_NAME?.trim() || 'Licensed data provider';
  const token = process.env.LICENSED_PROVIDER_TOKEN?.trim();
  return [{ name, url, ...(token ? { token } : {}) }];
}

async function queryOneProvider(config: ProviderConfig, e164: string, providerIndex: number): Promise<{
  name: string;
  observations: Observation[];
  relationships: RelationshipHint[];
  findings: Finding[];
  error?: string;
}> {
  const url = config.url.replaceAll('{phone}', encodeURIComponent(e164));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.token) headers.authorization = `Bearer ${config.token}`;

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(7000),
      redirect: 'error',
    });
    if (!response.ok) {
      return { name: config.name, observations: [], relationships: [], findings: [], error: `HTTP ${response.status}` };
    }

    const body = (await response.json()) as ProviderPayload;
    const prefix = `${slug(config.name)}-${providerIndex + 1}`;
    const observations: Observation[] = [];
    const findings: Finding[] = [];
    const externalIdMap = new Map<string, string>([['$query', 'query-phone']]);

    if (Array.isArray(body.observations)) {
      for (const [index, raw] of (body.observations as RawObservation[]).slice(0, 50).entries()) {
        const value = clean(raw.value, 500);
        const field = clean(raw.field, 80);
        const rawKind = clean(raw.entityKind, 40) as EntityKind | undefined;
        if (!value || !field || !rawKind || !entityKinds.has(rawKind)) continue;
        const confidence = clampConfidence(typeof raw.confidence === 'number' ? raw.confidence : 0.5);
        const sourceUrl = clean(raw.sourceUrl, 1000);
        const observedAt = clean(raw.observedAt, 60);
        const note = clean(raw.note, 300);
        const id = `${prefix}-observation-${index + 1}`;
        const externalId = clean(raw.id, 100);
        if (externalId) externalIdMap.set(externalId, id);

        observations.push({
          id,
          entityKind: rawKind,
          field,
          value,
          normalizedValue: normalizeObservedValue(rawKind, value),
          confidence,
          source: { name: config.name, kind: 'licensed-provider', ...(sourceUrl ? { url: sourceUrl } : {}) },
          ...(observedAt ? { observedAt } : {}),
          ...(note ? { note } : {}),
        });
      }
    }

    // Backward compatibility with the original flat findings contract.
    if (Array.isArray(body.findings)) {
      for (const [index, raw] of (body.findings as RawFinding[]).slice(0, 25).entries()) {
        const label = clean(raw.label, 100);
        const value = clean(raw.value, 500);
        if (!label || !value) continue;
        const category = clean(raw.category, 60) || 'identity';
        const confidence = clampConfidence(typeof raw.confidence === 'number' ? raw.confidence : 0.5);
        const sourceUrl = clean(raw.sourceUrl, 1000);
        const note = clean(raw.note, 300);
        const findingId = `${prefix}-finding-${index + 1}`;
        findings.push({
          id: findingId,
          category,
          label,
          value,
          confidence,
          source: { name: config.name, kind: 'licensed-provider', ...(sourceUrl ? { url: sourceUrl } : {}) },
          ...(note ? { note } : {}),
        });
        observations.push({
          id: findingId,
          entityKind: 'other',
          field: label,
          value,
          normalizedValue: normalizeObservedValue('other', value),
          confidence,
          source: { name: config.name, kind: 'licensed-provider', ...(sourceUrl ? { url: sourceUrl } : {}) },
          ...(note ? { note } : {}),
        });
      }
    }

    const relationships: RelationshipHint[] = [];
    if (Array.isArray(body.relationships)) {
      for (const raw of (body.relationships as RawRelationship[]).slice(0, 100)) {
        const fromExternal = clean(raw.from, 100);
        const toExternal = clean(raw.to, 100);
        const type = clean(raw.type, 80);
        if (!fromExternal || !toExternal || !type) continue;
        const fromObservationId = externalIdMap.get(fromExternal);
        const toObservationId = externalIdMap.get(toExternal);
        if (!fromObservationId || !toObservationId) continue;
        const confidence = clampConfidence(typeof raw.confidence === 'number' ? raw.confidence : 0.5);
        const sourceUrl = clean(raw.sourceUrl, 1000);
        const note = clean(raw.note, 300);
        relationships.push({
          fromObservationId,
          toObservationId,
          type,
          confidence,
          source: { name: config.name, kind: 'licensed-provider', ...(sourceUrl ? { url: sourceUrl } : {}) },
          ...(note ? { note } : {}),
        });
      }
    }

    return { name: config.name, observations, relationships, findings };
  } catch {
    return { name: config.name, observations: [], relationships: [], findings: [], error: 'request failed or timed out' };
  }
}

export async function queryLicensedProviders(e164: string): Promise<{
  configured: boolean;
  providerStatuses: Array<{ name: string; ok: boolean; error?: string }>;
  observations: Observation[];
  relationships: RelationshipHint[];
  findings: Finding[];
}> {
  const configs = parseProviderConfigs();
  if (!configs.length) {
    return { configured: false, providerStatuses: [], observations: [], relationships: [], findings: [] };
  }

  const results = await Promise.all(configs.map((config, index) => queryOneProvider(config, e164, index)));
  return {
    configured: true,
    providerStatuses: results.map((result) => ({
      name: result.name,
      ok: !result.error,
      ...(result.error ? { error: result.error } : {}),
    })),
    observations: results.flatMap((result) => result.observations),
    relationships: results.flatMap((result) => result.relationships),
    findings: results.flatMap((result) => result.findings),
  };
}

// Compatibility shim for callers that still expect the original single-provider function.
export async function queryLicensedProvider(e164: string): Promise<{
  configured: boolean;
  providerName?: string;
  findings: Finding[];
  error?: string;
}> {
  const result = await queryLicensedProviders(e164);
  const first = result.providerStatuses[0];
  return {
    configured: result.configured,
    ...(first ? { providerName: first.name } : {}),
    findings: result.findings,
    ...(first?.error ? { error: first.error } : {}),
  };
}
