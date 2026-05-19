// — owner: .
//
// Hybrid Search Builder wizard. Renders a Radix Dialog with form fields for
// the vector + text sides of an RRF query, hands them to `buildHybridSearchSql`
// on submit, and opens the resulting SQL in a new Query Editor tab.
//
// The wizard does **not** auto-run the query — by design, the user reviews
// and runs it manually from the editor tab.

import * as RadixDialog from "@radix-ui/react-dialog";
import { type JSX, useState } from "react";
import { useEditor } from "../editor/store";
import { type VectorValue, VectorValueInput } from "./VectorValueInput";
import { type DistanceOp, buildHybridSearchSql } from "./hybridSearchSql";

export interface HybridSearchWizardProps {
  open: boolean;
  connId: string;
  qualifiedTable: string;
  pk: string;
  vectorColumns: string[];
  textColumns: string[];
  onClose: () => void;
}

/** Convert a `VectorValue` into a SQL pivot expression. Mirrors KnnBrowseDialog. */
function vectorValueToPivotExpr(v: VectorValue): string {
  if (v.mode === "literal") {
    const escaped = v.literal.replace(/'/g, "''");
    return `'${escaped}'::vector`;
  }
  return v.expr;
}

const DISTANCE_OPS: { op: DistanceOp; label: string }[] = [
  { op: "<->", label: "L2 (<->)" },
  { op: "<#>", label: "Inner product (<#>)" },
  { op: "<=>", label: "Cosine (<=>)" },
];

export function HybridSearchWizard(props: HybridSearchWizardProps): JSX.Element | null {
  const { open, connId, qualifiedTable, pk, vectorColumns, textColumns, onClose } = props;

  const [vectorCol, setVectorCol] = useState<string>(vectorColumns[0] ?? "");
  const [textCol, setTextCol] = useState<string>(textColumns[0] ?? "");
  const [distanceOp, setDistanceOp] = useState<DistanceOp>("<->");
  const [pivot, setPivot] = useState<VectorValue>({ mode: "literal", literal: "" });
  const [tsQuery, setTsQuery] = useState<string>("");
  const [wVector, setWVector] = useState<string>("0.5");
  const [wText, setWText] = useState<string>("0.5");
  const [rrfK, setRrfK] = useState<string>("60");
  const [limit, setLimit] = useState<string>("50");

  if (!open) return null;

  const handleSubmit = (): void => {
    const sql = buildHybridSearchSql({
      qualifiedTable,
      pk,
      vectorCol,
      vectorPivotExpr: vectorValueToPivotExpr(pivot),
      tsCol: textCol,
      tsQuery,
      distanceOp,
      weights: {
        vector: Number.parseFloat(wVector),
        text: Number.parseFloat(wText),
      },
      rrfK: Number.parseInt(rrfK, 10),
      limit: Number.parseInt(limit, 10),
    });
    useEditor.getState().openEditorTab(connId, { prefillSql: sql });
    onClose();
  };

  const fieldLabel: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
    gap: 2,
  };

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="q-backdrop" />
        <RadixDialog.Content
          className="q-modal md"
          data-testid="hybrid-search-wizard"
          style={{ padding: 20, minWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <RadixDialog.Title className="q-modal-title">Hybrid Search Builder</RadixDialog.Title>
          <RadixDialog.Description style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Combine pgvector distance with full-text rank via Reciprocal Rank Fusion.
          </RadixDialog.Description>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={fieldLabel}>
              <span>Vector column</span>
              <select
                data-testid="hybrid-vector-col"
                value={vectorCol}
                onChange={(e) => setVectorCol(e.target.value)}
              >
                {vectorColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <fieldset style={{ border: "1px solid var(--hairline)", borderRadius: 4, padding: 6 }}>
              <legend style={{ fontSize: 11, color: "var(--ink-3)" }}>Distance op</legend>
              <div style={{ display: "flex", gap: 12 }}>
                {DISTANCE_OPS.map(({ op, label }) => (
                  <label key={op} style={{ fontSize: 12, display: "flex", gap: 4 }}>
                    <input
                      type="radio"
                      name="hybrid-distance-op"
                      value={op}
                      checked={distanceOp === op}
                      onChange={() => setDistanceOp(op)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Pivot vector</span>
              <VectorValueInput value={pivot} onChange={setPivot} />
            </div>

            <label style={fieldLabel}>
              <span>Text column (tsvector)</span>
              <select
                data-testid="hybrid-text-col"
                value={textCol}
                onChange={(e) => setTextCol(e.target.value)}
              >
                {textColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label style={fieldLabel}>
              <span>Text query</span>
              <input
                type="text"
                data-testid="hybrid-ts-query"
                value={tsQuery}
                onChange={(e) => setTsQuery(e.target.value)}
                placeholder="hello world"
              />
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ ...fieldLabel, flex: 1 }}>
                <span>Vector weight</span>
                <input
                  type="number"
                  step="0.1"
                  data-testid="hybrid-w-vector"
                  value={wVector}
                  onChange={(e) => setWVector(e.target.value)}
                />
              </label>
              <label style={{ ...fieldLabel, flex: 1 }}>
                <span>Text weight</span>
                <input
                  type="number"
                  step="0.1"
                  data-testid="hybrid-w-text"
                  value={wText}
                  onChange={(e) => setWText(e.target.value)}
                />
              </label>
              <label style={{ ...fieldLabel, flex: 1 }}>
                <span>RRF k</span>
                <input
                  type="number"
                  step="1"
                  data-testid="hybrid-rrf-k"
                  value={rrfK}
                  onChange={(e) => setRrfK(e.target.value)}
                />
              </label>
              <label style={{ ...fieldLabel, flex: 1 }}>
                <span>Limit</span>
                <input
                  type="number"
                  step="1"
                  data-testid="hybrid-limit"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="hybrid-submit"
              onClick={handleSubmit}
            >
              Open in editor
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
