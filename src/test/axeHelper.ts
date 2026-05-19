/**
 * — thin wrapper around `jest-axe` for ide99 test suite.
 *
 * Why a helper instead of importing `axe` directly per-test:
 * 1. `expect.extend(toHaveNoViolations)` happens once globally — tests just
 * call `await expectNoAxeViolations(container)` without per-file boilerplate.
 * 2. The default rule set is too strict for some controlled exemptions in
 * this codebase (e.g. `<g role="group" tabIndex={0}>` inside SVG ERD —
 * legitimate md` §4 alt list view note).
 * A single allow-list lives here so it can be audited centrally.
 * 3. Tests get a default `axe.run()` configuration that mirrors what CI
 * enforces, so authoring tests is consistent with the production gate.
 *
 * Exemptions are *narrow* — opt out of a single rule per call when the
 * underlying widget cannot be expressed in pure ARIA without breaking the
 * design intent. Document each exemption inline at the call site.
 */

import { axe, toHaveNoViolations } from "jest-axe";
import { expect } from "vitest";

// Register the matcher exactly once. Vitest re-imports modules per test file
// but `expect.extend` is idempotent.
expect.extend(toHaveNoViolations);

export interface ExpectNoAxeOptions {
  /** Disable specific axe rules — keep the array small and document why. */
  disabledRules?: string[];
}

export async function expectNoAxeViolations(  container: Element,
  options: ExpectNoAxeOptions = {},
): Promise<void> {
  const rules: Record<string, { enabled: boolean }> = {};
  for (const r of options.disabledRules ?? []) {
    rules[r] = { enabled: false };
  }
  const results = await axe(container, { rules });
  expect(results).toHaveNoViolations();
}
