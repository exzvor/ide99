import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSnippet } from "../../lib/tauri";
import { useSnippets } from "./store";

vi.mock("../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tauri")>("../../lib/tauri");
  return {
    ...actual,
    snippetsList: vi.fn(),
    snippetsCreate: vi.fn(),
    snippetsUpdate: vi.fn(),
    snippetsDelete: vi.fn(),
    snippetsExport: vi.fn(),
    snippetsImport: vi.fn(),
  };
});
import { snippetsCreate, snippetsDelete, snippetsList, snippetsUpdate } from "../../lib/tauri";

const fake = (id: number, overrides: Partial<UserSnippet> = {}): UserSnippet => ({
  id,
  label: `Snippet ${id}`,
  prefix: `s${id}`,
  body: "SELECT",
  documentation: "",
  createdAt: "2026-04-28T00:00:00.000Z",
  updatedAt: "2026-04-28T00:00:00.000Z",
  ...overrides,
});

describe("useSnippets", () => {
  beforeEach(() => {
    useSnippets.setState({ userSnippets: [], paletteOpen: false, loading: false, error: null });
    vi.mocked(snippetsList).mockReset();
    vi.mocked(snippetsCreate).mockReset();
    vi.mocked(snippetsUpdate).mockReset();
    vi.mocked(snippetsDelete).mockReset();
  });

  it("load() populates userSnippets", async () => {
    vi.mocked(snippetsList).mockResolvedValue([fake(1), fake(2)]);
    await useSnippets.getState().load();
    expect(useSnippets.getState().userSnippets).toHaveLength(2);
  });

  it("create() prepends to userSnippets", async () => {
    useSnippets.setState({ userSnippets: [fake(1)] });
    vi.mocked(snippetsCreate).mockResolvedValue(fake(2, { label: "new" }));
    await useSnippets
      .getState()
      .create({ label: "new", prefix: "n", body: "x", documentation: "" });
    const list = useSnippets.getState().userSnippets;
    expect(list[0].label).toBe("new");
    expect(list).toHaveLength(2);
  });

  it("update() replaces in place", async () => {
    useSnippets.setState({ userSnippets: [fake(1, { label: "old" })] });
    vi.mocked(snippetsUpdate).mockResolvedValue(fake(1, { label: "new" }));
    await useSnippets.getState().update(1, {
      label: "new",
      prefix: "s1",
      body: "SELECT",
      documentation: "",
    });
    expect(useSnippets.getState().userSnippets[0].label).toBe("new");
  });

  it("delete() removes by id", async () => {
    useSnippets.setState({ userSnippets: [fake(1), fake(2)] });
    vi.mocked(snippetsDelete).mockResolvedValue(undefined);
    await useSnippets.getState().delete(1);
    expect(useSnippets.getState().userSnippets.map((s) => s.id)).toEqual([2]);
  });

  it("openPalette() / closePalette() flip flag", () => {
    useSnippets.getState().openPalette();
    expect(useSnippets.getState().paletteOpen).toBe(true);
    useSnippets.getState().closePalette();
    expect(useSnippets.getState().paletteOpen).toBe(false);
  });

  it("getMerged() returns built-ins + user; user wins on prefix collision", () => {
    useSnippets.setState({
      userSnippets: [fake(99, { label: "MyOverride", prefix: "sel", body: "MY SELECT" })],
    });
    const merged = useSnippets.getState().getMerged();
    // 17 built-ins + 1 user = 18 minus 1 hidden built-in (override on "sel") = 17
    expect(merged.find((s) => s.label === "MyOverride")).toBeDefined();
    // built-in with prefix "sel" is hidden by the override
    const collisions = merged.filter((s) => s.prefixes.includes("sel"));
    expect(collisions).toHaveLength(1);
    expect(collisions[0].label).toBe("MyOverride");
  });
});
