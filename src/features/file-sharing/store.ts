// — file-sharing zustand store.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import type {
  ExportedErdLayout,
  ExportedHealthConfig,
  ExportedKeymap,
  ExportedTheme,
  ImportPreview,
  ShareEnvelope,
} from "./types";

type State = {
  preview: ImportPreview | null;
  // Per-kind export wrappers.
  exportConnection: (connectionId: string, path: string) => Promise<void>;
  exportConnectionBundle: (name: string, connectionIds: string[], path: string) => Promise<void>;
  exportSnippet: (snippetId: number, path: string) => Promise<void>;
  exportSnippetBundle: (name: string, snippetIds: number[], path: string) => Promise<void>;
  exportQuery: (tabId: string, path: string) => Promise<void>;
  exportNotebook: (notebookId: string, path: string) => Promise<void>;
  exportMigrationSet: (label: string, srcDir: string, path: string) => Promise<void>;
  exportErdLayout: (
    label: string,
    schemasKey: string,
    positions: Array<{ nodeId: string; x: number; y: number }>,
    path: string,
  ) => Promise<void>;
  exportTheme: (name: string, tokens: Record<string, unknown>, path: string) => Promise<void>;
  exportKeymap: (name: string, bindings: unknown[], path: string) => Promise<void>;
  exportHealthConfig: (
    label: string,
    checks: Record<string, unknown>,
    path: string,
  ) => Promise<void>;

  // Preview / import.
  previewFile: (path: string) => Promise<ImportPreview>;
  importFile: (path: string) => Promise<ShareEnvelope>;
  clearPreview: () => void;

  // Per-kind apply pipelines — dispatched by ShareImportDialog after preview.
  applySnippet: (payload: unknown) => Promise<number>;
  applySnippetBundle: (payload: unknown) => Promise<number>;
  applyQuery: (payload: unknown) => Promise<string>;
  applyNotebook: (payload: unknown) => Promise<string>;
  applyMigrationSet: (payload: unknown, destDir: string) => Promise<number>;
  applyErdLayout: (payload: unknown) => Promise<ExportedErdLayout>;
  applyTheme: (payload: unknown) => Promise<ExportedTheme>;
  applyKeymap: (payload: unknown) => Promise<ExportedKeymap>;
  applyHealthConfig: (payload: unknown) => Promise<ExportedHealthConfig>;
};

export const useFileSharing = create<State>((set) => ({
  preview: null,

  exportConnection: async (connectionId, path) => {
    await invoke<void>("ide99_export_connection", { connectionId, path });
  },

  exportConnectionBundle: async (name, connectionIds, path) => {
    await invoke<void>("ide99_export_connection_bundle", { name, connectionIds, path });
  },

  exportSnippet: async (snippetId, path) => {
    await invoke<void>("ide99_export_snippet", { snippetId, path });
  },

  exportSnippetBundle: async (name, snippetIds, path) => {
    await invoke<void>("ide99_export_snippet_bundle", { name, snippetIds, path });
  },

  exportQuery: async (tabId, path) => {
    await invoke<void>("ide99_export_query", { tabId, path });
  },

  exportNotebook: async (notebookId, path) => {
    await invoke<void>("ide99_export_notebook", { notebookId, path });
  },

  exportMigrationSet: async (label, srcDir, path) => {
    await invoke<void>("ide99_export_migration_set", { label, srcDir, path });
  },

  exportErdLayout: async (label, schemasKey, positions, path) => {
    await invoke<void>("ide99_export_erd_layout", { label, schemasKey, positions, path });
  },

  exportTheme: async (name, tokens, path) => {
    await invoke<void>("ide99_export_theme", { name, tokens, path });
  },

  exportKeymap: async (name, bindings, path) => {
    await invoke<void>("ide99_export_keymap", { name, bindings, path });
  },

  exportHealthConfig: async (label, checks, path) => {
    await invoke<void>("ide99_export_health_config", { label, checks, path });
  },

  previewFile: async (path) => {
    const preview = await invoke<ImportPreview>("ide99_preview_file", { path });
    set({ preview });
    return preview;
  },

  importFile: async (path) => invoke<ShareEnvelope>("ide99_import_file", { path }),

  clearPreview: () => set({ preview: null }),

  applySnippet: async (payload) => invoke<number>("ide99_apply_snippet", { payload }),
  applySnippetBundle: async (payload) => invoke<number>("ide99_apply_snippet_bundle", { payload }),
  applyQuery: async (payload) => invoke<string>("ide99_apply_query", { payload }),
  applyNotebook: async (payload) => invoke<string>("ide99_apply_notebook", { payload }),
  applyMigrationSet: async (payload, destDir) =>
    invoke<number>("ide99_apply_migration_set", { payload, destDir }),
  applyErdLayout: async (payload) =>
    invoke<ExportedErdLayout>("ide99_apply_erd_layout", { payload }),
  applyTheme: async (payload) => invoke<ExportedTheme>("ide99_apply_theme", { payload }),
  applyKeymap: async (payload) => invoke<ExportedKeymap>("ide99_apply_keymap", { payload }),
  applyHealthConfig: async (payload) =>
    invoke<ExportedHealthConfig>("ide99_apply_health_config", { payload }),
}));
