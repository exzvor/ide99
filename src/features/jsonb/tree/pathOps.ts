/** Pure path-based mutation helpers. Always return a new value
 * (no in-place mutation). Used by TreeView/TableView. */

export function getAtPath(value: unknown, path: ReadonlyArray<string>): unknown {
  let cur: unknown = value;
  for (const seg of path) {
    if (Array.isArray(cur)) {
      cur = cur[Number(seg)];
    } else if (cur !== null && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function setAtPath(value: unknown, path: ReadonlyArray<string>, next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...tail] = path;
  if (head === undefined) return next;
  if (Array.isArray(value)) {
    const idx = Number(head);
    const cloned = value.slice();
    cloned[idx] = setAtPath(value[idx], tail, next);
    return cloned;
  }
  if (value !== null && typeof value === "object") {
    const cloned = { ...(value as Record<string, unknown>) };
    cloned[head] = setAtPath((value as Record<string, unknown>)[head], tail, next);
    return cloned;
  }
  return next;
}

export function deleteAtPath(value: unknown, path: ReadonlyArray<string>): unknown {
  if (path.length === 0) return value;
  if (path.length === 1) {
    const [seg] = path;
    if (seg === undefined) return value;
    if (Array.isArray(value)) {
      const idx = Number(seg);
      return value.filter((_, i) => i !== idx);
    }
    if (value !== null && typeof value === "object") {
      const next = { ...(value as Record<string, unknown>) };
      delete next[seg];
      return next;
    }
    return value;
  }
  const [head, ...tail] = path;
  if (head === undefined) return value;
  if (Array.isArray(value)) {
    const idx = Number(head);
    const next = value.slice();
    next[idx] = deleteAtPath(value[idx], tail);
    return next;
  }
  if (value !== null && typeof value === "object") {
    const next = { ...(value as Record<string, unknown>) };
    next[head] = deleteAtPath((value as Record<string, unknown>)[head], tail);
    return next;
  }
  return value;
}

/** Move an array element from one index to another at the parent path. */
export function moveArrayItem(  value: unknown,
  parentPath: ReadonlyArray<string>,
  fromIdx: number,
  toIdx: number,
): unknown {
  const parent = getAtPath(value, parentPath);
  if (!Array.isArray(parent)) return value;
  if (fromIdx === toIdx) return value;
  const next = parent.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return setAtPath(value, parentPath, next);
}
