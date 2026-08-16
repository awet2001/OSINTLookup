import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchLinks, inspectPhone, LookupInputError } from '../src/phone';
import type { ResolvedEntity } from '../src/model';

test('normalizes a valid international phone number', () => {
  const result = inspectPhone('+1 213 373 4253');
  assert.equal(result.e164, '+12133734253');
  assert.equal(result.countryCode, 'US');
  assert.equal(result.valid, true);
});

test('uses the default country for a national-format number', () => {
  const result = inspectPhone('020 7946 0018', 'GB');
  assert.equal(result.countryCode, 'GB');
  assert.equal(result.e164, '+442079460018');
});

test('rejects an invalid default country code', () => {
  assert.throws(() => inspectPhone('020 7946 0018', 'UNITED KINGDOM'), LookupInputError);
});

test('research plan generates multiple opt-in exact-match strategies without making requests', () => {
  const phone = inspectPhone('+1 213 373 4253');
  const links = buildResearchLinks(phone);
  assert.ok(links.length >= 12);
  assert.ok(links.some((link) => link.category === 'documents'));
  assert.ok(links.some((link) => link.category === 'profiles'));
  assert.ok(links.some((link) => link.category === 'business'));

  const googleExact = links.find((link) => link.id === 'phone-exact-google');
  assert.ok(googleExact);
  assert.match(googleExact.url, /^https:\/\/www\.google\.com\/search\?q=/);
  assert.match(decodeURIComponent(googleExact.url), /"\+12133734253"/);
});

test('research plan creates high-confidence entity pivots', () => {
  const phone = inspectPhone('+1 213 373 4253');
  const person: ResolvedEntity = {
    id: 'entity-person',
    kind: 'person',
    displayValue: 'Example Person',
    confidence: 0.91,
    observationIds: ['person-observation'],
    sources: [{ name: 'Test provider', kind: 'licensed-provider' }],
  };

  const links = buildResearchLinks(phone, [person]);
  const pivot = links.find((link) => link.category === 'pivot' && link.engine === 'Google');
  assert.ok(pivot);
  assert.match(pivot.query ?? '', /"Example Person"/);
  assert.match(pivot.query ?? '', /"\+12133734253"/);
});
