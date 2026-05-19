/**
 * — Notebook markdown helpers.
 *
 * Two responsibilities:
 * 1. {{ cell_N.result.col }} variable substitution from preceding cells'
 * result snapshots. Mirrors the backend `notebook_render_markdown`
 * logic () so the frontend can render previews live during
 * typing without an IPC round-trip.
 * 2. Minimal, dependency-free markdown → HTML renderer. Supports the
 * subset we need for documentation cells: headings (#–######),
 * `**bold**`, `*italic*` / `_italic_`, `` `inline code` ``, fenced
 * ``` code blocks ```, links `[text](url)`, unordered lists, and
 * paragraphs separated by blank lines.
 *
 * We deliberately avoid pulling in marked/markdown-it — the bundle
 * cost and XSS surface (we're rendering user-authored cells in-app)
 * isn't worth it for this scope. Output HTML is always escaped first
 * so raw HTML in cell source renders as text.
 */
import type { Cell } from "./types";

/** Selector inside a result snapshot. `column` may be null when only the
 * cell reference is given (e.g. `{{ cell_2.result }}` — currently unused
 * but reserved). */
export type VariableRef = {
  cellIndex: number; // zero-based, matches the position in `cells`
  column: string | null;
  row: number; // zero-based row index, defaults to 0
};

const VAR_PATTERN =
  /\{\{\s*cell_(\d+)\.result(?:\.([A-Za-z_][A-Za-z0-9_]*))?(?:\[(\d+)\])?\s*\}\}/g;

/** Parse a single `{{ cell_N.result.col }}` reference. Returns null if the
 * string is not a valid variable. Used for tooltips / lint errors in the
 * editor — not on the rendering path. */
export function parseVariableRef(raw: string): VariableRef | null {
  const trimmed = raw.trim();
  const m = trimmed.match(/^cell_(\d+)\.result(?:\.([A-Za-z_][A-Za-z0-9_]*))?(?:\[(\d+)\])?$/);
  if (!m) return null;
  return {
    cellIndex: Number.parseInt(m[1] ?? "0", 10),
    column: m[2] ?? null,
    row: m[3] ? Number.parseInt(m[3], 10) : 0,
  };
}

/**
 * Substitute every `{{ cell_N.result.col }}` reference in `source` with the
 * corresponding cell's result value. Unresolved references are left in place
 * but wrapped in a `data-error` span when `htmlError` is true (used for
 * preview rendering); plain-text mode replaces them with `«unresolved»` so
 * tests can assert on string content without parsing HTML.
 *
 * `cells` is the ordered cell list from the notebook; indices are zero-based
 * and refer to the *position* (not cell.id), matching the user's mental
 * model of «above this cell».
 */
export function substituteVariables(  source: string,
  cells: Cell[],
  options: { mode?: "text" | "html" } = {},
): string {
  const mode = options.mode ?? "text";
  return source.replace(VAR_PATTERN, (match, idxRaw: string, colRaw?: string, rowRaw?: string) => {
    const idx = Number.parseInt(idxRaw, 10);
    const cell = cells[idx];
    const value = resolveValue(cell, colRaw ?? null, rowRaw ? Number.parseInt(rowRaw, 10) : 0);
    if (value === null) {
      return mode === "html"
        ? `<span class="nb-var-error" data-error="unresolved">${escapeHtml(match)}</span>`
        : match;
    }
    return mode === "html" ? escapeHtml(value) : value;
  });
}

function resolveValue(cell: Cell | undefined, column: string | null, row: number): string | null {
  if (!cell) return null;
  let result: { columns: string[]; rows: Array<Array<string | null>> } | null = null;
  if (cell.kind === "sql" && cell.result) {
    result = cell.result;
  } else if (cell.kind === "result") {
    result = cell.result;
  }
  if (!result) return null;
  if (row < 0 || row >= result.rows.length) return null;

  if (column === null) {
    // Whole-row JSON dump — surfaces something useful when the user only
    // typed `{{ cell_N.result }}` without selecting a column.
    const obj: Record<string, string | null> = {};
    for (let i = 0; i < result.columns.length; i++) {
      obj[result.columns[i] ?? `col${i}`] = result.rows[row]?.[i] ?? null;
    }
    return JSON.stringify(obj);
  }

  const colIdx = result.columns.indexOf(column);
  if (colIdx === -1) return null;
  const cell0 = result.rows[row]?.[colIdx];
  return cell0 ?? null;
}

/* ------------------------------------------------------------------------ *
 * Minimal markdown → HTML.
 * ------------------------------------------------------------------------ */

export function renderMarkdown(source: string): string {
  // Substitution must run on the *raw* markdown so escaped HTML doesn't
  // double-encode; the renderer below escapes per-line.
  // Callers that want substitution should call substituteVariables first.
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block.
    if (/^```/.test(line)) {
      flushParagraph();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = (heading[1] ?? "#").length;
      out.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? "")) {
        const item = (lines[i] ?? "").replace(/^[-*]\s+/, "");
        items.push(`<li>${renderInline(item)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Blank line — paragraph break.
    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    paragraph.push(line);
    i++;
  }

  flushParagraph();
  return out.join("\n");
}

/** Inline emphasis / code / links. Operates on already-line-joined text. */
function renderInline(raw: string): string {
  // Pull code spans out first (placeholders) so emphasis regex doesn't
  // mangle e.g. `_foo_` inside backticks.
  const codes: string[] = [];
  let s = escapeHtml(raw).replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `@@CODE${codes.length - 1}@@`;
  });

  // Links — [text](url). URL is escaped by the leading escapeHtml pass; we
  // additionally strip dangerous schemes to neutralise stored XSS.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, url: string) => {
    const safe = /^(https?:|mailto:|#|\/)/i.test(url) ? url : "#";
    return `<a href="${safe}">${text}</a>`;
  });

  // Bold then italic — order matters (`***x***` would otherwise be eaten).
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");

  // Restore code spans.
  s = s.replace(/@@CODE(\d+)@@/g, (_, idx) => codes[Number.parseInt(idx, 10)] ?? "");
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
