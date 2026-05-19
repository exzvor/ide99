import { describe, expect, test } from "vitest";
import { localizeConnectionError, localizeQueryError } from "./errors";
import { ConnectionError, type ConnectionErrorPayload, QueryError } from "./tauri";

/**
 * Regression tests for audit fixes C3 / C4.
 *
 * Pre-fix: every `toast.error(err.message)` site dumped the raw inner string
 * (often a UUID for `notFound`, the literal i18n key for editor errors, or a
 * raw tokio-postgres message). `localizeConnectionError` and `localizeQueryError`
 * are the single seam that maps `kind` → human i18n template; these tests pin
 * down which kinds passthrough `detail` and which use template-only output.
 */

const tFake = ((key: string, opts?: Record<string, unknown>) => {
  if (!opts) return key;
  return Object.entries(opts).reduce<string>(    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)),
    key,
);
}) as Parameters<typeof localizeConnectionError>[1];

function makeConnError(payload: ConnectionErrorPayload): ConnectionError {
  return new ConnectionError(payload);
}

describe("localizeConnectionError", () => {
  test("notFound: uses the localized template only (no UUID leak)", () => {
    const e = makeConnError({ kind: "notFound", message: "b05deae3-3a8c-4c15-9833-e359e201fa11" });
    expect(localizeConnectionError(e, tFake)).toBe("toast.connection.error.notFound");
  });

  test("duplicateName: localized template only", () => {
    const e = makeConnError({ kind: "duplicateName", message: "QQ" });
    expect(localizeConnectionError(e, tFake)).toBe("toast.connection.error.duplicateName");
  });

  test("keychain: localized template includes detail (audit C8 — was kind-only)", () => {
    const e = makeConnError({
      kind: "keychain",
      message: "saved password unreachable for 'QQ'",
    });
    expect(localizeConnectionError(e, tFake)).toBe("toast.connection.error.keychain");
    // Ensure {detail} is interpolated (template happens to have no placeholder
    // in fake t — but our errors.ts passes it through, verify by spying):
    const calls: { key: string; opts?: Record<string, unknown> }[] = [];
    const tSpy = ((key: string, opts?: Record<string, unknown>) => {
      calls.push({ key, opts });
      return key;
    }) as Parameters<typeof localizeConnectionError>[1];
    localizeConnectionError(e, tSpy);
    expect(calls[0]).toEqual({
      key: "toast.connection.error.keychain",
      opts: { detail: "saved password unreachable for 'QQ'" },
    });
  });

  test("postgres: passthrough detail", () => {
    const e = makeConnError({ kind: "postgres", message: "connection refused" });
    const calls: { key: string; opts?: Record<string, unknown> }[] = [];
    const tSpy = ((key: string, opts?: Record<string, unknown>) => {
      calls.push({ key, opts });
      return key;
    }) as Parameters<typeof localizeConnectionError>[1];
    localizeConnectionError(e, tSpy);
    expect(calls[0]).toEqual({
      key: "toast.connection.error.postgres",
      opts: { detail: "connection refused" },
    });
  });

  test("non-ConnectionError Error: returns its message unchanged", () => {
    expect(localizeConnectionError(new Error("plain"), tFake)).toBe("plain");
  });

  test("non-Error value: stringifies", () => {
    expect(localizeConnectionError("oops" as unknown, tFake)).toBe("oops");
  });
});

describe("localizeQueryError", () => {
  test("postgresError: returns the underlying PG message verbatim", () => {
    const e = new QueryError({
      kind: "postgresError",
      message: 'syntax error at or near "GARBAGE"',
      position: 14,
    });
    expect(localizeQueryError(e, tFake)).toBe('syntax error at or near "GARBAGE"');
  });

  test("notConnected: uses localized template (no connId leak)", () => {
    const e = new QueryError({ kind: "notConnected", connId: "uuid-x" });
    expect(localizeQueryError(e, tFake)).toBe("toast.connection.error.notConnected");
  });

  test("poolError: localized pool error code", () => {
    const e = new QueryError({ kind: "poolError", message: "timeout" });
    expect(localizeQueryError(e, tFake)).toBe("editor.result.error.code.pool_error");
  });

  test("cancelled: localized 'query cancelled' template", () => {
    const e = new QueryError({ kind: "cancelled" });
    expect(localizeQueryError(e, tFake)).toBe("editor.result.error.code.cancelled");
  });

  test("cursorNotFound: localized 'session lost' template", () => {
    const e = new QueryError({ kind: "cursorNotFound", cursorId: "c_lost" });
    expect(localizeQueryError(e, tFake)).toBe("editor.result.error.code.cursor_lost");
  });
});
