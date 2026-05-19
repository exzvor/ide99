/**
 * — Cmd+J snippet palette.
 *
 * Radix Dialog modal hosting a search input + virtualised result list of
 * merged built-in + user snippets. Filter is case-insensitive substring
 * over label / prefix / body. Arrow keys move highlight, Enter inserts at
 * the active Monaco editor cursor (via useEditor.insertSnippetAtCursor),
 * Esc closes.
 *
 * The user-vs-builtin badge is computed from the snippet id (`user-*`
 * prefix means user snippet); when a user snippet shares a prefix with a
 * built-in, the store's getMerged() drops the built-in — so the palette
 * never shows the duplicate, but tags surviving built-ins as "overridden"
 * if any user snippet shares a prefix.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SnippetTemplate } from "../editor/autocomplete/types";
import { useEditor } from "../editor/store";
import { useSnippets } from "./store";

export function SnippetPalette() {
  const { t } = useTranslation();
  const open = useSnippets((s) => s.paletteOpen);
  const closePalette = useSnippets((s) => s.closePalette);
  const userSnippets = useSnippets((s) => s.userSnippets);
  const [filter, setFilter] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Compute merged from userSnippets directly so the zustand selector stays
  // referentially stable; calling `getMerged()` inside a selector returns a
  // fresh array on every render and triggers React's "Maximum update depth"
  // guard. The dependency on `userSnippets` is the actual recompute trigger;
  // biome's exhaustive-deps lint can't see through `getState()`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  const merged = useMemo(() => useSnippets.getState().getMerged(), [userSnippets]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.prefixes.some((p) => p.toLowerCase().includes(q)) ||
        s.body.toLowerCase().includes(q),
    );
  }, [merged, filter]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 56,
    overscan: 8,
    // Seed an initial rect so the first paint always renders at least the
    // overscan window — covers headless / jsdom layout where ResizeObserver
    // doesn't fire and prevents the palette from briefly showing empty rows.
    initialRect: { width: 720, height: 600 },
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement as HTMLElement | null;
      if (!el) return () => {};
      const measure = () => {
        const r = el.getBoundingClientRect();
        const width = r.width || 720;
        const height = r.height || 600;
        cb({ width, height });
      };
      measure();
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
      }
      return () => {};
    },
  });

  const insert = (snip: SnippetTemplate) => {
    setFilter("");
    setHighlightIdx(0);
    // Close the palette FIRST so Radix tears down its focus-trap. Then
    // schedule the insert on the next macrotask — by that point Radix has
    // restored focus to whatever owned it before the dialog opened (the
    // Monaco textarea, in our usage), and `editor.action.insertSnippet`
    // can actually mutate the buffer ().
    closePalette();
    setTimeout(() => {
      useEditor.getState().insertSnippetAtCursor(snip.body);
    }, 0);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const snip = filtered[highlightIdx];
      if (snip) insert(snip);
    }
  };

  const isUserSnippet = (s: SnippetTemplate) => s.id.startsWith("user-");
  const userPrefixes = new Set(userSnippets.map((u) => u.prefix));

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? null : closePalette())}>
      <Dialog.Portal>
        <Dialog.Overlay className="snippet-palette-overlay" />
        <Dialog.Content className="snippet-palette-content" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{t("snippets.palette.title")}</Dialog.Title>
          <input
            className="snippet-palette-input"
            placeholder={t("snippets.palette.searchPlaceholder")}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setHighlightIdx(0);
            }}
            onKeyDown={handleKey}
            // biome-ignore lint/a11y/noAutofocus: palette autofocus is the whole point
            autoFocus
          />
          <div ref={listRef} className="snippet-palette-list">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vrow) => {
                const snip = filtered[vrow.index];
                const builtinOverridden =
                  !isUserSnippet(snip) && snip.prefixes.some((p) => userPrefixes.has(p));
                return (
                  <button
                    key={snip.id}
                    type="button"
                    onClick={() => insert(snip)}
                    style={{
                      position: "absolute",
                      top: vrow.start,
                      height: vrow.size,
                      width: "100%",
                    }}
                    className={`snippet-palette-row${vrow.index === highlightIdx ? " is-highlighted" : ""}`}
                  >
                    <span className="snippet-label">{snip.label}</span>
                    <span className="snippet-prefix">{snip.prefixes.join(", ")}</span>
                    <span className="snippet-badge">
                      {isUserSnippet(snip)
                        ? t("snippets.badge.user")
                        : builtinOverridden
                          ? t("snippets.badge.overridden")
                          : t("snippets.badge.builtin")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
