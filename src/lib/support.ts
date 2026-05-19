/**
 * Typed wrapper around the Rust `support_send_feedback` Tauri command.
 *
 * The Rust side POSTs to the ide99-landing API (`/api/feedback`), which
 * sends mail to the operator mailbox via Yandex Postbox with the user's
 * email in Reply-To. Locale is passed through so the Rust client picks
 * the RU or INTL endpoint.
 */

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const screenshotSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  dataBase64: z.string().min(1),
});
export type SupportScreenshot = z.infer<typeof screenshotSchema>;

function locale(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en";
}

export async function supportSendFeedback(input: {
  email: string;
  message: string;
  screenshots: SupportScreenshot[];
}): Promise<void> {
  await invoke<void>("support_send_feedback", {
    locale: locale(),
    email: input.email,
    message: input.message,
    screenshots: input.screenshots,
  });
}
