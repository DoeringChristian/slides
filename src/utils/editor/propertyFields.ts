export function getNested(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Returns a `Partial<T>` that, when shallow-merged onto `el`, sets the
 *  value at `path`. For nested paths the intermediate objects are spread
 *  from the live element so sibling fields aren't lost. */
export function setNestedPartial<T>(el: T, path: string, value: unknown): Partial<T> {
  const parts = path.split('.');
  if (parts.length === 1) {
    return { [parts[0]]: value } as Partial<T>;
  }
  const root: Record<string, unknown> = {};
  let target = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const existing = (parts.slice(0, i + 1).reduce<unknown>(
      (acc, p) => (acc == null ? undefined : (acc as Record<string, unknown>)[p]),
      el,
    ) as Record<string, unknown> | undefined) ?? {};
    target[parts[i]] = { ...existing };
    target = target[parts[i]] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
  return root as Partial<T>;
}

/** Copy only the named leaves, retaining CURRENT siblings. Accumulate each
 * nested partial so multiple fields sharing a root do not undo one another. */
export function copyNestedFields<T>(source: T, current: T, fields: string[]): Partial<T> {
  let changes: Partial<T> = {};
  for (const field of fields) {
    changes = { ...changes, ...setNestedPartial({ ...current, ...changes }, field, getNested(source, field)) };
  }
  return changes;
}

