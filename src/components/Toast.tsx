import * as RadixToast from "@radix-ui/react-toast";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";

/**
 * Application-level toast surface.
 *
 * - <ToastProvider> wraps the app and mounts a single Radix Toast.Provider
 * plus a <Toast.Viewport /> in the top-right corner.
 * - useToast() returns dispatchers `success / info / warning / error`. Each
 * pushes a toast onto a small array kept in React state; Radix handles the
 * timing, focus, and screen-reader announcements.
 *
 * Auto-dismiss durations (per spec):
 * success / info → 3 s
 * warning        → 5 s
 * error          → 6 s
 *
 * Hovering a toast pauses its dismissal timer (Radix default behaviour).
 */

export type ToastVariant = "success" | "info" | "warning" | "error";

interface ToastEntry {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  /** — optional action button (e.g. "Explain in plain English"). */
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  success: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
  /** — error toast with an inline action (e.g. open Explain modal). */
  errorWithAction: (message: string, action: { label: string; onClick: () => void }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const VARIANT_DURATIONS: Record<ToastVariant, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 6000,
};

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success:
    "border-[var(--success-500)] bg-[var(--success-50)] text-[var(--success-700)] data-[state=open]:animate-in",
  info: "border-[var(--info-500)] bg-[var(--info-50)] text-[var(--info-700)] data-[state=open]:animate-in",
  warning:
    "border-[var(--warning-500)] bg-[var(--warning-50)] text-[var(--warning-700)] data-[state=open]:animate-in",
  error:
    "border-[var(--error-500)] bg-[var(--error-50)] text-[var(--error-700)] data-[state=open]:animate-in",
};

/**
 * Hard cap on simultaneous toasts so a runaway loop of error toasts can't
 * blanket the screen. Oldest entries get dropped first.
 */
const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);

  const push = useCallback((entry: Omit<ToastEntry, "id">, idHint: string) => {
    const id = `${idHint}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => {
      const next = [...prev, { id, ...entry }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const baseId = useId();

  const api = useMemo<ToastApi>(    () => ({
      success: (message) =>
        push({ message, variant: "success", duration: VARIANT_DURATIONS.success }, baseId),
      info: (message) =>
        push({ message, variant: "info", duration: VARIANT_DURATIONS.info }, baseId),
      warning: (message) =>
        push({ message, variant: "warning", duration: VARIANT_DURATIONS.warning }, baseId),
      error: (message) =>
        push({ message, variant: "error", duration: VARIANT_DURATIONS.error }, baseId),
      errorWithAction: (message, action) =>
        push({ message, variant: "error", duration: VARIANT_DURATIONS.error, action }, baseId),
    }),
    [push, baseId],
);

  return (    <ToastContext.Provider value={api}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {items.map((entry) => (          <RadixToast.Root
            key={entry.id}
            duration={entry.duration}
            onOpenChange={(open) => {
              if (!open) remove(entry.id);
            }}
            className={`pointer-events-auto flex items-start gap-[var(--space-3)] rounded-[var(--radius-md)] border px-[var(--space-4)] py-[var(--space-3)] shadow-[var(--shadow-md)] ${VARIANT_CLASSES[entry.variant]}`}
            data-testid={`toast-${entry.variant}`}
          >
            <RadixToast.Description className="break-words text-[var(--text-sm)] leading-[var(--text-sm-lh)]">
              {entry.message}
            </RadixToast.Description>
            {entry.action ? (              <RadixToast.Action
                altText={entry.action.label}
                asChild
                onClick={() => {
                  entry.action?.onClick();
                  remove(entry.id);
                }}
              >
                <button
                  type="button"
                  className="ml-auto rounded-[var(--radius-sm)] border border-current px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-xs)] font-[var(--font-weight-medium)] hover:bg-[color:rgb(0_0_0_/_5%)]"
                  data-testid="toast-action"
                >
                  {entry.action.label}
                </button>
              </RadixToast.Action>
) : null}
          </RadixToast.Root>
))}
        <RadixToast.Viewport className="fixed right-[var(--space-4)] top-[var(--space-4)] z-[var(--z-toast)] flex w-[20rem] max-w-[calc(100vw-2rem)] flex-col gap-[var(--space-2)] outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
);
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  // Fallback: no provider mounted — log + no-op so unit tests of consumer
  // components don't have to wrap themselves in ToastProvider unless they
  // specifically assert on toasts.
  return {
    success: () => {},
    info: () => {},
    warning: () => {},
    error: () => {},
    errorWithAction: () => {},
  };
}
