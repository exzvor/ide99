/**
 * —
 *
 * DiffViewer: two version dropdowns (only versions with `hasSnapshot=true`
 * are selectable) + a read-only Monaco editor displaying the unified diff
 * returned by `migrations_diff_snapshots`.
 *
 * The Monaco DiffEditor expects two distinct sources; we already get a
 * pre-computed unified-diff string from the backend, so we render it as
 * plain text in a single Editor with `language="diff"` and rely on
 * Monaco's diff syntax highlighting.
 */

import { Editor } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { type JSX, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorToMessage } from "../../lib/errors";
import type { Migration } from "./store";

type DiffResult = { unifiedDiff: string };

interface Props {
  connectionId: string;
  migrations: Migration[];
}

export function DiffViewer(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { connectionId, migrations } = props;

  const candidates = useMemo(() => migrations.filter((m) => m.hasSnapshot), [migrations]);

  const [fromVersion, setFromVersion] = useState<string>("");
  const [toVersion, setToVersion] = useState<string>("");
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fromVersion || !toVersion) {
      setDiff(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = (await invoke("migrations_diff_snapshots", {
          connId: connectionId,
          fromVersion,
          toVersion,
        })) as DiffResult;
        if (!cancelled) setDiff(res.unifiedDiff);
      } catch (err) {
        if (!cancelled) {
          setError(errorToMessage(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromVersion, toVersion, connectionId]);

  if (candidates.length === 0) {
    return (
      <div
        data-testid="diff-no-snapshots"
        style={{ padding: 24, color: "var(--ink-3)", fontSize: 13, textAlign: "center" }}
      >
        {t("migrations.diff.noSnapshots")}
      </div>
    );
  }

  const noChanges = diff !== null && diff.length === 0;

  return (
    <div
      data-testid="diff-viewer"
      style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("migrations.diff.from")}</span>
          <select
            data-testid="diff-from-select"
            className="q-input"
            value={fromVersion}
            onChange={(e) => setFromVersion(e.target.value)}
          >
            <option value="">—</option>
            {candidates.map((m) => (
              <option key={m.version} value={m.version}>
                {m.version} — {m.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("migrations.diff.to")}</span>
          <select
            data-testid="diff-to-select"
            className="q-input"
            value={toVersion}
            onChange={(e) => setToVersion(e.target.value)}
          >
            <option value="">—</option>
            {candidates.map((m) => (
              <option key={m.version} value={m.version}>
                {m.version} — {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
          {t("migrations.diff.error", { error })}
        </div>
      ) : null}

      {!fromVersion || !toVersion ? (
        <div
          data-testid="diff-select-prompt"
          style={{ color: "var(--ink-3)", fontSize: 12, padding: 12 }}
        >
          {t("migrations.diff.selectBoth")}
        </div>
      ) : loading ? (
        <div
          data-testid="diff-loading"
          style={{ color: "var(--ink-3)", fontSize: 12, padding: 12 }}
        >
          {t("migrations.diff.loading")}
        </div>
      ) : noChanges ? (
        <div
          data-testid="diff-no-changes"
          style={{
            color: "var(--ink-3)",
            fontSize: 13,
            padding: 24,
            textAlign: "center",
            border: "1px dashed var(--hairline)",
            borderRadius: 4,
          }}
        >
          {t("migrations.diff.noChanges")}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 280,
            border: "1px solid var(--hairline)",
            borderRadius: 4,
          }}
        >
          <Editor
            height="100%"
            defaultLanguage="diff"
            value={diff ?? ""}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      )}
    </div>
  );
}
