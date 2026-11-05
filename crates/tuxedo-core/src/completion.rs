//! Completing and reopening one Todo item's line, with parity to
//! `packages/backend/src/complete-todo.ts`. Pure string transformations.

use crate::{TodoDate, TodoItem};

/// The Kanban board's Done-position key, meaningless once an item is open.
pub(crate) const BOARD_DONE_KEY: &str = "board-done";

/// The completed or reopened form of `item`'s line, without its line ending.
pub(crate) fn set_completion_line(
    item: &TodoItem,
    completed: bool,
    today: TodoDate,
) -> Result<String, &'static str> {
    if item.completed == completed {
        return Err("Todo item already has the requested completion state.");
    }
    let priorities = priority_tokens(&item.raw);
    if completed {
        let mut rest = item.raw.clone();
        if let Some(priority) = item.priority {
            if priorities.iter().any(|p| *p != priority.to_string()) {
                return Err(
                    "Conflicting priority metadata; edit the Todo file before completing this item.",
                );
            }
            rest.replace_range(..4, "");
            if priorities.is_empty() {
                // Keep the Priority as `pri:` metadata, before any trailing whitespace.
                let content = rest.trim_end_matches(char::is_whitespace).len();
                rest.insert_str(content, &format!(" pri:{priority}"));
            }
        }
        return Ok(format!("x {today} {rest}"));
    }

    let mut rest = &item.raw[2..];
    if item.completion_date.is_some() {
        // The Completion date and the one whitespace character after it, if any.
        rest = &rest[10..];
        let mut chars = rest.chars();
        if chars.next().is_some() {
            rest = chars.as_str();
        }
    }
    // A Done position is meaningless once open; the Board assignment keeps the open position.
    let mut rest = remove_metadata_token(rest, BOARD_DONE_KEY);
    let restored = item
        .metadata_value("pri")
        .filter(|p| p.len() == 1 && p.as_bytes()[0].is_ascii_uppercase());
    if let (None, Some(priority)) = (item.priority, restored) {
        if priorities.iter().any(|p| *p != priority) {
            return Err(
                "Conflicting priority metadata; edit the Todo file before uncompleting this item.",
            );
        }
        let without = remove_priority_metadata(&rest);
        rest = format!(
            "({priority}) {}",
            without.trim_start_matches(char::is_whitespace)
        );
    }
    if rest.chars().all(char::is_whitespace) {
        return Err(
            "Cannot uncomplete a Todo item without remaining content. Edit the Todo file first.",
        );
    }
    Ok(rest)
}

/// Every `pri:<value>` token's value (a value without `:`), in source order.
fn priority_tokens(raw: &str) -> Vec<&str> {
    raw.split(char::is_whitespace)
        .filter_map(|token| token.strip_prefix("pri:"))
        .filter(|value| !value.is_empty() && !value.contains(':'))
        .collect()
}

fn is_priority_metadata(token: &str) -> bool {
    let b = token.as_bytes();
    b.len() == 5 && token.starts_with("pri:") && b[4].is_ascii_uppercase()
}

/// Removes each `pri:[A-Z]` token together with the one whitespace character before it, like
/// `replace(/(^|\s)pri:[A-Z](?=\s|$)/gu, "")`.
fn remove_priority_metadata(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while !rest.is_empty() {
        let ws = rest
            .find(|c: char| !c.is_whitespace())
            .unwrap_or(rest.len());
        out.push_str(&rest[..ws]);
        rest = &rest[ws..];
        let token = rest.find(char::is_whitespace).unwrap_or(rest.len());
        if is_priority_metadata(&rest[..token]) {
            // Any token after the start follows whitespace; the match consumed one character.
            out.pop();
        } else {
            out.push_str(&rest[..token]);
        }
        rest = &rest[token..];
    }
    out
}

/// Removes `key:` tokens like `removeMetadataToken` in `board-order.ts`: a leading token with the
/// whitespace after it, and any later token with the whitespace run before it.
pub(crate) fn remove_metadata_token(raw: &str, key: &str) -> String {
    let prefix = format!("{key}:");
    let token_end = |s: &str| s.find(char::is_whitespace).unwrap_or(s.len());
    let ws_end = |s: &str| s.find(|c: char| !c.is_whitespace()).unwrap_or(s.len());
    let mut rest = raw;
    if rest.starts_with(&prefix) {
        rest = &rest[token_end(rest)..];
        rest = &rest[ws_end(rest)..];
    }
    let mut out = String::with_capacity(rest.len());
    while !rest.is_empty() {
        let token = token_end(rest);
        out.push_str(&rest[..token]);
        rest = &rest[token..];
        let ws = ws_end(rest);
        if ws > 0 && rest[ws..].starts_with(&prefix) {
            rest = &rest[ws..];
            rest = &rest[token_end(rest)..];
        } else {
            out.push_str(&rest[..ws]);
            rest = &rest[ws..];
        }
    }
    out
}
