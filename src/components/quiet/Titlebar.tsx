import { getCurrentWindow } from "@tauri-apps/api/window";
import type { JSX, MouseEvent, ReactNode } from "react";
import { useCallback } from "react";

interface TitlebarProps {
  /** Left part (centered in the layout) — context name. */
  name?: string;
  /** Right-side subtext (mono) — usually a DB name or host. */
  context?: string;
  /** When set, shows a green pulsing dot to the left of `name`. */
  connected?: boolean;
  /** Right-side slot (e.g. Edit/Disconnect buttons). */
  right?: ReactNode;
}

/**
 * Quiet titlebar (h: 36) with a centered "name · context".
 *
 * Real macOS traffic lights are rendered via `titleBarStyle: "Overlay"`
 * in the Tauri config. Window drag is handled explicitly via
 * `getCurrentWindow().startDragging()` in `onMouseDown` —
 * `data-tauri-drag-region` is unreliable on macOS Overlay style.
 *
 * Double-click reproduces the standard macOS behavior: maximize
 * (toggleMaximize).
 */
export function Titlebar({ name, context, connected = false, right }: TitlebarProps): JSX.Element {
  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    // Do not drag if the click is on an interactive element (button / input).
    const target = event.target as HTMLElement;
    if (target.closest("button, [role='button'], a, input, select, textarea")) {
      return;
    }
    if (event.button !== 0) return;
    void getCurrentWindow().startDragging();
  }, []);

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, [role='button'], a, input, select, textarea")) {
      return;
    }
    void getCurrentWindow().toggleMaximize();
  }, []);

  return (
    <div
      className="q-titlebar"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      style={{ paddingLeft: 80 }}
    >
      {(name || context) && (
        <div className="tl-center">
          {connected ? <span className="dot" aria-hidden="true" /> : null}
          {name ? <span>{name}</span> : null}
          {name && context ? <span className="sep">·</span> : null}
          {context ? <span className="ctx">{context}</span> : null}
        </div>
      )}
      {right ? (
        <div
          style={{
            position: "absolute",
            right: 12,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            gap: 4,
            alignItems: "center",
          }}
        >
          {right}
        </div>
      ) : null}
    </div>
  );
}
