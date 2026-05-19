import { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type PlanDiffSide, type PlanDiffTab, useEditor } from "../../store";
import { QuietPlanCanvas } from "../QuietPlanCanvas";
import { type PlanDiff, diffPlans } from "../planDiff";
import { buildNodeLabel, nodeAtPath } from "../planNodeUtils";
import { PlanDiffPanel } from "./PlanDiffPanel";
import { PlanDiffSummary } from "./PlanDiffSummary";
import { PlanDiffToolbar } from "./PlanDiffToolbar";
import { type LoadedSide, PlanGoneError, PlanParseError, loadDiffSide } from "./loadDiffSide";

interface PlanDiffPaneProps {
  tabId: string;
}

interface SideState {
  status: "loading" | "loaded" | "gone" | "parse_error" | "error";
  loaded: LoadedSide | null;
  errorMessage?: string;
}

const INITIAL_SIDE: SideState = { status: "loading", loaded: null };

/**
 * — host for a PlanDiffTab. Resolves both sides via
 * `loadDiffSide`, computes `diffPlans` once both are ready, then renders
 * the toolbar / summary / two pev2 instances / panel layout. Failures on
 * either side render placeholders per spec §7.6.
 */
export function PlanDiffPane({ tabId }: PlanDiffPaneProps): JSX.Element {
  const { t } = useTranslation();
  const tab = useEditor((s) =>
    s.tabs.find((x): x is PlanDiffTab => x.id === tabId && x.kind === "plan-diff"),
  );

  const [leftState, setLeftState] = useState<SideState>(INITIAL_SIDE);
  const [rightState, setRightState] = useState<SideState>(INITIAL_SIDE);
  const [hlLeft, setHlLeft] = useState<string | null>(null);
  const [hlRight, setHlRight] = useState<string | null>(null);
  const [activePickKey, setActivePickKey] = useState<string | null>(null);

  const leftSide: PlanDiffSide | null = tab?.left ?? null;
  const rightSide: PlanDiffSide | null = tab?.right ?? null;

  // Reload sides whenever the diff target changes.
  useEffect(() => {
    if (!leftSide) return;
    let cancelled = false;
    setLeftState(INITIAL_SIDE);
    loadDiffSide(leftSide, "left")
      .then((loaded) => {
        if (!cancelled) setLeftState({ status: "loaded", loaded });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof PlanGoneError) {
          setLeftState({ status: "gone", loaded: null });
        } else if (err instanceof PlanParseError) {
          setLeftState({ status: "parse_error", loaded: null });
        } else {
          setLeftState({
            status: "error",
            loaded: null,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [leftSide]);

  useEffect(() => {
    if (!rightSide) return;
    let cancelled = false;
    setRightState(INITIAL_SIDE);
    loadDiffSide(rightSide, "right")
      .then((loaded) => {
        if (!cancelled) setRightState({ status: "loaded", loaded });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof PlanGoneError) {
          setRightState({ status: "gone", loaded: null });
        } else if (err instanceof PlanParseError) {
          setRightState({ status: "parse_error", loaded: null });
        } else {
          setRightState({
            status: "error",
            loaded: null,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rightSide]);

  const diff: PlanDiff | null = useMemo(() => {
    if (leftState.status !== "loaded" || rightState.status !== "loaded") return null;
    if (!leftState.loaded || !rightState.loaded) return null;
    return diffPlans(leftState.loaded.planJson, rightState.loaded.planJson);
  }, [leftState, rightState]);

  // — resolve picked-row paths into per-side canonical labels
  // (using the same buildNodeLabel that QuietPlanCanvas matches against)
  // so highlight wires up regardless of node-type changes.
  const onPickDiff = useCallback<React.ComponentProps<typeof PlanDiffPanel>["onPick"]>(
    (pick) => {
      const leftPlan = leftState.loaded?.planJson ?? null;
      const rightPlan = rightState.loaded?.planJson ?? null;
      if (pick.kind === "matched") {
        const lNode = leftPlan ? nodeAtPath(leftPlan, pick.row.leftPath) : null;
        const rNode = rightPlan ? nodeAtPath(rightPlan, pick.row.rightPath) : null;
        const next = pick.row.identityKey === activePickKey ? null : pick.row.identityKey;
        setActivePickKey(next);
        setHlLeft(next && lNode ? buildNodeLabel(lNode) : null);
        setHlRight(next && rNode ? buildNodeLabel(rNode) : null);
        return;
      }
      const node =
        pick.kind === "added"
          ? rightPlan
            ? nodeAtPath(rightPlan, pick.row.path)
            : null
          : leftPlan
            ? nodeAtPath(leftPlan, pick.row.path)
            : null;
      const next = pick.row.identityKey === activePickKey ? null : pick.row.identityKey;
      setActivePickKey(next);
      if (pick.kind === "added") {
        setHlLeft(null);
        setHlRight(next && node ? buildNodeLabel(node) : null);
      } else {
        setHlLeft(next && node ? buildNodeLabel(node) : null);
        setHlRight(null);
      }
    },
    [leftState, rightState, activePickKey],
  );

  if (!tab) {
    return <div data-testid="plan-diff-pane-missing" />;
  }

  const bothBad =
    (leftState.status === "gone" || leftState.status === "parse_error") &&
    (rightState.status === "gone" || rightState.status === "parse_error");

  if (bothBad) {
    const key =
      leftState.status === "parse_error" || rightState.status === "parse_error"
        ? "editor.explain.diff.placeholder.parse_error"
        : "editor.explain.diff.placeholder.both_gone";
    return (
      <div
        data-testid="plan-diff-pane"
        style={{ display: "flex", flexDirection: "column", height: "100%", padding: 16 }}
      >
        <div data-testid="plan-diff-placeholder-both" style={{ opacity: 0.7 }}>
          {t(key)}
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void useEditor.getState().closeTab(tabId)}
          style={{ marginTop: 12, alignSelf: "flex-start" }}
        >
          {t("editor.explain.diff.placeholder.close")}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="plan-diff-pane"
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
      <PlanDiffToolbar
        tabId={tabId}
        left={tab.left}
        right={tab.right}
        leftLabel={leftState.loaded?.shortLabel ?? "—"}
        rightLabel={rightState.loaded?.shortLabel ?? "—"}
      />
      {diff ? <PlanDiffSummary diff={diff} /> : null}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid var(--hairline)",
          }}
          data-testid="plan-diff-left"
        >
          {leftState.status === "loaded" && leftState.loaded ? (
            <QuietPlanCanvas
              plan={leftState.loaded.planJson}
              highlight={hlLeft}
              onSelect={(label) => setHlLeft(label)}
            />
          ) : leftState.status === "gone" ? (
            <SidePlaceholder
              testId="plan-diff-left-gone"
              text={t("editor.explain.diff.placeholder.left_gone")}
              onClose={() => void useEditor.getState().closeTab(tabId)}
              closeText={t("editor.explain.diff.placeholder.close")}
            />
          ) : leftState.status === "parse_error" ? (
            <SidePlaceholder
              testId="plan-diff-left-parse-error"
              text={t("editor.explain.diff.placeholder.parse_error")}
            />
          ) : (
            <SkeletonSide />
          )}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
          data-testid="plan-diff-right"
        >
          {rightState.status === "loaded" && rightState.loaded ? (
            <QuietPlanCanvas
              plan={rightState.loaded.planJson}
              highlight={hlRight}
              onSelect={(label) => setHlRight(label)}
            />
          ) : rightState.status === "gone" ? (
            <SidePlaceholder
              testId="plan-diff-right-gone"
              text={t("editor.explain.diff.placeholder.right_gone")}
              onClose={() => void useEditor.getState().closeTab(tabId)}
              closeText={t("editor.explain.diff.placeholder.close")}
            />
          ) : rightState.status === "parse_error" ? (
            <SidePlaceholder
              testId="plan-diff-right-parse-error"
              text={t("editor.explain.diff.placeholder.parse_error")}
            />
          ) : (
            <SkeletonSide />
          )}
        </div>
      </div>
      {diff ? (
        <PlanDiffPanel
          diff={diff}
          activeKey={activePickKey}
          onPick={onPickDiff}
          leftPlan={leftState.loaded?.planJson}
          rightPlan={rightState.loaded?.planJson}
        />
      ) : null}
    </div>
  );
}

function SkeletonSide(): JSX.Element {
  return (
    <div data-testid="plan-diff-side-loading" style={{ flex: 1, padding: 16, opacity: 0.5 }}>
      …
    </div>
  );
}

function SidePlaceholder({
  testId,
  text,
  onClose,
  closeText,
}: {
  testId: string;
  text: string;
  onClose?: () => void;
  closeText?: string;
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      style={{
        flex: 1,
        padding: 16,
        opacity: 0.7,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span>{text}</span>
      {onClose && closeText ? (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onClose}
          style={{ alignSelf: "flex-start" }}
        >
          {closeText}
        </button>
      ) : null}
    </div>
  );
}
