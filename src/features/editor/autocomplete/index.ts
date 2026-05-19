import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
import { LanguageIdEnum } from "monaco-sql-languages";
import { type ProviderHooks, buildProvider } from "./provider";

let registered = false;
let disposeRegistration: (() => void) | null = null;

/**
 * Idempotent registration: language-level Monaco completion provider for the
 * PG SQL language. We deliberately keep the language-level provider alive
 * across editor remounts (HMR friendliness, matches `pgLanguageRegistered`
 * in MonacoEditor.tsx). The hooks object closes over getActiveConnId /
 * getActiveEditor, which always return live values, so the provider stays
 * correct even as editor instances come and go.
 */
export function registerAutocomplete(monaco: Monaco, hooks: ProviderHooks): IDisposable {
  if (!registered) {
    const handle = monaco.languages.registerCompletionItemProvider(
      LanguageIdEnum.PG,
      buildProvider(hooks),
    );
    disposeRegistration = () => handle.dispose();
    registered = true;
  }
  return {
    dispose: () => {
      // Intentionally a no-op for the language-level provider — see above.
    },
  };
}

/** Test-only escape hatch — flush the module-level guard so HMR re-registers cleanly. */
export function __resetAutocompleteRegistration(): void {
  if (disposeRegistration) disposeRegistration();
  disposeRegistration = null;
  registered = false;
}
