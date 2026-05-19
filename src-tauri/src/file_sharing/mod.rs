//! `.ide99` JSON file format.
//!
//! Universal envelope:
//! { "version": 1, "kind": "<type>", "exportedAt": "...", "payload": {...} }
//!
//! Where `<type>` ∈ { connection, connection-bundle, snippet, snippet-bundle,
//! query, notebook, migration-set, erd-layout, theme, keymap, health-config }.
//!
//! Provides the envelope, a per-kind serializer registry, and
//! connection / connection-bundle support (acceptance criterion:
//! "Export connection → import in another instance → connection appears
//! without credentials"). Other kinds are added in dedicated modules.

pub mod commands;
pub mod envelope;
pub mod kinds;
pub mod types;
