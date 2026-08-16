import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildResearchLinks, inspectPhone, LookupInputError } from './phone';
import { normalizeObservedValue, type Observation } from './model';
import { queryLicensedProviders, type Finding } from './provider';
import { resolveObservations } from './resolver';
import { queryPeopleDataLabs } from './integrations/pdl';
import { queryTwilioLookup } from './integrations/twilio';

try { loadEnvFile(); } catch { /* .env is optional */ }

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy) app.set('trust proxy', Number(trustProxy));

app.disable('x-powered-by');
app.use(helmet({
  referrerPolicy: { policy: 'no-referrer' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: '16kb' }));
app.use(express.static(publicDir, { extensions: ['html'] }));

const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOOKUP_RATE_LIMIT || 30),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many lookup requests. Try again later.' },
});

app.get('/api/status', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    providerConfigured: Boolean(
      process.env.LICENSED_PROVIDERS_JSON?.trim()
      || process.env.LICENSED_PROVIDER_URL?.trim()
      || (process.env.TWILIO_LOOKUP_ENABLED?.trim().toLowerCase() === 'true'
        && process.env.TWILIO_ACCOUNT_SID?.trim()
        && process.env.TWILIO_AUTH_TOKEN?.trim())
      || (process.env.PDL_IDENTIFY_ENABLED?.trim().toLowerCase() === 'true'
        && process.env.PDL_API_KEY?.trim()),
    ),
    retention: 'Lookup requests are processed in memory and are not stored by this application.',
    allowedScopes: ['self', 'consented', 'business'],
  });
});

app.post('/api/lookup', lookupLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = req.body as {
    phone?: unknown;
    defaultCountry?: unknown;
    purposeAccepted?: unknown;
    lookupScope?: unknown;
  };

  if (body.purposeAccepted !== true) {
    res.status(400).json({ error: 'Confirm lawful-use and public/licensed-source use before searching.' });
    return;
  }
  if (!['self', 'consented', 'business'].includes(String(body.lookupScope))) {
    res.status(400).json({ error: 'lookupScope must be self, consented, or business.' });
    return;
  }
  if (typeof body.phone !== 'string') {
    res.status(400).json({ error: 'phone must be a string.' });
    return;
  }
  if (body.defaultCountry !== undefined && typeof body.defaultCountry !== 'string') {
    res.status(400).json({ error: 'defaultCountry must be a string.' });
    return;
  }

  try {
    const phone = inspectPhone(body.phone, body.defaultCountry);
    const lookupScope = String(body.lookupScope) as 'self' | 'consented' | 'business';
    const localFindings: Finding[] = [
      {
        id: 'phone-country',
        category: 'phone-metadata',
        label: 'Country / region',
        value: phone.countryName || phone.countryCode || 'Unknown',
        confidence: phone.countryCode ? 0.99 : 0.4,
        source: { name: 'libphonenumber metadata', kind: 'local-metadata' },
      },
      {
        id: 'phone-validity',
        category: 'phone-metadata',
        label: 'Number validity',
        value: phone.valid ? 'Valid numbering pattern' : phone.possible ? 'Possible, but not valid' : 'Not a possible numbering pattern',
        confidence: 1,
        source: { name: 'libphonenumber metadata', kind: 'local-metadata' },
        note: 'Pattern validity does not prove that a number is assigned, active, or owned by a specific person.',
      },
      ...(phone.type ? [{
        id: 'phone-type',
        category: 'phone-metadata',
        label: 'Line type',
        value: phone.type,
        confidence: 0.9,
        source: { name: 'libphonenumber metadata', kind: 'local-metadata' as const },
      }] : []),
    ];

    const queryPhoneObservation: Observation = {
      id: 'query-phone',
      entityKind: 'phone',
      field: 'phone',
      value: phone.e164,
      normalizedValue: normalizeObservedValue('phone', phone.e164),
      confidence: 1,
      source: { name: 'User query', kind: 'local-metadata' },
      note: 'Lookup anchor only; this does not establish ownership.',
    };

    const pdlPromise = lookupScope === 'business'
      ? Promise.resolve(null)
      : queryPeopleDataLabs(phone.e164);

    const [genericProviders, twilio, pdl] = await Promise.all([
      queryLicensedProviders(phone.e164),
      queryTwilioLookup(phone.e164),
      pdlPromise,
    ]);

    const nativeResults = [twilio, pdl].filter((result) => result !== null);
    const graph = resolveObservations(
      [
        queryPhoneObservation,
        ...genericProviders.observations,
        ...nativeResults.flatMap((result) => result.observations),
      ],
      [
        ...genericProviders.relationships,
        ...nativeResults.flatMap((result) => result.relationships),
      ],
    );

    const nativeStatuses = nativeResults
      .filter((result) => result.configured)
      .map((result) => ({
        name: result.name,
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      }));

    res.json({
      generatedAt: new Date().toISOString(),
      retention: 'not-stored',
      lookupScope,
      phone,
      findings: [...localFindings, ...genericProviders.findings],
      graph,
      researchLinks: buildResearchLinks(phone, graph.entities),
      providers: {
        configured: genericProviders.configured || nativeStatuses.length > 0,
        statuses: [...genericProviders.providerStatuses, ...nativeStatuses],
      },
    });
  } catch (error) {
    if (error instanceof LookupInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Lookup failed.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(port, () => {
  console.log(`OSINTLookup listening on http://localhost:${port}`);
});
