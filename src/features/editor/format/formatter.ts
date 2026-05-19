import { format } from "sql-formatter";

const PG_CONFIG = {
  language: "postgresql",
  tabWidth: 2,
  keywordCase: "upper",
  linesBetweenQueries: 2,
} as const;

/**
 * Format SQL using the project's standard PG config. Returns null on truly
 * empty input or library throw — caller falls back to original buffer.
 */
export function formatSql(sql: string): string | null {
  if (sql.trim().length === 0) return null;
  try {
    return format(sql, PG_CONFIG as Parameters<typeof format>[1]);
  } catch {
    return null;
  }
}
