/**
 * Typed wrapper around the Rust `instant_db_*` Tauri commands.
 *
 * Server is the ide99 Instant Beta control service (Yandex Cloud). HMAC is
 * baked into the Rust binary — the frontend never sees the secret. Locale is
 * passed through so the Rust client can pick the RU vs INTL endpoint.
 */

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

export const instantDbCreateSchema = z.object({
  dbId: z.string(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  connectionString: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  ttlSeconds: z.number().int().nonnegative(),
});
export type InstantDbCreate = z.infer<typeof instantDbCreateSchema>;

export const instantDbStatusSchema = z.object({
  dbId: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  secondsRemaining: z.number().int(),
});
export type InstantDbStatus = z.infer<typeof instantDbStatusSchema>;

function locale(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en";
}

export async function instantDbCreate(): Promise<InstantDbCreate> {
  const raw = await invoke<unknown>("instant_db_create", { locale: locale() });
  return instantDbCreateSchema.parse(raw);
}

export async function instantDbStatus(dbId: string): Promise<InstantDbStatus> {
  const raw = await invoke<unknown>("instant_db_status", { locale: locale(), dbId });
  return instantDbStatusSchema.parse(raw);
}

export async function instantDbHeartbeat(dbId: string): Promise<InstantDbStatus> {
  const raw = await invoke<unknown>("instant_db_heartbeat", { locale: locale(), dbId });
  return instantDbStatusSchema.parse(raw);
}

export async function instantDbDelete(dbId: string): Promise<void> {
  await invoke<void>("instant_db_delete", { locale: locale(), dbId });
}
