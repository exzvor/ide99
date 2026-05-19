//! Tauri command wrappers for the DDL/SELECT parsers.
//!
//! Both commands are synchronous because `pg_query` itself is sync and fast
//! (sub-50 ms even on 100-line DDL — see `benches/parser_bench.rs`). They
//! return either the typed result or `ParseError` with a 1-based
//! `(line, column)` for Monaco marker rendering.

use crate::parser::ddl::parse_ddl;
use crate::parser::select::parse_select;
use crate::parser::types::{DdlParseResult, ParseError, QueryShape};

#[tauri::command]
pub fn parser_parse_ddl(text: String) -> Result<DdlParseResult, ParseError> {
    parse_ddl(&text)
}

#[tauri::command]
pub fn parser_parse_select(text: String) -> Result<QueryShape, ParseError> {
    parse_select(&text)
}
