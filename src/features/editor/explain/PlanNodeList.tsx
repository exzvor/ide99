import { type JSX, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { computeInsights } from "./insights";
import {
  type PlanNodeRecord,
  asNumber,
  asString,
  buildNodeLabel,
  classifySeverity,
  collectChildren,
  isPlanNode,
} from "./planNodeUtils";

interface PlanNodeListProps {
  plan: unknown;
  highlight: string | null;
  onSelect(label: string | null, node: PlanNodeRecord | null, idx: number | null): void;
}

interface FlatNode {
  idx: number;
  depth: number;
  label: string;
  shortType: string;
  relation: string | null;
  cost: number;
  severity: "ok" | "hot" | "crit";
  node: PlanNodeRecord;
}

function flatten(plan: unknown): FlatNode[] {
  if (!Array.isArray(plan) || plan.length === 0) return [];
  const root = (plan[0] as { Plan?: unknown }).Plan;
  if (!isPlanNode(root)) return [];
  const out: FlatNode[] = [];
  let cursor = 0;
  const walk = (node: PlanNodeRecord, depth: number): void => {
    cursor++;
    const cost = asNumber(node["Total Cost"]) ?? 0;
    const rel = asString(node["Relation Name"]);
    const nodeType = asString(node["Node Type"]) ?? "Unknown";
    out.push({
      idx: cursor,
      depth,
      label: buildNodeLabel(node),
      shortType: nodeType,
      relation: rel,
      cost,
      severity: classifySeverity(node),
      node,
    });
    for (const child of collectChildren(node)) walk(child, depth + 1);
  };
  walk(root, 0);
  return out;
}

/**
 * — left rail of the EXPLAIN visualizer. Lists every plan node
 * sorted by Total Cost descending, with a horizontal cost bar and a
 * severity flag-dot inferred from `computeInsights` + `classifySeverity`
 * fallback. Click → highlights node in canvas + opens its details on the
 * right rail (via the shared onSelect callback).
 */
export function PlanNodeList({ plan, highlight, onSelect }: PlanNodeListProps): JSX.Element | null {
  const { t } = useTranslation();
  const nodes = useMemo(() => flatten(plan), [plan]);
  const insights = useMemo(() => computeInsights(plan), [plan]);

  const severityByLabel = useMemo(() => {
    const map = new Map<string, "hot" | "crit">();
    for (const ins of insights) {
      const cur = map.get(ins.nodeLabel);
      const sev: "hot" | "crit" = ins.severity === "high" ? "crit" : "hot";
      if (cur === "crit") continue;
      map.set(ins.nodeLabel, sev);
    }
    return map;
  }, [insights]);

  if (nodes.length === 0) return null;

  const annotated = nodes.map((n) => {
    const fromInsights = severityByLabel.get(n.label);
    return { ...n, severity: fromInsights ?? n.severity };
  });
  const sorted = [...annotated].sort((a, b) => b.cost - a.cost);
  const maxCost = sorted[0]?.cost || 1;

  return (
    <div data-testid="plan-node-list" className="q-scroll" style={{ overflow: "auto" }}>
      <div
        style={{
          padding: "10px 12px 6px",
          fontSize: 10.5,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {t("editor.explain.node_list.header", {
          count: nodes.length,
          defaultValue: "узлы · {{count}} · по cost",
        })}
      </div>
      <div className="q-plan-tree" style={{ padding: "0 8px 12px" }}>
        {sorted.map((n) => {
          const widthPct = Math.max(2, Math.round((n.cost / maxCost) * 100));
          const isActive = highlight === n.label;
          const sevClass = n.severity === "crit" ? "crit" : n.severity === "hot" ? "hot" : "";
          return (
            <button
              type="button"
              key={`${n.idx}-${n.label}`}
              data-testid={`plan-node-row-${n.idx}`}
              data-severity={n.severity}
              className={`q-plan-node ${sevClass} ${isActive ? "active" : ""}`}
              onClick={() =>
                onSelect(
                  isActive ? null : n.label,
                  isActive ? null : n.node,
                  isActive ? null : n.idx,
                )
              }
              title={n.label}
            >
              <span className="pn-idx">#{n.idx}</span>
              <span className="pn-name">
                <span className="indent">{"└─".repeat(n.depth)}</span>
                {n.shortType}
                {n.relation ? <span className="rel"> {n.relation}</span> : null}
              </span>
              <span className="pn-bar">
                <span style={{ width: `${widthPct}%` }} />
              </span>
              <span className="pn-cost">
                {n.cost.toFixed(2)}
                {n.severity !== "ok" ? <span className="pn-flag" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
