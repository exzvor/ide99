//! — pure decoder for `pg_trigger.tgtype` bitmask.
//!
//! Postgres encodes timing, events, and FOR EACH ROW/STATEMENT into a single
//! 16-bit integer field. This module isolates the decode so unit tests can
//! cover all combinations without spinning a real database.
//!
//! skeleton + constants + `decode_tgtype` function.
//! Phase B1: `#[cfg(test)] mod tests {}` block with 4 unit tests.

#![allow(unused, clippy::pedantic, clippy::nursery)]

use crate::schema::types::TriggerEvents;

pub const TRIGGER_TYPE_ROW: u32 = 0x01;
pub const TRIGGER_TYPE_BEFORE: u32 = 0x02;
pub const TRIGGER_TYPE_INSERT: u32 = 0x04;
pub const TRIGGER_TYPE_DELETE: u32 = 0x08;
pub const TRIGGER_TYPE_UPDATE: u32 = 0x10;
pub const TRIGGER_TYPE_TRUNCATE: u32 = 0x20;
pub const TRIGGER_TYPE_INSTEAD: u32 = 0x40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedTgtype {
    /// "before" | "after" | "instead_of"
    pub timing: String,
    pub events: TriggerEvents,
    /// "row" | "statement"
    pub for_each: String,
}

/// Decode the `pg_trigger.tgtype` bitmask into structured fields.
///
/// AFTER timing is inferred from absence of BEFORE and INSTEAD bits.
/// FOR EACH STATEMENT is inferred from absence of the ROW bit.
pub fn decode_tgtype(tgtype: u32) -> DecodedTgtype {
    let timing = if tgtype & TRIGGER_TYPE_INSTEAD != 0 {
        "instead_of".to_string()
    } else if tgtype & TRIGGER_TYPE_BEFORE != 0 {
        "before".to_string()
    } else {
        "after".to_string()
    };
    let events = TriggerEvents {
        insert: tgtype & TRIGGER_TYPE_INSERT != 0,
        update: tgtype & TRIGGER_TYPE_UPDATE != 0,
        delete: tgtype & TRIGGER_TYPE_DELETE != 0,
        truncate: tgtype & TRIGGER_TYPE_TRUNCATE != 0,
    };
    let for_each = if tgtype & TRIGGER_TYPE_ROW != 0 {
        "row".to_string()
    } else {
        "statement".to_string()
    };
    DecodedTgtype {
        timing,
        events,
        for_each,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::types::TriggerEvents;

    #[test]
    fn before_insert_for_each_row() {
        let d = decode_tgtype(TRIGGER_TYPE_BEFORE | TRIGGER_TYPE_INSERT | TRIGGER_TYPE_ROW);
        assert_eq!(d.timing, "before");
        assert!(d.events.insert);
        assert!(!d.events.update);
        assert!(!d.events.delete);
        assert!(!d.events.truncate);
        assert_eq!(d.for_each, "row");
    }

    #[test]
    fn after_update_delete_for_each_statement() {
        let d = decode_tgtype(TRIGGER_TYPE_UPDATE | TRIGGER_TYPE_DELETE);
        assert_eq!(d.timing, "after");
        assert!(d.events.update);
        assert!(d.events.delete);
        assert!(!d.events.insert);
        assert!(!d.events.truncate);
        assert_eq!(d.for_each, "statement");
        assert_eq!(            d.events,
            TriggerEvents {
                insert: false,
                update: true,
                delete: true,
                truncate: false,
            }
);
    }

    #[test]
    fn instead_of_truncate_for_each_row() {
        let d = decode_tgtype(TRIGGER_TYPE_INSTEAD | TRIGGER_TYPE_TRUNCATE | TRIGGER_TYPE_ROW);
        assert_eq!(d.timing, "instead_of");
        assert!(d.events.truncate);
        assert!(!d.events.insert);
        assert_eq!(d.for_each, "row");
    }

    #[test]
    fn all_events_after_for_each_statement() {
        let d = decode_tgtype(            TRIGGER_TYPE_INSERT | TRIGGER_TYPE_UPDATE | TRIGGER_TYPE_DELETE | TRIGGER_TYPE_TRUNCATE,
);
        assert!(d.events.insert && d.events.update && d.events.delete && d.events.truncate);
        assert_eq!(d.timing, "after");
        assert_eq!(d.for_each, "statement");
    }
}
