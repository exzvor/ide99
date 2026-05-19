// — minimal deep-equality for form-state dirty checks.
// TODO(B3->B4 integrate): swap to `shared/formStateDirty` once B4 lands.

export function formStateDirty<T>(initial: T | null, current: T): boolean {
  if (initial === null) return true;
  return JSON.stringify(initial) !== JSON.stringify(current);
}
