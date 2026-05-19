/**
 * — 
 *
 * Vertical, scrollable list of migrations with status badges and
 * keyboard navigation (ArrowUp / ArrowDown). The component is a pure
 * view: selection lives upstream (parent or zustand store).
 *
 * Each row exposes:
 * - data-testid="migration-row-{version}"
 * - data-status="applied" | "pending" | "dirty"
 * - role="button" + aria-pressed for AT users
 *
 * The summary line at the top is keyed off `migrations.timeline.summary`
 * with `applied`, `pending`, `dirty` interpolated from {@link countByStatus}.
 */

import { type JSX, type KeyboardEvent, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLintStore } from "./squawk/lintStore";
import type { Migration, MigrationStatus } from "./store";

interface Props {
  migrations: Migration[];
  selectedVersion: string | null;
  onSelect(version: string | null): void;
}

const STATUS_DOT: Record<MigrationStatus, string> = {
  applied: "var(--ok, #34c759)",
  pending: "var(--ink-4, #888)",
  dirty: "var(--warn, #d49b1c)",
};

const STATUS_GLYPH: Record<MigrationStatus, string> = {
  applied: "✔",
  pending: "⏸",
  dirty: "⚠",
};

/**
 * �� backend keeps `status="applied"` for ledger-only rows whose
 * `.up.sql` was deleted from disk (the apply succeeded historically), but
 * surfaces the missing file via `parse_error="file missing"`. The user
 * needs to see this distinctly from a normal applied row, otherwise the
 * timeline lies about state. We override the badge to red and force a
 * `🚫 file missing` glyph + tooltip when this discrepancy is detected.
 */
const FILE_MISSING_DOT = "var(--err, #d33)";
const FILE_MISSING_GLYPH = "🚫";

function isFileMissing(parseError: string | null): boolean {
  return parseError === "file missing";
}

export function Timeline(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { migrations, selectedVersion, onSelect } = props;

  // Subscribe to the lint store so the badge re-renders when findings
  // arrive after the initial render (per-file lint dispatch is async).
  const findingsByVersion = useLintStore((s) => s.findingsByVersion);

  const counts = useMemo<Record<MigrationStatus, number>>(() => {
    const acc: Record<MigrationStatus, number> = { applied: 0, pending: 0, dirty: 0 };
    for (const m of migrations) acc[m.status]++;
    return acc;
  }, [migrations]);

  const handleKeyDown = useCallback(    (e: KeyboardEvent<HTMLDivElement>) => {
      if (migrations.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = selectedVersion ? migrations.findIndex((m) => m.version === selectedVersion) : -1;
      let next: number;
      if (e.key === "ArrowDown") {
        next = idx === -1 ? 0 : Math.min(migrations.length - 1, idx + 1);
      } else {
        next = idx === -1 ? migrations.length - 1 : Math.max(0, idx - 1);
      }
      const target = migrations[next];
      if (target) onSelect(target.version);
    },
    [migrations, selectedVersion, onSelect],
);

  if (migrations.length === 0) {
    return (      <div
        data-testid="migrations-timeline-empty"
        style={{
          padding: 24,
          color: "var(--ink-3)",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        {t("migrations.timeline.empty")}
      </div>
);
  }

  return (    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        data-testid="migrations-timeline-summary"
        style={{
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--ink-3)",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        {t("migrations.timeline.summary", {
          applied: counts.applied,
          pending: counts.pending,
          dirty: counts.dirty,
        })}
      </div>
      <div
        data-testid="migrations-timeline"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: list-as-radiogroup; rows are buttons.
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="q-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          outline: "none",
        }}
      >
        {migrations.map((m) => {
          const isSelected = m.version === selectedVersion;
          const tooltips: string[] = [];
          if (m.parseError === "duplicate version") {
            tooltips.push(t("migrations.timeline.duplicateVersion"));
          }
          if (m.parseError === "orphan rollback file") {
            tooltips.push(t("migrations.timeline.orphanRollback"));
          }
          if (m.status === "dirty") {
            tooltips.push(t("migrations.timeline.checksumMismatch"));
          }
          // �� applied + file_missing: must NOT render as a
          // normal green applied row.
          const fileMissing = isFileMissing(m.parseError);
          if (fileMissing) {
            tooltips.push(t("migrations.timeline.fileMissing"));
          }

          return (            <div
              key={m.version}
              data-testid={`migration-row-${m.version}`}
              data-status={m.status}
              data-selected={isSelected ? "true" : "false"}
              // biome-ignore lint/a11y/useSemanticElements: row is a custom button with multi-column grid; <button> would not allow this layout.
              role="button"
              aria-pressed={isSelected}
              tabIndex={-1}
              onClick={() => onSelect(m.version)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(m.version);
                }
              }}
              style={{
                display: "grid",
                gridTemplateColumns: "20px 56px 1fr auto auto auto auto",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                cursor: "pointer",
                background: isSelected ? "var(--accent-bg, rgba(80, 130, 200, 0.15))" : undefined,
                borderLeft: isSelected
                  ? "2px solid var(--accent, #4f7fff)"
                  : "2px solid transparent",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
              title={tooltips.length > 0 ? tooltips.join(" · ") : undefined}
            >
              <span
                aria-hidden="true"
                style={{
                  color: fileMissing ? FILE_MISSING_DOT : STATUS_DOT[m.status],
                  fontSize: 14,
                }}
              >
                {fileMissing ? FILE_MISSING_GLYPH : STATUS_GLYPH[m.status]}
              </span>
              <span style={{ fontFamily: "var(--font-mono-q)", color: "var(--ink-4)" }}>
                {m.version}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.name}
                {m.downPath === null ? (                  <span
                    data-testid={`migration-row-${m.version}-no-rollback`}
                    title={t("migrations.timeline.noRollbackFile")}
                    style={{ marginLeft: 6, color: "var(--warn, #d49b1c)", fontSize: 11 }}
                  >
                    🚫
                  </span>
) : null}
              </span>
              <span
                data-testid={`migration-row-${m.version}-badge`}
                data-file-missing={fileMissing ? "true" : "false"}
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "var(--bg-sunken, rgba(0,0,0,0.1))",
                  color: fileMissing ? FILE_MISSING_DOT : STATUS_DOT[m.status],
                  textTransform: "lowercase",
                }}
              >
                {fileMissing
                  ? t("migrations.timeline.fileMissing")
                  : t(`migrations.timeline.${m.status}`)}
              </span>
              <span style={{ fontSize: 11, color: "var(--ink-4)", minWidth: 0 }}>
                {m.appliedAt ?? ""}
              </span>
              <span
                style={{ fontSize: 11, color: "var(--ink-4)", minWidth: 32, textAlign: "right" }}
              >
                {m.durationMs !== null ? `${m.durationMs}ms` : ""}
              </span>
              {(() => {
                const findings = findingsByVersion.get(m.version) ?? [];
                if (findings.length === 0) return <span />;
                const rules = [...new Set(findings.map((f) => f.rule))].slice(0, 5);
                const tooltip =
                  rules.join("\n") + (findings.length > 5 ? `\n+ ${findings.length - 5} more` : "");
                return (                  <span
                    data-testid={`squawk-badge-${m.version}`}
                    title={tooltip}
                    style={{
                      background: "var(--warning-soft, #fef9c3)",
                      color: "var(--warning, #854d0e)",
                      borderRadius: 999,
                      padding: "1px 8px",
                      fontSize: 11,
                      marginLeft: 4,
                    }}
                  >
                    ⚠ {findings.length}
                  </span>
);
              })()}
            </div>
);
        })}
      </div>
    </div>
);
}
