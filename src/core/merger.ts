export type DocumentFields = Record<string, unknown>;

export interface FieldDiff {
  field: string;
  ancestor: unknown;
  current: unknown;
  incoming: unknown;
}

export interface MergeResult {
  merged: DocumentFields;
  autoMergedFields: string[];
  conflicts: FieldDiff[];
  strategy: 'auto_merged' | 'has_conflicts' | 'no_changes';
}

export function threeWayMerge(
  ancestor: DocumentFields,
  current: DocumentFields,
  incoming: DocumentFields
): MergeResult {
  const allFields = new Set([
    ...Object.keys(ancestor),
    ...Object.keys(current),
    ...Object.keys(incoming),
  ]);

  const merged: DocumentFields = { ...current };
  const autoMergedFields: string[] = [];
  const conflicts: FieldDiff[] = [];

  for (const field of allFields) {
    const a = ancestor[field];
    const c = current[field];
    const i = incoming[field];

    const aJson = JSON.stringify(a);
    const cJson = JSON.stringify(c);
    const iJson = JSON.stringify(i);

    const currentChanged = aJson !== cJson;
    const incomingChanged = aJson !== iJson;

    if (!currentChanged && !incomingChanged) {
      continue;
    }

    if (!currentChanged && incomingChanged) {
      merged[field] = i;
      autoMergedFields.push(field);
      continue;
    }

    if (currentChanged && !incomingChanged) {
      continue;
    }

    if (cJson === iJson) {
      continue;
    }

    conflicts.push({ field, ancestor: a, current: c, incoming: i });
  }

  if (autoMergedFields.length === 0 && conflicts.length === 0) {
    return { merged, autoMergedFields, conflicts, strategy: 'no_changes' };
  }

  if (conflicts.length > 0) {
    return { merged, autoMergedFields, conflicts, strategy: 'has_conflicts' };
  }

  return { merged, autoMergedFields, conflicts, strategy: 'auto_merged' };
}

export function applyLWW(
  current: DocumentFields,
  incoming: DocumentFields,
  conflictFields: string[]
): DocumentFields {
  const result = { ...current };
  for (const field of conflictFields) {
    result[field] = incoming[field];
  }
  return result;
}

export function computeFieldDiff(
  before: DocumentFields,
  after: DocumentFields
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const allFields = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const field of allFields) {
    const bJson = JSON.stringify(before[field]);
    const aJson = JSON.stringify(after[field]);
    if (bJson !== aJson) {
      diff[field] = { from: before[field], to: after[field] };
    }
  }

  return diff;
}
