// — Easy-mode placeholder. S33 will replace this with a real
// persisted toggle; until then the body is a `localStorage` flag for
// dev/QA. Default is `false` (actions visible). Call sites stay one-liner
// `if (isEasyMode()) return null;`.

const LS_KEY = "ide99:debug.easyMode";

export function isEasyMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LS_KEY) === "1";
}

export function setEasyModeForTesting(value: boolean): void {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(LS_KEY, "1");
  else window.localStorage.removeItem(LS_KEY);
}
