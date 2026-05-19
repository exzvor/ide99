-- Sprint 30 — MCP authorized clients.
--
-- Каждый внешний AI-агент (Claude Code, Cursor, ...) при первом коннекте
-- проходит authorize-flow и получает opaque token. Token хранится в
-- keychain (key = `mcp:<id>`); здесь — только метаданные для UI и
-- scope-checking без керчейн-обращений на каждый request.
--
-- `scopes` — JSON-массив McpScope-вариантов (`db:list`, `db:read`, ...).
CREATE TABLE IF NOT EXISTS mcp_clients (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    scopes          TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    last_used_at    TEXT,
    -- Hash (SHA-256 hex) от bearer token для быстрой lookup без керчейн-походов.
    -- Сам токен в keychain под key `mcp:<id>`. Здесь только digest.
    token_hash      TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_mcp_clients_token_hash ON mcp_clients(token_hash);
