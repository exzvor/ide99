-- Sprint 16 — JSONB schema inference cache.
--
-- One row per (conn_id, schema, table, column). schema_json holds the
-- serialized InferredSchema (camelCase JSON). stat_* columns are NULL
-- for views/matviews/foreign tables (TTL fallback per spec §6.4).

CREATE TABLE inferred_schemas (
    conn_id        TEXT NOT NULL,
    schema_name    TEXT NOT NULL,
    table_name     TEXT NOT NULL,
    column_name    TEXT NOT NULL,
    schema_json    TEXT NOT NULL,
    sample_count   INTEGER NOT NULL,
    generated_at   INTEGER NOT NULL,
    stat_n_ins     INTEGER,
    stat_n_upd     INTEGER,
    stat_n_del     INTEGER,
    stat_n_live    INTEGER,
    PRIMARY KEY (conn_id, schema_name, table_name, column_name)
);

CREATE INDEX idx_inferred_schemas_conn ON inferred_schemas (conn_id);
CREATE INDEX idx_inferred_schemas_generated_at ON inferred_schemas (generated_at);
