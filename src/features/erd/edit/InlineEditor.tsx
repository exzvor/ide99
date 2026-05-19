// src/features/erd/edit/InlineEditor.tsx
import { type JSX, useEffect, useRef, useState } from "react";

interface InlineEditorProps {
  value: string;
  onCommit(next: string): void;
  /** When true, click does nothing — used in read-mode. */
  disabled?: boolean;
  /** Optional aria label for the input. */
  ariaLabel?: string;
  /** Optional class for the static text span. */
  className?: string;
}

export function InlineEditor({
  value,
  onCommit,
  disabled,
  ariaLabel,
  className,
}: InlineEditorProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [displayValue, setDisplayValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    setDraft(value);
    setDisplayValue(value);
  }, [value]);

  if (!editing) {
    return (      <span
        className={className}
        onClick={disabled ? undefined : () => setEditing(true)}
        style={{ cursor: disabled ? "default" : "text" }}
        data-testid="inline-editor-static"
      >
        {displayValue}
      </span>
);
  }

  const tryCommit = (next: string) => {
    if (next.trim() === "") return false;
    if (next === value) {
      setEditing(false);
      return true;
    }
    onCommit(next);
    setDisplayValue(next);
    setEditing(false);
    return true;
  };

  return (    <input
      ref={inputRef}
      type="text"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          tryCommit(draft);
        } else if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      onBlur={() => tryCommit(draft)}
      style={{
        font: "inherit",
        background: "var(--bg-2, transparent)",
        color: "inherit",
        border: "1px solid var(--accent, #888)",
        borderRadius: 2,
        padding: "0 4px",
        width: "100%",
        outline: "none",
      }}
    />
);
}
