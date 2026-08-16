import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchLinks, inspectPhone, LookupInputError } from '../src/phone';

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

test('research links do not make network requests and contain encoded exact-match queries', () => {
  const phone = inspectPhone('+1 213 373 4253');
  const links = buildResearchLinks(phone);
  assert.equal(links.length, 2);
  const firstLink = links[0];
  assert.ok(firstLink);
  assert.match(firstLink.url, /^https:\/\/www\.google\.com\/search\?q=/);
  assert.match(decodeURIComponent(firstLink.url), /"\+12133734253"/);
});
