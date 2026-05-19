//! `pg_dump --verbose` / `pg_restore --verbose` stderr parser.
//!
//! Each stderr line is a phase plus an optional detail. Parsing is pure:
//! gives the frontend a structured `ProgressEvent::Phase` without a
//! regex hairball in JS.
//!
//! Pattern coverage (based on real pg_dump 16/17 traces):
//! * "pg_dump: last built-in OID is …"            → phase=`init`
//! * "pg_dump: reading extensions"                 → phase=`reading`, detail=`extensions`
//! * "pg_dump: dumping contents of table public.x" → phase=`dumping`, detail=`public.x`
//! * "pg_dump: finished item …"                    → phase=`finished`, detail=item
//! * "pg_restore: launching item …"                → phase=`restoring`
//! * "pg_restore: processing data for table public.x" → phase=`restoring`, detail=`public.x`
//!
//! Progress percentage is computed by counting "finished item" lines
//! against the total reported in the reading phase; if the total is
//! unknown, only phase events are emitted.

use crate::backup::types::ProgressEvent;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLine {
    pub phase: String,
    pub detail: Option<String>,
}

/// Parse a single stderr line. Returns None for lines that don't match
/// known patterns (empty lines, "command-line summary", etc.) — frontend
/// safely ignores absent events.
#[must_use]
pub fn parse_line(line: &str) -> Option<ParsedLine> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // pg_dump and pg_restore both prefix lines with "pg_dump: " or "pg_restore: ".
    let body = trimmed
        .strip_prefix("pg_dump: ")
        .or_else(|| trimmed.strip_prefix("pg_restore: "))
        .unwrap_or(trimmed);

    // Drop any "[N/M]" or category prefixes present in newer pg_dump versions.
    // Format: "pg_dump: [archiver] reading ..." → "[archiver] reading ..."
    let body = if let Some(rest) = body.strip_prefix('[') {
        rest.find(']')
            .map_or(body, |idx| rest[idx + 1..].trim_start())
    } else {
        body
    };

    // Match prefix verbs we care about (ordered longest-first).
    const VERBS: &[(&str, &str)] = &[
        ("dumping contents of table ", "dumping"),
        ("dumping contents of ", "dumping"),
        ("processing data for table ", "restoring"),
        ("processing data for ", "restoring"),
        ("creating ", "creating"),
        ("reading ", "reading"),
        ("finished item ", "finished"),
        ("launching item ", "launching"),
        ("restoring ", "restoring"),
        ("connecting to database", "connecting"),
        ("saving encoding", "saving"),
        ("saving database definition", "saving"),
        ("last built-in OID", "init"),
    ];

    for (prefix, phase) in VERBS {
        if let Some(rest) = body.strip_prefix(prefix) {
            let detail = rest.trim();
            return Some(ParsedLine {
                phase: (*phase).to_string(),
                detail: if detail.is_empty() {
                    None
                } else {
                    Some(detail.to_string())
                },
            });
        }
    }

    // Fallback: emit raw body as detail under a generic "log" phase for UX.
    Some(ParsedLine {
        phase: "log".into(),
        detail: Some(body.to_string()),
    })
}

/// Lightweight accumulator: counts "finished item N of M" when pg_dump
/// reports it (modern versions). Returns Some(percent) when both numbers
/// are available.
#[derive(Debug, Default)]
pub struct ProgressCounter {
    /// Total items, derived from the `pg_dump: dumping N items total`
    /// line or counted from the `reading` phase. Conservative initial
    /// value.
    pub total_items: Option<u32>,
    pub finished_items: u32,
}

impl ProgressCounter {
    pub fn observe(&mut self, parsed: &ParsedLine) -> Option<f32> {
        if parsed.phase == "finished" {
            self.finished_items += 1;
            if let Some(total) = self.total_items {
                if total > 0 {
                    let pct = (f64::from(self.finished_items) / f64::from(total) * 100.0) as f32;
                    return Some(pct.min(100.0).max(0.0));
                }
            }
        }
        None
    }
}

/// Adapter helper: zip parsed line + optional percent into ProgressEvent
/// list. Used by subprocess plumbing to push events on the Tauri channel.
pub fn build_events(job_id: &str, parsed: &ParsedLine, percent: Option<f32>) -> Vec<ProgressEvent> {
    let mut out = vec![ProgressEvent::Phase {
        job_id: job_id.to_string(),
        phase: parsed.phase.clone(),
        detail: parsed.detail.clone(),
    }];
    if let Some(value) = percent {
        out.push(ProgressEvent::Percent {
            job_id: job_id.to_string(),
            value,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dumping_table() {
        let line = "pg_dump: dumping contents of table public.users";
        let parsed = parse_line(line).expect("parsed");
        assert_eq!(parsed.phase, "dumping");
        assert_eq!(parsed.detail.as_deref(), Some("public.users"));
    }

    #[test]
    fn parses_with_archiver_bracket() {
        let line = "pg_dump: [archiver] reading user-defined tables";
        let parsed = parse_line(line).expect("parsed");
        assert_eq!(parsed.phase, "reading");
        assert_eq!(parsed.detail.as_deref(), Some("user-defined tables"));
    }

    #[test]
    fn parses_restore_processing() {
        let line = "pg_restore: processing data for table \"public.orders\"";
        let parsed = parse_line(line).expect("parsed");
        assert_eq!(parsed.phase, "restoring");
        assert!(parsed.detail.unwrap().contains("orders"));
    }

    #[test]
    fn empty_line_returns_none() {
        assert!(parse_line("").is_none());
        assert!(parse_line("   ").is_none());
    }

    #[test]
    fn unknown_line_falls_through_to_log() {
        let parsed = parse_line("pg_dump: weird new message").expect("parsed");
        assert_eq!(parsed.phase, "log");
        assert!(parsed.detail.is_some());
    }

    #[test]
    fn progress_counter_emits_percent_after_total_known() {
        let mut counter = ProgressCounter {
            total_items: Some(4),
            finished_items: 0,
        };
        let parsed = ParsedLine {
            phase: "finished".into(),
            detail: None,
        };
        assert_eq!(counter.observe(&parsed), Some(25.0));
        counter.observe(&parsed);
        counter.observe(&parsed);
        let last = counter.observe(&parsed).unwrap();
        assert!((last - 100.0).abs() < f32::EPSILON);
    }

    #[test]
    fn progress_counter_no_percent_without_total() {
        let mut counter = ProgressCounter::default();
        let parsed = ParsedLine {
            phase: "finished".into(),
            detail: None,
        };
        assert!(counter.observe(&parsed).is_none());
    }

    #[test]
    fn build_events_emits_phase_only_when_no_percent() {
        let parsed = ParsedLine {
            phase: "dumping".into(),
            detail: Some("public.users".into()),
        };
        let events = build_events("job-1", &parsed, None);
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn build_events_emits_phase_and_percent() {
        let parsed = ParsedLine {
            phase: "finished".into(),
            detail: None,
        };
        let events = build_events("job-1", &parsed, Some(50.0));
        assert_eq!(events.len(), 2);
    }
}
