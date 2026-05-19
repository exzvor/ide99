import { Loader2, Paperclip, X } from "lucide-react";
import { type JSX, useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { type SupportScreenshot, supportSendFeedback } from "../../lib/support";

interface SupportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PendingScreenshot extends SupportScreenshot {
  /** Raw byte count so we can render a size badge without round-tripping the base64. */
  bytes: number;
}

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_FILES = 3;
const MAX_PER_FILE_BYTES = 5 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked → btoa: avoids the "Maximum call stack size exceeded" RangeError
  // when fromCharCode is called on a multi-MB Uint8Array in one shot.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SupportDialog({ open, onOpenChange }: SupportDialogProps): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const emailId = useId();
  const messageId = useId();
  const fileInputId = useId();

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [screenshots, setScreenshots] = useState<PendingScreenshot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; message?: string }>({});

  const reset = useCallback(() => {
    setEmail("");
    setMessage("");
    setScreenshots([]);
    setErrors({});
    setSubmitting(false);
  }, []);

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleFilesPicked = useCallback(    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const next: PendingScreenshot[] = [];
      const room = MAX_FILES - screenshots.length;
      if (room <= 0) {
        toast.error(          t("support.dialog.error.too_many", {
            defaultValue: "Maximum {{n}} screenshots",
            n: MAX_FILES,
          }),
);
        return;
      }
      const slice = Array.from(files).slice(0, room);
      for (const file of slice) {
        if (!ALLOWED_TYPES.has(file.type)) {
          toast.error(            t("support.dialog.error.bad_type", {
              defaultValue: "Unsupported file: {{name}}",
              name: file.name,
            }),
);
          continue;
        }
        if (file.size > MAX_PER_FILE_BYTES) {
          toast.error(            t("support.dialog.error.too_large", {
              defaultValue: "{{name}} is over {{limit}}",
              name: file.name,
              limit: formatBytes(MAX_PER_FILE_BYTES),
            }),
);
          continue;
        }
        try {
          const dataBase64 = await readAsBase64(file);
          next.push({
            filename: file.name || "screenshot.png",
            contentType: file.type,
            dataBase64,
            bytes: file.size,
          });
        } catch (err) {
          toast.error(            t("support.dialog.error.read_failed", {
              defaultValue: "Failed to read {{name}}",
              name: file.name,
            }),
);
          if (err instanceof Error) {
            console.error("[support] read failed", err.message);
          }
        }
      }
      if (next.length > 0) {
        setScreenshots((prev) => [...prev, ...next]);
      }
    },
    [screenshots.length, t, toast],
);

  const removeScreenshot = useCallback((idx: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const onSubmit = useCallback(async () => {
    if (submitting) return;
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedMessage = message.trim();
    const nextErrors: { email?: string; message?: string } = {};
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      nextErrors.email = t("support.dialog.error.email_required", {
        defaultValue: "Please enter a valid email so we can reply.",
      });
    }
    if (!trimmedMessage) {
      nextErrors.message = t("support.dialog.error.message_required", {
        defaultValue: "Tell us what's going on so we can help.",
      });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await supportSendFeedback({
        email: trimmedEmail,
        message: trimmedMessage,
        screenshots: screenshots.map(({ filename, contentType, dataBase64 }) => ({
          filename,
          contentType,
          dataBase64,
        })),
      });
      toast.success(        t("support.dialog.success", {
          defaultValue: "Sent — thanks, we'll get back to you.",
        }),
);
      reset();
      close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(        t("support.dialog.error.send_failed", {
          defaultValue: "Couldn't send: {{msg}}",
          msg,
        }),
);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, email, message, screenshots, t, toast, reset, close]);

  const handleOpenChange = useCallback(    (next: boolean) => {
      if (next) return;
      if (submitting) return;
      reset();
      onOpenChange(false);
    },
    [submitting, reset, onOpenChange],
);

  return (    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("support.dialog.title", { defaultValue: "Support" })}
      description={t("support.dialog.description", {
        defaultValue:
          "Questions, ideas, or found a bug — write to us. Attach screenshots if it helps tell the story.",
      })}
      size="md"
      closeAriaLabel={t("support.dialog.close", { defaultValue: "Close" })}
      footer={
        <>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
            className="btn btn-ghost"
            data-testid="support-cancel"
          >
            {t("support.dialog.cancel", { defaultValue: "Cancel" })}
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={submitting}
            className="btn btn-primary"
            data-testid="support-submit"
          >
            {submitting ? <Loader2 size={14} className="q-spin" aria-hidden="true" /> : null}
            {submitting
              ? t("support.dialog.sending", { defaultValue: "Sending…" })
              : t("support.dialog.send", { defaultValue: "Send" })}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
      >
        <div className="q-field">
          <label htmlFor={emailId}>
            {t("support.dialog.field.email", { defaultValue: "Your email" })}
            <span aria-hidden="true" className="req" style={{ marginLeft: 4 }}>
              *
            </span>
          </label>
          <input
            id={emailId}
            type="email"
            className="q-input"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            placeholder={t("support.dialog.field.email_placeholder", {
              defaultValue: "you@example.com",
            })}
            aria-invalid={errors.email ? "true" : undefined}
            data-testid="support-email"
          />
          {errors.email ? (            <p role="alert" style={{ fontSize: 11, color: "var(--danger-q)", margin: 0 }}>
              {errors.email}
            </p>
) : null}
        </div>

        <div className="q-field">
          <label htmlFor={messageId}>
            {t("support.dialog.field.message", { defaultValue: "Message" })}
            <span aria-hidden="true" className="req" style={{ marginLeft: 4 }}>
              *
            </span>
          </label>
          <textarea
            id={messageId}
            className="q-input"
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
            placeholder={t("support.dialog.field.message_placeholder", {
              defaultValue: "What happened? What did you expect to happen?",
            })}
            aria-invalid={errors.message ? "true" : undefined}
            data-testid="support-message"
            style={{ resize: "vertical", minHeight: 120, fontFamily: "inherit" }}
          />
          {errors.message ? (            <p role="alert" style={{ fontSize: 11, color: "var(--danger-q)", margin: 0 }}>
              {errors.message}
            </p>
) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
            {t("support.dialog.field.screenshots", {
              defaultValue: "Screenshots (optional, up to {{n}})",
              n: MAX_FILES,
            })}
          </span>
          <label
            htmlFor={fileInputId}
            className="btn btn-ghost"
            style={{
              alignSelf: "flex-start",
              cursor: screenshots.length >= MAX_FILES ? "not-allowed" : "pointer",
              opacity: screenshots.length >= MAX_FILES ? 0.5 : 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Paperclip size={14} aria-hidden="true" />
            {t("support.dialog.field.attach", { defaultValue: "Attach images" })}
          </label>
          <input
            id={fileInputId}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            data-testid="support-screenshot-input"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              whiteSpace: "nowrap",
            }}
            disabled={screenshots.length >= MAX_FILES}
            onChange={(e) => {
              void handleFilesPicked(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
          {screenshots.length > 0 ? (            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
              data-testid="support-screenshot-list"
            >
              {screenshots.map((s, idx) => (                <li
                  key={`${s.filename}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 8px",
                    background: "var(--surface-2, rgba(99,102,241,0.06))",
                    border: "1px solid var(--ink-7, rgba(120,120,140,0.2))",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.filename}
                  </span>
                  <span style={{ color: "var(--ink-4)", fontSize: 11 }}>
                    {formatBytes(s.bytes)}
                  </span>
                  <button
                    type="button"
                    aria-label={t("support.dialog.remove_screenshot", {
                      defaultValue: "Remove {{name}}",
                      name: s.filename,
                    })}
                    onClick={() => removeScreenshot(idx)}
                    className="btn-icon"
                    style={{ width: 24, height: 24 }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
))}
            </ul>
) : null}
        </div>
      </form>
    </Dialog>
);
}
