# OSINTLookup

A privacy-conscious phone-number intelligence and public-source research MVP.

OSINTLookup normalizes a phone number, reports numbering-plan metadata, generates opt-in public-web research links, and can merge results from one explicitly configured **licensed** enrichment provider. It does not access private accounts, messages, device contents, or live location.

## What works now

- E.164, international, and national phone formatting
- country / calling-code detection
- possible / valid numbering-pattern checks
- line-type detection when metadata supports it
- confidence-scored, source-attributed findings
- optional licensed-provider enrichment adapter
- Google/Bing exact-match research links that are only opened by the user
- in-memory request processing with `Cache-Control: no-store`
- API rate limiting and security headers
- browser UI
- unit tests and GitHub Actions CI

## Important limitation

A valid phone-number pattern does **not** prove that the number is active, assigned, or owned by a particular person. Identity information must come from a lawful public source or a provider you are contractually allowed to use. Treat enrichment data as potentially incomplete or stale and verify important claims against the source.

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

The server automatically loads `.env` when that file exists. Copy `.env.example` to `.env` if you want local configuration. Never commit real API tokens.

## Optional licensed provider

Set these values in `.env`:

```env
LICENSED_PROVIDER_NAME=Example Licensed Provider
LICENSED_PROVIDER_URL=https://provider.example/v1/lookup?phone={phone}
LICENSED_PROVIDER_TOKEN=replace-with-secret
```

`LICENSED_PROVIDER_URL` must include the literal `{phone}` placeholder. OSINTLookup replaces it with the URL-encoded E.164 number and sends an optional Bearer token.

The provider endpoint must return JSON shaped like this:

```json
{
  "findings": [
    {
      "category": "identity",
      "label": "Name",
      "value": "Example Person",
      "confidence": 0.88,
      "sourceUrl": "https://provider.example/source/123",
      "note": "Optional provider note"
    }
  ]
}
```

Rules enforced by the adapter:

- at most 25 findings per lookup
- confidence is clamped to `0..1`
- text fields are length-limited
- provider requests time out after 6 seconds
- redirects are rejected
- provider failures are returned as provider status, not as fabricated findings

## API

### `GET /api/status`

Reports service state and whether a licensed provider is configured.

### `POST /api/lookup`

Example request:

```json
{
  "phone": "+1 213 373 4253",
  "defaultCountry": "US",
  "purposeAccepted": true
}
```

The response contains normalized phone metadata, findings, optional provider status, and public-web research links.

## Privacy / deployment notes

- Lookup bodies are not persisted by this application.
- There is intentionally no request logger in the MVP.
- Reverse proxies, hosting platforms, CDNs, or a configured provider may have their own logs; review those separately before deployment.
- If deploying behind a trusted reverse proxy, configure `TRUST_PROXY` correctly before relying on IP-based rate limiting.
- Keep provider credentials in environment variables or a secret manager, never in the repository.
- Add authentication, an abuse policy, audit controls, retention rules, and jurisdiction-specific privacy review before exposing enrichment features publicly.

## Project structure

```text
src/phone.ts       phone parsing + research-link generation
src/provider.ts    licensed enrichment boundary
src/server.ts      Express API + static server
public/            browser UI
test/              unit tests
```

## Development checks

```bash
npm run check
```

This runs TypeScript type checking and the Node test suite.
