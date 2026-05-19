import * as RadixDialog from "@radix-ui/react-dialog";
// — owner: .
// Modal that gathers the inputs needed to run a kNN browse against a single
// `pgvector` column: a pivot (literal or SQL-function expression), a distance
// operator, and a row limit. On submit the dialog inlines the pivot into the
// canonical kNN SELECT (twice — both in the projection and in ORDER BY — so
// the planner sees the same sub-expression) and hands the assembled SQL back
// to the caller. Actually running the SQL is the caller's job; this component
// is intentionally I/O-free.
import { type JSX, useState } from "react";
import { type VectorValue, VectorValueInput } from "./VectorValueInput";
import type { DistanceOp } from "./hybridSearchSql";

export interface KnnBrowseDialogProps {
  open: boolean;
  connId: string;
  qualifiedTable: string;
  vectorColumn: string;
  defaultLimit?: number;
  onClose: () => void;
  /** Caller is responsible for opening the result pane on submit. */
  onSubmit: (req: {
    sql: string;
    pivotPreview: string;
    distanceOp: DistanceOp;
  }) => void;
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function buildPivotExpr(value: VectorValue): string {
  if (value.mode === "literal") {
    return `'${escapeSqlLiteral(value.literal)}'::vector`;
  }
  return value.expr;
}

export function KnnBrowseDialog(props: KnnBrowseDialogProps): JSX.Element | null {
  const { open, qualifiedTable, vectorColumn, defaultLimit, onClose, onSubmit } = props;
  const [pivot, setPivot] = useState<VectorValue>({ mode: "literal", literal: "" });
  const [op, setOp] = useState<DistanceOp>("<->");
  const [limitText, setLimitText] = useState<string>(String(defaultLimit ?? 10));

  if (!open) return null;

  const handleSubmit = () => {
    const pivotExpr = buildPivotExpr(pivot);
    const parsed = Number.parseInt(limitText, 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : (defaultLimit ?? 10);
    const sql =
      `SELECT *, ${vectorColumn} ${op} ${pivotExpr} AS distance ` +
      `FROM ${qualifiedTable} ` +
      `ORDER BY ${vectorColumn} ${op} ${pivotExpr} ` +
      `LIMIT ${limit}`;
    onSubmit({ sql, pivotPreview: pivotExpr, distanceOp: op });
    onClose();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="q-backdrop" />
        <RadixDialog.Content
          className="q-modal sm"
          data-testid="knn-browse-dialog"
          style={{ padding: 24 }}
        >
          <RadixDialog.Title className="q-modal-title">
            Find nearest by <code>{vectorColumn}</code>
          </RadixDialog.Title>
          <RadixDialog.Description style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-3)" }}>
            Choose a pivot vector and a distance operator. The query runs in a new result pane.
          </RadixDialog.Description>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12.5, marginBottom: 6 }}>Pivot vector</div>
            <VectorValueInput value={pivot} onChange={setPivot} />
          </div>

          <fieldset style={{ marginTop: 16, border: "none", padding: 0 }}>
            <legend style={{ fontSize: 12.5, marginBottom: 6 }}>Distance operator</legend>
            <label style={{ marginRight: 12 }}>
              <input
                type="radio"
                name="knn-op"
                value="<->"
                data-testid="knn-op-l2"
                checked={op === "<->"}
                onChange={() => setOp("<->")}
              />{" "}
              <code>&lt;-&gt;</code> (L2)
            </label>
            <label style={{ marginRight: 12 }}>
              <input
                type="radio"
                name="knn-op"
                value="<#>"
                data-testid="knn-op-ip"
                checked={op === "<#>"}
                onChange={() => setOp("<#>")}
              />{" "}
              <code>&lt;#&gt;</code> (inner product)
            </label>
            <label>
              <input
                type="radio"
                name="knn-op"
                value="<=>"
                data-testid="knn-op-cos"
                checked={op === "<=>"}
                onChange={() => setOp("<=>")}
              />{" "}
              <code>&lt;=&gt;</code> (cosine)
            </label>
          </fieldset>

          <div style={{ marginTop: 16 }}>
            <label htmlFor="knn-limit-input" style={{ fontSize: 12.5 }}>
              Limit
            </label>
            <br />
            <input
              id="knn-limit-input"
              data-testid="knn-limit"
              type="number"
              min={1}
              value={limitText}
              onChange={(e) => setLimitText(e.target.value)}
              className="q-input"
              style={{ width: 100 }}
            />
          </div>

          <div
            style={{
              marginTop: 18,
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="knn-submit"
              className="btn btn-primary"
              onClick={handleSubmit}
            >
              Run
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
