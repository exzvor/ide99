import { describe, expect, test } from "vitest";
import { shortServerVersion } from "./serverVersion";

/**
 * Regression tests for the verbose-version-string truncation.
 *
 * Audit fix: connection-success badge used to show the entire
 * `SELECT version()` output (including build host, compiler, target triple).
 * `shortServerVersion` collapses it to "PostgreSQL <major.minor>" so the badge
 * stays compact regardless of how chatty the server build is.
 */

describe("shortServerVersion", () => {
  test("collapses a full Linux/musl version line", () => {
    const raw =
      "PostgreSQL 17.9 on aarch64-unknown-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit";
    expect(shortServerVersion(raw)).toBe("PostgreSQL 17.9");
  });

  test("collapses macOS Homebrew build line", () => {
    const raw =
      "PostgreSQL 16.4 on aarch64-apple-darwin23.5.0, compiled by Apple clang version 16.0.0";
    expect(shortServerVersion(raw)).toBe("PostgreSQL 16.4");
  });

  test("handles single-segment major-only versions", () => {
    expect(shortServerVersion("PostgreSQL 17 on x86_64-pc-linux-gnu")).toBe("PostgreSQL 17");
  });

  test("returns input verbatim when prefix is missing (forks, custom builds)", () => {
    expect(shortServerVersion("Aurora 14.6")).toBe("Aurora 14.6");
  });

  test("is case-insensitive on the prefix", () => {
    expect(shortServerVersion("postgresql 15.5 ...")).toBe("postgresql 15.5");
  });
});
