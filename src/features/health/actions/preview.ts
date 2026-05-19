import type { ActionTarget } from "./types";

export interface PreviewBundle {
  sql: string;
  confirmTarget: string;
  impact: string;
  impactArgs?: Record<string, string | number>;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function prettyBytes(bytes?: number): string {
  if (bytes === undefined) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const fixed = v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1);
  return `${fixed} ${units[i]}`;
}

export function buildPreview(target: ActionTarget): PreviewBundle {
  switch (target.kind) {
    case "reindexTable":
      return {
        sql: `REINDEX TABLE CONCURRENTLY ${quoteQualified(target.schema, target.table)}`,
        confirmTarget: target.table,
        impact: "health.actions.impact.reindex",
        impactArgs: { size: prettyBytes(target.sizeBytes) },
      };
    case "vacuum":
      return {
        sql: `VACUUM ${quoteQualified(target.schema, target.table)}`,
        confirmTarget: target.table,
        impact: "health.actions.impact.vacuum",
        impactArgs: { size: prettyBytes(target.sizeBytes) },
      };
    case "analyze":
      return {
        sql: `ANALYZE ${quoteQualified(target.schema, target.table)}`,
        confirmTarget: target.table,
        impact: "health.actions.impact.analyze",
      };
    case "dropIndex":
      return {
        sql: `DROP INDEX CONCURRENTLY ${quoteQualified(target.schema, target.index)}`,
        confirmTarget: target.index,
        impact: "health.actions.impact.drop_index",
        impactArgs: { size: prettyBytes(target.sizeBytes) },
      };
    case "killPid": {
      const fn = target.terminate ? "pg_terminate_backend" : "pg_cancel_backend";
      return {
        sql: `SELECT ${fn}(${target.pid})`,
        confirmTarget: String(target.pid),
        impact: target.terminate
          ? "health.actions.impact.kill_terminate"
          : "health.actions.impact.kill_cancel",
        impactArgs: { pid: target.pid },
      };
    }
    case "explain":
      throw new Error("explain is handled outside the preview modal");
  }
}
