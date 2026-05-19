// — locale-aware Intl helpers.
//
// Centralised `Intl.*` wrappers so the rest of the codebase doesn't have to
// thread `useTranslation().i18n.language` through every formatter call.
// Defaults to the current i18next language; explicit `locale` override
// supported for tests.
//
// Locale mapping: i18next `lng` ("ru" / "en") → BCP-47 ("ru-RU" / "en-US")
// for `Intl.NumberFormat` and friends. Tier-2 languages (S35 product spec)
// add to `BCP47` when they ship.

import i18n from "./index";

const BCP47: Record<string, string> = {
  ru: "ru-RU",
  en: "en-US",
};

function resolveLocale(locale?: string): string {
  const lng = locale ?? i18n.language ?? "ru";
  return BCP47[lng] ?? lng;
}

/** Locale-aware integer / float formatter. */
export function formatNumber(  value: number,
  options?: Intl.NumberFormatOptions,
  locale?: string,
): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(resolveLocale(locale), options).format(value);
}

/** Compact number formatting (e.g. "1.2k" / "3.4M") — used in result grid + Health screen. */
export function formatCompactNumber(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(resolveLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Bytes formatter — IEC binary prefixes (KiB / MiB / GiB) by default;
 * `decimal` flag switches to SI (KB / MB / GB).
 */
export function formatBytes(value: number, locale?: string, decimal = false): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  const base = decimal ? 1000 : 1024;
  const units = decimal
    ? ["B", "KB", "MB", "GB", "TB", "PB"]
    : ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  if (value < base) {
    return `${formatNumber(value, { maximumFractionDigits: 0 }, locale)} ${units[0]}`;
  }
  let unitIdx = 0;
  let scaled = value;
  while (scaled >= base && unitIdx < units.length - 1) {
    scaled /= base;
    unitIdx += 1;
  }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${formatNumber(scaled, { maximumFractionDigits: digits }, locale)} ${units[unitIdx]}`;
}

/** Format an ISO timestamp / Date as a locale-aware date+time string. */
export function formatDateTime(  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(date);
}

/** Date only (used in History / Recent Plans rows). */
export function formatDate(  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options,
  }).format(date);
}

/**
 * Relative time (locale-aware, e.g. "5 minutes ago") — picks the largest
 * sensible unit. `from` defaults to now.
 */
export function formatRelativeTime(  target: Date | string | number,
  from: Date = new Date(),
  locale?: string,
): string {
  const date = target instanceof Date ? target : new Date(target);
  if (Number.isNaN(date.getTime())) return "—";
  const deltaMs = date.getTime() - from.getTime();
  const deltaSec = deltaMs / 1000;
  const fmt = new Intl.RelativeTimeFormat(resolveLocale(locale), { numeric: "auto" });
  const abs = Math.abs(deltaSec);
  if (abs < 60) return fmt.format(Math.round(deltaSec), "second");
  if (abs < 3600) return fmt.format(Math.round(deltaSec / 60), "minute");
  if (abs < 86400) return fmt.format(Math.round(deltaSec / 3600), "hour");
  if (abs < 86400 * 30) return fmt.format(Math.round(deltaSec / 86400), "day");
  if (abs < 86400 * 365) return fmt.format(Math.round(deltaSec / (86400 * 30)), "month");
  return fmt.format(Math.round(deltaSec / (86400 * 365)), "year");
}

/** Duration in milliseconds, formatted as "Xms" / "X.Xs" / "Xm Ys". */
export function formatDuration(ms: number, locale?: string): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${formatNumber(Math.round(ms), undefined, locale)} ms`;
  if (ms < 60_000) {
    return `${formatNumber(ms / 1000, { maximumFractionDigits: ms < 10_000 ? 1 : 0 }, locale)} s`;
  }
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${formatNumber(minutes, undefined, locale)} m ${formatNumber(seconds, undefined, locale)} s`;
}

/** Percentage with one decimal place (`46.7%` / `100%`). */
export function formatPercent(fraction: number, locale?: string): string {
  if (!Number.isFinite(fraction)) return "—";
  return new Intl.NumberFormat(resolveLocale(locale), {
    style: "percent",
    maximumFractionDigits: fraction >= 1 || fraction <= -1 ? 0 : 1,
  }).format(fraction);
}
