export type SourceKind = 'local-metadata' | 'licensed-provider' | 'public-record';

export type EntityKind =
  | 'phone'
  | 'person'
  | 'organization'
  | 'email'
  | 'address'
  | 'profile'
  | 'domain'
  | 'other';

export type Observation = {
  id: string;
  entityKind: EntityKind;
  field: string;
  value: string;
  normalizedValue: string;
  confidence: number;
  source: {
    name: string;
    kind: SourceKind;
    url?: string;
  };
  observedAt?: string;
  note?: string;
};

export type RelationshipHint = {
  fromObservationId: string;
  toObservationId: string;
  type: string;
  confidence: number;
  source: {
    name: string;
    kind: SourceKind;
    url?: string;
  };
  note?: string;
};

export type ResolvedEntity = {
  id: string;
  kind: EntityKind;
  displayValue: string;
  confidence: number;
  observationIds: string[];
  sources: Array<{
    name: string;
    kind: SourceKind;
    url?: string;
  }>;
};

export type ResolvedRelationship = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  confidence: number;
  evidenceObservationIds: string[];
};

export type ProvenanceReport = {
  observations: Observation[];
  entities: ResolvedEntity[];
  relationships: ResolvedRelationship[];
  warnings: string[];
};

export const clampConfidence = (value: number): number => Math.max(0, Math.min(1, value));

export const normalizeObservedValue = (kind: EntityKind, value: string): string => {
  const trimmed = value.trim();
  if (kind === 'email' || kind === 'domain') return trimmed.toLowerCase();
  if (kind === 'profile') {
    try {
      const url = new URL(trimmed);
      url.hash = '';
      url.search = '';
      url.hostname = url.hostname.toLowerCase();
      return url.toString().replace(/\/$/, '');
    } catch {
      return trimmed.toLowerCase();
    }
  }
  if (kind === 'phone') return trimmed.replace(/[\s().-]/g, '');
  if (kind === 'address') return trimmed.toLowerCase().replace(/\s+/g, ' ');
  return trimmed.toLowerCase().replace(/\s+/g, ' ');
};
