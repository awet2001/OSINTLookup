import {
  normalizeObservedValue,
  type Observation,
  type RelationshipHint,
} from '../model';

type TwilioResponse = {
  phone_number?: unknown;
  country_code?: unknown;
  national_format?: unknown;
  valid?: unknown;
  line_type_intelligence?: unknown;
  caller_name?: unknown;
  url?: unknown;
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
  name: 'Twilio Lookup v2',
  kind: 'licensed-provider' as const,
  url: 'https://www.twilio.com/docs/lookup/v2-api',
};

const clean = (value: unknown, max = 500): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

function addLinkedObservation(
  observations: Observation[],
  relationships: RelationshipHint[],
  id: string,
  entityKind: Observation['entityKind'],
  field: string,
  value: string,
  confidence: number,
  relationshipType: string,
  note?: string,
): void {
  observations.push({
    id,
    entityKind,
    field,
    value,
    normalizedValue: normalizeObservedValue(entityKind, value),
    confidence,
    source: SOURCE,
    ...(note ? { note } : {}),
  });
  relationships.push({
    fromObservationId: 'query-phone',
    toObservationId: id,
    type: relationshipType,
    confidence,
    source: SOURCE,
    ...(note ? { note } : {}),
  });
}

export async function queryTwilioLookup(e164: string): Promise<Result> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const enabled = process.env.TWILIO_LOOKUP_ENABLED?.trim().toLowerCase() === 'true';
  if (!enabled || !accountSid || !authToken) {
    return {
      configured: false,
      name: SOURCE.name,
      ok: true,
      observations: [],
      relationships: [],
    };
  }

  const allowedFields = new Set([
    'line_type_intelligence',
    'caller_name',
    'line_status',
  ]);
  const requestedFields = (process.env.TWILIO_LOOKUP_FIELDS || 'line_type_intelligence')
    .split(',')
    .map((field) => field.trim())
    .filter((field) => allowedFields.has(field));

  const url = new URL(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}`);
  if (requestedFields.length) url.searchParams.set('Fields', requestedFields.join(','));

  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Basic ${authorization}`,
      },
      signal: AbortSignal.timeout(7000),
      redirect: 'error',
    });

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

    const body = await response.json() as TwilioResponse;
    const observations: Observation[] = [];
    const relationships: RelationshipHint[] = [];

    const lineType = asRecord(body.line_type_intelligence);
    const carrierName = clean(lineType?.carrier_name, 200);
    if (carrierName) {
      addLinkedObservation(
        observations,
        relationships,
        'twilio-carrier',
        'organization',
        'carrier',
        carrierName,
        0.95,
        'served-by-carrier',
      );
    }

    const lineTypeName = clean(lineType?.type, 80);
    if (lineTypeName) {
      addLinkedObservation(
        observations,
        relationships,
        'twilio-line-type',
        'other',
        'line_type',
        lineTypeName,
        0.95,
        'has-line-type',
      );
    }

    const caller = asRecord(body.caller_name);
    const callerName = clean(caller?.caller_name, 200);
    if (callerName) {
      addLinkedObservation(
        observations,
        relationships,
        'twilio-caller-name',
        'person',
        'caller_name',
        callerName,
        0.85,
        'caller-name-associated-with',
        'Twilio Caller Name uses US CNAM data and should be treated as an association, not proof of current ownership.',
      );
    }

    const callerType = clean(caller?.caller_type, 80);
    if (callerType) {
      addLinkedObservation(
        observations,
        relationships,
        'twilio-caller-type',
        'other',
        'caller_type',
        callerType,
        0.9,
        'has-caller-type',
      );
    }

    const lineStatus = asRecord((body as Record<string, unknown>).line_status);
    const status = clean(lineStatus?.status, 80);
    if (status) {
      addLinkedObservation(
        observations,
        relationships,
        'twilio-line-status',
        'other',
        'line_status',
        status,
        0.9,
        'has-line-status',
      );
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
