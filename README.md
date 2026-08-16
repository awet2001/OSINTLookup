# OSINTLookup

A privacy-conscious phone intelligence and public/licensed-source aggregation project.

OSINTLookup is being built toward a ClarityCheck-style architecture: start from a phone number, query configured lawful data suppliers, preserve provenance, normalize returned records, merge duplicate identifiers conservatively, and render an evidence-backed entity graph.

It does **not** access private accounts, messages, device contents, passwords, or live location. The current application only enables lookups for the user's own number, a consenting subject, or a business/public contact number.

## What works now

- E.164, international, and national phone formatting
- country / calling-code detection
- possible / valid numbering-pattern checks
- line-type detection when metadata supports it
- parallel querying of multiple configured licensed providers
- structured observations for person, organization, email, address, profile, domain, phone, and other records
- provenance retained per observation
- conservative entity deduplication by normalized identifiers
- evidence-backed relationships between resolved entities
- confidence combination when independent observations resolve to the same identifier
- provider health/status reporting
- backward compatibility with the original flat `findings` provider format
- Google/Bing exact-match research links that are only opened by the user
- in-memory request processing with `Cache-Control: no-store`
- API rate limiting and security headers
- browser UI
- unit tests and GitHub Actions CI

## Architecture

```text
phone number
    |
    +--> local phone metadata
    |
    +--> licensed provider A ----+
    +--> licensed provider B ----+--> observations + relationship evidence
    +--> licensed provider N ----+                 |
                                                   v
                                             normalization
                                                   |
                                                   v
                                            entity resolver
                                                   |
                       +---------------------------+--------------------------+
                       |                           |                          |
                    entities                  relationships               provenance
                 name / email /              associated-with /           source URLs /
                 address / profile           belongs-to / etc.           confidence
```

The resolver deliberately does not fuzzy-merge two people merely because their names are similar. A false merge can create a convincing but incorrect profile, so ambiguous records remain separate unless the evidence supplies a stronger shared identifier or relationship.

## Important limitation

The application code is only one half of a ClarityCheck-like product. The other half is **data access**. Real name/email/address/profile enrichment requires public datasets you may lawfully process or commercial providers whose contracts permit the use case. OSINTLookup does not ship with a hidden people database.

A valid phone-number pattern does **not** prove that the number is active, assigned, or owned by a particular person. Provider data may be incomplete or stale. Treat confidence as evidence strength, not proof, and verify important claims against cited sources.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

For production-like mode:

```bash
npm start
```

The server automatically loads `.env` when that file exists. Copy `.env.example` to `.env` for local configuration. Never commit real API tokens.

## Multiple licensed providers

Preferred configuration uses `LICENSED_PROVIDERS_JSON`:

```env
LICENSED_PROVIDERS_JSON=[{"name":"Provider A","url":"https://provider-a.example/v1/lookup?phone={phone}","token":"secret-a"},{"name":"Provider B","url":"https://provider-b.example/lookup/{phone}","token":"secret-b"}]
```

At most eight provider definitions are loaded. Every URL must contain the literal `{phone}` placeholder. OSINTLookup replaces it with the URL-encoded E.164 number. Providers are queried in parallel with a seven-second timeout and redirects disabled.

The original single-provider variables remain supported:

```env
LICENSED_PROVIDER_NAME=Example Licensed Provider
LICENSED_PROVIDER_URL=https://provider.example/v1/lookup?phone={phone}
LICENSED_PROVIDER_TOKEN=replace-with-secret
```

## Structured provider contract

A provider can return observations and explicit relationship evidence:

```json
{
  "observations": [
    {
      "id": "name-1",
      "entityKind": "person",
      "field": "name",
      "value": "Example Person",
      "confidence": 0.88,
      "sourceUrl": "https://provider.example/source/123"
    },
    {
      "id": "email-1",
      "entityKind": "email",
      "field": "email",
      "value": "person@example.com",
      "confidence": 0.82,
      "sourceUrl": "https://provider.example/source/456"
    }
  ],
  "relationships": [
    {
      "from": "$query",
      "to": "name-1",
      "type": "associated-with",
      "confidence": 0.81
    },
    {
      "from": "name-1",
      "to": "email-1",
      "type": "uses-email",
      "confidence": 0.76
    }
  ]
}
```

`$query` is a reserved relationship endpoint referring to the searched phone number. Provider-local observation IDs are translated into internal IDs before resolution.

Supported `entityKind` values:

```text
phone
person
organization
email
address
profile
domain
other
```

Adapter limits:

- up to 50 structured observations per provider
- up to 100 relationships per provider
- confidence values clamped to `0..1`
- text fields length-limited
- seven-second provider timeout
- redirects rejected
- failed providers reported separately rather than fabricating results

### Legacy provider contract

The original flat response still works:

```json
{
  "findings": [
    {
      "category": "identity",
      "label": "Name",
      "value": "Example Person",
      "confidence": 0.88,
      "sourceUrl": "https://provider.example/source/123"
    }
  ]
}
```

Use the structured contract for new providers because it supports entity resolution and relationships.

## API

### `GET /api/status`

Reports service state, provider configuration, retention behavior, and allowed lookup scopes.

### `POST /api/lookup`

Example request:

```json
{
  "phone": "+31 6 12345678",
  "defaultCountry": "NL",
  "lookupScope": "self",
  "purposeAccepted": true
}
```

Allowed scopes are `self`, `consented`, and `business`.

The response includes:

- normalized phone metadata
- metadata/legacy findings
- `graph.observations`
- `graph.entities`
- `graph.relationships`
- provider status
- opt-in public-web research links

## Privacy / deployment notes

- Lookup bodies are not persisted by this application.
- There is intentionally no request logger.
- Reverse proxies, hosting platforms, CDNs, and configured providers may maintain their own logs; review those separately.
- Configure `TRUST_PROXY` correctly before relying on IP-based rate limiting behind a reverse proxy.
- Keep provider credentials in environment variables or a secret manager.
- Before exposing enrichment publicly, add authentication, abuse controls, audit rules, deletion/objection workflows, retention policy, and jurisdiction-specific privacy review.
- Do not configure providers whose terms prohibit reverse lookup, aggregation, or the intended subject scope.

## Project structure

```text
src/phone.ts       phone parsing + research-link generation
src/model.ts       provenance graph data model
src/provider.ts    multi-provider enrichment boundary
src/resolver.ts    conservative entity resolution
src/server.ts      Express API + static server
public/            browser UI
test/              unit tests
```

## Development checks

```bash
npm run check
```

This runs TypeScript type checking and the Node test suite.
