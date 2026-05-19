import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { shortServerVersion } from "../../lib/serverVersion";
import {
  type TestInput,
  type TestResult,
  testConnection,
  testSavedConnection,
} from "../../lib/tauri";

/**
 * <TestButton /> — runs a connection test and renders the spinner / status.
 *
 * Two variants:
 * - `input`: ad-hoc test against current form values (used in
 * ConnectionForm). Caller supplies a `getInput()` thunk so the latest
 * form state is read at click-time, not at render-time.
 * - `saved`: test an already-persisted connection by id (used in
 * ConnectionDetails). Backend reads the password from the keychain.
 *
 * Caller hooks:
 * - `onResult(result)` — fired on success/failure; the caller decides
 * whether to flip the form's "save enabled" gate, surface a toast, etc.
 * - `onError(error)` — fired only on rejected promises (network / Tauri
 * bridge / unexpected); not for `result.ok === false` outcomes.
 *
 * Layout-stability contract:
 * - The button label is always `connection.form.action.test`; running state
 * only adds a spinner glyph (`aria-busy` carries the live-region semantic).
 * This keeps the button's width fixed across runs.
 * - The previous result chip stays visible while a new run is in flight —
 * only the numeric meta (ms / version) updates when the new result lands.
 * Without this, re-testing made the whole row briefly collapse and reflow.
 */

export type TestButtonProps =
  | {
      variant: "input";
      getInput: () => TestInput;
      onResult?: (result: TestResult) => void;
      onError?: (error: unknown) => void;
      disabled?: boolean;
    }
  | {
      variant: "saved";
      connectionId: string;
      onResult?: (result: TestResult) => void;
      onError?: (error: unknown) => void;
      disabled?: boolean;
    };

interface State {
  running: boolean;
  result: TestResult | null;
}

export function TestButton(props: TestButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ running: false, result: null });

  const run = useCallback(async () => {
    setState((prev) => ({ running: true, result: prev.result }));
    try {
      const result =
        props.variant === "input"
          ? await testConnection(props.getInput())
          : await testSavedConnection(props.connectionId);
      setState({ running: false, result });
      props.onResult?.(result);
    } catch (err) {
      const result: TestResult = {
        ok: false,
        durationMs: 0,
        error: String(err),
        serverVersion: null,
      };
      setState({ running: false, result });
      props.onError?.(err);
    }
  }, [props]);

  const { running, result } = state;
  const label = t("connection.form.action.test");

  const successMeta = result?.ok
    ? result.serverVersion
      ? t("connection.form.test.success_meta_with_version", {
          ms: result.durationMs,
          version: shortServerVersion(result.serverVersion),
        })
      : t("connection.form.test.success_meta", { ms: result.durationMs })
    : null;

  return (    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        onClick={run}
        disabled={props.disabled || running}
        aria-label={label}
        aria-busy={running}
        className="btn"
      >
        {running ? <Loader2 size={14} className="q-spin" aria-hidden="true" /> : null}
        <span>{label}</span>
      </button>
      {result?.ok ? (        <output
          aria-live="polite"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--accent)",
            whiteSpace: "nowrap",
            opacity: running ? 0.55 : 1,
            transition: "opacity 120ms ease",
          }}
        >
          <CheckCircle2 size={14} aria-hidden="true" />
          <span data-testid="test-success-badge" style={{ fontWeight: 500 }}>
            {t("connection.form.test.success")}
          </span>
          {successMeta ? (            <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {successMeta}</span>
) : null}
        </output>
) : null}
      {result && !result.ok ? (        <output
          aria-live="polite"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--danger-q)",
            whiteSpace: "nowrap",
            fontWeight: 500,
            opacity: running ? 0.55 : 1,
            transition: "opacity 120ms ease",
          }}
        >
          <XCircle size={14} aria-hidden="true" />
          <span data-testid="test-failure-badge">{t("connection.form.test.failure")}</span>
        </output>
) : null}
    </span>
);
}
