// — Intl helpers smoke tests. Locale-pinned so CI is deterministic
// regardless of the host locale.

import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatCompactNumber,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "../intl";

describe("Intl helpers", () => {
  it("formatNumber renders thousands separator per locale", () => {
    expect(formatNumber(1234567, undefined, "en")).toContain("1,234,567");
    // RU uses NBSP as thousands separator — match digits + literal value.
    const ru = formatNumber(1234567, undefined, "ru");
    expect(ru.replace(/\s+/g, "")).toBe("1234567");
  });

  it("formatCompactNumber renders K/M shorthand", () => {
    expect(formatCompactNumber(12500, "en")).toMatch(/12\.5K/i);
    expect(formatCompactNumber(2_400_000, "en")).toMatch(/2\.4M/i);
  });

  it("formatBytes uses IEC prefixes by default", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(1024, "en")).toBe("1 KiB");
    expect(formatBytes(1024 * 1024 * 5, "en")).toBe("5 MiB");
  });

  it("formatBytes decimal mode uses SI prefixes", () => {
    expect(formatBytes(1000, "en", true)).toBe("1 KB");
    expect(formatBytes(2_500_000, "en", true)).toMatch(/2\.5 MB/);
  });

  it("formatBytes returns em-dash for invalid input", () => {
    expect(formatBytes(Number.NaN, "en")).toBe("—");
    expect(formatBytes(-1, "en")).toBe("—");
  });

  it("formatDateTime rejects invalid Date", () => {
    expect(formatDateTime("not-a-date", undefined, "en")).toBe("—");
  });

  it("formatDate produces a parseable string", () => {
    const out = formatDate(new Date("2026-05-07T12:00:00Z"), undefined, "en");
    // Order varies by locale; just ensure year + month token present.
    expect(out).toMatch(/2026/);
  });

  it("formatRelativeTime picks human-friendly unit", () => {
    const now = new Date("2026-05-07T12:00:00Z");
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    expect(formatRelativeTime(fiveMinAgo, now, "en")).toMatch(/5 minutes ago/);
  });

  it("formatDuration handles ms / s / m breakpoints", () => {
    expect(formatDuration(45, "en")).toMatch(/45 ms/);
    expect(formatDuration(1234, "en")).toMatch(/1\.2 s/);
    expect(formatDuration(125_000, "en")).toMatch(/2 m 5 s/);
  });

  it("formatPercent treats fraction in [-1, 1] as 0–100%", () => {
    expect(formatPercent(0.467, "en")).toBe("46.7%");
    expect(formatPercent(1, "en")).toBe("100%");
    expect(formatPercent(-0.5, "en")).toMatch(/-50/);
  });

  it("non-finite values render as em-dash", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});
