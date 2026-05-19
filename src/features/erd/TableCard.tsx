import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { InlineEditor } from "./edit/InlineEditor";
import { HEADER_H, type LaidErdColumn, type LaidErdNode, MAX_VISIBLE_COLS, ROW_H } from "./layout";

interface TableCardProps {
  node: LaidErdNode;
  highlighted: boolean;
  onFocus?: () => void;
  /** switch on inline editing affordances. */
  editable?: boolean;
  /** card is currently a drop-target during FK drag. */
  isDropTarget?: boolean;
  /** this card is the source of an in-flight FK drag. */
  isFkDragSource?: boolean;
  /** visual badge for cards that came from `addTable` ops in
   * the current session. */
  newThisSession?: boolean;
  onRenameTable?(next: string): void;
  onRenameColumn?(colId: string, next: string): void;
  onRetypeColumn?(colId: string, type: string, nullable: boolean): void;
  onAddColumn?(): void;
  onStartFkDrag?(): void;
}

/**
 * — single ERD table card. Renders inside the parent SVG so
 * everything stays in one coordinate system with the FK paths. Uses the
 * project's actual design tokens (`--bg-elev`, `--ink`, `--ink-3`,
 * `--ink-4`, `--hairline`, `--accent`) — earlier drafts referenced
 * `--surface-1` / `--ink-1` which are not defined and rendered the cards
 * as black panels.
 *
 * — when `editable` is true, header + column names render
 * inside `<foreignObject>` slots wired to `InlineEditor`; an `+ Add
 * column` row appears below the visible columns; a small 🔗 FK link
 * handle appears in the upper-right; `isDropTarget` projects a
 * `data-state="drop-target"` attribute used both for styling and tests.
 */
export function TableCard({
  node,
  highlighted,
  onFocus,
  editable,
  isDropTarget,
  isFkDragSource,
  newThisSession,
  onRenameTable,
  onRenameColumn,
  onRetypeColumn: _onRetypeColumn,
  onAddColumn,
  onStartFkDrag,
}: TableCardProps): JSX.Element {
  const { t } = useTranslation();
  const visible = node.columns.slice(0, MAX_VISIBLE_COLS);
  const hidden = Math.max(0, node.columns.length - MAX_VISIBLE_COLS);
  const pkCount = node.columns.filter((c) => c.isPrimaryKey).length;
  const fkCount = node.columns.filter((c) => c.isForeignKey).length;

  const ariaLabel = t("erd.node.card_aria", {
    schema: node.schema,
    table: node.name,
    columnCount: node.columns.length,
    pkCount,
    fkCount,
  });

  const stroke = isDropTarget ? "var(--accent)" : highlighted ? "var(--accent)" : "var(--hairline)";
  const strokeWidth = isDropTarget ? 2.5 : highlighted ? 2 : 1;

  const dataState = isDropTarget ? "drop-target" : isFkDragSource ? "fk-drag-source" : undefined;

  // The editable test queries the card via `erd-card-${node.id}`.
  // Read-mode tests query via `erd-table-card`. Keep both stable by
  // switching the testid on `editable` so each existing test continues
  // to pass while the new tests can address the card directly.
  const cardTestId = editable ? `erd-card-${node.id}` : "erd-table-card";

  return (
    // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: SVG <g> needs role="group" + tabIndex per sprint 18 a11y contract.
    <g
      data-testid={cardTestId}
      data-table-id={node.id}
      data-state={dataState}
      transform={`translate(${node.x} ${node.y})`}
      tabIndex={0}
      // biome-ignore lint/a11y/useSemanticElements: <g> inside SVG cannot be replaced with <fieldset>.
      role="group"
      aria-label={ariaLabel}
      onFocus={onFocus}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={0}
        y={0}
        width={node.width}
        height={node.height}
        rx={6}
        ry={6}
        fill="var(--bg-elev)"
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Header band: small italic schema, bold table name. */}
      <text x={10} y={13} fontSize={9.5} fontStyle="italic" fill="var(--ink-4)">
        {node.schema}
      </text>
      {editable ? (
        <foreignObject x={6} y={14} width={node.width - 30} height={ROW_H + 4}>
          <div
            style={{
              font: "600 12px/1 var(--font-sans, sans-serif)",
              color: "var(--ink)",
              padding: "0 4px",
            }}
          >
            <InlineEditor
              value={node.name}
              onCommit={(v) => onRenameTable?.(v)}
              ariaLabel={t("erd.node.card_aria")}
            />
          </div>
        </foreignObject>
      ) : (
        <text x={10} y={25} fontSize={12} fontWeight={600} fill="var(--ink)">
          {node.name}
        </text>
      )}
      {editable && (
        <foreignObject x={node.width - 22} y={4} width={20} height={20}>
          <button
            type="button"
            data-testid="table-card-fk-handle"
            onMouseDown={(e) => {
              e.stopPropagation();
              onStartFkDrag?.();
            }}
            title={t("erd.edit.fk.modal.title")}
            style={{
              width: 20,
              height: 20,
              padding: 0,
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              background: "transparent",
              color: "var(--ink-3)",
              cursor: "crosshair",
              fontSize: 12,
              lineHeight: "18px",
            }}
            aria-label={t("erd.edit.fk.modal.title")}
          >
            🔗
          </button>
        </foreignObject>
      )}
      {newThisSession && (
        <text x={node.width - 44} y={13} fontSize={9} fill="var(--accent)" textAnchor="end">
          NEW
        </text>
      )}
      <line
        x1={0}
        y1={HEADER_H}
        x2={node.width}
        y2={HEADER_H}
        stroke="var(--hairline)"
        strokeWidth={1}
      />
      {visible.map((column, index) => (
        <ColumnRow
          key={`${column.ordinal}-${column.name}`}
          column={column}
          index={index}
          width={node.width}
          pkLabel={t("erd.node.pk_aria")}
          fkLabel={t("erd.node.fk_aria")}
          editable={editable}
          onRenameColumn={onRenameColumn}
        />
      ))}
      {hidden > 0 ? (
        <text
          data-testid="erd-column-overflow"
          x={10}
          y={HEADER_H + visible.length * ROW_H + 12}
          fontSize={10}
          fill="var(--ink-4)"
        >
          {t("erd.node.more_columns", { count: hidden })}
        </text>
      ) : null}
      {editable && (
        <foreignObject
          x={4}
          y={HEADER_H + visible.length * ROW_H + (hidden > 0 ? ROW_H : 0)}
          width={node.width - 8}
          height={ROW_H}
        >
          <button
            type="button"
            data-testid="table-card-add-column"
            onClick={(e) => {
              e.stopPropagation();
              onAddColumn?.();
            }}
            style={{
              width: "100%",
              padding: "2px 6px",
              textAlign: "left",
              background: "transparent",
              color: "var(--ink-3)",
              border: "1px dashed var(--hairline)",
              borderRadius: 3,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {t("erd.edit.add_column")}
          </button>
        </foreignObject>
      )}
    </g>
  );
}

interface ColumnRowProps {
  column: LaidErdColumn;
  index: number;
  width: number;
  pkLabel: string;
  fkLabel: string;
  editable?: boolean;
  onRenameColumn?(colId: string, next: string): void;
}

function ColumnRow({
  column,
  index,
  width,
  pkLabel,
  fkLabel,
  editable,
  onRenameColumn,
}: ColumnRowProps): JSX.Element {
  // Each row is centered on its band so badges + glyphs share a baseline.
  const baseline = HEADER_H + index * ROW_H + ROW_H - 5;
  // Layout per row: [PK/FK marker • name ........ type]
  // Markers live left of the name so the right-side type column never
  // collides with a "PK"/"FK" text badge (the previous design overlapped
  // those at the right edge, which made the type unreadable in dense
  // tables).
  const isKey = column.isPrimaryKey || column.isForeignKey;
  const markerLabel = column.isPrimaryKey ? pkLabel : fkLabel;
  const markerTestId = column.isPrimaryKey ? "erd-pk-badge" : "erd-fk-badge";
  return (
    <g data-testid="erd-column-row" data-column-name={column.name}>
      {isKey ? (
        <text
          data-testid={markerTestId}
          x={10}
          y={baseline}
          fontSize={11}
          fontWeight={700}
          fill="var(--accent)"
          aria-label={markerLabel}
        >
          {column.isPrimaryKey ? "◆" : "◇"}
        </text>
      ) : (
        <text x={10} y={baseline} fontSize={11} fill="var(--ink-4)">
          •
        </text>
      )}
      {editable ? (
        <foreignObject x={22} y={HEADER_H + index * ROW_H + 1} width={width / 2} height={ROW_H}>
          <div
            style={{
              font: "11px/1 var(--font-sans, sans-serif)",
              color: "var(--ink-2)",
            }}
          >
            <InlineEditor
              value={column.name}
              onCommit={(v) => onRenameColumn?.(column.id ?? column.name, v)}
            />
          </div>
        </foreignObject>
      ) : (
        <text x={24} y={baseline} fontSize={11} fill="var(--ink-2)">
          {column.name}
        </text>
      )}
      <text x={width - 10} y={baseline} fontSize={10.5} fill="var(--ink-4)" textAnchor="end">
        {column.dataType}
      </text>
    </g>
  );
}
