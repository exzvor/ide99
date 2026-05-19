import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useInferredSchema, useJsonbInference } from "../inference";
import { type TreeNode, buildTree } from "../inference/treeBuilder";

import type { Fqn, PathSegment } from "../../../lib/tauri";

import "./InferredSchemaPanel.css";

export interface InferredSchemaPanelProps {
  connId: string;
  fqn: Fqn;
  /**
   * `browser` is rendered as a floating block under the schema tree,
   * `modal` is rendered inside the JSONB editor modal under the diff
   * preview. Both variants share the same internal layout (header +
   * tree); they only differ in container chrome (max-height + margin).
   */
  variant: "browser" | "modal";
  className?: string;
  /** when set, each tree row becomes a clickable <button>. */
  onPathSelect?: (path: PathSegment[]) => void;
  /** highlights the row whose `path` deep-equals this. */
  selectedPath?: PathSegment[];
}

export function InferredSchemaPanel({
  connId,
  fqn,
  variant,
  className,
  onPathSelect,
  selectedPath,
}: InferredSchemaPanelProps): JSX.Element {
  const { t } = useTranslation();
  const entry = useInferredSchema(connId, fqn);
  const invalidate = useJsonbInference((s) => s.invalidate);

  const tree = useMemo(() => {
    if (entry.status === "ready" || entry.status === "stale") {
      return buildTree(entry.schema);
    }
    return null;
  }, [entry]);

  const handleReinfer = (): void => {
    void invalidate(connId, fqn);
  };

  const containerClass = [
    "ide99-jsonb-inference-panel",
    variant === "browser"
      ? "ide99-jsonb-inference-panel--browser"
      : "ide99-jsonb-inference-panel--modal",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const scrollStyle: React.CSSProperties = {
    maxHeight: variant === "browser" ? "320px" : "200px",
    overflowY: "auto",
  };

  // Common region wrapper used by every status branch.
  const Region: React.FC<{ children: React.ReactNode; busy?: boolean }> = ({ children, busy }) => (    <section
      aria-label={t("jsonb.inference.panel.ariaRegion", { column: fqn.column })}
      aria-busy={busy ? "true" : undefined}
      className={containerClass}
      style={scrollStyle}
    >
      {children}
    </section>
);

  if (entry.status === "pending") {
    return (      <Region busy>
        <div className="ide99-jsonb-inference-skeleton">
          <SkeletonRow widthCh={6} />
          <SkeletonRow widthCh={4} />
          <SkeletonRow widthCh={8} />
          <span className="sr-only" aria-live="polite">
            {t("jsonb.inference.panel.statusPending")}
          </span>
        </div>
      </Region>
);
  }

  if (entry.status === "error") {
    return (      <Region>
        <div className="ide99-jsonb-inference-error">
          <span>{t("jsonb.inference.panel.error", { message: entry.message })}</span>
          <button type="button" onClick={handleReinfer}>
            {t("jsonb.inference.panel.retryAction")}
          </button>
        </div>
      </Region>
);
  }

  // ready | stale
  const schema = entry.schema;
  const isStale = entry.status === "stale";

  return (    <Region>
      <Header
        sampleCount={schema.sampleCount}
        keyCount={schema.nodes.length}
        generatedAt={schema.generatedAt}
        isStale={isStale}
        onReinfer={handleReinfer}
        t={t}
      />
      {schema.nodes.length === 0 ? (        <div className="ide99-jsonb-inference-empty">{t("jsonb.inference.panel.empty")}</div>
) : (        // TODO: TanStack Virtual when nodes > 100 (typical case is < 50).
        <ul className="ide99-jsonb-inference-tree" role="tree">
          {tree?.children.map((node) => (            <TreeRow
              key={pathToString(node)}
              node={node}
              depth={0}
              onPathSelect={onPathSelect}
              selectedPath={selectedPath}
            />
))}
        </ul>
)}
    </Region>
);
}

interface HeaderProps {
  sampleCount: number;
  keyCount: number;
  generatedAt: number;
  isStale: boolean;
  onReinfer: () => void;
  t: TFunction;
}

function Header({
  sampleCount,
  keyCount,
  generatedAt,
  isStale,
  onReinfer,
  t,
}: HeaderProps): JSX.Element {
  const agoStr = useMemo(() => formatRelativeTime(generatedAt, t), [generatedAt, t]);
  const rowsStr = t("jsonb.inference.panel.sampledRowsCount", { count: sampleCount });
  const keysStr = t("jsonb.inference.panel.keysCount", { count: keyCount });
  const summary = t("jsonb.inference.panel.headerSummary", {
    title: t("jsonb.inference.panel.title"),
    rows: rowsStr,
    keys: keysStr,
    ago: agoStr,
  });
  return (    <header className="ide99-jsonb-inference-header">
      <span>
        {isStale && (          <span
            className="ide99-jsonb-inference-stale"
            title={t("jsonb.inference.panel.staleTooltip")}
          >
            ⚠ {t("jsonb.inference.panel.staleBadge")} ·{" "}
          </span>
)}
        {summary}
      </span>
      <button type="button" onClick={onReinfer} className="ide99-jsonb-inference-reinfer">
        ↻ {t("jsonb.inference.panel.reinferAction")}
      </button>
    </header>
);
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  onPathSelect?: (path: PathSegment[]) => void;
  selectedPath?: PathSegment[];
}

function TreeRow({ node, depth, onPathSelect, selectedPath }: TreeRowProps): JSX.Element {
  const indent = depth * 16;
  const freqPct = Math.round(node.freq * 100);
  const isPickerMode = onPathSelect !== undefined;
  const isSelected = selectedPath !== undefined && pathsEqual(node.path, selectedPath);

  const rowContent = (    <>
      <span className="ide99-jsonb-inference-label">{node.label}</span>
      <span className="ide99-jsonb-inference-type">{node.typeLabel || ""}</span>
      <span className="ide99-jsonb-inference-freq">{freqPct}%</span>
      <span
        className="ide99-jsonb-inference-freq-rail"
        style={{ width: `${Math.max(2, node.freq * 24)}px` }}
      />
      <span className="ide99-jsonb-inference-samples">
        {node.samples.length > 0
          ? node.samples
              .slice(0, 3)
              .map((s) => JSON.stringify(s))
              .join(", ")
          : ""}
      </span>
    </>
);

  return (    <li role={isPickerMode ? undefined : "treeitem"} style={{ paddingLeft: `${indent}px` }}>
      {isPickerMode ? (        <button
          type="button"
          aria-pressed={isSelected}
          onClick={() => onPathSelect(node.path)}
          className={`ide99-jsonb-inference-row-button${isSelected ? " is-selected" : ""}`}
        >
          <div className="ide99-jsonb-inference-row">{rowContent}</div>
        </button>
) : (        <div className="ide99-jsonb-inference-row">{rowContent}</div>
)}
      {node.children.length > 0 && (        <ul className="ide99-jsonb-inference-children" role={isPickerMode ? undefined : "group"}>
          {node.children.map((child) => (            <TreeRow
              key={pathToString(child)}
              node={child}
              depth={depth + 1}
              onPathSelect={onPathSelect}
              selectedPath={selectedPath}
            />
))}
        </ul>
)}
    </li>
);
}

function SkeletonRow({ widthCh }: { widthCh: number }): JSX.Element {
  return (    <div
      className="ide99-jsonb-inference-skeleton-row"
      aria-hidden="true"
      style={{ width: `${widthCh * 4}ch` }}
    />
);
}

function pathToString(node: TreeNode): string {
  return node.path
    .map((seg) => (typeof seg === "string" ? seg : "key" in seg ? seg.key : "[*]"))
    .join(".");
}

function pathsEqual(a: PathSegment[], b: PathSegment[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av === "arraywildcard" || bv === "arraywildcard") {
      if (av !== bv) return false;
    } else {
      if (av.key !== bv.key) return false;
    }
  }
  return true;
}

function formatRelativeTime(epochMs: number, t: TFunction): string {
  if (epochMs === 0) return t("jsonb.inference.panel.agoUnknown");
  const deltaSec = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (deltaSec < 5) return t("jsonb.inference.panel.agoNow");
  if (deltaSec < 60) return t("jsonb.inference.panel.agoSeconds", { count: deltaSec });
  if (deltaSec < 3600)
    return t("jsonb.inference.panel.agoMinutes", { count: Math.floor(deltaSec / 60) });
  if (deltaSec < 86400)
    return t("jsonb.inference.panel.agoHours", { count: Math.floor(deltaSec / 3600) });
  return t("jsonb.inference.panel.agoDays", { count: Math.floor(deltaSec / 86400) });
}
