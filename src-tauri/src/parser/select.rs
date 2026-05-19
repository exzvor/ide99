//! Postgres SELECT parser → `QueryShape`. Implements of .

use crate::parser::types::{BaseSelect, ClauseSpan, ParseError, QueryShape};
use pg_query::protobuf as pb;
use pg_query::NodeEnum;

pub fn parse_select(text: &str) -> Result<QueryShape, ParseError> {
    let parsed = pg_query::parse(text).map_err(to_parse_error)?;
    let mut stmts = parsed.protobuf.stmts.iter();
    let raw = stmts.next().ok_or_else(|| ParseError {
        message: "Empty input".into(),
        line: 1,
        column: 1,
    })?;
    let stmt_node = raw
        .stmt
        .as_ref()
        .and_then(|n| n.node.as_ref())
        .ok_or_else(|| ParseError {
            message: "Missing statement node".into(),
            line: 1,
            column: 1,
        })?;
    let select = match stmt_node {
        NodeEnum::SelectStmt(s) => s,
        _ => {
            return Err(ParseError {
                message: "Not a SELECT statement".into(),
                line: 1,
                column: 1,
            })
        }
    };
    build_shape(text, select)
}

fn build_shape(text: &str, s: &pb::SelectStmt) -> Result<QueryShape, ParseError> {
    // Reject non-flat shapes BEFORE extracting base select.
    //
    // Reason values are stable kebab-case slugs (no English prose). The
    // frontend looks them up in `filter.unrepresentableReason.<slug>` and
    // suppresses the banner entirely when filtering is structurally
    // inapplicable (e.g. `no-from` for scalar SELECTs).
    if !s.group_clause.is_empty() {
        return Ok(empty_unrep_shape(text, s, "group-by"));
    }
    if s.having_clause.is_some() {
        return Ok(empty_unrep_shape(text, s, "having"));
    }
    if !s.window_clause.is_empty() {
        return Ok(empty_unrep_shape(text, s, "window"));
    }
    if !s.with_clause.as_ref().is_none_or(|w| w.ctes.is_empty()) {
        return Ok(empty_unrep_shape(text, s, "with-cte"));
    }
    let from_count = s.from_clause.len();
    if from_count == 0 {
        return Ok(empty_unrep_shape(text, s, "no-from"));
    }
    if from_count > 1 {
        return Ok(empty_unrep_shape(text, s, "multiple-from"));
    }
    let Some(from) = s.from_clause.first().and_then(|n| n.node.as_ref()) else {
        return Ok(empty_unrep_shape(text, s, "complex-from"));
    };
    let NodeEnum::RangeVar(rv) = from else {
        return Ok(empty_unrep_shape(text, s, "non-flat-from"));
    };
    // S20 a `RangeVar` with an `alias` set is `FROM users u`. The
    // filter UI generates unqualified `"id"` predicates which would clash
    // with an aliased projection (`SELECT u.id`); the spec lists alias as
    // unrepresentable, so disable filter UI here.
    if rv.alias.is_some() {
        return Ok(empty_unrep_shape(text, s, "non-flat-from"));
    }
    let base_select = extract_base_select(s)?;
    let (filters, where_unrep) = extract_filters(s);
    let (sort, sort_unrep) = extract_sort(s);
    let limit = extract_limit(s);
    let unrepresentable_tail = where_unrep.or(sort_unrep);
    Ok(QueryShape {
        base_select,
        filters,
        sort,
        limit,
        unrepresentable_tail,
        where_span: if s.where_clause.is_some() {
            find_keyword_span(text, "WHERE ")
        } else {
            None
        },
        order_by_span: if !s.sort_clause.is_empty() {
            find_keyword_span(text, "ORDER BY")
        } else {
            None
        },
        limit_span: if s.limit_count.is_some() {
            find_keyword_span(text, "LIMIT ")
        } else {
            None
        },
        from_end: find_from_end(text),
    })
}

fn empty_unrep_shape(text: &str, _s: &pb::SelectStmt, slug: &str) -> QueryShape {
    QueryShape {
        base_select: BaseSelect {
            schema: None,
            table: String::new(),
            columns: Vec::new(),
        },
        filters: Vec::new(),
        sort: None,
        limit: None,
        unrepresentable_tail: Some(slug.to_string()),
        where_span: None,
        order_by_span: None,
        limit_span: None,
        from_end: text.len() as u32,
    }
}

fn find_keyword_span(text: &str, kw: &str) -> Option<ClauseSpan> {
    let upper = text.to_ascii_uppercase();
    let kw_upper = kw.to_ascii_uppercase();
    let start = upper.find(&kw_upper)?;
    let after_start = start + kw_upper.len();
    let stop_words = [
        "WHERE ", "ORDER BY", "GROUP BY", "HAVING ", "LIMIT ", "OFFSET ", "FETCH ",
    ];
    let end = stop_words
        .iter()
        .filter(|w| **w != kw_upper.as_str())
        .filter_map(|w| upper[after_start..].find(*w).map(|p| after_start + p))
        .min()
        .unwrap_or(text.len());
    Some(ClauseSpan {
        start: start as u32,
        end: end as u32,
    })
}

fn find_from_end(text: &str) -> u32 {
    let upper = text.to_ascii_uppercase();
    let from_idx = upper.find("FROM ").unwrap_or(0);
    let after_from = from_idx + 5;
    // FROM ends at whitespace after the relation name (single-table only).
    let end = upper[after_from..]
        .find([' ', '\t', '\n'])
        .map(|i| after_from + i + 1)
        .unwrap_or(text.len());
    // Walk past further whitespace to land before optional WHERE/ORDER/LIMIT.
    let mut idx = end;
    while idx < text.len() && text.as_bytes()[idx].is_ascii_whitespace() {
        idx += 1;
    }
    idx as u32
}

fn extract_sort(s: &pb::SelectStmt) -> (Option<crate::parser::types::Sort>, Option<String>) {
    use crate::parser::types::{Sort, SortDir};
    use pb::SortByDir;
    if s.sort_clause.is_empty() {
        return (None, None);
    }
    if s.sort_clause.len() > 1 {
        return (None, Some("multi-column-order".into()));
    }
    let Some(NodeEnum::SortBy(sb)) = s.sort_clause[0].node.as_ref() else {
        return (None, Some("order-shape".into()));
    };
    let Some(node) = sb.node.as_ref().and_then(|n| n.node.as_ref()) else {
        return (None, None);
    };
    let NodeEnum::ColumnRef(c) = node else {
        return (None, Some("order-expr".into()));
    };
    let Some(column) = column_ref_name(c) else {
        return (None, None);
    };
    let dir_proto = SortByDir::try_from(sb.sortby_dir).unwrap_or(SortByDir::SortbyDefault);
    let dir = match dir_proto {
        SortByDir::SortbyDesc => SortDir::Desc,
        _ => SortDir::Asc,
    };
    (Some(Sort { column, dir }), None)
}

fn extract_limit(s: &pb::SelectStmt) -> Option<i64> {
    let node = s.limit_count.as_ref()?.node.as_ref()?;
    let NodeEnum::AConst(c) = node else {
        return None;
    };
    let val = c.val.as_ref()?;
    if let pb::a_const::Val::Ival(i) = val {
        Some(i.ival as i64)
    } else {
        None
    }
}

fn extract_filters(s: &pb::SelectStmt) -> (Vec<crate::parser::types::Filter>, Option<String>) {
    let Some(where_node) = s.where_clause.as_ref().and_then(|n| n.node.as_ref()) else {
        return (Vec::new(), None);
    };
    let mut acc: Vec<crate::parser::types::Filter> = Vec::new();
    if !walk_and_collect(where_node, &mut acc) {
        return (Vec::new(), Some("where-expr".into()));
    }
    (acc, None)
}

fn walk_and_collect(node: &NodeEnum, out: &mut Vec<crate::parser::types::Filter>) -> bool {
    use pb::BoolExprType;
    match node {
        NodeEnum::BoolExpr(b)
            if BoolExprType::try_from(b.boolop).ok() == Some(BoolExprType::AndExpr) =>
        {
            for arg in &b.args {
                let Some(inner) = arg.node.as_ref() else {
                    return false;
                };
                if !walk_and_collect(inner, out) {
                    return false;
                }
            }
            true
        }
        _ => match build_filter(node) {
            Some(f) => {
                out.push(f);
                true
            }
            None => false,
        },
    }
}

fn build_filter(node: &NodeEnum) -> Option<crate::parser::types::Filter> {
    use crate::parser::types::{Filter, FilterOp};
    use pb::AExprKind;
    match node {
        NodeEnum::AExpr(e) => {
            let kind = AExprKind::try_from(e.kind).ok()?;
            // v6 distinguishes plain operators (AexprOp) from LIKE/ILIKE (AexprLike).
            // Both surface as `~~` / `!~~` op names; accept either kind.
            if kind != AExprKind::AexprOp && kind != AExprKind::AexprLike {
                return None;
            }
            let op_name = e.name.first().and_then(|n| {
                if let Some(NodeEnum::String(s)) = n.node.as_ref() {
                    Some(s.sval.clone())
                } else {
                    None
                }
            })?;
            let op = match op_name.as_str() {
                "=" => FilterOp::Eq,
                "<>" | "!=" => FilterOp::Ne,
                "<" => FilterOp::Lt,
                "<=" => FilterOp::Le,
                ">" => FilterOp::Gt,
                ">=" => FilterOp::Ge,
                "~~" => FilterOp::Like, // LIKE in pg AST
                _ => return None,
            };
            let lexpr = e.lexpr.as_ref()?.node.as_ref()?;
            let NodeEnum::ColumnRef(c) = lexpr else {
                return None;
            };
            let column = column_ref_name(c)?;
            let rexpr = e.rexpr.as_ref()?.node.as_ref()?;
            let value = a_const_to_json(rexpr)?;
            Some(Filter {
                column,
                op,
                value: Some(value),
            })
        }
        NodeEnum::NullTest(n) => {
            use pb::NullTestType;
            let arg = n.arg.as_ref()?.node.as_ref()?;
            let NodeEnum::ColumnRef(c) = arg else {
                return None;
            };
            let column = column_ref_name(c)?;
            let nt = NullTestType::try_from(n.nulltesttype).ok()?;
            let op = match nt {
                NullTestType::IsNull => FilterOp::IsNull,
                NullTestType::IsNotNull => FilterOp::IsNotNull,
                _ => return None,
            };
            Some(Filter {
                column,
                op,
                value: None,
            })
        }
        _ => None,
    }
}

fn a_const_to_json(node: &NodeEnum) -> Option<serde_json::Value> {
    let NodeEnum::AConst(c) = node else {
        return None;
    };
    let val = c.val.as_ref()?;
    match val {
        pb::a_const::Val::Ival(i) => Some(serde_json::json!(i.ival as i64)),
        pb::a_const::Val::Fval(f) => f.fval.parse::<f64>().ok().map(|n| serde_json::json!(n)),
        pb::a_const::Val::Sval(s) => Some(serde_json::json!(s.sval)),
        pb::a_const::Val::Boolval(b) => Some(serde_json::json!(b.boolval)),
        _ => None,
    }
}

fn extract_base_select(s: &pb::SelectStmt) -> Result<BaseSelect, ParseError> {
    let columns: Vec<String> = s
        .target_list
        .iter()
        .filter_map(|t| {
            let NodeEnum::ResTarget(rt) = t.node.as_ref()? else {
                return None;
            };
            let val_node = rt.val.as_ref()?.node.as_ref()?;
            match val_node {
                NodeEnum::ColumnRef(c) => column_ref_name(c),
                NodeEnum::AStar(_) => Some("*".into()),
                _ => None,
            }
        })
        .filter(|c| c != "*")
        .collect();

    let from = s.from_clause.first().ok_or_else(|| ParseError {
        message: "SELECT requires FROM clause".into(),
        line: 1,
        column: 1,
    })?;
    let Some(NodeEnum::RangeVar(rv)) = from.node.as_ref() else {
        return Err(ParseError {
            message: "Only flat FROM table supported".into(),
            line: 1,
            column: 1,
        });
    };
    let schema = if rv.schemaname.is_empty() {
        None
    } else {
        Some(rv.schemaname.clone())
    };
    Ok(BaseSelect {
        schema,
        table: rv.relname.clone(),
        columns,
    })
}

fn column_ref_name(c: &pb::ColumnRef) -> Option<String> {
    let last = c.fields.last()?;
    match last.node.as_ref()? {
        NodeEnum::String(s) => Some(s.sval.clone()),
        NodeEnum::AStar(_) => Some("*".into()),
        _ => None,
    }
}

fn to_parse_error(e: pg_query::Error) -> ParseError {
    ParseError {
        message: e.to_string(),
        line: 1,
        column: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flat_select_star() {
        let r = parse_select("SELECT * FROM users").unwrap();
        assert_eq!(r.base_select.table, "users");
        assert_eq!(r.base_select.schema, None);
        assert_eq!(r.base_select.columns, Vec::<String>::new());
    }

    #[test]
    fn parses_qualified_table() {
        let r = parse_select("SELECT id, email FROM public.users").unwrap();
        assert_eq!(r.base_select.schema.as_deref(), Some("public"));
        assert_eq!(r.base_select.table, "users");
        assert_eq!(
            r.base_select.columns,
            vec!["id".to_string(), "email".to_string()]
        );
    }

    #[test]
    fn parses_where_eq() {
        let r = parse_select("SELECT * FROM users WHERE id = 5").unwrap();
        assert_eq!(r.filters.len(), 1);
        let f = &r.filters[0];
        assert_eq!(f.column, "id");
        assert_eq!(f.op, crate::parser::types::FilterOp::Eq);
        assert_eq!(f.value.as_ref().unwrap(), &serde_json::json!(5));
    }

    #[test]
    fn parses_where_and_chain() {
        let r =
            parse_select("SELECT * FROM users WHERE id > 1 AND email LIKE 'a%' AND name IS NULL")
                .unwrap();
        assert_eq!(r.filters.len(), 3);
        assert_eq!(r.filters[0].column, "id");
        assert_eq!(r.filters[0].op, crate::parser::types::FilterOp::Gt);
        assert_eq!(r.filters[1].column, "email");
        assert_eq!(r.filters[1].op, crate::parser::types::FilterOp::Like);
        assert_eq!(r.filters[2].column, "name");
        assert_eq!(r.filters[2].op, crate::parser::types::FilterOp::IsNull);
        assert!(r.filters[2].value.is_none());
    }

    #[test]
    fn unrepresentable_or_in_where() {
        let r = parse_select("SELECT * FROM users WHERE id = 1 OR id = 2").unwrap();
        assert!(r.filters.is_empty());
        assert!(r.unrepresentable_tail.is_some());
    }

    #[test]
    fn parses_order_by_asc() {
        let r = parse_select("SELECT * FROM users ORDER BY id").unwrap();
        let s = r.sort.unwrap();
        assert_eq!(s.column, "id");
        assert_eq!(s.dir, crate::parser::types::SortDir::Asc);
    }

    #[test]
    fn parses_order_by_desc() {
        let r = parse_select("SELECT * FROM users ORDER BY name DESC").unwrap();
        let s = r.sort.unwrap();
        assert_eq!(s.column, "name");
        assert_eq!(s.dir, crate::parser::types::SortDir::Desc);
    }

    #[test]
    fn parses_limit() {
        let r = parse_select("SELECT * FROM users LIMIT 50").unwrap();
        assert_eq!(r.limit, Some(50));
    }

    #[test]
    fn unrepresentable_multi_column_order_by() {
        let r = parse_select("SELECT * FROM users ORDER BY id, name DESC").unwrap();
        assert!(r.sort.is_none());
        assert!(r.unrepresentable_tail.is_some());
    }

    #[test]
    fn captures_where_span() {
        let sql = "SELECT * FROM users WHERE id = 5";
        let r = parse_select(sql).unwrap();
        let span = r.where_span.unwrap();
        let captured = &sql[span.start as usize..span.end as usize];
        assert!(captured.contains("WHERE"));
        assert!(captured.contains("id = 5"));
    }

    #[test]
    fn captures_order_by_span() {
        let sql = "SELECT * FROM users WHERE id > 1 ORDER BY name DESC";
        let r = parse_select(sql).unwrap();
        let span = r.order_by_span.unwrap();
        let captured = &sql[span.start as usize..span.end as usize];
        assert!(captured.starts_with("ORDER BY"));
        assert!(captured.contains("DESC"));
    }

    #[test]
    fn marks_join_as_unrepresentable() {
        let r = parse_select("SELECT * FROM users JOIN posts ON posts.user_id = users.id").unwrap();
        assert!(r.unrepresentable_tail.is_some());
        assert!(r.filters.is_empty());
    }

    #[test]
    fn marks_group_by_as_unrepresentable() {
        let r = parse_select("SELECT count(*) FROM users GROUP BY country").unwrap();
        assert!(r.unrepresentable_tail.is_some());
    }

    #[test]
    fn marks_subquery_as_unrepresentable() {
        let r = parse_select("SELECT * FROM (SELECT * FROM users) u").unwrap();
        assert!(r.unrepresentable_tail.is_some());
    }

    #[test]
    fn marks_table_alias_as_unrepresentable() {
        // `FROM users u` would otherwise be accepted as flat;
        // spec groups alias with JOIN/subquery — filters must be inactive.
        let r = parse_select("SELECT u.id FROM users u").unwrap();
        assert!(r.unrepresentable_tail.is_some());
    }

    #[test]
    fn flat_select_without_alias_remains_flat() {
        let r = parse_select("SELECT id FROM users").unwrap();
        assert!(r.unrepresentable_tail.is_none());
    }
}
