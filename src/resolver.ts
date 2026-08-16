import {
  clampConfidence,
  type Observation,
  type ProvenanceReport,
  type RelationshipHint,
  type ResolvedEntity,
  type ResolvedRelationship,
} from './model';

const sourceKey = (source: Observation['source']): string =>
  `${source.kind}|${source.name}|${source.url ?? ''}`;

const combineConfidence = (values: number[]): number => {
  const missProbability = values.reduce((acc, value) => acc * (1 - clampConfidence(value)), 1);
  return clampConfidence(1 - missProbability);
};

export function resolveObservations(
  observations: Observation[],
  relationshipHints: RelationshipHint[] = [],
): ProvenanceReport {
  const warnings: string[] = [];
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  const groups = new Map<string, Observation[]>();

  for (const observation of observations) {
    const key = `${observation.entityKind}|${observation.normalizedValue}`;
    const group = groups.get(key);
    if (group) group.push(observation);
    else groups.set(key, [observation]);
  }

  const entities: ResolvedEntity[] = [];
  const entityIdByObservationId = new Map<string, string>();
  let entityCounter = 0;

  for (const group of groups.values()) {
    entityCounter += 1;
    const entityId = `entity-${entityCounter}`;
    const strongest = [...group].sort((a, b) => b.confidence - a.confidence)[0];
    if (!strongest) continue;

    const uniqueSources = new Map<string, Observation['source']>();
    for (const observation of group) {
      uniqueSources.set(sourceKey(observation.source), observation.source);
      entityIdByObservationId.set(observation.id, entityId);
    }

    entities.push({
      id: entityId,
      kind: strongest.entityKind,
      displayValue: strongest.value,
      confidence: combineConfidence(group.map((observation) => observation.confidence)),
      observationIds: group.map((observation) => observation.id),
      sources: [...uniqueSources.values()],
    });
  }

  const relationshipGroups = new Map<string, RelationshipHint[]>();
  for (const hint of relationshipHints) {
    if (!observationById.has(hint.fromObservationId) || !observationById.has(hint.toObservationId)) {
      warnings.push(`Ignored relationship ${hint.type}: referenced observation was not present.`);
      continue;
    }

    const fromEntityId = entityIdByObservationId.get(hint.fromObservationId);
    const toEntityId = entityIdByObservationId.get(hint.toObservationId);
    if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) continue;

    const ordered = [fromEntityId, toEntityId].sort();
    const key = `${ordered[0]}|${ordered[1]}|${hint.type.trim().toLowerCase()}`;
    const group = relationshipGroups.get(key);
    if (group) group.push(hint);
    else relationshipGroups.set(key, [hint]);
  }

  const relationships: ResolvedRelationship[] = [];
  let relationshipCounter = 0;
  for (const hints of relationshipGroups.values()) {
    const first = hints[0];
    if (!first) continue;
    const fromEntityId = entityIdByObservationId.get(first.fromObservationId);
    const toEntityId = entityIdByObservationId.get(first.toObservationId);
    if (!fromEntityId || !toEntityId) continue;

    relationshipCounter += 1;
    relationships.push({
      id: `relationship-${relationshipCounter}`,
      fromEntityId,
      toEntityId,
      type: first.type,
      confidence: combineConfidence(hints.map((hint) => hint.confidence)),
      evidenceObservationIds: [...new Set(hints.flatMap((hint) => [hint.fromObservationId, hint.toObservationId]))],
    });
  }

  return { observations, entities, relationships, warnings };
}
