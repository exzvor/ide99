import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

import { parseConnectionUri } from "./parseConnectionUri";

describe("parseConnectionUri", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the Rust parse_connection_uri command with the URI", async () => {
    invokeMock.mockResolvedValueOnce({
      host: "localhost",
      port: 5432,
      database: "postgres",
      username: "u",
      password: "p",
      sslMode: "prefer",
    });

    const out = await parseConnectionUri("postgresql://u:p@localhost:5432/postgres");

    expect(invokeMock).toHaveBeenCalledWith("parse_connection_uri", {
      uri: "postgresql://u:p@localhost:5432/postgres",
    });
    expect(out.host).toBe("localhost");
    expect(out.port).toBe(5432);
    expect(out.username).toBe("u");
  });

  it("propagates rejections from the underlying invoke", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "invalidUri", message: "bad uri" });
    await expect(parseConnectionUri("nope")).rejects.toBeDefined();
  });
});
