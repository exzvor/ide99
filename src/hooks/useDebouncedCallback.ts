// src/hooks/useDebouncedCallback.ts
import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a stable function that defers invoking `fn` until `delay` ms have
 * passed since the last call. The latest `fn` reference is always used so
 * stale-closure bugs in callbacks that capture state are avoided. Used by
 * S20 bidirectional panels to debounce parse-on-edit at 200 ms.
 */
export function useDebouncedCallback<F extends (...args: unknown[]) => unknown>(
  fn: F,
  delay: number,
): (...args: Parameters<F>) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (...args: Parameters<F>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  );
}
