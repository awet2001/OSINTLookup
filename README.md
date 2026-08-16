# OSINTLookup

A privacy-conscious phone intelligence and public/licensed-source aggregation project.

OSINTLookup is being built toward a ClarityCheck-style architecture: start from a phone number, query configured lawful data suppliers, preserve provenance, normalize returned records, merge duplicate identifiers conservatively, and render an evidence-backed entity graph.

It does **not** access private accounts, messages, device contents, passwords, or live location. The current application only enables lookups for the user's own number, a consenting subject, or a business/public contact number.

## What works now

- E.164, international, and national phone formatting
- country / calling-code detection
- possible / valid numbering-pattern checks
- line-type detection when metadata supports it
- expanded no-API public-web research plan using multiple exact phone formats
- targeted searches for indexed PDFs, office/data files, public profiles, business/contact pages, and public messaging/contact mentions
- automatic follow-up search pivots from high-confidence resolved names, emails, organizations, domains, and public profile URLs
- native Twilio Lookup v2 integration for phone intelligence
- native People Data Labs Person Identify integration for self/consented identity enrichment
- parallel querying of multiple configured custom licensed providers
- structured observations for person, organization, email, address, profile, domain, phone, and other records
- provenance retained per observation
- conservative entity deduplication by normalized identifiers
- evidence-backed relationships between resolved entities
- confidence combination when independent observations resolve to the same identifier
- provider health/status reporting
- backward compatibility with the original flat `findings` provider format
- in-memory request processing with `Cache-Control: no-store`
- API rate limiting and security headers
- browser UI
- unit tests and GitHub Actions CI

## Architecture

```text
phone number
    |
    +--> local phone metadata
    +--> local research-plan generator ---> Google/Bing links (only on user click)
    +--> Twilio Lookup v2 --------+
    +--> People Data Labs --------+
    +--> licensed provider A -----+--> observations + relationship evidence
    +--> licensed provider B -----+                 |
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
                         |
                         +--> high-confidence public-web pivots
```

The resolver deliberately does not fuzzy-merge two people merely because their names are similar. A false merge can create a convincing but incorrect profile, so ambiguous records remain separate unless the evidence supplies a stronger shared identifier or relationship.

## Stronger public-web mode (no API required)

Even with no enrichment account configured, OSINTLookup now builds a local research plan from several exact formatting variants of the same phone number. It generates separate Google and Bing queries for:

- broad exact phone-number mentions
- indexed PDF documents
- indexed CSV/XLS/XLSX/DOC/DOCX files
- common public-profile platforms
- business and contact pages, with country context when available
- public pages mentioning the number alongside WhatsApp, Telegram, or Signal

The application itself does **not** send those searches automatically. A search engine receives the query only when the user opens one of the generated links.

If the entity resolver already has a high-confidence person, email, organization, domain, or public profile, the research plan also creates follow-up pivots. For example, a resolved person can be searched together with the exact phone number, and a resolved domain can be searched with a `site:` restriction. Low-confidence entities are not used for pivots.

## Important limitation

The application code is only one half of a ClarityCheck-like product. The other half is **data access**. Real name/email/location/profile enrichment depends on commercial data coverage and field access under your provider plan. OSINTLookup does not ship with a hidden people database.

A valid phone-number pattern does **not** prove that the number is active, assigned, or owned by a particular person. Public search results and provider data may be incomplete, stale, or refer to somebody else. Treat confidence as evidence strength, not proof, and verify important claims against cited/original sources.

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

## Native provider: Twilio Lookup v2

Twilio is disabled by default. Enabling it requires credentials **and** an explicit flag so credentials alone do not trigger billable requests.

```env
TWILIO_LOOKUP_ENABLED=true
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=replace-with-secret
TWILIO_LOOKUP_FIELDS=line_type_intelligence
```

Supported fields in this adapter:

```text
line_type_intelligence
caller_name
line_status
```

The default is `line_type_intelligence`. Caller Name is only useful for supported US numbers and may be billed per request, so enable it intentionally:

```env
TWILIO_LOOKUP_FIELDS=line_type_intelligence,caller_name
```

Returned carrier, line type, caller-name, caller-type, and line-status values are converted into normal graph observations and linked back to the queried phone number. Caller Name remains an association, not proof of current ownership.

## Native provider: People Data Labs Person Identify

PDL is also disabled by default:

```env
PDL_IDENTIFY_ENABLED=true
PDL_API_KEY=replace-with-secret
PDL_MIN_MATCH_SCORE=70
```

The adapter sends the E.164 phone number to Person Identify, keeps at most the top five returned matches, and discards profiles below `PDL_MIN_MATCH_SCORE`.

It requests a deliberately limited field set:

- full name
- email addresses
- associated phone numbers
- general location names
- social/profile URLs
- current company
- current job title

It intentionally does **not** request birth dates or street-address fields. PDL is skipped for `business` lookup scope and only runs for `self` or `consented` scope.

Each surviving profile becomes a person entity. Emails, phone numbers, locations, social profiles, company, and job title become related entities with the PDL match score carried into the evidence graph.

## Multiple custom licensed providers

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

- up to 50 structured observations per custom provider
- up to 100 relationships per custom provider
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
- an opt-in, categorized public-web research plan

## Privacy / deployment notes

- Lookup bodies are not persisted by this application.
- There is intentionally no request logger.
- Public-web queries are generated locally and are not sent until the user opens a search link.
- Reverse proxies, hosting platforms, CDNs, search engines, and configured providers may maintain their own logs; review those separately.
- Configure `TRUST_PROXY` correctly before relying on IP-based rate limiting behind a reverse proxy.
- Keep provider credentials in environment variables or a secret manager.
- Twilio and PDL integrations require explicit enable flags so credentials alone do not activate them.
- Before exposing enrichment publicly, add authentication, abuse controls, audit rules, deletion/objection workflows, retention policy, and jurisdiction-specific privacy review.
- Do not configure providers whose terms prohibit reverse lookup, aggregation, or the intended subject scope.

## Project structure

```text
src/phone.ts                 phone parsing + public research-plan generation
src/model.ts                 provenance graph data model
src/provider.ts              custom multi-provider enrichment boundary
src/resolver.ts              conservative entity resolution
src/integrations/twilio.ts   Twilio Lookup v2 adapter
src/integrations/pdl.ts      People Data Labs Person Identify adapter
src/server.ts                Express API + static server
public/                      browser UI
test/                        unit tests
```

## Development checks

```bash
npm run check
```

This runs TypeScript type checking and the Node test suite.
