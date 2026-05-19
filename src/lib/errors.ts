/**
 * Single seam for converting backend error envelopes into localized,
 * human-readable strings. The Rust side serializes `ConnectionError` /
 * `QueryError` as `{kind, message}` where `message` is often a raw inner
 * value (UUID for `notFound`, postgres-specific text, etc). Surfacing
 * `err.message` directly to a toast leaks UUIDs to users (audit C3/C4).
 *
 * Use {@link localizeConnectionError} at every catch site that calls
 * `toast.error(...)` for a connection command. Use
 * {@link localizeQueryError} for SQL execution / tab-store paths.
 *
 * For unstructured Tauri-reject paths that don't have a typed envelope (e.g.
 * the migrations panel commands), use {@link errorToMessage} — `String(err)`
 * on a plain object reject silently produces "[object Object]" in the UI.
 */
import type { TFunction } from "i18next";
import { ConnectionError, QueryError } from "./tauri";

/**
 * Best-effort coercion of an unknown thrown / rejected value into a
 * user-readable string. Handles Errors, strings, common Tauri/Rust error
 * envelopes (`{message}`, `{detail}`, `{error}`, `{kind, message}`), and
 * falls back to `JSON.stringify` so we never render the literal
 * "[object Object]" anywhere in the UI.
 */
export function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err === null || err === undefined) return "Unknown error";
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.length > 0) {
      return typeof obj.kind === "string" ? `${obj.kind}: ${obj.message}` : obj.message;
    }
    if (typeof obj.detail === "string" && obj.detail.length > 0) return obj.detail;
    if (typeof obj.error === "string" && obj.error.length > 0) return obj.error;
    // Object-editor "apply" failures and other Postgres-bridge envelopes use
    // `{pgMessage, pgErrorCode, pgHint, failingSql, ...}`. Surface the human
    // pgMessage as the primary line and tag it with the SQLSTATE if present
    // so power users can grep ("42601 → syntax error").
    if (typeof obj.pgMessage === "string" && obj.pgMessage.length > 0) {
      return typeof obj.pgErrorCode === "string" && obj.pgErrorCode.length > 0
        ? `${obj.pgErrorCode}: ${obj.pgMessage}`
        : obj.pgMessage;
    }
    if (typeof obj.kind === "string") return obj.kind;
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  }
  return String(err);
}

export function localizeConnectionError(err: unknown, t: TFunction): string {
  if (err instanceof ConnectionError) {
    // `err.message` is the raw payload (e.g. UUID for notFound). It's useful
    // as a "detail" interpolation only for kinds where the message is human
    // (invalidInput / postgres). For everything else, the localized template
    // is enough — the UUID would just confuse the user.
    // Kinds whose backend message is itself human-readable and worth showing
    // verbatim alongside the localized template.
    const passthroughKinds: ConnectionError["kind"][] = [
      "invalidInput",
      "postgres",
      "keychain",
      // `message` carries the connection name; the i18n template embeds it as
      // the "name" interpolation alongside the action prompt.
      "passwordMissing",
    ];
    if (passthroughKinds.includes(err.kind)) {
      const interp =
        err.kind === "passwordMissing" ? { name: err.message } : { detail: err.message };
      return t(`toast.connection.error.${err.kind}`, interp);
    }
    return t(`toast.connection.error.${err.kind}`);
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Localize a migrations IPC error envelope. Mirrors the Rust
 * `MigrationsError` enum (see `src-tauri/src/migrations/types.rs`).
 *
 * Returns `null` for `dirNotSet` because the Migrations panel renders an
 * empty-state hint ("Choose a directory…") that already covers that case —
 * showing a separate red banner with the same meaning would just be noise.
 * Every other variant maps to a human i18n string.
 */
export function localizeMigrationError(err: unknown, t: TFunction): string | null {
  if (err && typeof err === "object") {
    const obj = err as { kind?: unknown; message?: unknown; from?: unknown; to?: unknown };
    if (typeof obj.kind === "string") {
      // dirNotSet — empty-state below already explains it.
      if (obj.kind === "dirNotSet") return null;
      const detail =
        typeof obj.message === "string"
          ? obj.message
          : obj.kind === "rangeNonContiguous" &&
              typeof obj.from === "string" &&
              typeof obj.to === "string"
            ? `${obj.from}..${obj.to}`
            : "";
      const key = `migrations.error.${obj.kind}`;
      const localized = t(key, { detail });
      // i18next returns the key string when no translation exists — fall back
      // to the generic template so the user never sees a raw key like
      // `migrations.error.someUnknownKind` slip through.
      if (localized === key) {
        return t("migrations.error.fallback", { detail: detail || obj.kind });
      }
      return localized;
    }
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return t("migrations.error.fallback", { detail: errorToMessage(err) });
}

export function localizeQueryError(err: unknown, t: TFunction): string {
  if (err instanceof QueryError) {
    if (err.kind === "postgresError") {
      return err.message;
    }
    if (err.kind === "notConnected") {
      return t("toast.connection.error.notConnected");
    }
    if (err.kind === "poolError") {
      return t("editor.result.error.code.pool_error");
    }
    if (err.kind === "cancelled") {
      return t("editor.result.error.code.cancelled");
    }
    if (err.kind === "cursorNotFound") {
      return t("editor.result.error.code.cursor_lost");
    }
    return t("editor.result.error.code.storage_error");
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
