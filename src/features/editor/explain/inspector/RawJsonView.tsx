import { type JSX, useMemo } from "react";

interface RawJsonViewProps {
  plan: unknown;
}

/**
 * — pretty-printed plan JSON. Mono-font, light syntax tinting
 * via plain regex (good enough for read-only inspection). For editing /
 * complex syntax tooling users should still copy the JSON out and paste
 * it into a real editor.
 */
export function RawJsonView({ plan }: RawJsonViewProps): JSX.Element {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(plan, null, 2);
    } catch {
      return String(plan);
    }
  }, [plan]);

  const html = useMemo(() => highlight(pretty), [pretty]);

  return (
    <div
      data-testid="raw-json-view"
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
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--ink-2)",
          whiteSpace: "pre",
          wordBreak: "normal",
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: highlight() escapes input
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tiny JSON syntax highlighter — keys, string values, numbers, booleans.
 * Operates on already-escaped HTML; never re-escapes the spans we add.
 */
function highlight(jsonStr: string): string {
  const escaped = escapeHtml(jsonStr);
  return escaped.replace(
    /(&quot;[^&]*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_, str, colon, bool, num) => {
      if (str !== undefined) {
        if (colon) {
          return `<span style="color:var(--brand-q)">${str}</span>${colon}`;
        }
        return `<span style="color:var(--accent-strong)">${str}</span>`;
      }
      if (bool !== undefined) {
        return `<span style="color:#7c3aed">${bool}</span>`;
      }
      if (num !== undefined) {
        return `<span style="color:var(--brand-q)">${num}</span>`;
      }
      return _;
    },
  );
}
