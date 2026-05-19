//! Postgres DDL parser built on top of `pg_query` v6. Converts SQL text to a
//! `DdlParseResult` containing typed `DdlChange` variants. .

use crate::parser::types::{ColumnDef, DdlChange, DdlParseResult, ParseError};
use pg_query::protobuf as pb;
use pg_query::NodeEnum;

pub fn parse_ddl(text: &str) -> Result<DdlParseResult, ParseError> {
    let parsed = pg_query::parse(text).map_err(|e| to_parse_error(&e, text))?;
    let mut changes = Vec::new();
    let warnings = Vec::new();

    for raw in &parsed.protobuf.stmts {
        let Some(stmt_node) = raw.stmt.as_ref().and_then(|n| n.node.as_ref()) else {
            continue;
        };
        match stmt_node {
            NodeEnum::CreateStmt(create) => handle_create_stmt(create, &mut changes),
            NodeEnum::AlterTableStmt(alter) => handle_alter_table(alter, &mut changes),
            NodeEnum::RenameStmt(r) => handle_rename_stmt(r, &mut changes),
            NodeEnum::DropStmt(d) => handle_drop_stmt(d, &mut changes),
            // Other node kinds land in Task 7.
            _ => changes.push(DdlChange::Unrepresentable {
                sql_snippet: snippet_for_stmt(text, raw),
                reason: "Statement type not yet supported in visual editor".into(),
            }),
        }
    }

    Ok(DdlParseResult { changes, warnings })
}

fn handle_create_stmt(create: &pb::CreateStmt, out: &mut Vec<DdlChange>) {
    let Some(rel) = &create.relation else { return };
    let schema = if rel.schemaname.is_empty() {
        "public".into()
    } else {
        rel.schemaname.clone()
    };
    let table_name = rel.relname.clone();

    let mut columns: Vec<ColumnDef> = Vec::new();
    let mut pk_cols: Vec<String> = Vec::new();
    let mut deferred_fks: Vec<DdlChange> = Vec::new();

    for elt in &create.table_elts {
        let Some(node) = elt.node.as_ref() else {
            continue;
        };
        match node {
            NodeEnum::ColumnDef(col) => {
                let mut def = ColumnDef {
                    name: col.colname.clone(),
                    data_type: format_type_name(col.type_name.as_ref()),
                    nullable: true,
                    identity: false,
                    is_primary_key: false,
                };
                for cnode in &col.constraints {
                    let Some(NodeEnum::Constraint(c)) = cnode.node.as_ref() else {
                        continue;
                    };
                    apply_column_constraint(                        c,
                        &mut def,
                        &mut pk_cols,
                        &col.colname,
                        &schema,
                        &table_name,
                        &mut deferred_fks,
);
                }
                if def.is_primary_key && !pk_cols.contains(&def.name) {
                    pk_cols.push(def.name.clone());
                }
                columns.push(def);
            }
            NodeEnum::Constraint(c) => {
                apply_table_constraint(                    c,
                    &schema,
                    &table_name,
                    &mut pk_cols,
                    &mut deferred_fks,
                    &mut columns,
);
            }
            _ => {}
        }
    }

    out.push(DdlChange::CreateTable {
        schema,
        name: table_name,
        columns,
        primary_key: pk_cols,
    });
    out.extend(deferred_fks);
}

fn apply_column_constraint(    c: &pb::Constraint,
    def: &mut ColumnDef,
    pk_cols: &mut Vec<String>,
    col_name: &str,
    table_schema: &str,
    table_name: &str,
    deferred_fks: &mut Vec<DdlChange>,
) {
    use pb::ConstrType;
    match ConstrType::try_from(c.contype).unwrap_or(ConstrType::ConstrNull) {
        ConstrType::ConstrNotnull => def.nullable = false,
        ConstrType::ConstrPrimary => {
            def.is_primary_key = true;
            def.nullable = false;
            if !pk_cols.contains(&col_name.to_string()) {
                pk_cols.push(col_name.to_string());
            }
        }
        ConstrType::ConstrIdentity => def.identity = true,
        // S20 fix: column-level `REFERENCES other(col)` produces a
        // `ConstrForeign` whose `pktable` / `pk_attrs` are populated but
        // `fk_attrs` is empty (the FK column IS the column being defined).
        // Synthesize an AddForeignKey using the column's own name so the
        // ERD edge gets drawn.
        ConstrType::ConstrForeign => {
            let pktable = c.pktable.as_ref();
            let ref_schema = pktable
                .map(|r| {
                    if r.schemaname.is_empty() {
                        table_schema.to_string()
                    } else {
                        r.schemaname.clone()
                    }
                })
                .unwrap_or_else(|| table_schema.to_string());
            let ref_table = pktable.map(|r| r.relname.clone()).unwrap_or_default();
            let ref_columns = string_list(&c.pk_attrs);
            let name = if c.conname.is_empty() {
                None
            } else {
                Some(c.conname.clone())
            };
            deferred_fks.push(DdlChange::AddForeignKey {
                schema: table_schema.to_string(),
                table: table_name.to_string(),
                name,
                columns: vec![col_name.to_string()],
                ref_schema,
                ref_table,
                ref_columns,
            });
        }
        _ => {}
    }
}

fn apply_table_constraint(    c: &pb::Constraint,
    schema: &str,
    table_name: &str,
    pk_cols: &mut Vec<String>,
    deferred_fks: &mut Vec<DdlChange>,
    _columns: &mut [ColumnDef],
) {
    use pb::ConstrType;
    match ConstrType::try_from(c.contype).unwrap_or(ConstrType::ConstrNull) {
        ConstrType::ConstrPrimary => {
            for k in &c.keys {
                if let Some(NodeEnum::String(s)) = k.node.as_ref() {
                    if !pk_cols.contains(&s.sval) {
                        pk_cols.push(s.sval.clone());
                    }
                }
            }
        }
        ConstrType::ConstrForeign => {
            let cols = string_list(&c.fk_attrs);
            let ref_cols = string_list(&c.pk_attrs);
            let pktable = c.pktable.as_ref();
            let ref_schema = pktable
                .map(|r| {
                    if r.schemaname.is_empty() {
                        schema.to_string()
                    } else {
                        r.schemaname.clone()
                    }
                })
                .unwrap_or_else(|| schema.to_string());
            let ref_table = pktable.map(|r| r.relname.clone()).unwrap_or_default();
            let name = if c.conname.is_empty() {
                None
            } else {
                Some(c.conname.clone())
            };
            deferred_fks.push(DdlChange::AddForeignKey {
                schema: schema.to_string(),
                table: table_name.to_string(),
                name,
                columns: cols,
                ref_schema,
                ref_table,
                ref_columns: ref_cols,
            });
        }
        _ => {}
    }
}

fn string_list(nodes: &[pb::Node]) -> Vec<String> {
    nodes
        .iter()
        .filter_map(|n| {
            if let Some(NodeEnum::String(s)) = n.node.as_ref() {
                Some(s.sval.clone())
            } else {
                None
            }
        })
        .collect()
}

pub(crate) fn format_type_name(tn: Option<&pb::TypeName>) -> String {
    let Some(tn) = tn else { return String::new() };
    let parts: Vec<String> = tn
        .names
        .iter()
        .filter_map(|n| {
            if let Some(NodeEnum::String(s)) = n.node.as_ref() {
                Some(s.sval.clone())
            } else {
                None
            }
        })
        .collect();
    let last = parts.last().cloned().unwrap_or_default();
    // Map pg_catalog.int4 → integer, etc.
    match last.as_str() {
        "int4" => "integer".into(),
        "int8" => "bigint".into(),
        "int2" => "smallint".into(),
        "float4" => "real".into(),
        "float8" => "double precision".into(),
        other => other.to_string(),
    }
}

fn handle_alter_table(alter: &pb::AlterTableStmt, out: &mut Vec<DdlChange>) {
    let Some(rel) = &alter.relation else { return };
    let schema = if rel.schemaname.is_empty() {
        "public".into()
    } else {
        rel.schemaname.clone()
    };
    let table = rel.relname.clone();

    for cmd_node in &alter.cmds {
        let Some(NodeEnum::AlterTableCmd(cmd)) = cmd_node.node.as_ref() else {
            continue;
        };
        let pre_len = out.len();
        let representable = handle_alter_cmd(cmd, &schema, &table, out);
        if !representable && out.len() == pre_len {
            out.push(DdlChange::Unrepresentable {
                sql_snippet: format!("ALTER TABLE {schema}.{table} ..."),
                reason: format!("ALTER subtype {} not yet supported", cmd.subtype),
            });
        }
    }
}

/// Returns true when the subtype was recognised. The function MAY push more
/// than one change (e.g. ALTER ADD COLUMN with inline REFERENCES emits both
/// `AddColumn` and `AddForeignKey`). Returns false when the subtype is
/// unsupported so the caller can record an Unrepresentable entry.
fn handle_alter_cmd(    cmd: &pb::AlterTableCmd,
    schema: &str,
    table: &str,
    out: &mut Vec<DdlChange>,
) -> bool {
    use pb::AlterTableType as A;
    let Ok(subtype) = A::try_from(cmd.subtype) else {
        return false;
    };
    match subtype {
        A::AtAddColumn => {
            let Some(def_node) = cmd.def.as_ref().and_then(|n| n.node.as_ref()) else {
                return false;
            };
            let NodeEnum::ColumnDef(col) = def_node else {
                return false;
            };
            let mut def = ColumnDef {
                name: col.colname.clone(),
                data_type: format_type_name(col.type_name.as_ref()),
                nullable: true,
                identity: false,
                is_primary_key: false,
            };
            // Synthesize FK if the new column carries an inline REFERENCES.
            let mut deferred_fks: Vec<DdlChange> = Vec::new();
            let mut tmp_pk = Vec::new();
            for cnode in &col.constraints {
                if let Some(NodeEnum::Constraint(c)) = cnode.node.as_ref() {
                    apply_column_constraint(                        c,
                        &mut def,
                        &mut tmp_pk,
                        &col.colname,
                        schema,
                        table,
                        &mut deferred_fks,
);
                }
            }
            out.push(DdlChange::AddColumn {
                schema: schema.into(),
                table: table.into(),
                column: def,
            });
            out.extend(deferred_fks);
            true
        }
        A::AtDropColumn => {
            out.push(DdlChange::DropColumn {
                schema: schema.into(),
                table: table.into(),
                column: cmd.name.clone(),
            });
            true
        }
        A::AtSetNotNull => {
            out.push(DdlChange::AlterColumnNullable {
                schema: schema.into(),
                table: table.into(),
                column: cmd.name.clone(),
                nullable: false,
            });
            true
        }
        A::AtDropNotNull => {
            out.push(DdlChange::AlterColumnNullable {
                schema: schema.into(),
                table: table.into(),
                column: cmd.name.clone(),
                nullable: true,
            });
            true
        }
        A::AtAlterColumnType => {
            let Some(def_node) = cmd.def.as_ref().and_then(|n| n.node.as_ref()) else {
                return false;
            };
            let NodeEnum::ColumnDef(col) = def_node else {
                return false;
            };
            out.push(DdlChange::AlterColumnType {
                schema: schema.into(),
                table: table.into(),
                column: cmd.name.clone(),
                new_type: format_type_name(col.type_name.as_ref()),
            });
            true
        }
        A::AtAddConstraint => {
            let Some(def_node) = cmd.def.as_ref().and_then(|n| n.node.as_ref()) else {
                return false;
            };
            let NodeEnum::Constraint(c) = def_node else {
                return false;
            };
            use pb::ConstrType;
            let Ok(ct) = ConstrType::try_from(c.contype) else {
                return false;
            };
            match ct {
                ConstrType::ConstrPrimary => {
                    out.push(DdlChange::AddPrimaryKey {
                        schema: schema.into(),
                        table: table.into(),
                        columns: string_list(&c.keys),
                    });
                    true
                }
                ConstrType::ConstrForeign => {
                    let cols = string_list(&c.fk_attrs);
                    let ref_cols = string_list(&c.pk_attrs);
                    let pktable = c.pktable.as_ref();
                    let ref_schema = pktable
                        .map(|r| {
                            if r.schemaname.is_empty() {
                                schema.to_string()
                            } else {
                                r.schemaname.clone()
                            }
                        })
                        .unwrap_or_else(|| schema.to_string());
                    let ref_table = pktable.map(|r| r.relname.clone()).unwrap_or_default();
                    let name = if c.conname.is_empty() {
                        None
                    } else {
                        Some(c.conname.clone())
                    };
                    out.push(DdlChange::AddForeignKey {
                        schema: schema.into(),
                        table: table.into(),
                        name,
                        columns: cols,
                        ref_schema,
                        ref_table,
                        ref_columns: ref_cols,
                    });
                    true
                }
                _ => false,
            }
        }
        A::AtDropConstraint => {
            out.push(DdlChange::DropConstraint {
                schema: schema.into(),
                table: table.into(),
                constraint: cmd.name.clone(),
            });
            true
        }
        _ => false,
    }
}

fn handle_rename_stmt(r: &pb::RenameStmt, out: &mut Vec<DdlChange>) {
    use pb::ObjectType;
    let kind = ObjectType::try_from(r.rename_type).unwrap_or(ObjectType::ObjectAccessMethod);
    let Some(rel) = &r.relation else { return };
    let schema = if rel.schemaname.is_empty() {
        "public".into()
    } else {
        rel.schemaname.clone()
    };
    let table = rel.relname.clone();
    match kind {
        ObjectType::ObjectTable => {
            out.push(DdlChange::RenameTable {
                schema,
                old_name: table,
                new_name: r.newname.clone(),
            });
        }
        ObjectType::ObjectColumn => {
            out.push(DdlChange::RenameColumn {
                schema,
                table,
                old_name: r.subname.clone(),
                new_name: r.newname.clone(),
            });
        }
        _ => out.push(DdlChange::Unrepresentable {
            sql_snippet: format!("RENAME {kind:?}"),
            reason: format!("Rename of {kind:?} not yet supported"),
        }),
    }
}

fn handle_drop_stmt(d: &pb::DropStmt, out: &mut Vec<DdlChange>) {
    use pb::ObjectType;
    let kind = ObjectType::try_from(d.remove_type).unwrap_or(ObjectType::ObjectAccessMethod);
    if !matches!(kind, ObjectType::ObjectTable) {
        out.push(DdlChange::Unrepresentable {
            sql_snippet: format!("DROP {kind:?}"),
            reason: format!("Drop of {kind:?} not yet supported"),
        });
        return;
    }
    for obj_node in &d.objects {
        let Some(NodeEnum::List(list)) = obj_node.node.as_ref() else {
            continue;
        };
        let parts: Vec<String> = list
            .items
            .iter()
            .filter_map(|n| {
                if let Some(NodeEnum::String(s)) = n.node.as_ref() {
                    Some(s.sval.clone())
                } else {
                    None
                }
            })
            .collect();
        let (schema, name) = match parts.as_slice() {
            [s, n] => (s.clone(), n.clone()),
            [n] => ("public".into(), n.clone()),
            _ => continue,
        };
        out.push(DdlChange::DropTable { schema, name });
    }
}

fn to_parse_error(e: &pg_query::Error, text: &str) -> ParseError {
    let msg = e.to_string();
    // pg_query error message is like: "syntax error at or near \"TABL\""
    // pg_query::Error variants don't expose offset directly; for simple syntax
    // errors we locate the offending token by string match.
    let (line, column) = locate_first_diff(text, &msg).unwrap_or((1, 1));
    ParseError {
        message: msg,
        line,
        column,
    }
}

fn locate_first_diff(text: &str, msg: &str) -> Option<(u32, u32)> {
    let token = msg.split('"').nth(1)?;
    let pos = text.find(token)?;
    let prefix = &text[..pos];
    let line = prefix.matches('\n').count() as u32 + 1;
    let last_newline = prefix.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let column = (pos - last_newline) as u32 + 1;
    Some((line, column))
}

fn snippet_for_stmt(text: &str, raw: &pb::RawStmt) -> String {
    let start = raw.stmt_location as usize;
    let len = raw.stmt_len as usize;
    let end = (start + len).min(text.len());
    text.get(start..end).unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::types::DdlChange;

    #[test]
    fn handles_multi_statement() {
        let sql = "CREATE TABLE a (id int); ALTER TABLE a ADD COLUMN b text;";
        let r = parse_ddl(sql).unwrap();
        assert_eq!(r.changes.len(), 2);
        assert!(matches!(r.changes[0], DdlChange::CreateTable { .. }));
        assert!(matches!(r.changes[1], DdlChange::AddColumn { .. }));
    }

    #[test]
    fn unsupported_statement_marked_unrepresentable() {
        let r = parse_ddl("CREATE INDEX idx_users_email ON users (email)").unwrap();
        match &r.changes[0] {
            DdlChange::Unrepresentable { reason, .. } => {
                assert!(reason.contains("not yet supported"));
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parse_error_returns_line_column() {
        let err = parse_ddl("CREATE TABL foo (id int)").unwrap_err();
        assert!(err.line >= 1);
        assert!(err.column >= 1);
        assert!(err.message.to_lowercase().contains("syntax"));
    }

    #[test]
    fn parses_rename_table() {
        let r = parse_ddl("ALTER TABLE users RENAME TO accounts").unwrap();
        match &r.changes[0] {
            DdlChange::RenameTable {
                old_name, new_name, ..
            } => {
                assert_eq!(old_name, "users");
                assert_eq!(new_name, "accounts");
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_rename_column() {
        let r = parse_ddl("ALTER TABLE users RENAME COLUMN email TO email_address").unwrap();
        match &r.changes[0] {
            DdlChange::RenameColumn {
                table,
                old_name,
                new_name,
                ..
            } => {
                assert_eq!(table, "users");
                assert_eq!(old_name, "email");
                assert_eq!(new_name, "email_address");
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_drop_table() {
        let r = parse_ddl("DROP TABLE public.posts").unwrap();
        match &r.changes[0] {
            DdlChange::DropTable { schema, name } => {
                assert_eq!(schema, "public");
                assert_eq!(name, "posts");
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_alter_add_column() {
        let r = parse_ddl("ALTER TABLE public.users ADD COLUMN email text NOT NULL").unwrap();
        assert_eq!(r.changes.len(), 1);
        match &r.changes[0] {
            DdlChange::AddColumn {
                schema,
                table,
                column,
            } => {
                assert_eq!(schema, "public");
                assert_eq!(table, "users");
                assert_eq!(column.name, "email");
                assert_eq!(column.data_type, "text");
                assert!(!column.nullable);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_alter_drop_column() {
        let r = parse_ddl("ALTER TABLE users DROP COLUMN deprecated_flag").unwrap();
        match &r.changes[0] {
            DdlChange::DropColumn { table, column, .. } => {
                assert_eq!(table, "users");
                assert_eq!(column, "deprecated_flag");
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_alter_set_not_null() {
        let r = parse_ddl("ALTER TABLE users ALTER COLUMN email SET NOT NULL").unwrap();
        match &r.changes[0] {
            DdlChange::AlterColumnNullable {
                column, nullable, ..
            } => {
                assert_eq!(column, "email");
                assert!(!nullable);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_alter_drop_not_null() {
        let r = parse_ddl("ALTER TABLE users ALTER COLUMN email DROP NOT NULL").unwrap();
        match &r.changes[0] {
            DdlChange::AlterColumnNullable {
                column, nullable, ..
            } => {
                assert!(*nullable);
                assert_eq!(column, "email");
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_alter_column_type() {
        let r = parse_ddl("ALTER TABLE users ALTER COLUMN age TYPE bigint").unwrap();
        match &r.changes[0] {
            DdlChange::AlterColumnType {
                column, new_type, ..
            } => {
                assert_eq!(column, "age");
                assert_eq!(new_type, "bigint");
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_alter_add_foreign_key() {
        let r = parse_ddl(            "ALTER TABLE posts ADD CONSTRAINT posts_user_fk FOREIGN KEY (user_id) REFERENCES users (id)"
).unwrap();
        match &r.changes[0] {
            DdlChange::AddForeignKey {
                table,
                name,
                columns,
                ref_table,
                ref_columns,
                ..
            } => {
                assert_eq!(table, "posts");
                assert_eq!(name.as_deref(), Some("posts_user_fk"));
                assert_eq!(columns, &vec!["user_id".to_string()]);
                assert_eq!(ref_table, "users");
                assert_eq!(ref_columns, &vec!["id".to_string()]);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_alter_drop_constraint() {
        let r = parse_ddl("ALTER TABLE posts DROP CONSTRAINT posts_user_fk").unwrap();
        match &r.changes[0] {
            DdlChange::DropConstraint {
                table, constraint, ..
            } => {
                assert_eq!(table, "posts");
                assert_eq!(constraint, "posts_user_fk");
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_alter_add_primary_key() {
        let r = parse_ddl("ALTER TABLE users ADD PRIMARY KEY (id)").unwrap();
        match &r.changes[0] {
            DdlChange::AddPrimaryKey { table, columns, .. } => {
                assert_eq!(table, "users");
                assert_eq!(columns, &vec!["id".to_string()]);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_create_table_with_inline_column_references() {
        // S20 column-level `REFERENCES posts(id)` was silently
        // dropped; the FK edge never appeared in the ERD.
        let sql = "CREATE TABLE comments (\
            id bigint PRIMARY KEY,\
            post_id bigint REFERENCES posts(id)\
)";
        let result = parse_ddl(sql).unwrap();
        assert_eq!(            result.changes.len(),
            2,
            "expected CreateTable + AddForeignKey"
);
        match &result.changes[1] {
            DdlChange::AddForeignKey {
                table,
                columns,
                ref_table,
                ref_columns,
                ..
            } => {
                assert_eq!(table, "comments");
                assert_eq!(columns, &vec!["post_id".to_string()]);
                assert_eq!(ref_table, "posts");
                assert_eq!(ref_columns, &vec!["id".to_string()]);
            }
            other => panic!("expected AddForeignKey, got {other:?}"),
        }
    }

    #[test]
    fn parses_alter_add_column_with_inline_references() {
        // S20 (ALTER variant): `ALTER TABLE foo ADD COLUMN bar bigint
        // REFERENCES users(id)` should produce both AddColumn + AddForeignKey.
        let r = parse_ddl("ALTER TABLE comments ADD COLUMN author_id bigint REFERENCES users(id)")
            .unwrap();
        assert_eq!(r.changes.len(), 2);
        match &r.changes[0] {
            DdlChange::AddColumn { column, .. } => assert_eq!(column.name, "author_id"),
            o => panic!("{o:?}"),
        }
        match &r.changes[1] {
            DdlChange::AddForeignKey {
                table,
                columns,
                ref_table,
                ref_columns,
                ..
            } => {
                assert_eq!(table, "comments");
                assert_eq!(columns, &vec!["author_id".to_string()]);
                assert_eq!(ref_table, "users");
                assert_eq!(ref_columns, &vec!["id".to_string()]);
            }
            o => panic!("{o:?}"),
        }
    }

    #[test]
    fn parses_create_table_with_pk_and_fk() {
        let sql = "CREATE TABLE public.posts (\
            id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,\
            user_id bigint NOT NULL,\
            title text NOT NULL,\
            CONSTRAINT posts_user_fk FOREIGN KEY (user_id) REFERENCES public.users (id)\
)";
        let result = parse_ddl(sql).unwrap();
        assert_eq!(            result.changes.len(),
            2,
            "expected CreateTable + AddForeignKey"
);

        match &result.changes[0] {
            DdlChange::CreateTable {
                schema,
                name,
                columns,
                primary_key,
            } => {
                assert_eq!(schema, "public");
                assert_eq!(name, "posts");
                assert_eq!(columns.len(), 3);
                assert_eq!(columns[0].name, "id");
                assert_eq!(columns[0].data_type, "bigint");
                assert!(columns[0].identity);
                assert!(!columns[0].nullable);
                assert!(columns[0].is_primary_key);
                assert_eq!(primary_key, &vec!["id".to_string()]);
            }
            other => panic!("expected CreateTable, got {other:?}"),
        }
        match &result.changes[1] {
            DdlChange::AddForeignKey {
                table,
                columns,
                ref_table,
                ref_columns,
                ..
            } => {
                assert_eq!(table, "posts");
                assert_eq!(columns, &vec!["user_id".to_string()]);
                assert_eq!(ref_table, "users");
                assert_eq!(ref_columns, &vec!["id".to_string()]);
            }
            other => panic!("expected AddForeignKey, got {other:?}"),
        }
    }
}
