// — owner: .
//
// VectorIndexWizard — modal that surfaces the recommendation engine and
// lets the user override method and tuning parameters before committing.
// Designed to be opened from `IndexEditor` when the connected DB has the
// `vector` extension installed; emits an `IndexForm` patch (method +
// withOptions) which the IndexEditor merges into its current form state.
//
// Behaviour:
// - When `open === false`, returns null (no modal markup).
// - When `open === true`, renders a Radix Dialog. The opening recommendation
// is computed once on mount via `recommend({ rowCount, dim })`.
// - Toggling the method radio resets the WITH-options to that method's
// defaults (HNSW: {m, ef_construction}, IVFFlat: {lists}). The lists
// default mirrors the recommender's IVFFlat formula so users see the
// same value the engine would suggest.

import * as Dialog from "@radix-ui/react-dialog";
import { type JSX, useMemo, useState } from "react";
import type { IndexForm } from "../object-editor/ddl/types";
import { type Recommendation, recommend } from "./vectorIndexRecommender";

export interface VectorIndexWizardProps {
  open: boolean;
  rowCount: number;
  dim: number;
  onCancel: () => void;
  onApply: (patch: Pick<IndexForm, "method" | "withOptions">) => void;
}

type Method = "hnsw" | "ivfflat";

/**
 * Default WITH-options for each method, given the table size. HNSW uses the
 * recommender's small-table defaults regardless of rowCount when the user
 * manually picks HNSW (a deliberate override should start somewhere sane).
 * IVFFlat uses the recommender's lists formula for the current rowCount.
 */
function defaultsFor(method: Method, rowCount: number, dim: number): Record<string, number> {
  if (method === "hnsw") {
    // Reuse recommender output when HNSW is the recommended method, otherwise
    // fall back to the small-table defaults — manual HNSW selection on a
    // huge table doesn't have a documented preset, so {m=16, ef_construction=64}
    // is a safe starting point.
    const r = recommend({ rowCount, dim });
    if (r.method === "hnsw") return { ...r.params };
    return { m: 16, ef_construction: 64 };
  }
  // IVFFlat — borrow the recommender's lists formula.
  const r = recommend({ rowCount: Math.max(rowCount, 1), dim: 3001 });
  return { ...r.params };
}

export function VectorIndexWizard(props: VectorIndexWizardProps): JSX.Element | null {
  const { open, rowCount, dim, onCancel, onApply } = props;

  if (!open) return null;

  return <WizardBody rowCount={rowCount} dim={dim} onCancel={onCancel} onApply={onApply} />;
}

function WizardBody(props: {
  rowCount: number;
  dim: number;
  onCancel: () => void;
  onApply: (patch: Pick<IndexForm, "method" | "withOptions">) => void;
}): JSX.Element {
  const { rowCount, dim, onCancel, onApply } = props;

  // Stable seed: compute the recommendation once. We don't reseed when props
  // change — the wizard is a one-shot modal whose lifecycle is controlled by
  // the parent's `open` flag.
  const initial: Recommendation = useMemo(() => recommend({ rowCount, dim }), [rowCount, dim]);

  const [method, setMethod] = useState<Method>(initial.method);
  const [params, setParams] = useState<Record<string, number>>({ ...initial.params });

  const switchMethod = (next: Method): void => {
    if (next === method) return;
    setMethod(next);
    setParams(defaultsFor(next, rowCount, dim));
  };

  const setParam = (key: string, value: number): void => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleApply = (): void => {
    onApply({ method, withOptions: { ...params } });
  };

  return (
    <Dialog.Root
      open={true}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 100,
          }}
        />
        <Dialog.Content
          data-testid="vector-index-wizard"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "var(--bg, #fff)",
            border: "1px solid var(--hairline)",
            borderRadius: 6,
            padding: 20,
            minWidth: 420,
            maxWidth: 560,
            zIndex: 101,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            fontSize: 13,
          }}
        >
          <Dialog.Title style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            Vector Index Wizard
          </Dialog.Title>
          <Dialog.Description style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
            Recommends HNSW or IVFFlat based on table size and dimensionality. You can override the
            choice and tuning before applying.
          </Dialog.Description>

          <section
            style={{
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              Recommendation: <strong>{initial.method.toUpperCase()}</strong> with{" "}
              {Object.entries(initial.params)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")}
            </div>
            <p data-testid="wizard-rationale" style={{ margin: 0, fontSize: 12 }}>
              {initial.rationale}
            </p>
          </section>

          <fieldset
            style={{
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              padding: 6,
              margin: 0,
            }}
          >
            <legend style={{ fontSize: 12, padding: "0 4px" }}>Method</legend>
            <label style={{ marginRight: 16 }}>
              <input
                type="radio"
                name="vector-index-wizard-method"
                data-testid="wizard-method-hnsw"
                value="hnsw"
                checked={method === "hnsw"}
                onChange={() => switchMethod("hnsw")}
              />{" "}
              HNSW
            </label>
            <label>
              <input
                type="radio"
                name="vector-index-wizard-method"
                data-testid="wizard-method-ivfflat"
                value="ivfflat"
                checked={method === "ivfflat"}
                onChange={() => switchMethod("ivfflat")}
              />{" "}
              IVFFlat
            </label>
          </fieldset>

          {method === "hnsw" ? (
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
                m
                <input
                  data-testid="wizard-param-m"
                  type="number"
                  min={2}
                  value={params.m ?? 16}
                  onChange={(e) => setParam("m", Number(e.target.value))}
                  style={{ width: 96 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
                ef_construction
                <input
                  data-testid="wizard-param-ef_construction"
                  type="number"
                  min={4}
                  value={params.ef_construction ?? 64}
                  onChange={(e) => setParam("ef_construction", Number(e.target.value))}
                  style={{ width: 120 }}
                />
              </label>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
                lists
                <input
                  data-testid="wizard-param-lists"
                  type="number"
                  min={1}
                  value={params.lists ?? 100}
                  onChange={(e) => setParam("lists", Number(e.target.value))}
                  style={{ width: 120 }}
                />
              </label>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              data-testid="wizard-cancel"
              onClick={onCancel}
              style={{ padding: "4px 12px" }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="wizard-apply"
              onClick={handleApply}
              style={{ padding: "4px 12px", fontWeight: 600 }}
            >
              Apply
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
