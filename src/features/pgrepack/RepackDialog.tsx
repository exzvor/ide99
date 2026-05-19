// — owner: .
//
// Three-section pg_repack dialog:
// 1. Pre-flight check (4 bullets, plus a missing-PK warning banner).
// 2. Generate command (form + read-only textarea + clipboard button).
// 3. Active jobs monitor (polls `_repack.repack_log` every 2 s).
//
// ide99 never invokes pg_repack directly — the dialog only generates a string
// the user copies into their own terminal.
import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";

import { queryExecute } from "../../lib/tauri";
import { ACTIVE_JOBS_SQL } from "./activeJobsQuery";
import { buildRepackCommand } from "./buildRepackCommand";
import { type PreflightResult, runPreflightCheck } from "./preflightCheck";

export interface RepackDialogProps {
  open: boolean;
  connId: string;
  database: string;
  schema: string;
  table: string;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 2_000;

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 12,
  gap: 2,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-2)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginTop: 4,
};

type ActiveJob = {
  startTime: string;
  pid: string;
  tableName: string;
};

type JobsState = { kind: "loading" } | { kind: "ok"; jobs: ActiveJob[] } | { kind: "error" };

export function RepackDialog(props: RepackDialogProps): JSX.Element | null {
  const { open, connId, database, schema, table, onClose } = props;

  const [preflightLoading, setPreflightLoading] = useState(true);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);

  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState<string>("5432");
  const [db, setDb] = useState(database);
  const [jobs, setJobs] = useState<string>("");
  const [noSuperuserCheck, setNoSuperuserCheck] = useState(false);
  const [onlyIndexes, setOnlyIndexes] = useState(false);

  const [jobsState, setJobsState] = useState<JobsState>({ kind: "loading" });
  const jobsStateRef = useRef(jobsState);
  jobsStateRef.current = jobsState;

  // Reset preflight whenever dialog reopens or target changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreflightLoading(true);
    runPreflightCheck(connId, schema, table)
      .then((result) => {
        if (cancelled) return;
        setPreflight(result);
        setPreflightLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPreflight(null);
        setPreflightLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connId, schema, table]);

  // Keep db field in sync with prop when it changes (e.g. dialog re-opened on
  // a different connection).
  useEffect(() => {
    setDb(database);
  }, [database]);

  // Active-jobs polling. Fires once on open + every 2 s thereafter. Cleared
  // immediately when `open` flips false or the dialog unmounts.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setJobsState({ kind: "loading" });

    const fetchJobs = async (): Promise<void> => {
      try {
        const result = await queryExecute(connId, ACTIVE_JOBS_SQL);
        if (cancelled) return;
        const rows = (result as { rows: (string | null)[][] }).rows ?? [];
        const parsed: ActiveJob[] = rows.map((row) => ({
          startTime: row[0] ?? "",
          pid: row[1] ?? "",
          tableName: row[2] ?? "",
        }));
        setJobsState({ kind: "ok", jobs: parsed });
      } catch {
        if (cancelled) return;
        setJobsState({ kind: "error" });
      }
    };

    void fetchJobs();
    const id = setInterval(() => {
      void fetchJobs();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, connId]);

  const portNum = useMemo(() => {
    if (port.trim() === "") return undefined;
    const n = Number.parseInt(port, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [port]);
  const jobsNum = useMemo(() => {
    if (jobs.trim() === "") return undefined;
    const n = Number.parseInt(jobs, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [jobs]);

  const generated = useMemo(    () =>
      buildRepackCommand({
        host,
        port: portNum,
        database: db,
        schema,
        table,
        jobs: jobsNum,
        noSuperuserCheck,
        onlyIndexes,
      }),
    [host, portNum, db, schema, table, jobsNum, noSuperuserCheck, onlyIndexes],
);

  if (!open) return null;

  const handleCopy = (): void => {
    const cmd = generated;
    void navigator.clipboard.writeText(cmd);
    const truncated = cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd;
    // eslint-disable-next-line no-alert
    alert(`Copied: ${truncated}`);
  };

  return (    <RadixDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="q-backdrop" />
        <RadixDialog.Content
          className="q-modal md"
          data-testid="repack-dialog"
          style={{
            padding: 20,
            minWidth: 520,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <RadixDialog.Title className="q-modal-title">
            {`Repack table: ${schema}.${table}`}
          </RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Pre-flight check + generate-command + active-jobs monitor for pg_repack.
          </RadixDialog.Description>

          {/* Section 1: Pre-flight check */}
          <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={sectionTitle}>Pre-flight check</div>
            {preflightLoading ? (              <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Running pre-flight check…</p>
) : preflight ? (              <>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
                  <li>{`Has primary key: ${preflight.hasPk ? "✓" : "✗"}`}</li>
                  <li>{`Total size: ${preflight.tableSize}`}</li>
                  <li>{`Index count: ${preflight.indexCount}`}</li>
                  <li>{`Foreign-key count: ${preflight.fkCount}`}</li>
                </ul>
                {!preflight.hasPk ? (                  <div
                    role="alert"
                    style={{
                      padding: 8,
                      background: "var(--bg-warn, #3a2a18)",
                      color: "var(--ink-warn, #ffb86b)",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    pg_repack requires a primary key — operation will fail without one.
                  </div>
) : null}
              </>
) : (              <p style={{ fontSize: 12, color: "var(--ink-3)" }}>
                Pre-flight check unavailable (permission denied or table missing).
              </p>
)}
          </section>

          {/* Section 2: Generate command */}
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={sectionTitle}>Generate command</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={fieldLabel}>
                <span>Host</span>
                <input
                  type="text"
                  data-testid="repack-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </label>
              <label style={fieldLabel}>
                <span>Port</span>
                <input
                  type="number"
                  data-testid="repack-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </label>
              <label style={fieldLabel}>
                <span>Database</span>
                <input
                  type="text"
                  data-testid="repack-database"
                  value={db}
                  onChange={(e) => setDb(e.target.value)}
                />
              </label>
              <label style={fieldLabel}>
                <span>Jobs (optional)</span>
                <input
                  type="number"
                  data-testid="repack-jobs"
                  value={jobs}
                  onChange={(e) => setJobs(e.target.value)}
                  placeholder=""
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  data-testid="repack-no-superuser-check"
                  checked={noSuperuserCheck}
                  onChange={(e) => setNoSuperuserCheck(e.target.checked)}
                />
                <span>--no-superuser-check</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  data-testid="repack-only-indexes"
                  checked={onlyIndexes}
                  onChange={(e) => setOnlyIndexes(e.target.checked)}
                />
                <span>--only-indexes</span>
              </label>
            </div>
            <textarea
              data-testid="repack-command"
              readOnly
              value={generated}
              rows={2}
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
                padding: 6,
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <p style={{ fontSize: 11, color: "var(--ink-3)", margin: 0, flex: 1 }}>
                Run this command in your terminal. ide99 does not invoke pg_repack directly to avoid
                Tauri-side binary execution surface.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="repack-copy"
                onClick={handleCopy}
              >
                Copy to clipboard
              </button>
            </div>
          </section>

          {/* Section 3: Active jobs monitor */}
          <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={sectionTitle}>Active jobs</div>
            {jobsState.kind === "error" ? (              <p style={{ fontSize: 12, color: "var(--ink-3)" }}>No repack history available.</p>
) : jobsState.kind === "loading" ? (              <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading active jobs…</p>
) : jobsState.jobs.length === 0 ? (              <p style={{ fontSize: 12, color: "var(--ink-3)" }}>No active repack jobs.</p>
) : (              <table
                data-testid="repack-active-jobs"
                style={{ fontSize: 12, borderCollapse: "collapse" }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "2px 8px" }}>Start time</th>
                    <th style={{ textAlign: "left", padding: "2px 8px" }}>PID</th>
                    <th style={{ textAlign: "left", padding: "2px 8px" }}>Table name</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsState.jobs.map((job, idx) => (                    <tr key={`${job.pid}-${idx}`}>
                      <td style={{ padding: "2px 8px" }}>{job.startTime}</td>
                      <td style={{ padding: "2px 8px" }}>{job.pid}</td>
                      <td style={{ padding: "2px 8px" }}>{job.tableName}</td>
                    </tr>
))}
                </tbody>
              </table>
)}
          </section>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
);
}
