import type { editor } from "monaco-editor";
import { formatSql } from "./formatter";

/**
 * Single edit operation that replaces the entire model with formatted SQL.
 * Returns true if a format was applied; false on no-op (parse error or
 * already-formatted).
 */
export function applyFormat(ed: editor.ICodeEditor): boolean {
  const model = ed.getModel();
  if (!model) return false;
  const current = model.getValue();
  const formatted = formatSql(current);
  if (formatted === null) return false;
  if (formatted === current) return false;
  // Monaco's ITextModel exposes `getFullModelRange()` at runtime but the
  // public type definition routes the range through `IModel`; we cast to a
  // narrow shape to keep this file independent of monaco-editor's internal
  // type re-exports.
  const range = (    model as unknown as { getFullModelRange(): editor.IModelDeltaDecoration["range"] }
).getFullModelRange();
  ed.executeEdits("format-on-save", [{ range, text: formatted }]);
  return true;
}

/** Bind Cmd/Ctrl+Shift+F to applyFormat. Returns disposable for unmount. */
export function bindFormatShortcut(  ed: editor.ICodeEditor,
  monaco: { KeyMod: { CtrlCmd: number; Shift: number }; KeyCode: { KeyF: number } },
): { dispose: () => void } {
  const handle = (    ed as unknown as {
      addCommand: (keybinding: number, handler: () => void, context?: string) => string | null;
    }
).addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
    applyFormat(ed);
  });
  return {
    dispose: () => {
      void handle; // Monaco GCs commands per editor on dispose
    },
  };
}

/** Bind format-on-save: triggers on Cmd+S. Debounce 500ms cancels on next keystroke. */
export function bindFormatOnSave(  ed: editor.ICodeEditor,
  monaco: { KeyMod: { CtrlCmd: number }; KeyCode: { KeyS: number } },
): { dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handle = (    ed as unknown as {
      addCommand: (k: number, h: () => void, c?: string) => string | null;
    }
).addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      applyFormat(ed);
      timer = null;
    }, 500);
  });
  return {
    dispose: () => {
      if (timer) clearTimeout(timer);
      void handle;
    },
  };
}
