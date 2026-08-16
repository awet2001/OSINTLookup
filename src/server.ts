import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildResearchLinks, inspectPhone, LookupInputError } from './phone';
import { queryLicensedProvider, type Finding } from './provider';

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
app.use(express.json({ limit: '8kb' }));
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
    providerConfigured: Boolean(process.env.LICENSED_PROVIDER_URL?.trim()),
    retention: 'Lookup requests are processed in memory and are not stored by this application.',
  });
});

app.post('/api/lookup', lookupLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = req.body as { phone?: unknown; defaultCountry?: unknown; purposeAccepted?: unknown };

  if (body.purposeAccepted !== true) {
    res.status(400).json({ error: 'Confirm lawful-use and public/licensed-source use before searching.' });
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

    const provider = await queryLicensedProvider(phone.e164);

    res.json({
      generatedAt: new Date().toISOString(),
      retention: 'not-stored',
      phone,
      findings: [...localFindings, ...provider.findings],
      researchLinks: buildResearchLinks(phone),
      provider: {
        configured: provider.configured,
        ...(provider.providerName ? { name: provider.providerName } : {}),
        ...(provider.error ? { error: provider.error } : {}),
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
