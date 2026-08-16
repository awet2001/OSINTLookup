import {
  clampConfidence,
  normalizeObservedValue,
  type Observation,
  type RelationshipHint,
} from '../model';

type Match = {
  match_score?: unknown;
  matched_on?: unknown;
  data?: unknown;
};

type PdlResponse = {
  status?: unknown;
  matches?: unknown;
};

type Result = {
  configured: boolean;
  name: string;
  ok: boolean;
  observations: Observation[];
  relationships: RelationshipHint[];
  error?: string;
};

const SOURCE = {
  name: 'People Data Labs Person Identify',
  kind: 'licensed-provider' as const,
  url: 'https://docs.peopledatalabs.com/docs/person-identify-api',
};

const clean = (value: unknown, max = 500): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const stringArray = (value: unknown, limit = 5): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const text = clean(item);
        return text ? [text] : [];
      }).slice(0, limit)
    : [];

function addObservation(
  observations: Observation[],
  relationships: RelationshipHint[],
  personObservationId: string,
  id: string,
  entityKind: Observation['entityKind'],
  field: string,
  value: string,
  confidence: number,
  relationshipType: string,
): void {
  observations.push({
    id,
    entityKind,
    field,
    value,
    normalizedValue: normalizeObservedValue(entityKind, value),
    confidence,
    source: SOURCE,
  });
  relationships.push({
    fromObservationId: personObservationId,
    toObservationId: id,
    type: relationshipType,
    confidence,
    source: SOURCE,
  });
}

export async function queryPeopleDataLabs(e164: string): Promise<Result> {
  const apiKey = process.env.PDL_API_KEY?.trim();
  const enabled = process.env.PDL_IDENTIFY_ENABLED?.trim().toLowerCase() === 'true';
  if (!enabled || !apiKey) {
    return {
      configured: false,
      name: SOURCE.name,
      ok: true,
      observations: [],
      relationships: [],
    };
  }

  const configuredMinScore = Number(process.env.PDL_MIN_MATCH_SCORE || 70);
  const minScore = Number.isFinite(configuredMinScore)
    ? Math.max(5, Math.min(99, configuredMinScore))
    : 70;

  const url = new URL('https://api.peopledatalabs.com/v5/person/identify');
  url.searchParams.set('phone', e164);
  url.searchParams.set('include_if_matched', 'true');
  url.searchParams.set('titlecase', 'true');
  url.searchParams.set(
    'data_include',
    [
      'id',
      'full_name',
      'emails.address',
      'phone_numbers',
      'location_name',
      'location_names',
      'profiles',
      'linkedin_url',
      'facebook_url',
      'twitter_url',
      'github_url',
      'job_company_name',
      'job_title',
    ].join(','),
  );

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });

    if (response.status === 404) {
      return {
        configured: true,
        name: SOURCE.name,
        ok: true,
        observations: [],
        relationships: [],
      };
    }
    if (!response.ok) {
      return {
        configured: true,
        name: SOURCE.name,
        ok: false,
        observations: [],
        relationships: [],
        error: `HTTP ${response.status}`,
      };
    }

    const body = await response.json() as PdlResponse;
    if (!Array.isArray(body.matches)) {
      return {
        configured: true,
        name: SOURCE.name,
        ok: false,
        observations: [],
        relationships: [],
        error: 'Response did not contain a matches array.',
      };
    }

    const observations: Observation[] = [];
    const relationships: RelationshipHint[] = [];

    for (const [matchIndex, rawMatch] of (body.matches as Match[]).slice(0, 5).entries()) {
      const scoreValue = typeof rawMatch.match_score === 'number' ? rawMatch.match_score : 0;
      if (scoreValue < minScore) continue;
      const confidence = clampConfidence(scoreValue / 100);
      const data = asRecord(rawMatch.data);
      if (!data) continue;

      const fullName = clean(data.full_name, 200);
      if (!fullName) continue;

      const prefix = `pdl-${matchIndex + 1}`;
      const personObservationId = `${prefix}-person`;
      observations.push({
        id: personObservationId,
        entityKind: 'person',
        field: 'full_name',
        value: fullName,
        normalizedValue: normalizeObservedValue('person', fullName),
        confidence,
        source: SOURCE,
        note: `PDL match score ${scoreValue}/100.`,
      });
      relationships.push({
        fromObservationId: 'query-phone',
        toObservationId: personObservationId,
        type: 'identified-as',
        confidence,
        source: SOURCE,
        note: 'The searched phone number was the identifying input for this profile match.',
      });

      const emails = Array.isArray(data.emails)
        ? data.emails.flatMap((item) => {
            const emailRecord = asRecord(item);
            const address = clean(emailRecord?.address, 320);
            return address ? [address] : [];
          }).slice(0, 5)
        : [];
      emails.forEach((email, index) => addObservation(
        observations,
        relationships,
        personObservationId,
        `${prefix}-email-${index + 1}`,
        'email',
        'email',
        email,
        confidence,
        'uses-email',
      ));

      stringArray(data.phone_numbers, 5).forEach((phone, index) => addObservation(
        observations,
        relationships,
        personObservationId,
        `${prefix}-phone-${index + 1}`,
        'phone',
        'phone',
        phone,
        confidence,
        'uses-phone',
      ));

      const locations = stringArray(data.location_names, 5);
      const primaryLocation = clean(data.location_name, 300);
      const locationValues = [...new Set(primaryLocation ? [primaryLocation, ...locations] : locations)];
      locationValues.slice(0, 5).forEach((location, index) => addObservation(
        observations,
        relationships,
        personObservationId,
        `${prefix}-location-${index + 1}`,
        'address',
        'general_location',
        location,
        confidence * 0.9,
        'associated-location',
      ));

      const profileValues: string[] = [];
      if (Array.isArray(data.profiles)) {
        for (const item of data.profiles.slice(0, 8)) {
          const profile = asRecord(item);
          const profileUrl = clean(profile?.url, 500);
          if (profileUrl) profileValues.push(profileUrl);
        }
      }
      for (const field of ['linkedin_url', 'facebook_url', 'twitter_url', 'github_url'] as const) {
        const profileUrl = clean(data[field], 500);
        if (profileUrl) profileValues.push(profileUrl);
      }
      [...new Set(profileValues)].slice(0, 8).forEach((profile, index) => addObservation(
        observations,
        relationships,
        personObservationId,
        `${prefix}-profile-${index + 1}`,
        'profile',
        'profile',
        profile,
        confidence,
        'has-profile',
      ));

      const companyName = clean(data.job_company_name, 250);
      if (companyName) {
        addObservation(
          observations,
          relationships,
          personObservationId,
          `${prefix}-company`,
          'organization',
          'current_company',
          companyName,
          confidence * 0.9,
          'works-at',
        );
      }

      const jobTitle = clean(data.job_title, 250);
      if (jobTitle) {
        addObservation(
          observations,
          relationships,
          personObservationId,
          `${prefix}-job-title`,
          'other',
          'job_title',
          jobTitle,
          confidence * 0.85,
          'has-job-title',
        );
      }
    }

    return {
      configured: true,
      name: SOURCE.name,
      ok: true,
      observations,
      relationships,
    };
  } catch {
    return {
      configured: true,
      name: SOURCE.name,
      ok: false,
      observations: [],
      relationships: [],
      error: 'Request failed or timed out.',
    };
  }
}
