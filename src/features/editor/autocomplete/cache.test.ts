import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutocompleteSnapshot } from "../../../lib/tauri";
import { useAutocompleteCache } from "./cache";

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return {
    ...actual,
    schemaGetAutocompleteSnapshot: vi.fn(),
  };
});

import { schemaGetAutocompleteSnapshot } from "../../../lib/tauri";

const fakeSnapshot = (connId: string): AutocompleteSnapshot => ({
  connId,
  searchPath: ["public"],
  relations: [
    {
      schema: "public",
      name: "users",
      kind: "table",
      columns: [
        { name: "id", dataType: "bigint", nullable: false, isJsonb: false },
        { name: "name", dataType: "text", nullable: true, isJsonb: false },
      ],
    },
  ],
  loadedAt: 1234,
});

describe("useAutocompleteCache", () => {
  beforeEach(() => {
    useAutocompleteCache.setState({ snapshots: {}, inflight: {}, errors: {} });
    vi.mocked(schemaGetAutocompleteSnapshot).mockReset();
  });

  it("loadSnapshot fetches and caches per connId", async () => {
    vi.mocked(schemaGetAutocompleteSnapshot).mockResolvedValue(fakeSnapshot("c1"));
    const store = useAutocompleteCache.getState();
    const snap = await store.loadSnapshot("c1");
    expect(snap?.relations[0].name).toBe("users");
    expect(useAutocompleteCache.getState().getSnapshot("c1")).toBeDefined();
  });

  it("dedupes concurrent loadSnapshot calls", async () => {
    vi.mocked(schemaGetAutocompleteSnapshot).mockResolvedValue(fakeSnapshot("c1"));
    const store = useAutocompleteCache.getState();
    await Promise.all([store.loadSnapshot("c1"), store.loadSnapshot("c1")]);
    expect(vi.mocked(schemaGetAutocompleteSnapshot)).toHaveBeenCalledTimes(1);
  });

  it("refresh re-fetches even when cached", async () => {
    vi.mocked(schemaGetAutocompleteSnapshot)
      .mockResolvedValueOnce(fakeSnapshot("c1"))
      .mockResolvedValueOnce(fakeSnapshot("c1"));
    const store = useAutocompleteCache.getState();
    await store.loadSnapshot("c1");
    await store.refresh("c1");
    expect(vi.mocked(schemaGetAutocompleteSnapshot)).toHaveBeenCalledTimes(2);
  });

  it("evict drops snapshot for a connId", async () => {
    vi.mocked(schemaGetAutocompleteSnapshot).mockResolvedValue(fakeSnapshot("c1"));
    const store = useAutocompleteCache.getState();
    await store.loadSnapshot("c1");
    store.evict("c1");
    expect(useAutocompleteCache.getState().getSnapshot("c1")).toBeUndefined();
  });

  it("loadSnapshot calls retrigger callback once snapshot resolves", async () => {
    vi.mocked(schemaGetAutocompleteSnapshot).mockResolvedValue(fakeSnapshot("c1"));
    const onResolved = vi.fn();
    await useAutocompleteCache.getState().loadSnapshot("c1", onResolved);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("captures fetch error in errors map", async () => {
    vi.mocked(schemaGetAutocompleteSnapshot).mockRejectedValue(new Error("boom"));
    const store = useAutocompleteCache.getState();
    const snap = await store.loadSnapshot("c1");
    expect(snap).toBeUndefined();
    expect(useAutocompleteCache.getState().errors.c1).toBe("boom");
  });
});
