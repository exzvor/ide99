import { type JSX, useEffect, useRef, useState } from "react";

export type LeafKind = "string" | "number" | "boolean" | "null";

export function leafKind(v: unknown): LeafKind | "container" {
  if (v === null) return "null";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "container";
}

/** Type-aware inline editor for a JSON leaf. Calls `onCommit` with the
 * parsed value (string / number / boolean / null) when the user finishes
 * editing. `onCancel` reverts without notifying. */
export function LeafEditor({
  value,
  onCommit,
  onCancel,
  autoFocus = true,
  testid,
}: {
  value: unknown;
  onCommit: (next: unknown) => void;
  onCancel: () => void;
  autoFocus?: boolean;
  testid?: string;
}): JSX.Element {
  const kind = leafKind(value);
  const [draft, setDraft] = useState<string>(() => {
    if (kind === "string") return value as string;
    if (kind === "number") return String(value);
    if (kind === "boolean") return value ? "true" : "false";
    return "";
  });
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // null leaves get a "set value" affordance that lifts them into a string.
  const [convertedFromNull, setConvertedFromNull] = useState<boolean>(false);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function commit() {
    if (kind === "string" || convertedFromNull) {
      onCommit(draft);
      return;
    }
    if (kind === "number") {
      const parsed = Number.parseFloat(draft);
      if (!Number.isFinite(parsed)) {
        setError("not a number");
        return;
      }
      onCommit(parsed);
      return;
    }
    if (kind === "boolean") {
      onCommit(draft === "true");
      return;
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  if (kind === "null" && !convertedFromNull) {
    return (
      <button
        type="button"
        data-testid="leaf-set-value"
        onClick={() => setConvertedFromNull(true)}
        style={{
          background: "transparent",
          border: "1px solid var(--hairline)",
          padding: "1px 6px",
          fontSize: 11,
          cursor: "pointer",
          color: "var(--ink-3)",
        }}
      >
        [set value]
      </button>
    );
  }

  if (kind === "boolean") {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        data-testid={testid ?? "leaf-input"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        style={{ fontSize: 12, padding: "1px 4px" }}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        data-testid={testid ?? "leaf-input"}
        type={kind === "number" ? "number" : "text"}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
        style={{
          fontSize: 12,
          padding: "1px 6px",
          minWidth: 80,
          fontFamily: "var(--font-mono-q, monospace)",
        }}
      />
      {error ? (
        <span style={{ fontSize: 10, color: "var(--accent-strong-danger, #ef4444)" }}>{error}</span>
      ) : null}
    </span>
  );
}

/** Display-only formatter for a leaf value. */
export function leafDisplay(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}
