//! Property tests for the Sprint 20 DDL parser. Verifies that random
//! generated CREATE TABLE / ALTER TABLE statements round-trip cleanly through
//! `parse_ddl` and produce structurally consistent `DdlChange` outputs.

use ide99::parser::ddl::parse_ddl;
use ide99::parser::types::DdlChange;
use proptest::prelude::*;

// Subset of PG reserved keywords that the regex `[a-z][a-z0-9_]{0,15}` can hit
// at random. Filtering them out keeps property tests focused on parser
// round-trips, not on quoting behavior. Discovered the hard way when
// `schema = "to"` shrunk into a reproducible failure.
const RESERVED: &[&str] = &[
    "all",
    "and",
    "any",
    "array",
    "as",
    "asc",
    "asymmetric",
    "both",
    "case",
    "cast",
    "check",
    "collate",
    "column",
    "constraint",
    "create",
    "current_catalog",
    "current_date",
    "current_role",
    "current_time",
    "current_timestamp",
    "current_user",
    "default",
    "deferrable",
    "desc",
    "distinct",
    "do",
    "else",
    "end",
    "except",
    "false",
    "fetch",
    "for",
    "foreign",
    "from",
    "grant",
    "group",
    "having",
    "in",
    "initially",
    "intersect",
    "into",
    "is",
    "lateral",
    "leading",
    "limit",
    "localtime",
    "localtimestamp",
    "not",
    "null",
    "offset",
    "on",
    "only",
    "or",
    "order",
    "placing",
    "primary",
    "references",
    "returning",
    "select",
    "session_user",
    "some",
    "symmetric",
    "table",
    "then",
    "to",
    "trailing",
    "true",
    "union",
    "unique",
    "user",
    "using",
    "variadic",
    "when",
    "where",
    "window",
    "with",
];

fn is_reserved(s: &str) -> bool {
    RESERVED.binary_search(&s).is_ok()
}

// Identifier alphabet: keep simple — Postgres bareword unquoted identifiers
// are case-insensitive ASCII letters, digits, and underscores starting with
// a letter. Then filter out PG reserved words so the parser doesn't have to
// deal with `CREATE TABLE to.a (a integer)` and friends.
fn ident() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9_]{0,15}".prop_filter("not a PG reserved word", |s| !is_reserved(s))
}

proptest! {
    #[test]
    fn create_table_with_one_column_roundtrips(
        schema in ident(),
        name in ident(),
        col in ident(),
    ) {
        let sql = format!("CREATE TABLE {schema}.{name} ({col} integer NOT NULL)");
        let result = parse_ddl(&sql).unwrap();
        prop_assert_eq!(result.changes.len(), 1);
        match &result.changes[0] {
            DdlChange::CreateTable { schema: s, name: n, columns, .. } => {
                prop_assert_eq!(s, &schema);
                prop_assert_eq!(n, &name);
                prop_assert_eq!(columns.len(), 1);
                prop_assert_eq!(&columns[0].name, &col);
                prop_assert_eq!(&columns[0].data_type, "integer");
                prop_assert!(!columns[0].nullable);
            }
            other => prop_assert!(false, "expected CreateTable, got {:?}", other),
        }
    }

    #[test]
    fn alter_add_column_roundtrips(
        schema in ident(),
        table in ident(),
        col in ident(),
    ) {
        let sql = format!("ALTER TABLE {schema}.{table} ADD COLUMN {col} text");
        let result = parse_ddl(&sql).unwrap();
        prop_assert_eq!(result.changes.len(), 1);
        match &result.changes[0] {
            DdlChange::AddColumn { schema: s, table: t, column } => {
                prop_assert_eq!(s, &schema);
                prop_assert_eq!(t, &table);
                prop_assert_eq!(&column.name, &col);
                prop_assert_eq!(&column.data_type, "text");
                prop_assert!(column.nullable); // no NOT NULL → nullable
            }
            other => prop_assert!(false, "expected AddColumn, got {:?}", other),
        }
    }

    #[test]
    fn alter_drop_column_roundtrips(
        schema in ident(),
        table in ident(),
        col in ident(),
    ) {
        let sql = format!("ALTER TABLE {schema}.{table} DROP COLUMN {col}");
        let result = parse_ddl(&sql).unwrap();
        match &result.changes[0] {
            DdlChange::DropColumn { schema: s, table: t, column } => {
                prop_assert_eq!(s, &schema);
                prop_assert_eq!(t, &table);
                prop_assert_eq!(column, &col);
            }
            other => prop_assert!(false, "expected DropColumn, got {:?}", other),
        }
    }

    #[test]
    fn alter_set_not_null_roundtrips(
        schema in ident(),
        table in ident(),
        col in ident(),
    ) {
        let sql = format!("ALTER TABLE {schema}.{table} ALTER COLUMN {col} SET NOT NULL");
        let result = parse_ddl(&sql).unwrap();
        match &result.changes[0] {
            DdlChange::AlterColumnNullable { column, nullable, .. } => {
                prop_assert_eq!(column, &col);
                prop_assert!(!*nullable);
            }
            other => prop_assert!(false, "expected AlterColumnNullable, got {:?}", other),
        }
    }
}
