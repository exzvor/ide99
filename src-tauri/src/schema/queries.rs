//! SQL constants used by schema-introspection commands.
//!
//! All queries are parameterized via `$1` (schema) and `$2` (table) — the
//! identifiers are always bound, never interpolated, so Cyrillic / quoted
//! names round-trip safely. We deliberately avoid the
//! `(schema || '.' || table)::regclass` cast because it mishandles names that
//! require quoting; a `pg_class` + `pg_namespace` JOIN is safer.

/// List user schemas, excluding catalogs and per-session temp/toast namespaces.
pub const LIST_SCHEMAS_SQL: &str = "\
SELECT schema_name AS name, schema_owner AS owner
FROM information_schema.schemata
WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
  AND schema_name NOT LIKE 'pg_temp_%'
  AND schema_name NOT LIKE 'pg_toast%'
ORDER BY schema_name";

/// List ordinary + partitioned tables (relkind r/p) in a schema. Partition
/// children (anything in `pg_inherits`) are filtered out — the parent stays.
pub const LIST_TABLES_SQL: &str = "\
SELECT c.relname AS name,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = $1
  AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (    SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid
)
ORDER BY c.relname";

/// List views (relkind v) in a schema with their `pg_get_viewdef` body.
pub const LIST_VIEWS_SQL: &str = "\
SELECT c.relname AS name,
       pg_get_viewdef(c.oid, true) AS definition,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = $1
  AND c.relkind = 'v'
ORDER BY c.relname";

/// List columns for a relation with formatted types, defaults, comments.
pub const LIST_COLUMNS_SQL: &str = "\
SELECT a.attname AS name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable,
       pg_get_expr(d.adbin, d.adrelid) AS default,
       col_description(c.oid, a.attnum) AS comment,
       a.attnum AS ordinal
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = $1 AND c.relname = $2
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum";

/// List indexes for a table; primary first, then unique, then by name.
pub const LIST_INDEXES_SQL: &str = "\
SELECT c.relname AS name,
       am.amname AS method,
       idx.indisunique AS is_unique,
       idx.indisprimary AS is_primary,
       pg_get_indexdef(idx.indexrelid) AS definition
FROM pg_index idx
JOIN pg_class c ON c.oid = idx.indexrelid
JOIN pg_class t ON t.oid = idx.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = c.relam
WHERE n.nspname = $1 AND t.relname = $2
ORDER BY idx.indisprimary DESC, idx.indisunique DESC, c.relname";

/// List foreign-key constraints declared on a table with their
/// `pg_get_constraintdef` body and the referenced relation.
pub const LIST_FOREIGN_KEYS_SQL: &str = "\
SELECT con.conname AS name,
       pg_get_constraintdef(con.oid) AS definition,
       rn.nspname AS referenced_schema,
       rc.relname AS referenced_table
FROM pg_constraint con
JOIN pg_class t ON con.conrelid = t.oid
JOIN pg_namespace tn ON tn.oid = t.relnamespace
JOIN pg_class rc ON con.confrelid = rc.oid
JOIN pg_namespace rn ON rn.oid = rc.relnamespace
WHERE con.contype = 'f'
  AND tn.nspname = $1
  AND t.relname = $2
ORDER BY con.conname";

// ---------------------------------------------------------------------------
// — autocomplete snapshot
// ---------------------------------------------------------------------------

/// Returns the active `search_path` as a single text row.
/// We split client-side because libpq returns it as `"$user", public`.
pub const SHOW_SEARCH_PATH_SQL: &str = "SHOW search_path";

/// Returns the running role; used to substitute `$user` placeholder
/// in the search path before the snapshot query.
pub const CURRENT_USER_SQL: &str = "SELECT current_user::text";

/// One-shot snapshot of relations + columns for the schemas in `$1::text[]`.
///
/// Returns interleaved rows: a `kind='rel'` row for each relation followed by
/// `kind='col'` rows for that relation's columns (ordered by `attnum`). The
/// caller groups by `(schema, name)` while iterating and assembles
/// `AutocompleteRelation { columns: [...] }`.
///
/// Filters mirror `LIST_TABLES_SQL`: partition children (anything in
/// `pg_inherits`) are dropped — the parent partitioned table stays.
/// `relkind` accepted: r/p (tables), v (views), m (materialized views).
pub const AUTOCOMPLETE_SNAPSHOT_SQL: &str = "\
WITH search_path_resolved AS (  SELECT unnest($1::text[]) AS schema_name
)
SELECT 'rel' AS kind,
       n.nspname     AS schema,
       c.relname     AS name,
       CASE c.relkind WHEN 'r' THEN 'table'
                      WHEN 'p' THEN 'table'
                      WHEN 'v' THEN 'view'
                      WHEN 'm' THEN 'matview' END AS rel_kind,
       NULL::text  AS col_name,
       NULL::text  AS col_type,
       NULL::bool  AS col_nullable,
       c.oid       AS rel_oid,
       NULL::int4  AS col_ordinal,
       NULL::bool  AS col_is_jsonb
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN search_path_resolved sp ON sp.schema_name = n.nspname
WHERE c.relkind IN ('r','p','v','m')
  AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
UNION ALL
SELECT 'col' AS kind,
       n.nspname,
       c.relname,
       NULL::text,
       a.attname,
       format_type(a.atttypid, a.atttypmod),
       NOT a.attnotnull,
       c.oid,
       a.attnum,
       (format_type(a.atttypid, a.atttypmod) IN ('jsonb', 'json'))
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN search_path_resolved sp ON sp.schema_name = n.nspname
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r','p','v','m')
  AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
ORDER BY rel_oid, col_ordinal NULLS FIRST";

// ---------------------------------------------------------------------------
// — full-detail introspection for object editors.
// All queries are schema/name-bound via `$1`/`$2` (no interpolation).
// ---------------------------------------------------------------------------

/// Look up the relation OID, RLS flag, comment, and partitioning shape for a
/// single table. Returns one row or zero (mapped to `IntrospectError::NotFound`).
///
/// Uses LEFT JOIN on `pg_partitioned_table` so non-partitioned tables yield
/// NULL for `partition_strategy` / `partition_key`.
pub const GET_TABLE_HEAD_SQL: &str = "\
SELECT c.oid AS oid,
       c.relrowsecurity AS rls_enabled,
       obj_description(c.oid, 'pg_class') AS comment,
       pt.partstrat::text AS partition_strategy,
       CASE WHEN pt.partrelid IS NOT NULL THEN pg_get_partkeydef(c.oid)
            ELSE NULL END AS partition_key
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
LEFT JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
WHERE n.nspname = $1 AND c.relname = $2
  AND c.relkind IN ('r', 'p')";

/// PG < 10 variant of [`GET_TABLE_HEAD_SQL`]. `pg_partitioned_table` does not
/// exist before PG 10 (declarative partitioning), so the partition columns are
/// NULL literals. Used on PostgreSQL 9.x (e.g. Astra Linux ships 9.6).
pub const GET_TABLE_HEAD_SQL_PRE10: &str = "\
SELECT c.oid AS oid,
       c.relrowsecurity AS rls_enabled,
       obj_description(c.oid, 'pg_class') AS comment,
       NULL::text AS partition_strategy,
       NULL::text AS partition_key
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = $1 AND c.relname = $2
  AND c.relkind IN ('r', 'p')";

/// List columns with full detail — generated kind, identity, defaults, comment.
///
/// `attgenerated`: '' (none), 's' (STORED), 'v' (VIRTUAL — PG17+).
/// `attidentity` : '' (none), 'a' (ALWAYS), 'd' (BY DEFAULT).
pub const GET_TABLE_COLUMNS_SQL: &str = "\
SELECT a.attname AS name,
       format_type(a.atttypid, a.atttypmod) AS type_text,
       NOT a.attnotnull AS nullable,
       pg_get_expr(d.adbin, d.adrelid) AS default,
       a.attgenerated::text AS attgenerated,
       a.attidentity::text AS attidentity,
       a.atthasdef AS atthasdef,
       col_description(c.oid, a.attnum) AS comment,
       a.attnum AS ordinal
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = $1 AND c.relname = $2
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum";

/// PG < 10 variant of [`GET_TABLE_COLUMNS_SQL`]. `attidentity` (PG 10) and
/// `attgenerated` (PG 12) do not exist on `pg_attribute` before those versions;
/// neither feature exists on 9.x either, so both are reported as '' (none).
pub const GET_TABLE_COLUMNS_SQL_PRE10: &str = "\
SELECT a.attname AS name,
       format_type(a.atttypid, a.atttypmod) AS type_text,
       NOT a.attnotnull AS nullable,
       pg_get_expr(d.adbin, d.adrelid) AS default,
       ''::text AS attgenerated,
       ''::text AS attidentity,
       a.atthasdef AS atthasdef,
       col_description(c.oid, a.attnum) AS comment,
       a.attnum AS ordinal
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = $1 AND c.relname = $2
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum";

/// List PK / UNIQUE / FK / CHECK constraints for a table.
///
/// `conkey`/`confkey` are `int2[]` arrays of `attnum`s. `confrelid` is the
/// referenced relation OID (zero if not FK). `pg_get_constraintdef` renders
/// the verbatim DDL fragment.
pub const GET_TABLE_CONSTRAINTS_SQL: &str = "\
SELECT con.conname AS name,
       con.contype::text AS contype,
       pg_get_constraintdef(con.oid, true) AS definition,
       con.conkey AS conkey,
       con.confrelid AS confrelid,
       con.confkey AS confkey,
       rn.nspname AS ref_schema,
       rc.relname AS ref_table
FROM pg_constraint con
JOIN pg_class t ON con.conrelid = t.oid
JOIN pg_namespace tn ON tn.oid = t.relnamespace
LEFT JOIN pg_class rc ON con.confrelid = rc.oid
LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
WHERE con.contype IN ('p', 'u', 'f', 'c')
  AND tn.nspname = $1
  AND t.relname = $2
ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END,
         con.conname";

/// Resolve `attnum` array → column-name list for a single relation.
/// Bound: `$1 = relation oid (oid)`, `$2 = attnum array (int2[])`.
/// Returns names ordered to match the input array.
pub const RESOLVE_ATTNAMES_SQL: &str = "\
SELECT a.attname AS name, a.attnum AS attnum
FROM pg_attribute a
WHERE a.attrelid = $1 AND a.attnum = ANY($2::int2[])";

/// List index NAMES on a table. The detailed fetch uses `GET_INDEX_*` per
/// index. Schema/name-bound.
pub const GET_TABLE_INDEX_NAMES_SQL: &str = "\
SELECT ic.relname AS name
FROM pg_index idx
JOIN pg_class ic ON ic.oid = idx.indexrelid
JOIN pg_class t  ON t.oid  = idx.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = $1 AND t.relname = $2
ORDER BY idx.indisprimary DESC, idx.indisunique DESC, ic.relname";

/// Full detail for a single index — keyed by `(schema, index_name)`.
///
/// Returns oid, owning-table name, method, unique/primary flags, `indkey`
/// (column ordinals), `indnatts`/`indnkeyatts` (for INCLUDE detection),
/// `pg_get_indexdef` for the verbatim DDL, predicate (NULL if not partial),
/// and the `indrelid` (so the caller can resolve attname for indkey entries).
pub const GET_INDEX_DETAIL_SQL: &str = "\
SELECT ic.oid AS oid,
       t.relname AS table_name,
       am.amname AS method,
       idx.indisunique AS unique_flag,
       idx.indisprimary AS primary_flag,
       string_to_array(idx.indkey::text, ' ')::int2[] AS indkey,
       idx.indnatts AS indnatts,
       idx.indnkeyatts AS indnkeyatts,
       idx.indrelid AS indrelid,
       pg_get_indexdef(idx.indexrelid, 0, true) AS definition,
       pg_get_expr(idx.indpred, idx.indrelid) AS predicate
FROM pg_index idx
JOIN pg_class ic ON ic.oid = idx.indexrelid
JOIN pg_class t  ON t.oid  = idx.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = ic.relam
WHERE n.nspname = $1 AND ic.relname = $2";

/// View / matview body fetch (relkind in ('v','m')). One row or zero.
pub const GET_VIEW_LIKE_SQL: &str = "\
SELECT pg_get_viewdef(c.oid, true) AS body,
       obj_description(c.oid, 'pg_class') AS comment,
       c.relispopulated AS populated,
       c.relkind::text AS relkind
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = $1 AND c.relname = $2
  AND c.relkind IN ('v', 'm')";

/// Sequence options via `pg_sequences` (PG10+).
/// All numeric fields are int8 in `pg_sequences` regardless of the sequence's
/// declared `data_type` — the cast is part of the catalog view.
pub const GET_SEQUENCE_SQL: &str = "\
SELECT data_type::text AS data_type,
       start_value AS start_value,
       increment_by AS increment,
       min_value AS min_value,
       max_value AS max_value,
       cache_size AS cache,
       cycle AS cycle
FROM pg_sequences
WHERE schemaname = $1 AND sequencename = $2";

/// Resolve the column a sequence is OWNED BY, if any. Walks `pg_depend`
/// looking for a "auto" / "internal" link from the sequence to a relation
/// column. Returns zero or one row.
pub const GET_SEQUENCE_OWNED_BY_SQL: &str = "\
SELECT rn.nspname AS owner_schema,
       rc.relname AS owner_table,
       a.attname AS owner_column
FROM pg_class seq
JOIN pg_namespace sn ON sn.oid = seq.relnamespace
JOIN pg_depend dep ON dep.objid = seq.oid AND dep.classid = 'pg_class'::regclass
JOIN pg_class rc ON rc.oid = dep.refobjid
JOIN pg_namespace rn ON rn.oid = rc.relnamespace
JOIN pg_attribute a ON a.attrelid = rc.oid AND a.attnum = dep.refobjsubid
WHERE seq.relkind = 'S'
  AND sn.nspname = $1
  AND seq.relname = $2
  AND dep.deptype IN ('a', 'i')
LIMIT 1";

/// List materialized views in a schema.
pub const LIST_MATVIEWS_SQL: &str = "\
SELECT c.relname AS name,
       c.relispopulated AS populated,
       obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = $1 AND c.relkind = 'm'
ORDER BY c.relname";

/// List user-managed sequences in a schema.
///
/// Filters out sequences that are internally owned (`pg_depend.deptype = 'a'`)
/// by a column — these are the implicit sequences created by `SERIAL` /
/// `IDENTITY` and aren't surfaced to the user as standalone objects.
pub const LIST_SEQUENCES_SQL: &str = "\
SELECT seq.relname AS name,
       (SELECT data_type::text FROM pg_sequences
        WHERE schemaname = n.nspname AND sequencename = seq.relname) AS data_type
FROM pg_class seq
JOIN pg_namespace n ON n.oid = seq.relnamespace
WHERE n.nspname = $1
  AND seq.relkind = 'S'
  AND NOT EXISTS (    SELECT 1 FROM pg_depend dep
    WHERE dep.objid = seq.oid
      AND dep.classid = 'pg_class'::regclass
      AND dep.deptype = 'a'
)
ORDER BY seq.relname";

/// PG < 10 variant of [`LIST_SEQUENCES_SQL`]. `pg_sequences` does not exist
/// before PG 10; every sequence is `bigint` on 9.x, so `data_type` is reported
/// as NULL and the caller defaults it to "bigint".
pub const LIST_SEQUENCES_SQL_PRE10: &str = "\
SELECT seq.relname AS name,
       NULL::text AS data_type
FROM pg_class seq
JOIN pg_namespace n ON n.oid = seq.relnamespace
WHERE n.nspname = $1
  AND seq.relkind = 'S'
  AND NOT EXISTS (    SELECT 1 FROM pg_depend dep
    WHERE dep.objid = seq.oid
      AND dep.classid = 'pg_class'::regclass
      AND dep.deptype = 'a'
)
ORDER BY seq.relname";

// ---------------------------------------------------------------------------
// — function / procedure / trigger introspection.
// ---------------------------------------------------------------------------

/// Head row for a single function — bound by `(schema, name, args)` where
/// `args` is the result of `pg_get_function_arguments(oid)` — required because
/// PG allows function overloading.
///
/// `prokind = 'f'` filters out procedures and aggregates. Returns at most one
/// row.
pub const GET_FUNCTION_HEAD_SQL: &str = "\
SELECT p.oid AS oid,
       p.prokind::text AS prokind,
       l.lanname AS language,
       p.proretset AS proretset,
       p.provolatile::text AS provolatile,
       p.proparallel::text AS proparallel,
       p.prosecdef AS prosecdef,
       p.procost AS procost,
       p.prorows AS prorows,
       p.prosrc AS body,
       format_type(p.prorettype, NULL) AS return_type_text,
       obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
WHERE n.nspname = $1 AND p.proname = $2
  AND pg_get_function_arguments(p.oid) = $3
  AND p.prokind = 'f'";

/// PG < 11 variant of [`GET_FUNCTION_HEAD_SQL`]. No `prokind` column (PG 11+);
/// `proparallel` exists from PG 9.6. Plain functions are filtered via
/// `proisagg` / `proiswindow`, and `prokind` is reported as the literal 'f'.
pub const GET_FUNCTION_HEAD_SQL_PRE11: &str = "\
SELECT p.oid AS oid,
       'f'::text AS prokind,
       l.lanname AS language,
       p.proretset AS proretset,
       p.provolatile::text AS provolatile,
       p.proparallel::text AS proparallel,
       p.prosecdef AS prosecdef,
       p.procost AS procost,
       p.prorows AS prorows,
       p.prosrc AS body,
       format_type(p.prorettype, NULL) AS return_type_text,
       obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
WHERE n.nspname = $1 AND p.proname = $2
  AND pg_get_function_arguments(p.oid) = $3
  AND NOT p.proisagg
  AND NOT p.proiswindow";

/// Head row for a single procedure — same join shape as functions but
/// `prokind = 'p'` and the return-type cols are unused. Returns at most one row.
pub const GET_PROCEDURE_HEAD_SQL: &str = "\
SELECT p.oid AS oid,
       l.lanname AS language,
       p.prosecdef AS prosecdef,
       p.prosrc AS body,
       obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
WHERE n.nspname = $1 AND p.proname = $2
  AND pg_get_function_arguments(p.oid) = $3
  AND p.prokind = 'p'";

/// Structured parameter arrays for a function/procedure (bound by oid).
///
/// `proallargtypes` covers BOTH IN and OUT params; falls back to `proargtypes`
/// (IN only) when null. `proargnames`/`proargmodes` are NULL when all params
/// are unnamed/IN respectively. `pg_get_expr(proargdefaults, 0)` renders the
/// comma-separated default expression list — applies to the LAST
/// `pronargdefaults` IN-mode parameters.
pub const GET_FUNCTION_PARAMS_SQL: &str = "\
SELECT ARRAY(         SELECT format_type(t, NULL)
         FROM unnest(COALESCE(proallargtypes, proargtypes::oid[])) AS t
) AS type_texts,
       proargnames AS arg_names,
       proargmodes::text[] AS arg_modes,
       pg_get_expr(proargdefaults, 0) AS defaults_text,
       pronargdefaults AS num_defaults
FROM pg_proc WHERE oid = $1";

/// Trigger detail row bound by `(schema, table, trigger_name)`. Excludes
/// internal (constraint) triggers via `NOT tgisinternal`.
///
/// `tgtype` is decoded by `schema::tgtype_decode`. `pg_get_expr(tgqual, tgrelid)`
/// renders the WHEN clause (NULL when absent). `tgattr` is `int2vector` and
/// must be cast to `int2[]` to read as `Vec<i16>` — these are column ordinals
/// for `UPDATE OF (...)`.
pub const GET_TRIGGER_DETAIL_SQL: &str = "\
SELECT t.tgname AS name,
       t.tgrelid AS tgrelid,
       n.nspname AS table_schema,
       c.relname AS table_name,
       t.tgtype::int8 AS tgtype,
       t.tgenabled::text AS tgenabled,
       pg_get_expr(t.tgqual, t.tgrelid) AS when_clause,
       string_to_array(t.tgattr::text, ' ')::int2[] AS tgattr,
       fn_n.nspname AS function_schema,
       fn.proname AS function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc fn ON t.tgfoid = fn.oid
JOIN pg_namespace fn_n ON fn.pronamespace = fn_n.oid
WHERE NOT t.tgisinternal
  AND n.nspname = $1
  AND c.relname = $2
  AND t.tgname = $3";

/// List user functions in a schema.
///
/// `$2` is a `bool` flag — when true, only trigger-returning functions are
/// included (`prorettype = pg_catalog.trigger`). Aggregates / window functions
/// are excluded via `prokind = 'f'`.
pub const LIST_FUNCTIONS_SQL: &str = "\
SELECT p.proname AS name,
       pg_get_function_arguments(p.oid) AS args,
       p.proretset AS proretset,
       format_type(p.prorettype, NULL) AS return_type_text
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = $1
  AND p.prokind = 'f'
  AND ($2 = false OR p.prorettype = 'pg_catalog.trigger'::regtype)
ORDER BY p.proname";

/// PG < 11 variant of [`LIST_FUNCTIONS_SQL`]. `pg_proc.prokind` was added in
/// PG 11; before that, plain functions are distinguished from aggregates and
/// window functions via the boolean `proisagg` / `proiswindow` columns
/// (procedures did not exist before PG 11).
pub const LIST_FUNCTIONS_SQL_PRE11: &str = "\
SELECT p.proname AS name,
       pg_get_function_arguments(p.oid) AS args,
       p.proretset AS proretset,
       format_type(p.prorettype, NULL) AS return_type_text
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = $1
  AND NOT p.proisagg
  AND NOT p.proiswindow
  AND ($2 = false OR p.prorettype = 'pg_catalog.trigger'::regtype)
ORDER BY p.proname";

/// List user procedures in a schema (`prokind = 'p'`).
pub const LIST_PROCEDURES_SQL: &str = "\
SELECT p.proname AS name,
       pg_get_function_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = $1
  AND p.prokind = 'p'
ORDER BY p.proname";

/// List user-defined triggers in a schema, optionally filtered to a single
/// table. `$2::text` may be NULL to return triggers for all tables.
pub const LIST_TRIGGERS_SQL: &str = "\
SELECT t.tgname AS name,
       n.nspname AS table_schema,
       c.relname AS table_name,
       t.tgenabled::text AS tgenabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE NOT t.tgisinternal
  AND n.nspname = $1
  AND ($2::text IS NULL OR c.relname = $2)
ORDER BY c.relname, t.tgname";

// ---------------------------------------------------------------------------
// — FDW / Publication / Subscription / Role / Custom Type queries.
// ---------------------------------------------------------------------------

pub const GET_FDW_SERVER_SQL: &str = "\
SELECT s.srvname,
       w.fdwname,
       s.srvtype,
       s.srvversion,
       COALESCE(s.srvoptions, ARRAY[]::text[]) AS options,
       obj_description(s.oid, 'pg_foreign_server') AS comment \
FROM   pg_foreign_server s \
JOIN   pg_foreign_data_wrapper w ON w.oid = s.srvfdw \
WHERE  s.srvname = $1";

pub const GET_USER_MAPPINGS_SQL: &str = "\
SELECT COALESCE(a.rolname, 'PUBLIC') AS role_name,
       COALESCE(u.umoptions, ARRAY[]::text[]) AS options \
FROM   pg_user_mapping u \
JOIN   pg_foreign_server s ON s.oid = u.umserver \
LEFT   JOIN pg_authid a ON a.oid = u.umuser \
WHERE  s.srvname = $1
ORDER  BY role_name";

pub const GET_PUBLICATION_HEAD_SQL: &str = "\
SELECT p.pubname,
       p.puballtables,
       p.pubinsert,
       p.pubupdate,
       p.pubdelete,
       p.pubtruncate,
       p.pubviaroot,
       obj_description(p.oid, 'pg_publication') AS comment \
FROM   pg_publication p \
WHERE  p.pubname = $1";

pub const GET_PUBLICATION_TABLES_SQL: &str = "\
SELECT n.nspname, c.relname \
FROM   pg_publication_rel pr \
JOIN   pg_publication p ON p.oid = pr.prpubid \
JOIN   pg_class c ON c.oid = pr.prrelid \
JOIN   pg_namespace n ON n.oid = c.relnamespace \
WHERE  p.pubname = $1
ORDER  BY n.nspname, c.relname";

pub const GET_PUBLICATION_SCHEMAS_SQL: &str = "\
SELECT n.nspname \
FROM   pg_publication_namespace pn \
JOIN   pg_publication p ON p.oid = pn.pnpubid \
JOIN   pg_namespace n ON n.oid = pn.pnnspid \
WHERE  p.pubname = $1
ORDER  BY n.nspname";

pub const LIST_PUBLISHABLE_TABLES_SQL: &str = "\
SELECT n.nspname, c.relname \
FROM   pg_class c \
JOIN   pg_namespace n ON n.oid = c.relnamespace \
WHERE  c.relkind IN ('r', 'p') \
AND    c.relpersistence = 'p' \
AND    n.nspname NOT IN ('pg_catalog', 'information_schema') \
AND    n.nspname NOT LIKE 'pg_toast%' \
AND    n.nspname NOT LIKE 'pg_temp%' \
ORDER  BY n.nspname, c.relname";

pub const LIST_PUBLICATIONS_SQL: &str = "\
SELECT p.pubname, p.puballtables \
FROM   pg_publication p \
ORDER  BY p.pubname";

pub const GET_SUBSCRIPTION_SQL: &str = "\
SELECT s.subname,
       s.subconninfo,
       s.subpublications,
       s.subenabled,
       (s.subsynccommit) AS synchronous_commit,
       s.subslotname,
       obj_description(s.oid, 'pg_subscription') AS comment \
FROM   pg_subscription s \
WHERE  s.subname = $1";

pub const GET_ROLE_SQL: &str = "\
SELECT r.rolname,
       r.rolcanlogin,
       r.rolsuper,
       r.rolcreatedb,
       r.rolcreaterole,
       r.rolreplication,
       r.rolbypassrls,
       r.rolinherit,
       r.rolconnlimit,
       r.rolvaliduntil::text AS valid_until,
       shobj_description(r.oid, 'pg_authid') AS comment \
FROM   pg_authid r \
WHERE  r.rolname = $1";

pub const GET_ROLE_MEMBERSHIPS_SQL: &str = "\
SELECT g.rolname AS parent \
FROM   pg_auth_members m \
JOIN   pg_authid r ON r.oid = m.member \
JOIN   pg_authid g ON g.oid = m.roleid \
WHERE  r.rolname = $1
ORDER  BY g.rolname";

pub const LIST_ROLES_SQL: &str = "\
SELECT r.rolname, r.rolcanlogin \
FROM   pg_roles r \
WHERE  r.rolname NOT LIKE 'pg\\_%' \
ORDER  BY r.rolname";

pub const LIST_COLLATIONS_SQL: &str = "\
SELECT c.collname \
FROM   pg_collation c \
JOIN   pg_namespace n ON n.oid = c.collnamespace \
WHERE  n.nspname IN ('pg_catalog', 'public') \
ORDER  BY c.collname";

pub const GET_TYPE_BY_NAME_SQL: &str = "\
SELECT t.oid, t.typtype, n.nspname, t.typname,
       obj_description(t.oid, 'pg_type') AS comment \
FROM   pg_type t \
JOIN   pg_namespace n ON n.oid = t.typnamespace \
WHERE  n.nspname = $1 AND t.typname = $2";

pub const GET_ENUM_VALUES_SQL: &str = "\
SELECT e.enumlabel \
FROM   pg_enum e \
WHERE  e.enumtypid = $1 \
ORDER  BY e.enumsortorder";

pub const GET_COMPOSITE_FIELDS_SQL: &str = "\
SELECT a.attname,
       format_type(a.atttypid, a.atttypmod) AS type_text,
       NULLIF(co.collname, '') AS collation \
FROM   pg_type t \
JOIN   pg_class c ON c.oid = t.typrelid \
JOIN   pg_attribute a ON a.attrelid = c.oid \
LEFT   JOIN pg_collation co ON co.oid = a.attcollation \
WHERE  t.oid = $1 AND a.attnum > 0 AND NOT a.attisdropped \
ORDER  BY a.attnum";

pub const GET_DOMAIN_SQL: &str = "\
SELECT format_type(t.typbasetype, t.typtypmod) AS base_type,
       t.typnotnull,
       NULLIF(t.typdefault, '') AS default_value,
       NULLIF(co.collname, '') AS collation \
FROM   pg_type t \
LEFT   JOIN pg_collation co ON co.oid = t.typcollation \
WHERE  t.oid = $1";

pub const GET_DOMAIN_CONSTRAINTS_SQL: &str = "\
SELECT c.conname, pg_get_constraintdef(c.oid) AS def, c.convalidated \
FROM   pg_constraint c \
WHERE  c.contypid = $1 AND c.contype = 'c' \
ORDER  BY c.conname";

pub const GET_RANGE_SQL: &str = "\
SELECT format_type(r.rngsubtype, NULL) AS subtype,
       NULLIF(opc.opcname, '') AS subtype_opclass,
       NULLIF(co.collname, '') AS collation,
       NULLIF(canon.proname, '') AS canonical,
       NULLIF(diff.proname, '') AS subtype_diff,
       NULLIF(mr.typname, '') AS multirange_type_name \
FROM   pg_range r \
LEFT   JOIN pg_opclass opc ON opc.oid = r.rngsubopc \
LEFT   JOIN pg_collation co ON co.oid = r.rngcollation \
LEFT   JOIN pg_proc canon ON canon.oid = r.rngcanonical \
LEFT   JOIN pg_proc diff ON diff.oid = r.rngsubdiff \
LEFT   JOIN pg_type mr ON mr.oid = r.rngmultitypid \
WHERE  r.rngtypid = $1";

#[cfg(test)]
mod tests {
    use super::*;

    /// Sanity that no constant is empty and each one references its parameter
    /// placeholders — guards against accidental edits.
    #[test]
    fn constants_are_nonempty_and_parameterized() {
        for sql in [
            LIST_SCHEMAS_SQL,
            LIST_TABLES_SQL,
            LIST_VIEWS_SQL,
            LIST_COLUMNS_SQL,
            LIST_INDEXES_SQL,
            LIST_FOREIGN_KEYS_SQL,
        ] {
            assert!(!sql.trim().is_empty(), "SQL constant must not be empty");
        }
        for sql in [LIST_TABLES_SQL, LIST_VIEWS_SQL] {
            assert!(sql.contains("$1"), "schema-scoped query must bind $1");
            assert!(!sql.contains("$2"), "schema-only query must not use $2");
        }
        for sql in [LIST_COLUMNS_SQL, LIST_INDEXES_SQL, LIST_FOREIGN_KEYS_SQL] {
            assert!(sql.contains("$1") && sql.contains("$2"));
        }
    }

    #[test]
    fn s23_constants_are_nonempty_and_parameterized() {
        for sql in [
            GET_TABLE_HEAD_SQL,
            GET_TABLE_COLUMNS_SQL,
            GET_TABLE_CONSTRAINTS_SQL,
            GET_TABLE_INDEX_NAMES_SQL,
            GET_INDEX_DETAIL_SQL,
            GET_VIEW_LIKE_SQL,
            GET_SEQUENCE_SQL,
            GET_SEQUENCE_OWNED_BY_SQL,
        ] {
            assert!(sql.contains("$1") && sql.contains("$2"));
        }
        for sql in [LIST_MATVIEWS_SQL, LIST_SEQUENCES_SQL] {
            assert!(sql.contains("$1"));
            assert!(!sql.contains("$2"));
        }
        assert!(RESOLVE_ATTNAMES_SQL.contains("$1") && RESOLVE_ATTNAMES_SQL.contains("$2"));
    }

    #[test]
    fn s24_constants_are_nonempty_and_parameterized() {
        for sql in [GET_FUNCTION_HEAD_SQL, GET_PROCEDURE_HEAD_SQL] {
            assert!(sql.contains("$1") && sql.contains("$2") && sql.contains("$3"));
        }
        assert!(GET_TRIGGER_DETAIL_SQL.contains("$1") && GET_TRIGGER_DETAIL_SQL.contains("$3"));
        assert!(GET_FUNCTION_PARAMS_SQL.contains("$1"));
        assert!(LIST_FUNCTIONS_SQL.contains("$1") && LIST_FUNCTIONS_SQL.contains("$2"));
        assert!(LIST_PROCEDURES_SQL.contains("$1") && !LIST_PROCEDURES_SQL.contains("$2"));
        assert!(LIST_TRIGGERS_SQL.contains("$1") && LIST_TRIGGERS_SQL.contains("$2"));
    }
}
