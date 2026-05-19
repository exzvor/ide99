/**
 * — Snippet create/edit modal.
 *
 * Radix Dialog hosting a react-hook-form with a zod resolver. Same form
 * is reused for "new" and "edit": when `editing` is null the form starts
 * empty and `create` is called on submit; otherwise it is seeded with
 * the existing snippet and `update` is called.
 *
 * Validation rules (mirror the Rust DTO contract — Tauri rejects on
 * mismatch but we validate client-side first for instant feedback):
 * - label: 1..200 chars
 * - prefix: 1..32 chars, ^[A-Za-z][A-Za-z0-9_]*$ (matches Monaco IntelliSense
 * trigger character class)
 * - body: 1..10_000 chars
 * - documentation: optional, ≤2000 chars
 */

import { zodResolver } from "@hookform/resolvers/zod";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useToast } from "../../components/Toast";
import type { UserSnippet } from "../../lib/tauri";
import { useSnippets } from "./store";

function formatBackendError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
) {
    return (err as { message: string }).message;
  }
  return String(err);
}

const formSchema = z.object({
  label: z.string().min(1, "label required").max(200),
  prefix: z
    .string()
    .min(1, "prefix required")
    .max(32)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "must start with a letter; [A-Za-z0-9_]"),
  body: z.string().min(1, "body required").max(10_000),
  documentation: z.string().max(2000).default(""),
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  editing: UserSnippet | null;
  onClose: () => void;
}

export function SnippetEditor({ open, editing, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useSnippets((s) => s.create);
  const update = useSnippets((s) => s.update);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { label: "", prefix: "", body: "", documentation: "" },
  });

  // Re-seed form values whenever the modal opens or `editing` changes —
  // RHF caches `defaultValues` on first mount, so without an explicit
  // reset the second open of the modal would show stale state.
  useEffect(() => {
    if (open) {
      setSubmitError(null);
      reset(editing ?? { label: "", prefix: "", body: "", documentation: "" });
    }
  }, [open, editing, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      if (editing) {
        await update(editing.id, values);
      } else {
        await create(values);
      }
      reset();
      onClose();
    } catch (err) {
      // Surface backend errors so users aren't left wondering why the
      // form stays open. Common cases: prefix/body validation rejected
      // server-side, IPC error, storage full. SnippetError comes back
      // as a plain { kind, message } object (lib/tauri only auto-wraps
      // ConnectionError); peel it manually so the toast doesn't render
      // as "[object Object]".
      const message = formatBackendError(err);
      setSubmitError(message);
      toast.error(message);
    }
  });

  return (    <Dialog.Root open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="snippet-editor-overlay" />
        <Dialog.Content className="snippet-editor-content" aria-describedby={undefined}>
          <Dialog.Title>
            {editing ? t("snippets.editor.editTitle") : t("snippets.editor.newTitle")}
          </Dialog.Title>
          <form onSubmit={onSubmit} className="snippet-editor-form">
            <label>
              {t("snippets.editor.label")}
              <input {...register("label")} />
              {errors.label && <span className="error">{errors.label.message}</span>}
            </label>
            <label>
              {t("snippets.editor.prefix")}
              <input {...register("prefix")} />
              {errors.prefix && <span className="error">{errors.prefix.message}</span>}
            </label>
            <label>
              {t("snippets.editor.body")}
              <textarea {...register("body")} rows={8} />
              {errors.body && <span className="error">{errors.body.message}</span>}
            </label>
            <label>
              {t("snippets.editor.documentation")}
              <textarea {...register("documentation")} rows={2} />
            </label>
            {submitError && <span className="error">{submitError}</span>}
            <div className="snippet-editor-actions">
              <button type="button" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button type="submit" disabled={isSubmitting}>
                {editing ? t("common.save") : t("common.create")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
);
}
