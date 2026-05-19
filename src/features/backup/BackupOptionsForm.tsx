// — reusable pg_dump options form. Used by:
// 1. BackupWizard (one-shot dump)
// 2. ScheduleManager add/edit drawer (so a schedule carries the same fidelity
// as a one-shot backup).
//
// The component is fully controlled — it receives `value` and emits the next
// snapshot via `onChange` whenever any field changes. Schema/table pickers
// invoke `schema_list_schemas` / `schema_list_tables` directly (mirrors
// SchemaBrowser usage) and are lazily loaded on demand.

import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { type JSX, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BackupOptions, DumpFormat, DumpScope } from "./types";

type SchemaInfo = { name: string };
type TableInfo = { name: string; schema: string };

interface Props {
  value: BackupOptions;
  onChange: (next: BackupOptions) => void;
  /** When true, the connection picker is hidden (wizard tab is per-connection). */
  hideConnection?: boolean;
  /** Optional id-prefix so multiple instances on one page don't collide. */
  idPrefix?: string;
}

export function BackupOptionsForm(props: Props): JSX.Element {
  const { value, onChange, idPrefix = "bk" } = props;
  const { t } = useTranslation();

  const update = useCallback(    (patch: Partial<BackupOptions>) => onChange({ ...value, ...patch }),
    [value, onChange],
);

  // ── Schema / table lookup ──────────────────────────────────────────────────
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<SchemaInfo[]>("schema_list_schemas", {
          connId: value.connectionId,
        });
        if (!cancelled) setSchemas(list.map((s) => s.name));
      } catch (e) {
        if (!cancelled) setSchemaError((e as { message?: string }).message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value.connectionId]);

  const ensureTables = useCallback(    async (schema: string) => {
      if (tablesBySchema[schema]) return;
      try {
        const list = await invoke<TableInfo[]>("schema_list_tables", {
          connId: value.connectionId,
          schema,
        });
        setTablesBySchema((m) => ({ ...m, [schema]: list.map((x) => x.name) }));
      } catch {
        setTablesBySchema((m) => ({ ...m, [schema]: [] }));
      }
    },
    [value.connectionId, tablesBySchema],
);

  const includeSchemas = value.includeSchemas ?? [];
  const includeTables = value.includeTables ?? [];
  const allSchemas = includeSchemas.length === 0;

  const toggleSchema = (name: string) => {
    const next = includeSchemas.includes(name)
      ? includeSchemas.filter((s) => s !== name)
      : [...includeSchemas, name];
    update({ includeSchemas: next });
    if (!includeSchemas.includes(name)) void ensureTables(name);
  };

  const toggleTable = (schema: string, table: string) => {
    const qualified = `${schema}.${table}`;
    const next = includeTables.includes(qualified)
      ? includeTables.filter((t) => t !== qualified)
      : [...includeTables, qualified];
    update({ includeTables: next });
  };

  // ── Output picker ──────────────────────────────────────────────────────────
  const onBrowse = async () => {
    try {
      const picked = await saveDialog({
        defaultPath: value.outputPath || undefined,
        filters: [{ name: "Backup", extensions: ["dump", "sql", "tar", "bin"] }],
      });
      if (typeof picked === "string" && picked) update({ outputPath: picked });
    } catch {
      // user cancelled
    }
  };

  // ── Pre-flight DB size estimate ────────────────────────────────────────────
  const [estimate, setEstimate] = useState<string | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const onEstimate = async () => {
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const result = await invoke<{ rows: Array<Array<unknown>> } | unknown>("query_execute", {
        connId: value.connectionId,
        sql: "SELECT pg_database_size(current_database())::text",
      });
      const rows =
        (result as { rows?: unknown[][] }).rows ??
        (result as { data?: { rows?: unknown[][] } }).data?.rows ??
        [];
      const cell = rows[0]?.[0];
      if (cell == null) throw new Error("no rows");
      const bytes = Number(cell);
      setEstimate(humanBytes(bytes));
    } catch (e) {
      setEstimateError((e as { message?: string }).message ?? String(e));
    } finally {
      setEstimating(false);
    }
  };

  return (    <div
      data-testid="backup-options-form"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("backup.field.format")}</span>
        <select
          value={value.format}
          onChange={(e) => update({ format: e.target.value as DumpFormat })}
          data-testid={`${idPrefix}-format`}
        >
          <option value="custom">{t("backup.format.custom")}</option>
          <option value="plain">{t("backup.format.plain")}</option>
          <option value="directory">{t("backup.format.directory")}</option>
          <option value="tar">{t("backup.format.tar")}</option>
        </select>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {t(`backup.format.help.${value.format}`)}
        </span>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("backup.field.scope")}</span>
        <select
          value={value.scope}
          onChange={(e) => update({ scope: e.target.value as DumpScope })}
          data-testid={`${idPrefix}-scope`}
        >
          <option value="both">{t("backup.scope.both")}</option>
          <option value="dataonly">{t("backup.scope.data_only")}</option>
          <option value="schemaonly">{t("backup.scope.schema_only")}</option>
        </select>
      </label>

      {/* Schema picker */}
      <fieldset
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: 4,
          padding: 8,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <legend style={{ fontSize: 12, fontWeight: 600, padding: "0 4px" }}>
          {t("backup.field.include_schemas")}
        </legend>
        {schemaError ? (          <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
            {schemaError}
          </div>
) : null}
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={allSchemas}
            data-testid={`${idPrefix}-all-schemas`}
            onChange={(e) => {
              if (e.target.checked) update({ includeSchemas: [], includeTables: [] });
            }}
          />
          <span>{t("backup.field.all_schemas")}</span>
        </label>
        {schemas?.map((s) => (          <label
            key={s}
            style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}
          >
            <input
              type="checkbox"
              checked={includeSchemas.includes(s)}
              onChange={() => toggleSchema(s)}
              data-testid={`${idPrefix}-schema-${s}`}
            />
            <span>{s}</span>
          </label>
))}
      </fieldset>

      {/* Table picker — only shown when at least one schema is selected */}
      {includeSchemas.length > 0 ? (        <fieldset
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: 4,
            padding: 8,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <legend style={{ fontSize: 12, fontWeight: 600, padding: "0 4px" }}>
            {t("backup.field.include_tables")}
          </legend>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {t("backup.field.all_tables_hint")}
          </span>
          {includeSchemas.map((schema) => (            <div key={schema} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{schema}</span>
              {(tablesBySchema[schema] ?? []).map((tbl) => {
                const qualified = `${schema}.${tbl}`;
                return (                  <label
                    key={qualified}
                    style={{
                      display: "inline-flex",
                      gap: 6,
                      alignItems: "center",
                      fontSize: 12,
                      paddingLeft: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={includeTables.includes(qualified)}
                      onChange={() => toggleTable(schema, tbl)}
                      data-testid={`${idPrefix}-table-${qualified}`}
                    />
                    <span>{tbl}</span>
                  </label>
);
              })}
            </div>
))}
        </fieldset>
) : null}

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{t("backup.field.output_path")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={value.outputPath}
            onChange={(e) => update({ outputPath: e.target.value })}
            placeholder="/tmp/dump.bin"
            data-testid={`${idPrefix}-output-path`}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => void onBrowse()}
            data-testid={`${idPrefix}-browse`}
            aria-label={t("backup.field.browse")}
          >
            {t("backup.field.browse")}
          </button>
        </div>
      </label>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void onEstimate()}
          disabled={estimating}
          data-testid={`${idPrefix}-estimate`}
        >
          {estimating ? t("backup.field.estimating") : t("backup.field.estimate")}
        </button>
        {estimate ? (          <span data-testid={`${idPrefix}-estimate-value`} style={{ fontSize: 12 }}>
            ≈ {estimate}
          </span>
) : null}
        {estimateError ? (          <span role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
            {estimateError}
          </span>
) : null}
      </div>

      {value.format === "custom" ? (        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>
            {t("backup.field.compress_level")} ({value.compressLevel})
          </span>
          <input
            type="range"
            min={0}
            max={9}
            value={value.compressLevel}
            onChange={(e) => update({ compressLevel: Number(e.target.value) })}
            data-testid={`${idPrefix}-compress`}
            aria-label={t("backup.field.compress_level")}
          />
        </label>
) : null}

      {value.format === "directory" ? (        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{t("backup.field.parallel_jobs")}</span>
          <input
            type="number"
            min={1}
            max={32}
            value={value.parallelJobs ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              update({ parallelJobs: Number.isFinite(n) && n > 0 ? n : null });
            }}
            data-testid={`${idPrefix}-parallel`}
            aria-label={t("backup.field.parallel_jobs")}
          />
        </label>
) : null}

      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
        <input
          type="checkbox"
          checked={value.includeCreateDb ?? false}
          onChange={(e) => update({ includeCreateDb: e.target.checked })}
          data-testid={`${idPrefix}-create-db`}
        />
        <span>{t("backup.field.include_create_db")}</span>
      </label>

      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
        <input
          type="checkbox"
          checked={value.noOwner ?? false}
          onChange={(e) => update({ noOwner: e.target.checked })}
          data-testid={`${idPrefix}-no-owner`}
        />
        <span>{t("backup.field.no_owner")}</span>
      </label>
    </div>
);
}

function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
