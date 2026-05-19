import { beforeEach, describe, expect, it } from "vitest";
import { makeAddColumnOp, makeAddTableOp, makeMoveTableOp } from "./ops";
import { useEditStore } from "./store";

const TAB = "tab-1";

beforeEach(() => useEditStore.getState().reset());

describe("edit/store", () => {
  it("starts empty per-tab", () => {
    const s = useEditStore.getState();
    expect(s.getOps(TAB)).toEqual([]);
    expect(s.canUndo(TAB)).toBe(false);
    expect(s.canRedo(TAB)).toBe(false);
    expect(s.isDirty(TAB)).toBe(false);
    expect(s.getMode(TAB)).toBe("read");
  });

  it("toggleMode flips edit/read but preserves ops", () => {
    const s = useEditStore.getState();
    s.toggleMode(TAB);
    expect(s.getMode(TAB)).toBe("edit");
    s.pushOp(TAB, makeAddTableOp("public", "events"));
    s.toggleMode(TAB);
    expect(s.getMode(TAB)).toBe("read");
    expect(s.getOps(TAB)).toHaveLength(1);
  });

  it("pushOp + undo + redo", () => {
    const s = useEditStore.getState();
    const op = makeAddTableOp("public", "events");
    s.pushOp(TAB, op);
    expect(s.getOps(TAB)).toHaveLength(1);
    expect(s.canUndo(TAB)).toBe(true);
    expect(s.canRedo(TAB)).toBe(false);
    expect(s.isDirty(TAB)).toBe(true);

    s.undo(TAB);
    expect(s.getOps(TAB)).toHaveLength(0);
    expect(s.canUndo(TAB)).toBe(false);
    expect(s.canRedo(TAB)).toBe(true);

    s.redo(TAB);
    expect(s.getOps(TAB)).toHaveLength(1);
    expect(s.canRedo(TAB)).toBe(false);
  });

  it("pushOp after undo clears future stack", () => {
    const s = useEditStore.getState();
    s.pushOp(TAB, makeAddTableOp("public", "a"));
    s.undo(TAB);
    expect(s.canRedo(TAB)).toBe(true);
    s.pushOp(TAB, makeAddTableOp("public", "b"));
    expect(s.canRedo(TAB)).toBe(false);
  });

  it("moveTable ops coalesce on consecutive same-table moves", () => {
    const s = useEditStore.getState();
    const ref = { schema: "public", name: "users" };
    s.pushOp(TAB, makeMoveTableOp(ref, 100, 50));
    s.pushOp(TAB, makeMoveTableOp(ref, 110, 60));
    s.pushOp(TAB, makeMoveTableOp(ref, 120, 70));
    const ops = s.getOps(TAB);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("moveTable");
    if (ops[0].kind === "moveTable") {
      expect(ops[0].x).toBe(120);
      expect(ops[0].y).toBe(70);
    }
  });

  it("moveTable does not coalesce across different tables", () => {
    const s = useEditStore.getState();
    s.pushOp(TAB, makeMoveTableOp({ schema: "public", name: "a" }, 100, 50));
    s.pushOp(TAB, makeMoveTableOp({ schema: "public", name: "b" }, 200, 60));
    expect(s.getOps(TAB)).toHaveLength(2);
  });

  it("discard clears ops + history; not dirty afterwards", () => {
    const s = useEditStore.getState();
    s.pushOp(TAB, makeAddTableOp("public", "x"));
    s.pushOp(TAB, makeAddColumnOp({ schema: "public", name: "users" }, "y", "TEXT", true, false));
    s.discard(TAB);
    expect(s.getOps(TAB)).toEqual([]);
    expect(s.canUndo(TAB)).toBe(false);
    expect(s.canRedo(TAB)).toBe(false);
    expect(s.isDirty(TAB)).toBe(false);
  });

  it("clearTab forgets state for one tab only", () => {
    const s = useEditStore.getState();
    s.pushOp(TAB, makeAddTableOp("public", "x"));
    s.pushOp("tab-2", makeAddTableOp("public", "y"));
    s.clearTab(TAB);
    expect(s.getOps(TAB)).toEqual([]);
    expect(s.getOps("tab-2")).toHaveLength(1);
  });

  // S20 — bidirectional reverse projection slice
  describe("AST reverse-projection actions", () => {
    it("replaceOpsFromAst replaces ops and stores warnings", () => {
      const s = useEditStore.getState();
      s.pushOp(TAB, makeAddTableOp("public", "old"));
      const newOp = makeAddTableOp("public", "fresh");
      s.replaceOpsFromAst(
        TAB,
        [newOp],
        [{ message: "skipped CHECK constraint" }],
        "CREATE TABLE fresh ();",
      );
      expect(s.getOps(TAB)).toEqual([newOp]);
      expect(s.getAstWarnings(TAB)).toHaveLength(1);
    });

    it("replaceOpsFromAst preserves undo into prior state", () => {
      const s = useEditStore.getState();
      const before = makeAddTableOp("public", "before");
      s.pushOp(TAB, before);
      s.replaceOpsFromAst(TAB, [makeAddTableOp("public", "after")], [], "CREATE TABLE after ();");
      expect(s.canUndo(TAB)).toBe(true);
      s.undo(TAB);
      expect(s.getOps(TAB)).toEqual([before]);
    });

    it("setAstParseError + clearAstWarnings", () => {
      const s = useEditStore.getState();
      s.setAstParseError(TAB, { message: "syntax error", line: 3, column: 12 });
      expect(s.getAstParseError(TAB)?.line).toBe(3);
      s.clearAstWarnings(TAB);
      expect(s.getAstParseError(TAB)).toBe(null);
    });

    // S20 fix: lastChangeBy tracking
    it("pushOp marks lastChangeBy = 'visual' and clears reverse text", () => {
      const s = useEditStore.getState();
      s.replaceOpsFromAst(TAB, [], [], "CREATE INDEX foo ON bar (x);");
      expect(s.getLastChangeBy(TAB)).toBe("text");
      expect(s.getLastReverseText(TAB)).toContain("CREATE INDEX");
      s.pushOp(TAB, makeAddTableOp("public", "z"));
      expect(s.getLastChangeBy(TAB)).toBe("visual");
      expect(s.getLastReverseText(TAB)).toBeNull();
    });

    it("replaceOpsFromAst marks lastChangeBy = 'text' and stores raw text", () => {
      const s = useEditStore.getState();
      s.replaceOpsFromAst(TAB, [makeAddTableOp("public", "u")], [], "CREATE TABLE u (id int);");
      expect(s.getLastChangeBy(TAB)).toBe("text");
      expect(s.getLastReverseText(TAB)).toBe("CREATE TABLE u (id int);");
    });

    it("discard resets lastChangeBy + lastReverseText", () => {
      const s = useEditStore.getState();
      s.replaceOpsFromAst(TAB, [], [], "CREATE INDEX foo ON bar (x);");
      s.discard(TAB);
      expect(s.getLastChangeBy(TAB)).toBeNull();
      expect(s.getLastReverseText(TAB)).toBeNull();
    });
  });
});
