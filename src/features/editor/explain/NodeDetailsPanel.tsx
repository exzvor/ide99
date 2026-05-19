import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import {
  type PlanNodeRecord,
  asNumber,
  asString,
  blocksToBytes,
  buildNodeLabel,
  prettyBytes,
  readBuffers,
} from "./planNodeUtils";

interface NodeDetailsPanelProps {
  node: PlanNodeRecord;
  idx: number;
  onClose(): void;
}

interface KvProps {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  tone?: "ok" | "warn" | "crit";
}

function Kv({ label, children, mono = true, tone }: KvProps): JSX.Element {
  const color =
    tone === "crit"
      ? "var(--danger-q)"
      : tone === "warn"
        ? "var(--warn-q)"
        : tone === "ok"
          ? "var(--accent-strong)"
          : "var(--ink)";
  return (    <div
      style={{
        display: "grid",
        gridTemplateColumns: "92px 1fr",
        gap: 8,
        alignItems: "baseline",
        fontSize: 12,
        padding: "3px 0",
      }}
    >
      <span style={{ color: "var(--ink-4)", fontSize: 11 }}>{label}</span>
      <span
        style={{
          color,
          fontFamily: mono ? "var(--font-mono-q)" : "var(--font-sans-q)",
          fontSize: mono ? 11.5 : 12,
          wordBreak: "break-word",
        }}
      >
        {children}
      </span>
    </div>
);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
);
}

function ratioTone(actual: number, planned: number): "ok" | "warn" | "crit" | undefined {
  if (planned === 0) return undefined;
  const ratio = Math.max(actual / planned, planned / actual);
  if (ratio >= 10) return "crit";
  if (ratio >= 3) return "warn";
  return undefined;
}

/**
 * — pev2-equivalent inspector for a single plan node. Renders
 * timing, rows estimation accuracy, buffers, predicates, output, parallel
 * workers — i.e. everything you'd get from clicking a node in pev2 — but
 * in our quiet palette and inside the host React app (no iframe).
 */
export function NodeDetailsPanel({ node, idx, onClose }: NodeDetailsPanelProps): JSX.Element {
  const { t } = useTranslation();
  const nodeType = asString(node["Node Type"]) ?? "Unknown";
  const label = buildNodeLabel(node);
  const totalCost = asNumber(node["Total Cost"]);
  const startupCost = asNumber(node["Startup Cost"]);
  const planRows = asNumber(node["Plan Rows"]);
  const planWidth = asNumber(node["Plan Width"]);
  const actualRows = asNumber(node["Actual Rows"]);
  const actualLoops = asNumber(node["Actual Loops"]);
  const actualTotal = asNumber(node["Actual Total Time"]);
  const actualStartup = asNumber(node["Actual Startup Time"]);
  const buffers = readBuffers(node);
  const filter = asString(node.Filter);
  const indexCond = asString(node["Index Cond"]);
  const hashCond = asString(node["Hash Cond"]);
  const joinFilter = asString(node["Join Filter"]);
  const sortKey = node["Sort Key"];
  const groupKey = node["Group Key"];
  const indexName = asString(node["Index Name"]);
  const relation = asString(node["Relation Name"]);
  const schema = asString(node.Schema);
  const alias = asString(node.Alias);
  const workersLaunched = asNumber(node["Workers Launched"]);
  const workersPlanned = asNumber(node["Workers Planned"]);
  const output = node.Output;
  const rowsRemoved = asNumber(node["Rows Removed by Filter"]);
  const heapFetches = asNumber(node["Heap Fetches"]);
  const sortMethod = asString(node["Sort Method"]);
  const sortSpaceUsed = asNumber(node["Sort Space Used"]);
  const sortSpaceType = asString(node["Sort Space Type"]);
  const neverExecuted = actualLoops === 0;

  return (    <div
      data-testid={`node-details-${idx}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "var(--bg-elev)",
      }}
    >
      <div
        className="q-insight-header"
        style={{ justifyContent: "space-between", flex: "0 0 auto" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ color: "var(--ink-5)", fontSize: 11, fontFamily: "var(--font-mono-q)" }}>
            #{idx}
          </span>
          <span className="ttl">{nodeType}</span>
        </div>
        <button
          type="button"
          className="btn-icon"
          onClick={onClose}
          aria-label={t("editor.explain.node_details.close")}
          data-testid="node-details-close"
        >
          ×
        </button>
      </div>
      <div
        className="q-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {neverExecuted ? (          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "var(--bg-sunken)",
              color: "var(--ink-4)",
              fontSize: 11.5,
            }}
          >
            ∅ Never executed
          </div>
) : null}

        {relation ? (          <Section title="relation">
            <Kv label="schema">{schema ?? "—"}</Kv>
            <Kv label="table">{relation}</Kv>
            {alias && alias !== relation ? <Kv label="alias">{alias}</Kv> : null}
            {indexName ? <Kv label="index">{indexName}</Kv> : null}
          </Section>
) : null}

        <Section title="timing">
          {actualTotal != null ? (            <Kv label="total">{actualTotal.toFixed(3)} ms</Kv>
) : (            <Kv label="total">—</Kv>
)}
          {actualStartup != null ? <Kv label="startup">{actualStartup.toFixed(3)} ms</Kv> : null}
          {actualLoops != null ? <Kv label="loops">{actualLoops.toLocaleString()}</Kv> : null}
        </Section>

        <Section title="rows">
          {actualRows != null ? (            <Kv
              label="actual"
              tone={planRows != null ? ratioTone(actualRows, planRows) : undefined}
            >
              {actualRows.toLocaleString()}
            </Kv>
) : null}
          {planRows != null ? <Kv label="planned">{planRows.toLocaleString()}</Kv> : null}
          {actualRows != null && planRows != null && planRows > 0 ? (            <Kv label="ratio" tone={ratioTone(actualRows, planRows)}>
              {(actualRows / Math.max(planRows, 1)).toFixed(2)}×
            </Kv>
) : null}
          {rowsRemoved != null ? <Kv label="filtered">{rowsRemoved.toLocaleString()}</Kv> : null}
          {planWidth != null ? <Kv label="width">{planWidth} B</Kv> : null}
        </Section>

        <Section title="cost">
          {totalCost != null ? <Kv label="total">{totalCost.toFixed(2)}</Kv> : null}
          {startupCost != null ? <Kv label="startup">{startupCost.toFixed(2)}</Kv> : null}
        </Section>

        {buffers ? (          <Section title="buffers">
            {buffers.hit > 0 ? (              <Kv label="shared hit">
                {buffers.hit.toLocaleString()} ({prettyBytes(blocksToBytes(buffers.hit))})
              </Kv>
) : null}
            {buffers.read > 0 ? (              <Kv label="shared read" tone="warn">
                {buffers.read.toLocaleString()} ({prettyBytes(blocksToBytes(buffers.read))})
              </Kv>
) : null}
            {buffers.dirtied > 0 ? (              <Kv label="dirtied">{buffers.dirtied.toLocaleString()}</Kv>
) : null}
            {buffers.written > 0 ? (              <Kv label="written" tone="crit">
                {buffers.written.toLocaleString()}
              </Kv>
) : null}
            {heapFetches != null ? (              <Kv label="heap fetches">{heapFetches.toLocaleString()}</Kv>
) : null}
          </Section>
) : null}

        {filter || indexCond || hashCond || joinFilter ? (          <Section title="conditions">
            {indexCond ? <Kv label="index cond">{indexCond}</Kv> : null}
            {hashCond ? <Kv label="hash cond">{hashCond}</Kv> : null}
            {joinFilter ? <Kv label="join filter">{joinFilter}</Kv> : null}
            {filter ? <Kv label="filter">{filter}</Kv> : null}
          </Section>
) : null}

        {sortMethod || (Array.isArray(sortKey) && sortKey.length > 0) ? (          <Section title="sort">
            {Array.isArray(sortKey) && sortKey.length > 0 ? (              <Kv label="key">{sortKey.join(", ")}</Kv>
) : null}
            {sortMethod ? <Kv label="method">{sortMethod}</Kv> : null}
            {sortSpaceUsed != null ? (              <Kv label="memory">
                {sortSpaceUsed} kB ({sortSpaceType ?? "—"})
              </Kv>
) : null}
          </Section>
) : null}

        {Array.isArray(groupKey) && groupKey.length > 0 ? (          <Section title="group by">
            <Kv label="keys">{groupKey.join(", ")}</Kv>
          </Section>
) : null}

        {workersLaunched != null || workersPlanned != null ? (          <Section title="parallel">
            {workersPlanned != null ? <Kv label="planned">{workersPlanned}</Kv> : null}
            {workersLaunched != null ? (              <Kv
                label="launched"
                tone={
                  workersPlanned != null && workersLaunched < workersPlanned ? "warn" : undefined
                }
              >
                {workersLaunched}
              </Kv>
) : null}
          </Section>
) : null}

        {Array.isArray(output) && output.length > 0 ? (          <Section title="output">
            <div
              style={{
                fontFamily: "var(--font-mono-q)",
                fontSize: 11,
                color: "var(--ink-2)",
                background: "var(--bg-sunken)",
                padding: "6px 8px",
                borderRadius: 6,
                wordBreak: "break-all",
                lineHeight: 1.55,
              }}
            >
              {(output as unknown[]).map((c, i) => (i === 0 ? `${c}` : `, ${c}`)).join("")}
            </div>
          </Section>
) : null}

        <div style={{ fontSize: 10.5, color: "var(--ink-5)", marginTop: 8 }}>{label}</div>
      </div>
    </div>
);
}
