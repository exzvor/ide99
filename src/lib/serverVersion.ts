/**
 * Compact a verbose `SELECT version()` string into "PostgreSQL <major.minor>".
 *
 * The raw output includes build/host/compiler details that aren't useful in a
 * connection success badge — e.g.
 * "PostgreSQL 17.9 on aarch64-unknown-linux-musl, compiled by gcc ..."
 * collapses to just "PostgreSQL 17.9". Returns the raw string verbatim if the
 * pattern doesn't match (forks of PG, custom builds, very old versions).
 */
export function shortServerVersion(raw: string): string {
  const match = raw.match(/^(PostgreSQL)\s+(\d+(?:\.\d+)?)/i);
  if (!match) return raw;
  return `${match[1]} ${match[2]}`;
}
