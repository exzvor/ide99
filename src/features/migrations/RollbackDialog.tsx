/**
 * — 
 *
 * RollbackDialog wires `.down.sql` preview + the prod typed-confirm gate.
 *
 * non-prod: pre-fetched preview + Rollback button.
 * prod:     same preview, but pressing Rollback opens an inline typed-
 * confirm dialog (Radix-based, mirrors TypingConfirmModal's
 * contract). Rollback fires only after the user types the
 * connection name verbatim.
 *
 * The typed-confirm flow is inlined (not a re-use of `TypingConfirmModal`
 * proper) so we can attach stable test ids and keep the modal stack flat.
 * The behaviour matches the existing S8 pattern: case-insensitive token
 * match against the connection name.
 */

import { Editor } from "@monaco-editor/react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { type JSX, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/Dialog";
import { errorToMessage } from "../../lib/errors";
import type { Environment } from "../../lib/tauri";
import type { Migration } from "./store";

type SqlPreview = { sql: string };
type RollbackResult = { rolledBack: string; error: string | null };

interface Props {
  open: boolean;
  connectionId: string;
  connectionName: string;
  environment: Environment;
  migration: Migration;
  onClose(): void;
  onRolledBack(result: RollbackResult): void;
}

export function RollbackDialog(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { open, connectionId, connectionName, environment, migration, onClose, onRolledBack } =
    props;

  const [preview, setPreview] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rolling, setRolling] = useState<boolean>(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [typed, setTyped] = useState<string>("");

  const hasDown = migration.downPath !== null;
  const isProd = environment === "prod";

  // Fetch preview on mount when downPath is available.
  useEffect(() => {
    if (!hasDown) {
      setPreview("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    (async () => {
      try {
        const res = (await invoke("migrations_preview_down", {
          connId: connectionId,
          version: migration.version,
        })) as SqlPreview;
        if (!cancelled) setPreview(res.sql);
      } catch (err) {
        if (!cancelled) {
          setPreviewError(errorToMessage(err));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasDown, connectionId, migration.version]);

  const performRollback = useCallback(async () => {
    setRolling(true);
    setRollbackError(null);
    try {
      const res = (await invoke("migrations_rollback", {
        connId: connectionId,
        version: migration.version,
      })) as RollbackResult;
      onRolledBack(res);
      onClose();
    } catch (err) {
      setRollbackError(errorToMessage(err));
    } finally {
      setRolling(false);
      setConfirmOpen(false);
      setTyped("");
    }
  }, [connectionId, migration.version, onClose, onRolledBack]);

  const handleClickRollback = useCallback(() => {
    if (!hasDown || rolling) return;
    if (isProd) {
      setConfirmOpen(true);
      return;
    }
    void performRollback();
  }, [hasDown, rolling, isProd, performRollback]);

  const noDownTooltip = !hasDown ? t("migrations.rollback.noDownFile") : undefined;

  return (    <>
      <Dialog
        open={open && !confirmOpen}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={t("migrations.rollback.title", { version: migration.version })}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={rolling}>
              {t("migrations.rollback.cancel")}
            </button>
            <button
              type="button"
              data-testid="rollback-dialog-confirm"
              className="btn btn-danger"
              disabled={!hasDown || rolling || previewLoading}
              title={noDownTooltip}
              onClick={handleClickRollback}
            >
              {rolling ? t("migrations.rollback.rollingBack") : t("migrations.rollback.rollback")}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {!hasDown ? (            <div
              data-testid="rollback-dialog-no-down"
              role="alert"
              style={{ color: "var(--warn, #d49b1c)", fontSize: 13 }}
            >
              ⚠ {t("migrations.rollback.noDownFile")}
            </div>
) : null}
          {previewError ? (            <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
              {t("migrations.rollback.previewError", { error: previewError })}
            </div>
) : null}
          {rollbackError ? (            <div role="alert" style={{ color: "var(--err, #d33)", fontSize: 12 }}>
              {rollbackError}
            </div>
) : null}
          <div style={{ height: 280, border: "1px solid var(--hairline)", borderRadius: 4 }}>
            <Editor
              height="280px"
              defaultLanguage="sql"
              value={previewLoading ? `-- ${t("migrations.rollback.previewLoading")}` : preview}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        </div>
      </Dialog>

      {/*
        Inline typed-confirm gate (mirrors TypingConfirmModal's contract).
        Kept alongside this component so we own the test ids; the visible
        contract — case-insensitive name match → red Rollback unlocks — is
        identical to S8.
      */}
      <RadixDialog.Root
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmOpen(false);
            setTyped("");
          }
        }}
      >
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="q-backdrop" />
          <RadixDialog.Content className="q-modal sm" style={{ padding: 24 }}>
            <RadixDialog.Title className="q-modal-title">
              {t("migrations.rollback.prodTitle")}
            </RadixDialog.Title>
            <RadixDialog.Description
              style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-3)" }}
            >
              {t("migrations.rollback.prodDescription", {
                version: migration.version,
                name: connectionName,
              })}
            </RadixDialog.Description>
            <div className="q-field" style={{ marginTop: 12 }}>
              <label htmlFor="rollback-dialog-typing-input">
                {t("migrations.rollback.prodInputLabel")}
              </label>
              <input
                id="rollback-dialog-typing-input"
                data-testid="rollback-dialog-typing-input"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                // biome-ignore lint/a11y/noAutofocus: focus the type-prompt input on dialog open
                autoFocus
                className="q-input mono"
              />
            </div>
            <div
              style={{
                marginTop: 18,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setConfirmOpen(false);
                  setTyped("");
                }}
              >
                {t("migrations.rollback.cancel")}
              </button>
              <button
                type="button"
                data-testid="rollback-dialog-typing-confirm"
                className="btn btn-danger"
                disabled={
                  rolling || typed.trim().toLowerCase() !== connectionName.trim().toLowerCase()
                }
                onClick={() => {
                  void performRollback();
                }}
              >
                {rolling ? t("migrations.rollback.rollingBack") : t("migrations.rollback.rollback")}
              </button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </>
);
}
