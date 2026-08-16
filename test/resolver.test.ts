import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeObservedValue, type Observation, type RelationshipHint } from '../src/model';
import { resolveObservations } from '../src/resolver';

const source = { name: 'Test provider', kind: 'licensed-provider' as const };

const observation = (
  id: string,
  entityKind: Observation['entityKind'],
  value: string,
  confidence: number,
): Observation => ({
  id,
  entityKind,
  field: entityKind,
  value,
  normalizedValue: normalizeObservedValue(entityKind, value),
  confidence,
  source,
});

test('merges exact normalized identifiers and combines confidence', () => {
  const report = resolveObservations([
    observation('email-a', 'email', 'Example@Email.com', 0.7),
    observation('email-b', 'email', ' example@email.com ', 0.8),
  ]);

  assert.equal(report.entities.length, 1);
  const entity = report.entities[0];
  assert.ok(entity);
  assert.equal(entity.kind, 'email');
  assert.equal(entity.observationIds.length, 2);
  assert.ok(entity.confidence > 0.9);
});

test('does not merge different people merely because they are both person entities', () => {
  const report = resolveObservations([
    observation('person-a', 'person', 'Alex Example', 0.9),
    observation('person-b', 'person', 'Alexa Example', 0.9),
  ]);

  assert.equal(report.entities.length, 2);
});

test('resolves explicit relationships through observation evidence', () => {
  const observations = [
    observation('phone', 'phone', '+31612345678', 1),
    observation('email', 'email', 'person@example.com', 0.85),
  ];
  const relationships: RelationshipHint[] = [{
    fromObservationId: 'phone',
    toObservationId: 'email',
    type: 'associated-with',
    confidence: 0.8,
    source,
  }];

  const report = resolveObservations(observations, relationships);
  assert.equal(report.relationships.length, 1);
  assert.equal(report.relationships[0]?.type, 'associated-with');
  assert.equal(report.relationships[0]?.confidence, 0.8);
});

test('ignores relationship hints that reference missing observations', () => {
  const report = resolveObservations(
    [observation('phone', 'phone', '+31612345678', 1)],
    [{
      fromObservationId: 'phone',
      toObservationId: 'missing',
      type: 'associated-with',
      confidence: 0.8,
      source,
    }],
  );

  assert.equal(report.relationships.length, 0);
  assert.equal(report.warnings.length, 1);
});
