/**
 * Monaco's `editor.setTheme` is **global** to the Monaco
 * runtime — every editor on the page shares one theme. The SQL editor
 * (`MonacoEditor.tsx`) and the JSONB modal's text-mode view
 * (`features/jsonb/text/TextView.tsx`) both ride on top of that global,
 * so they MUST register the same theme names with the same definitions
 * or whichever component mounts last wins and the other side flips
 * to the wrong palette.
 *
 * This module is the single source of truth for the `quiet-light` /
 * `quiet-dark` definitions and the `<html data-theme>` reader. Anyone
 * embedding a Monaco instance calls `registerQuietThemes(monaco)` from
 * `beforeMount` and reads the active variant via
 * `readResolvedQuietTheme()`. `defineTheme` is idempotent — calling it
 * from multiple components is safe.
 */

import type { Monaco } from "@monaco-editor/react";

/** Identifier of the active quiet theme. Returned by `readResolvedQuietTheme`. */
export type QuietThemeId = "quiet-light" | "quiet-dark";

/** Read the currently resolved quiet theme from `<html data-theme>`.
 * Defaults to `quiet-light` in non-DOM environments (tests). */
export function readResolvedQuietTheme(): QuietThemeId {
  if (typeof document === "undefined") return "quiet-light";
  return document.documentElement.dataset.theme === "dark" ? "quiet-dark" : "quiet-light";
}

/** Register the two quiet Monaco themes. Idempotent — safe to call from
 * every Monaco-embedding component's `beforeMount`. */
export function registerQuietThemes(monaco: Monaco): void {
  monaco.editor.defineTheme("quiet-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "2a2d33" },
      { token: "comment", foreground: "8b8f96", fontStyle: "italic" },
      { token: "comment.sql", foreground: "8b8f96", fontStyle: "italic" },
      { token: "comment.quote.sql", foreground: "8b8f96", fontStyle: "italic" },
      { token: "keyword", foreground: "7c3aed" },
      { token: "keyword.sql", foreground: "7c3aed" },
      { token: "keyword.scope.sql", foreground: "7c3aed" },
      { token: "predefined.sql", foreground: "7c3aed" },
      { token: "type", foreground: "7c3aed" },
      { token: "type.sql", foreground: "7c3aed" },
      { token: "string", foreground: "059669" },
      { token: "string.sql", foreground: "059669" },
      { token: "string.double.sql", foreground: "059669" },
      { token: "string.escape.sql", foreground: "059669" },
      { token: "number", foreground: "db2777" },
      { token: "number.sql", foreground: "db2777" },
      { token: "number.float.sql", foreground: "db2777" },
      { token: "number.hex.sql", foreground: "db2777" },
      { token: "number.binary.sql", foreground: "db2777" },
      { token: "number.octal.sql", foreground: "db2777" },
      { token: "operator", foreground: "5b5f66" },
      { token: "operator.sql", foreground: "5b5f66" },
      { token: "operator.symbol.sql", foreground: "5b5f66" },
      { token: "operator.keyword.sql", foreground: "7c3aed" },
      { token: "delimiter", foreground: "5b5f66" },
      { token: "delimiter.sql", foreground: "5b5f66" },
      { token: "delimiter.paren.sql", foreground: "5b5f66" },
      { token: "delimiter.curly.sql", foreground: "5b5f66" },
      { token: "delimiter.square.sql", foreground: "5b5f66" },
      { token: "identifier", foreground: "2a2d33" },
      { token: "identifier.sql", foreground: "2a2d33" },
      { token: "identifier.quote.sql", foreground: "2a2d33" },
      { token: "variable", foreground: "2a2d33" },
      { token: "variable.sql", foreground: "2a2d33" },
    ],
    colors: {
      "editor.background": "#fafaf900",
      "editor.foreground": "#2a2d33",
      "editorLineNumber.foreground": "#b8bcc2",
      "editorLineNumber.activeForeground": "#5b5f66",
      "editorCursor.foreground": "#10b981",
      "editor.selectionBackground": "#10b98129",
      "editor.lineHighlightBackground": "#10b9810D",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background": "#0f111511",
      "editorIndentGuide.activeBackground": "#0f111522",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#0f11151f",
      "editor.findMatchBackground": "#10b98129",
      "editor.findMatchHighlightBackground": "#10b9811A",
      "editorGutter.background": "#fafaf900",
      "scrollbarSlider.background": "#0f111511",
      "scrollbarSlider.hoverBackground": "#0f111522",
      "scrollbarSlider.activeBackground": "#0f111533",
    },
  });

  monaco.editor.defineTheme("quiet-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e2e4e8" },
      { token: "comment", foreground: "6c7079", fontStyle: "italic" },
      { token: "comment.sql", foreground: "6c7079", fontStyle: "italic" },
      { token: "comment.quote.sql", foreground: "6c7079", fontStyle: "italic" },
      { token: "keyword", foreground: "c4b5fd" },
      { token: "keyword.sql", foreground: "c4b5fd" },
      { token: "keyword.scope.sql", foreground: "c4b5fd" },
      { token: "predefined.sql", foreground: "c4b5fd" },
      { token: "type", foreground: "c4b5fd" },
      { token: "type.sql", foreground: "c4b5fd" },
      { token: "string", foreground: "86efac" },
      { token: "string.sql", foreground: "86efac" },
      { token: "string.double.sql", foreground: "86efac" },
      { token: "string.escape.sql", foreground: "86efac" },
      { token: "number", foreground: "fda4af" },
      { token: "number.sql", foreground: "fda4af" },
      { token: "number.float.sql", foreground: "fda4af" },
      { token: "number.hex.sql", foreground: "fda4af" },
      { token: "number.binary.sql", foreground: "fda4af" },
      { token: "number.octal.sql", foreground: "fda4af" },
      { token: "operator", foreground: "a8acb3" },
      { token: "operator.sql", foreground: "a8acb3" },
      { token: "operator.symbol.sql", foreground: "a8acb3" },
      { token: "operator.keyword.sql", foreground: "c4b5fd" },
      { token: "delimiter", foreground: "a8acb3" },
      { token: "delimiter.sql", foreground: "a8acb3" },
      { token: "delimiter.paren.sql", foreground: "a8acb3" },
      { token: "delimiter.curly.sql", foreground: "a8acb3" },
      { token: "delimiter.square.sql", foreground: "a8acb3" },
      { token: "identifier", foreground: "e2e4e8" },
      { token: "identifier.sql", foreground: "e2e4e8" },
      { token: "identifier.quote.sql", foreground: "e2e4e8" },
      { token: "variable", foreground: "e2e4e8" },
      { token: "variable.sql", foreground: "e2e4e8" },
    ],
    colors: {
      "editor.background": "#0a0b0e00",
      "editor.foreground": "#e2e4e8",
      "editorLineNumber.foreground": "#3f434b",
      "editorLineNumber.activeForeground": "#a8acb3",
      "editorCursor.foreground": "#38c5ff",
      "editor.selectionBackground": "#38c5ff33",
      "editor.lineHighlightBackground": "#38c5ff14",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background": "#ffffff0a",
      "editorIndentGuide.activeBackground": "#ffffff14",
      "editorWidget.background": "#111317",
      "editorWidget.border": "#ffffff14",
      "editor.findMatchBackground": "#38c5ff33",
      "editor.findMatchHighlightBackground": "#38c5ff1A",
      "editorGutter.background": "#0a0b0e00",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff22",
      "scrollbarSlider.activeBackground": "#ffffff33",
    },
  });
}
