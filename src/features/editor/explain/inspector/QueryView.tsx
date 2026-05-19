import type { JSX } from "react";

interface QueryViewProps {
  sql: string;
}

/**
 * — read-only SQL view for the Plan Inspector. Shows the
 * statement that produced the plan (captured at run time as
 * `executedSql` in the ExplainRunState).
 */
export function QueryView({ sql }: QueryViewProps): JSX.Element {
  return (
    <div
      data-testid="query-view"
      className="q-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: "var(--bg-sunken)",
        padding: 16,
      }}
    >
      <pre
        style={{
          margin: 0,
          fontFamily: "var(--font-mono-q)",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--ink)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {sql || "(пусто)"}
      </pre>
    </div>
  );
}
