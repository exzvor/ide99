#![allow(clippy::pedantic, clippy::nursery)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSnippet {
    pub id: i64,
    pub label: String,
    pub prefix: String,
    pub body: String,
    pub documentation: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewUserSnippet {
    pub label: String,
    pub prefix: String,
    pub body: String,
    #[serde(default)]
    pub documentation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserSnippet {
    pub label: String,
    pub prefix: String,
    pub body: String,
    pub documentation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetExportBundle {
    pub version: u32,
    pub kind: String, // "snippets"
    pub exported_at: String,
    pub snippets: Vec<UserSnippet>,
}

#[derive(Debug, thiserror::Error)]
pub enum SnippetError {
    #[error("storage error: {0}")]
    Storage(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("not found: id {0}")]
    NotFound(i64),
    #[error("invalid bundle: {0}")]
    InvalidBundle(String),
    #[error("io error: {0}")]
    Io(String),
}

impl serde::Serialize for SnippetError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = ser.serialize_struct("SnippetError", 2)?;
        let kind = match self {
            Self::Storage(_) => "storage",
            Self::InvalidInput(_) => "invalidInput",
            Self::NotFound(_) => "notFound",
            Self::InvalidBundle(_) => "invalidBundle",
            Self::Io(_) => "io",
        };
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
