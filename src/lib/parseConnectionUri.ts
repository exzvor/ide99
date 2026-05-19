/**
 * Frontend convenience wrapper. Mirrors the Rust `parse_connection_uri`
 * Tauri command — the actual parsing happens in Rust via the `url` crate
 * for RFC-3986 compliance (percent encoding, IPv6 brackets, etc.). This
 * module is a thin re-export so consumers don't import directly from
 * `tauri.ts` for clarity, and to keep a single seam for unit-test mocking.
 */
import { type ParsedUri, parseConnectionUri as parseViaTauri } from "./tauri";

export async function parseConnectionUri(uri: string): Promise<ParsedUri> {
  return await parseViaTauri(uri);
}

export type { ParsedUri };
