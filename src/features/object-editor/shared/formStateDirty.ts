// — dirty-flag helper for object-editor forms.
//
// The form-state shapes are pure JSON (primitives, plain arrays, plain
// objects — no Date/Map/Set), so JSON.stringify is a fast and correct
// equality check. Reordering of fields within objects is irrelevant because
// the shapes always come from the same constructors / spread patterns
// (TypeScript guarantees a stable property order in practice).
//
// Trade-off: cosmetic reorder of an array (e.g. drag-reorder columns
// without changing names/types) is reported as "dirty". This is acceptable
// for v1 — a column reorder *should* round-trip through a re-create today,
// so flagging it as dirty is correct.

export function formStateDirty<T>(initial: T | null, current: T): boolean {
  if (initial === null) {
    // Create-mode: any current state is, by definition, "dirty" (the user
    // has typed at least the name/schema). We don't compare against a blank
    // template here — the editor owns that signal via field-level checks.
    return true;
  }
  return JSON.stringify(initial) !== JSON.stringify(current);
}
