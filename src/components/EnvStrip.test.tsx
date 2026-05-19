import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, Environment } from "../lib/tauri";

// EnvStrip pulls from both stores; we use real Zustand stores and just
// setState() before each render. The editor store's hydration helper is
// async + tauri-bound, so we mock the Tauri layer used during module init.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(null),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { useConnections } from "../features/connections/store";
import { useEditor } from "../features/editor/store";
import { EnvStrip } from "./EnvStrip";

function fakeConn(id: string, env: Environment): Connection {
  return {
    id,
    name: id,
    host: "h",
    port: 5432,
    database: "d",
    username: "u",
    sslMode: "disable",
    hasPassword: false,
    createdAt: "",
    updatedAt: "",
    lastTestedAt: null,
    lastTestOk: null,
    excludeFromHistory: false,
    excludeFromRecentPlans: false,
    environment: env,
    readOnly: false,
    slowQueryWarning: false,
    confirmDestructive: false,
  };
}

describe("EnvStrip", () => {
  beforeEach(() => {
    useConnections.setState({
      connections: [fakeConn("c1", "prod"), fakeConn("c2", "local")],
      selectedId: null,
      formMode: { type: "closed" },
      loading: false,
      error: null,
    });
    useEditor.setState({ tabs: [], activeTabId: null });
  });

  it("transparent when no active tab", () => {
    const { container } = render(<EnvStrip />);
    const strip = container.querySelector(".env-strip") as HTMLElement;
    expect(strip.style.background).toMatch(/transparent/);
  });

  it("transparent when active tab is local env", () => {
    useEditor.setState({
      tabs: [
        {
          id: "t",
          kind: "editor",
          connectionId: "c2",
          content: "",
          name: "x",
          cursorPos: { line: 1, col: 1 },
          dirty: false,
          createdAt: "",
          updatedAt: "",
        },
      ],
      activeTabId: "t",
    });
    const { container } = render(<EnvStrip />);
    const strip = container.querySelector(".env-strip") as HTMLElement;
    expect(strip.style.background).toMatch(/transparent/);
  });

  it("env-color when active tab is prod", () => {
    useEditor.setState({
      tabs: [
        {
          id: "t",
          kind: "editor",
          connectionId: "c1",
          content: "",
          name: "x",
          cursorPos: { line: 1, col: 1 },
          dirty: false,
          createdAt: "",
          updatedAt: "",
        },
      ],
      activeTabId: "t",
    });
    const { container } = render(<EnvStrip />);
    const strip = container.querySelector(".env-strip") as HTMLElement;
    expect(strip.style.background).toContain("--env-prod");
  });
});
