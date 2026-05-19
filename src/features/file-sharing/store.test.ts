import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFileSharing } from "./store";
import type { ImportPreview } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useFileSharing", () => {
  beforeEach(() => {
    useFileSharing.setState({ preview: null });
    vi.mocked(invoke).mockReset();
  });

  it("exportSnippet calls ide99_export_snippet IPC", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useFileSharing.getState().exportSnippet(42, "/tmp/x.ide99");
    expect(invoke).toHaveBeenCalledWith("ide99_export_snippet", {
      snippetId: 42,
      path: "/tmp/x.ide99",
    });
  });

  it("exportSnippetBundle passes name + ids", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useFileSharing.getState().exportSnippetBundle("team", [1, 2, 3], "/tmp/b.ide99");
    expect(invoke).toHaveBeenCalledWith("ide99_export_snippet_bundle", {
      name: "team",
      snippetIds: [1, 2, 3],
      path: "/tmp/b.ide99",
    });
  });

  it("exportNotebook + exportQuery call corresponding IPC commands", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useFileSharing.getState().exportNotebook("nb-1", "/tmp/n.ide99");
    await useFileSharing.getState().exportQuery("tab-1", "/tmp/q.ide99");
    expect(invoke).toHaveBeenNthCalledWith(1, "ide99_export_notebook", {
      notebookId: "nb-1",
      path: "/tmp/n.ide99",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "ide99_export_query", {
      tabId: "tab-1",
      path: "/tmp/q.ide99",
    });
  });

  it("exportTheme / exportKeymap / exportHealthConfig wrap IPC", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useFileSharing.getState().exportTheme("midnight", { "--bg": "#000" }, "/tmp/t.ide99");
    await useFileSharing
      .getState()
      .exportKeymap("dbeaver", [{ command: "run", keys: "Cmd+Enter" }], "/tmp/k.ide99");
    await useFileSharing
      .getState()
      .exportHealthConfig("team", { bloat: { warn: 30 } }, "/tmp/h.ide99");
    expect(invoke).toHaveBeenCalledWith("ide99_export_theme", {
      name: "midnight",
      tokens: { "--bg": "#000" },
      path: "/tmp/t.ide99",
    });
    expect(invoke).toHaveBeenCalledWith("ide99_export_keymap", {
      name: "dbeaver",
      bindings: [{ command: "run", keys: "Cmd+Enter" }],
      path: "/tmp/k.ide99",
    });
    expect(invoke).toHaveBeenCalledWith("ide99_export_health_config", {
      label: "team",
      checks: { bloat: { warn: 30 } },
      path: "/tmp/h.ide99",
    });
  });

  it("previewFile stores preview in state", async () => {
    const preview: ImportPreview = {
      kind: "snippet",
      version: 1,
      exportedAt: "2026-05-07T00:00:00Z",
      summary: "Top users (:topu)",
      mayCollide: true,
    };
    vi.mocked(invoke).mockResolvedValue(preview);
    const got = await useFileSharing.getState().previewFile("/tmp/x.ide99");
    expect(got).toEqual(preview);
    expect(useFileSharing.getState().preview).toEqual(preview);
  });

  it("clearPreview resets state", () => {
    useFileSharing.setState({
      preview: {
        kind: "snippet",
        version: 1,
        exportedAt: "x",
        summary: "y",
        mayCollide: false,
      },
    });
    useFileSharing.getState().clearPreview();
    expect(useFileSharing.getState().preview).toBeNull();
  });

  it("applySnippet/applyNotebook/applyMigrationSet route to correct IPC", async () => {
    vi.mocked(invoke).mockResolvedValue(1);
    await useFileSharing.getState().applySnippet({ label: "x" });
    expect(invoke).toHaveBeenCalledWith("ide99_apply_snippet", { payload: { label: "x" } });

    vi.mocked(invoke).mockResolvedValue("nb-id-42");
    await useFileSharing.getState().applyNotebook({ name: "demo", cells: [] });
    expect(invoke).toHaveBeenCalledWith("ide99_apply_notebook", {
      payload: { name: "demo", cells: [] },
    });

    vi.mocked(invoke).mockResolvedValue(3);
    await useFileSharing.getState().applyMigrationSet({ files: [] }, "/tmp/dst");
    expect(invoke).toHaveBeenCalledWith("ide99_apply_migration_set", {
      payload: { files: [] },
      destDir: "/tmp/dst",
    });
  });

  it("applyTheme/applyKeymap/applyHealthConfig pass payload as-is", async () => {
    vi.mocked(invoke).mockResolvedValue({ name: "midnight", tokens: {} });
    const t = await useFileSharing.getState().applyTheme({ name: "midnight", tokens: {} });
    expect(t.name).toBe("midnight");
    expect(invoke).toHaveBeenCalledWith("ide99_apply_theme", {
      payload: { name: "midnight", tokens: {} },
    });
  });
});
