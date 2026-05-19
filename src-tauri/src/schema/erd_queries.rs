//! — SQL constants for the ERD auto-layout payload.
//!
//! Two parameterized queries; both accept a single `$1::text[]` of schema
//! names. The caller passes either an explicitly-requested schema list or the
//! full set of non-system schemas (collected with the same filter that
//! `LIST_SCHEMAS_SQL` uses) — the SQL itself is identical either way.
//!
//! Conventions mirror `super::queries`:
//! - `pg_catalog`, `information_schema`, `pg_temp_*`, `pg_toast*` filtered out.
//! - Tables = `relkind IN ('r', 'p')` AND NOT EXISTS `pg_inherits` child (so a
//! partition parent is kept once and partition children are dropped).
//! - All identifiers are bound, never interpolated.

/// Interleaved tables + columns row stream for the schemas in `$1::text[]`.
///
/// Emits one `kind='table'` row per relation followed by `kind='column'`
/// rows for that relation's user attributes (in `attnum` order). The caller
/// iterates row-by-row and assembles `ErdTable { columns: [...] }` while
/// maintaining a "current table" cursor.
///
/// Column rows include:
/// - `is_primary_key` — derived from `pg_index` where `indisprimary` AND
/// `attnum = ANY(indkey)`.
/// - `is_foreign_key` — derived from `pg_constraint` where `contype='f'` AND
/// `attnum = ANY(conkey)` for any FK on the source table.
///
/// Sort order: `(schema, table, kind_rank, ordinal)` — table rows first per
/// relation, then its columns by `attnum`. We use `c.oid` as the grouping
/// key to keep the sort cheap and stable.
pub const ERD_TABLES_AND_COLUMNS_SQL: &str = "\
WITH target_schemas AS (  SELECT unnest($1::text[]) AS schema_name
),
relations AS (  SELECT c.oid       AS rel_oid,
         n.nspname   AS schema,
         c.relname   AS name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN target_schemas ts ON ts.schema_name = n.nspname
  WHERE c.relkind IN ('r', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
)
SELECT 'table'::text AS kind,
       r.schema      AS schema,
       r.name        AS name,
       NULL::text    AS col_name,
       NULL::text    AS col_type,
       NULL::bool    AS col_nullable,
       NULL::bool    AS col_is_pk,
       NULL::bool    AS col_is_fk,
       0::int4       AS col_ordinal,
       r.rel_oid     AS rel_oid,
       0::int4       AS kind_rank
FROM relations r
UNION ALL
SELECT 'column'::text AS kind,
       r.schema       AS schema,
       r.name         AS name,
       a.attname      AS col_name,
       format_type(a.atttypid, a.atttypmod) AS col_type,
       NOT a.attnotnull AS col_nullable,
       EXISTS (         SELECT 1
         FROM pg_index idx
         WHERE idx.indrelid = r.rel_oid
           AND idx.indisprimary
           AND a.attnum = ANY(idx.indkey)
) AS col_is_pk,
       EXISTS (         SELECT 1
         FROM pg_constraint con
         WHERE con.conrelid = r.rel_oid
           AND con.contype = 'f'
           AND a.attnum = ANY(con.conkey)
) AS col_is_fk,
       a.attnum::int4 AS col_ordinal,
       r.rel_oid      AS rel_oid,
       1::int4        AS kind_rank
FROM relations r
JOIN pg_attribute a ON a.attrelid = r.rel_oid
WHERE a.attnum > 0 AND NOT a.attisdropped
ORDER BY schema, name, rel_oid, kind_rank, col_ordinal";

/// Foreign-key edges across the schemas in `$1::text[]`.
///
/// Returns one row per `pg_constraint.contype='f'` declared on a relation in
/// the requested schema set. `source_columns` and `target_columns` are
/// `text[]` produced server-side via `array_agg(... ORDER BY o)` so positional
/// alignment between both arrays is guaranteed (composite-FK correctness).
pub const ERD_FOREIGN_KEYS_SQL: &str = "\
WITH target_schemas AS (  SELECT unnest($1::text[]) AS schema_name
),
fks AS (  SELECT con.oid        AS con_oid,
         con.conname    AS name,
         tn.nspname     AS source_schema,
         t.relname      AS source_table,
         con.conrelid   AS source_oid,
         con.conkey     AS source_keys,
         rn.nspname     AS target_schema,
         rc.relname     AS target_table,
         con.confrelid  AS target_oid,
         con.confkey    AS target_keys
  FROM pg_constraint con
  JOIN pg_class t ON con.conrelid = t.oid
  JOIN pg_namespace tn ON tn.oid = t.relnamespace
  JOIN pg_class rc ON con.confrelid = rc.oid
  JOIN pg_namespace rn ON rn.oid = rc.relnamespace
  JOIN target_schemas ts ON ts.schema_name = tn.nspname
  WHERE con.contype = 'f'
)
SELECT f.name              AS name,
       f.source_schema     AS source_schema,
       f.source_table      AS source_table,
       (SELECT array_agg(a.attname ORDER BY o.ord)
          FROM unnest(f.source_keys) WITH ORDINALITY AS o(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = f.source_oid AND a.attnum = o.attnum
) AS source_columns,
       f.target_schema     AS target_schema,
       f.target_table      AS target_table,
       (SELECT array_agg(a.attname ORDER BY o.ord)
          FROM unnest(f.target_keys) WITH ORDINALITY AS o(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = f.target_oid AND a.attnum = o.attnum
) AS target_columns
FROM fks f
ORDER BY source_schema, source_table, name";

/// All non-system schemas — used when the caller passes `schemas: None` to
/// `erd_get_schema_graph`. Returns a single `text` column.
pub const ERD_ALL_USER_SCHEMAS_SQL: &str = "\
SELECT schema_name AS name
FROM information_schema.schemata
WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
  AND schema_name NOT LIKE 'pg_temp_%'
  AND schema_name NOT LIKE 'pg_toast%'
ORDER BY schema_name";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_are_nonempty_and_parameterized() {
        for sql in [ERD_TABLES_AND_COLUMNS_SQL, ERD_FOREIGN_KEYS_SQL] {
            assert!(!sql.trim().is_empty(), "ERD SQL constant must not be empty");
            assert!(
                sql.contains("$1::text[]"),
                "ERD SQL must accept text[] schema list as $1: {sql}"
            );
        }
        assert!(!ERD_ALL_USER_SCHEMAS_SQL.trim().is_empty());
        assert!(ERD_TABLES_AND_COLUMNS_SQL.contains("relkind IN ('r', 'p')"));
        assert!(ERD_TABLES_AND_COLUMNS_SQL.contains("pg_inherits"));
        assert!(ERD_FOREIGN_KEYS_SQL.contains("contype = 'f'"));
        // Sanity: ordinality preserved server-side for composite FKs.
        assert!(ERD_FOREIGN_KEYS_SQL.contains("WITH ORDINALITY"));
        assert!(ERD_FOREIGN_KEYS_SQL.contains("array_agg"));
    }
}
