import { type JSX, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { computeInsights } from "../insights";
import {
  type PlanNodeRecord,
  asNumber,
  asString,
  blocksToBytes,
  buildNodeLabel,
  buildShortMeta,
  classifySeverity,
  collectChildren,
  isPlanNode,
  prettyBytes,
  readBuffers,
} from "../planNodeUtils";

interface NodesTableProps {
  plan: unknown;
  onSelectLabel?: (label: string | null) => void;
  /** Current highlight from the host. Lets the row button toggle to its
   * "✓ highlighted" state in-place — the modal stays open so the user
   * keeps the table context while the canvas behind absorbs the change. */
  highlight?: string | null;
}

interface FlatRow {
  idx: number;
  depth: number;
  label: string;
  nodeType: string;
  relation: string | null;
  exclusiveMs: number | null;
  totalMs: number | null;
  rowsActual: number | null;
  rowsPlanned: number | null;
  cost: number;
  buffers: number | null;
  meta: string | null;
  severity: "ok" | "hot" | "crit";
  node: PlanNodeRecord;
}

type SortKey = "idx" | "type" | "exclusiveMs" | "totalMs" | "rows" | "cost" | "buffers";

const COL_COUNT = 7;

function flatten(plan: unknown): FlatRow[] {
  if (!Array.isArray(plan) || plan.length === 0) return [];
  const root = (plan[0] as { Plan?: unknown }).Plan;
  if (!isPlanNode(root)) return [];
  const out: FlatRow[] = [];
  let cursor = 0;
  const walk = (node: PlanNodeRecord, depth: number): void => {
    cursor++;
    const totalMs = asNumber(node["Actual Total Time"]);
    let childTotal = 0;
    for (const c of collectChildren(node)) {
      const ct = asNumber(c["Actual Total Time"]);
      if (ct !== null) childTotal += ct;
    }
    const exclusiveMs = totalMs !== null ? Math.max(0, totalMs - childTotal) : null;
    const buffers = readBuffers(node);
    out.push({
      idx: cursor,
      depth,
      label: buildNodeLabel(node),
      nodeType: asString(node["Node Type"]) ?? "Unknown",
      relation: asString(node["Relation Name"]),
      exclusiveMs,
      totalMs,
      rowsActual: asNumber(node["Actual Rows"]),
      rowsPlanned: asNumber(node["Plan Rows"]),
      cost: asNumber(node["Total Cost"]) ?? 0,
      buffers: buffers ? buffers.total : null,
      meta: buildShortMeta(node),
      severity: classifySeverity(node),
      node,
    });
    for (const child of collectChildren(node)) walk(child, depth + 1);
  };
  walk(root, 0);
  return out;
}

function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function shortDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 10) return `${ms.toFixed(0)}ms`;
  return `${ms.toFixed(2)}ms`;
}

/**
 * — sortable flat table of every plan node, with expand-on-row
 * to show full per-node details inline (timing, rows, conditions, output,
 * buffers, parallel workers). Click toggles expand; a "Highlight in plan"
 * button inside the expanded panel bubbles back to the host DAG.
 */
export function NodesTable({ plan, onSelectLabel, highlight }: NodesTableProps): JSX.Element {
  const [sortBy, setSortBy] = useState<SortKey>("exclusiveMs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const rows = useMemo(() => flatten(plan), [plan]);
  const insights = useMemo(() => computeInsights(plan), [plan]);
  const severityByLabel = useMemo(() => {
    const m = new Map<string, "hot" | "crit">();
    for (const ins of insights) {
      const sev: "hot" | "crit" = ins.severity === "high" ? "crit" : "hot";
      const cur = m.get(ins.nodeLabel);
      if (cur === "crit") continue;
      m.set(ins.nodeLabel, sev);
    }
    return m;
  }, [insights]);

  const annotated = rows.map((r) => ({
    ...r,
    severity: severityByLabel.get(r.label) ?? r.severity,
  }));

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...annotated];
    arr.sort((a, b) => {
      switch (sortBy) {
        case "idx":
          return (a.idx - b.idx) * dir;
        case "type":
          return a.nodeType.localeCompare(b.nodeType) * dir;
        case "exclusiveMs":
          return ((a.exclusiveMs ?? 0) - (b.exclusiveMs ?? 0)) * dir;
        case "totalMs":
          return ((a.totalMs ?? 0) - (b.totalMs ?? 0)) * dir;
        case "rows":
          return ((a.rowsActual ?? 0) - (b.rowsActual ?? 0)) * dir;
        case "cost":
          return (a.cost - b.cost) * dir;
        case "buffers":
          return ((a.buffers ?? 0) - (b.buffers ?? 0)) * dir;
        default:
          return 0;
      }
    });
    return arr;
  }, [annotated, sortBy, sortDir]);

  function clickSort(k: SortKey): void {
    if (k === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(k);
      setSortDir(k === "type" || k === "idx" ? "asc" : "desc");
    }
  }

  function toggleExpand(idx: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="nodes-table-empty"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-4)",
          fontSize: 12,
        }}
      >
        План пуст
      </div>
    );
  }

  return (
    <div
      data-testid="nodes-table"
      className="q-scroll"
      style={{ flex: 1, minHeight: 0, overflow: "auto" }}
    >
      <table className="q-tbl" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <SortHeader k="idx" sortBy={sortBy} sortDir={sortDir} onClick={clickSort} width={64}>
              #
            </SortHeader>
            <SortHeader k="type" sortBy={sortBy} sortDir={sortDir} onClick={clickSort}>
              узел
            </SortHeader>
            <SortHeader
              k="exclusiveMs"
              sortBy={sortBy}
              sortDir={sortDir}
              onClick={clickSort}
              align="right"
              width={92}
            >
              own time
            </SortHeader>
            <SortHeader
              k="totalMs"
              sortBy={sortBy}
              sortDir={sortDir}
              onClick={clickSort}
              align="right"
              width={92}
            >
              total time
            </SortHeader>
            <SortHeader
              k="rows"
              sortBy={sortBy}
              sortDir={sortDir}
              onClick={clickSort}
              align="right"
              width={150}
            >
              rows actual / planned
            </SortHeader>
            <SortHeader
              k="cost"
              sortBy={sortBy}
              sortDir={sortDir}
              onClick={clickSort}
              align="right"
              width={92}
            >
              cost
            </SortHeader>
            <SortHeader
              k="buffers"
              sortBy={sortBy}
              sortDir={sortDir}
              onClick={clickSort}
              align="right"
              width={88}
            >
              buffers
            </SortHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const ratio = ratioOf(r.rowsActual, r.rowsPlanned);
            const sevTone =
              r.severity === "crit"
                ? "var(--danger-q)"
                : r.severity === "hot"
                  ? "var(--warn-q)"
                  : null;
            const isOpen = expanded.has(r.idx);
            return (
              <NodeRow
                key={`${r.idx}-${r.label}`}
                r={r}
                isOpen={isOpen}
                isHighlighted={highlight === r.label}
                ratio={ratio}
                sevTone={sevTone}
                onToggle={() => toggleExpand(r.idx)}
                onHighlight={() => {
                  // Toggle: clicking the active row clears the highlight,
                  // clicking an inactive row sets it. Modal stays open —
                  // the button label switches to "✓ highlighted" so the
                  // user gets feedback without losing table context.
                  onSelectLabel?.(highlight === r.label ? null : r.label);
                }}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface NodeRowProps {
  r: FlatRow;
  isOpen: boolean;
  isHighlighted: boolean;
  ratio: { label: string; tone: "warn" | "crit" } | null;
  sevTone: string | null;
  onToggle(): void;
  onHighlight(): void;
}

function NodeRow({
  r,
  isOpen,
  isHighlighted,
  ratio,
  sevTone,
  onToggle,
  onHighlight,
}: NodeRowProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: row-click toggles expand; the chevron column gives keyboard users a focusable button */}
      <tr
        data-testid={`nodes-table-row-${r.idx}`}
        data-expanded={isOpen}
        data-highlighted={isHighlighted}
        onClick={onToggle}
        style={{
          cursor: "pointer",
          background: isHighlighted ? "var(--brand-q-soft)" : undefined,
          boxShadow: isHighlighted ? "inset 2px 0 0 var(--brand-q)" : undefined,
        }}
      >
        <td className="num" style={{ color: "var(--ink-4)" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={
              isOpen
                ? t("editor.explain.nodes_table.collapse")
                : t("editor.explain.nodes_table.expand")
            }
            aria-expanded={isOpen}
            data-testid={`nodes-table-row-${r.idx}-toggle`}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--ink-4)",
            }}
          >
            <span
              style={{
                display: "inline-block",
                fontSize: 10,
                width: 10,
                transition: "transform 120ms",
                transform: isOpen ? "rotate(90deg)" : "none",
              }}
            >
              ▶
            </span>
            #{r.idx}
          </button>
        </td>
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {sevTone ? (
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: sevTone,
                  flex: "0 0 6px",
                }}
              />
            ) : (
              <span style={{ width: 6, flex: "0 0 6px" }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                {r.nodeType}
                {r.relation ? (
                  <span
                    style={{
                      color: "var(--ink-4)",
                      marginLeft: 6,
                      fontFamily: "var(--font-mono-q)",
                      fontSize: 11,
                    }}
                  >
                    on {r.relation}
                  </span>
                ) : null}
              </span>
              {r.meta ? (
                <span
                  style={{
                    color: "var(--ink-4)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono-q)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 480,
                  }}
                >
                  {r.meta}
                </span>
              ) : null}
            </div>
          </div>
        </td>
        <td className="num" data-testid={`nodes-table-row-${r.idx}-exclusive`}>
          {r.exclusiveMs != null ? shortDuration(r.exclusiveMs) : "—"}
        </td>
        <td className="num">{r.totalMs != null ? shortDuration(r.totalMs) : "—"}</td>
        <td className="num">
          {r.rowsActual != null ? shortNumber(r.rowsActual) : "—"}
          <span style={{ color: "var(--ink-5)" }}>
            {" / "}
            {r.rowsPlanned != null ? shortNumber(r.rowsPlanned) : "—"}
          </span>
          {ratio ? (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 999,
                background: ratio.tone === "crit" ? "var(--danger-q-soft)" : "var(--warn-q-soft)",
                color: ratio.tone === "crit" ? "var(--danger-q)" : "var(--warn-q)",
              }}
            >
              {ratio.label}
            </span>
          ) : null}
        </td>
        <td
          className="num"
          style={{ color: r.severity === "crit" ? "var(--danger-q)" : "var(--ink)" }}
        >
          {r.cost.toFixed(2)}
        </td>
        <td className="num" style={{ color: "var(--ink-3)" }}>
          {r.buffers != null ? shortNumber(r.buffers) : "—"}
        </td>
      </tr>
      {isOpen ? (
        <tr data-testid={`nodes-table-row-${r.idx}-detail`}>
          <td
            colSpan={COL_COUNT}
            style={{
              padding: 0,
              background: "var(--bg-sunken)",
              borderBottom: "1px solid var(--hairline)",
            }}
          >
            <NodeDetailRow node={r.node} isHighlighted={isHighlighted} onHighlight={onHighlight} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function NodeDetailRow({
  node,
  isHighlighted,
  onHighlight,
}: {
  node: PlanNodeRecord;
  isHighlighted: boolean;
  onHighlight(): void;
}): JSX.Element {
  const { t } = useTranslation();
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
  const sortMethod = asString(node["Sort Method"]);
  const sortSpaceUsed = asNumber(node["Sort Space Used"]);
  const indexName = asString(node["Index Name"]);
  const schema = asString(node.Schema);
  const relation = asString(node["Relation Name"]);
  const alias = asString(node.Alias);
  const workersLaunched = asNumber(node["Workers Launched"]);
  const workersPlanned = asNumber(node["Workers Planned"]);
  const output = node.Output;
  const rowsRemoved = asNumber(node["Rows Removed by Filter"]);
  const heapFetches = asNumber(node["Heap Fetches"]);
  const neverExec = actualLoops === 0;

  return (
    <div
      style={{
        padding: "12px 16px 14px 40px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "16px 24px",
      }}
    >
      {neverExec ? (
        <DetailGroup title="status">
          <Kv label="">∅ Never executed</Kv>
        </DetailGroup>
      ) : null}

      {relation ? (
        <DetailGroup title="relation">
          {schema ? <Kv label="schema">{schema}</Kv> : null}
          <Kv label="table">{relation}</Kv>
          {alias && alias !== relation ? <Kv label="alias">{alias}</Kv> : null}
          {indexName ? <Kv label="index">{indexName}</Kv> : null}
        </DetailGroup>
      ) : null}

      <DetailGroup title="timing">
        {actualTotal != null ? <Kv label="total">{actualTotal.toFixed(3)} ms</Kv> : null}
        {actualStartup != null ? <Kv label="startup">{actualStartup.toFixed(3)} ms</Kv> : null}
        {actualLoops != null ? <Kv label="loops">{actualLoops.toLocaleString()}</Kv> : null}
      </DetailGroup>

      <DetailGroup title="rows">
        {actualRows != null ? <Kv label="actual">{actualRows.toLocaleString()}</Kv> : null}
        {planRows != null ? <Kv label="planned">{planRows.toLocaleString()}</Kv> : null}
        {rowsRemoved != null ? <Kv label="filtered">{rowsRemoved.toLocaleString()}</Kv> : null}
        {planWidth != null ? <Kv label="width">{planWidth} B</Kv> : null}
      </DetailGroup>

      <DetailGroup title="cost">
        {totalCost != null ? <Kv label="total">{totalCost.toFixed(2)}</Kv> : null}
        {startupCost != null ? <Kv label="startup">{startupCost.toFixed(2)}</Kv> : null}
      </DetailGroup>

      {buffers ? (
        <DetailGroup title="buffers">
          {buffers.hit > 0 ? (
            <Kv label="hit">
              {buffers.hit.toLocaleString()} ({prettyBytes(blocksToBytes(buffers.hit))})
            </Kv>
          ) : null}
          {buffers.read > 0 ? (
            <Kv label="read">
              {buffers.read.toLocaleString()} ({prettyBytes(blocksToBytes(buffers.read))})
            </Kv>
          ) : null}
          {buffers.dirtied > 0 ? <Kv label="dirtied">{buffers.dirtied.toLocaleString()}</Kv> : null}
          {buffers.written > 0 ? <Kv label="written">{buffers.written.toLocaleString()}</Kv> : null}
          {heapFetches != null ? <Kv label="heap">{heapFetches.toLocaleString()}</Kv> : null}
        </DetailGroup>
      ) : null}

      {indexCond || hashCond || joinFilter || filter ? (
        <DetailGroup title="conditions" wide>
          {indexCond ? <Kv label="index cond">{indexCond}</Kv> : null}
          {hashCond ? <Kv label="hash cond">{hashCond}</Kv> : null}
          {joinFilter ? <Kv label="join filter">{joinFilter}</Kv> : null}
          {filter ? <Kv label="filter">{filter}</Kv> : null}
        </DetailGroup>
      ) : null}

      {sortMethod || (Array.isArray(sortKey) && sortKey.length > 0) ? (
        <DetailGroup title="sort">
          {Array.isArray(sortKey) && sortKey.length > 0 ? (
            <Kv label="key">{sortKey.join(", ")}</Kv>
          ) : null}
          {sortMethod ? <Kv label="method">{sortMethod}</Kv> : null}
          {sortSpaceUsed != null ? <Kv label="memory">{sortSpaceUsed} kB</Kv> : null}
        </DetailGroup>
      ) : null}

      {workersLaunched != null || workersPlanned != null ? (
        <DetailGroup title="parallel">
          {workersPlanned != null ? <Kv label="planned">{workersPlanned}</Kv> : null}
          {workersLaunched != null ? <Kv label="launched">{workersLaunched}</Kv> : null}
        </DetailGroup>
      ) : null}

      {Array.isArray(output) && output.length > 0 ? (
        <DetailGroup title="output" wide>
          <div
            style={{
              fontFamily: "var(--font-mono-q)",
              fontSize: 11,
              color: "var(--ink-2)",
              wordBreak: "break-all",
              lineHeight: 1.55,
            }}
          >
            {(output as unknown[]).map((c) => String(c)).join(", ")}
          </div>
        </DetailGroup>
      ) : null}

      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          justifyContent: "flex-end",
          paddingTop: 4,
        }}
      >
        <button
          type="button"
          className={`btn btn-sm ${isHighlighted ? "btn-accent" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onHighlight();
          }}
          data-testid="nodes-table-highlight"
          aria-pressed={isHighlighted}
          title={
            isHighlighted
              ? t("editor.explain.nodes_table.highlight_active_title")
              : t("editor.explain.nodes_table.highlight_inactive_title")
          }
        >
          {isHighlighted ? "✓ Подсвечено в плане" : "↗ Подсветить в плане"}
        </button>
      </div>
    </div>
  );
}

function DetailGroup({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}): JSX.Element {
  return (
    <div style={{ minWidth: 0, gridColumn: wide ? "1 / -1" : undefined }}>
      <div
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>{children}</div>
    </div>
  );
}

function Kv({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr",
        gap: 8,
        alignItems: "baseline",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--ink-4)", fontSize: 11 }}>{label}</span>
      <span
        style={{
          color: "var(--ink)",
          fontFamily: "var(--font-mono-q)",
          fontSize: 11.5,
          wordBreak: "break-word",
        }}
      >
        {children}
      </span>
    </div>
  );
}

interface SortHeaderProps {
  k: SortKey;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
}

function SortHeader({
  k,
  sortBy,
  sortDir,
  onClick,
  children,
  align = "left",
  width,
}: SortHeaderProps): JSX.Element {
  const isCurrent = k === sortBy;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: header sort is mouse-only by design
    <th
      onClick={() => onClick(k)}
      style={{
        textAlign: align,
        width,
        cursor: "pointer",
        userSelect: "none",
        color: isCurrent ? "var(--accent-strong)" : undefined,
      }}
      aria-sort={isCurrent ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      data-testid={`nodes-table-sort-${k}`}
    >
      {children}
      {isCurrent ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}

function ratioOf(
  actual: number | null,
  planned: number | null,
): { label: string; tone: "warn" | "crit" } | null {
  if (actual == null || planned == null) return null;
  if (actual === 0 && planned === 0) return null;
  const r = Math.max(actual, 1) / Math.max(planned, 1);
  const inv = Math.max(planned, 1) / Math.max(actual, 1);
  const worst = Math.max(r, inv);
  if (worst < 3) return null;
  return {
    label: `${worst.toFixed(0)}×`,
    tone: worst >= 10 ? "crit" : "warn",
  };
}
