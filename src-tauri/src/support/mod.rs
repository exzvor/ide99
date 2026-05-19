//! ide99 — in-app Support feedback wedge.
//!
//! Tauri commands behind the status-bar "Support" button. Posts the user's
//! email + message + (optional) screenshots to the ide99-landing API at
//! `https://ide99.ru/api/feedback` (Russian UI) or `https://ide99.io/api/feedback`
//! (English / fallback). The landing service forwards mail to the operator
//! mailbox via Yandex Postbox with `From: support@ide99.{ru|io}` and
//! `Reply-To: <user email>` so a reply from the operator lands back in the
//! user's inbox.

pub mod client;
pub mod commands;
