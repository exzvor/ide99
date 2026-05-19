#![allow(clippy::pedantic, clippy::nursery, clippy::missing_errors_doc)]

use rusqlite::{params, Connection as SqliteConnection};

use super::types::{NewUserSnippet, SnippetError, UpdateUserSnippet, UserSnippet};

/// Pure CRUD against the `user_snippets` table. Borrows the SQLite handle
/// from `connection::Store::conn()` (same pattern `query::tabs` uses to share
/// the global Mutex).
pub struct SnippetStore<'a> {
    conn: &'a SqliteConnection,
}

impl<'a> SnippetStore<'a> {
    pub const fn new(conn: &'a SqliteConnection) -> Self {
        Self { conn }
    }

    pub fn list(&self) -> Result<Vec<UserSnippet>, SnippetError> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, label, prefix, body, documentation, created_at, updated_at \
                 FROM user_snippets ORDER BY label COLLATE NOCASE",
            )
            .map_err(|e| SnippetError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(UserSnippet {
                    id: r.get(0)?,
                    label: r.get(1)?,
                    prefix: r.get(2)?,
                    body: r.get(3)?,
                    documentation: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            })
            .map_err(|e| SnippetError::Storage(e.to_string()))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| SnippetError::Storage(e.to_string()))?);
        }
        Ok(out)
    }

    pub fn create(&self, input: &NewUserSnippet) -> Result<UserSnippet, SnippetError> {
        validate_label(&input.label)?;
        validate_prefix(&input.prefix)?;
        validate_body(&input.body)?;
        self.conn
            .execute(
                "INSERT INTO user_snippets (label, prefix, body, documentation) \
                 VALUES (?, ?, ?, ?)",
                params![input.label, input.prefix, input.body, input.documentation],
            )
            .map_err(|e| SnippetError::Storage(e.to_string()))?;
        let id = self.conn.last_insert_rowid();
        self.get(id)
    }

    pub fn get(&self, id: i64) -> Result<UserSnippet, SnippetError> {
        self.conn
            .query_row(
                "SELECT id, label, prefix, body, documentation, created_at, updated_at \
                 FROM user_snippets WHERE id = ?",
                params![id],
                |r| {
                    Ok(UserSnippet {
                        id: r.get(0)?,
                        label: r.get(1)?,
                        prefix: r.get(2)?,
                        body: r.get(3)?,
                        documentation: r.get(4)?,
                        created_at: r.get(5)?,
                        updated_at: r.get(6)?,
                    })
                },
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => SnippetError::NotFound(id),
                other => SnippetError::Storage(other.to_string()),
            })
    }

    pub fn update(&self, id: i64, input: &UpdateUserSnippet) -> Result<UserSnippet, SnippetError> {
        validate_label(&input.label)?;
        validate_prefix(&input.prefix)?;
        validate_body(&input.body)?;
        let affected = self
            .conn
            .execute(
                "UPDATE user_snippets \
                 SET label = ?, prefix = ?, body = ?, documentation = ?, \
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
                 WHERE id = ?",
                params![
                    input.label,
                    input.prefix,
                    input.body,
                    input.documentation,
                    id
                ],
            )
            .map_err(|e| SnippetError::Storage(e.to_string()))?;
        if affected == 0 {
            return Err(SnippetError::NotFound(id));
        }
        self.get(id)
    }

    pub fn delete(&self, id: i64) -> Result<(), SnippetError> {
        let affected = self
            .conn
            .execute("DELETE FROM user_snippets WHERE id = ?", params![id])
            .map_err(|e| SnippetError::Storage(e.to_string()))?;
        if affected == 0 {
            return Err(SnippetError::NotFound(id));
        }
        Ok(())
    }
}

fn validate_label(s: &str) -> Result<(), SnippetError> {
    if s.trim().is_empty() {
        return Err(SnippetError::InvalidInput("label is empty".into()));
    }
    if s.len() > 200 {
        return Err(SnippetError::InvalidInput(
            "label too long (max 200)".into(),
        ));
    }
    Ok(())
}

fn validate_prefix(s: &str) -> Result<(), SnippetError> {
    if s.is_empty() {
        return Err(SnippetError::InvalidInput("prefix is empty".into()));
    }
    let first = s.chars().next().unwrap();
    if !first.is_ascii_alphabetic() {
        return Err(SnippetError::InvalidInput(
            "prefix must start with a letter".into(),
        ));
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(SnippetError::InvalidInput(
            "prefix may contain only [A-Za-z0-9_]".into(),
        ));
    }
    if s.len() > 32 {
        return Err(SnippetError::InvalidInput(
            "prefix too long (max 32)".into(),
        ));
    }
    Ok(())
}

fn validate_body(s: &str) -> Result<(), SnippetError> {
    if s.is_empty() {
        return Err(SnippetError::InvalidInput("body is empty".into()));
    }
    if s.len() > 10_000 {
        return Err(SnippetError::InvalidInput(
            "body too long (max 10000 chars)".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn open_with_migration() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        conn.execute_batch(include_str!("../../migrations/004_user_snippets.sql"))
            .expect("apply migration");
        conn
    }

    #[test]
    fn create_then_list_returns_one() {
        let c = open_with_migration();
        let s = SnippetStore::new(&c);
        let snip = s
            .create(&NewUserSnippet {
                label: "Sel users".into(),
                prefix: "selu".into(),
                body: "SELECT * FROM users;".into(),
                documentation: String::new(),
            })
            .unwrap();
        assert_eq!(snip.label, "Sel users");
        let list = s.list().unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn validate_prefix_rejects_starting_digit() {
        let c = open_with_migration();
        let s = SnippetStore::new(&c);
        let err = s.create(&NewUserSnippet {
            label: "x".into(),
            prefix: "1abc".into(),
            body: "SELECT 1".into(),
            documentation: String::new(),
        });
        assert!(matches!(err, Err(SnippetError::InvalidInput(_))));
    }

    #[test]
    fn update_changes_fields_and_updated_at() {
        let c = open_with_migration();
        let s = SnippetStore::new(&c);
        let snip = s
            .create(&NewUserSnippet {
                label: "v1".into(),
                prefix: "v".into(),
                body: "SELECT 1".into(),
                documentation: String::new(),
            })
            .unwrap();
        // Force ms tick so updated_at strictly differs
        std::thread::sleep(std::time::Duration::from_millis(2));
        let updated = s
            .update(
                snip.id,
                &UpdateUserSnippet {
                    label: "v2".into(),
                    prefix: "v".into(),
                    body: "SELECT 2".into(),
                    documentation: "doc".into(),
                },
            )
            .unwrap();
        assert_eq!(updated.label, "v2");
        assert_eq!(updated.body, "SELECT 2");
        assert_eq!(updated.documentation, "doc");
        assert!(updated.updated_at >= snip.updated_at);
    }

    #[test]
    fn delete_then_get_returns_not_found() {
        let c = open_with_migration();
        let s = SnippetStore::new(&c);
        let snip = s
            .create(&NewUserSnippet {
                label: "x".into(),
                prefix: "x".into(),
                body: "y".into(),
                documentation: String::new(),
            })
            .unwrap();
        s.delete(snip.id).unwrap();
        assert!(matches!(s.get(snip.id), Err(SnippetError::NotFound(_))));
    }

    #[test]
    fn list_orders_alphabetically_case_insensitive() {
        let c = open_with_migration();
        let s = SnippetStore::new(&c);
        for (label, prefix) in [("Bravo", "b"), ("alpha", "a"), ("Charlie", "c")] {
            s.create(&NewUserSnippet {
                label: label.into(),
                prefix: prefix.into(),
                body: "SELECT".into(),
                documentation: String::new(),
            })
            .unwrap();
        }
        let names: Vec<String> = s.list().unwrap().into_iter().map(|x| x.label).collect();
        assert_eq!(names, vec!["alpha", "Bravo", "Charlie"]);
    }
}
