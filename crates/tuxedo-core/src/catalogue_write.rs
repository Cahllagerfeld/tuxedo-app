//! Persisting the Workspace catalogue exactly as the Electron app does
//! (`packages/backend/src/workspace-catalogue.ts`): `JSON.stringify(catalogue, null, 2)` plus a
//! final LF, keys in schema order, absent preferences omitted, written atomically at `0600`.

#![allow(
    dead_code,
    reason = "used by the Workspace commands in workspace_write (next commit)"
)]

use std::path::Path;

use serde::Serialize;

use crate::atomic_file::atomic_replace;
use crate::catalogue::validate;
use crate::{Catalogue, CoreError, TodoSortOrder};

/// The catalogue file's permission bits, as the Electron app's `atomicWrite` default.
const CATALOGUE_MODE: u32 = 0o600;

#[derive(Serialize)]
struct RawCatalogue<'a> {
    version: u8,
    active_workspace_id: Option<&'a str>,
    workspaces: Vec<RawWorkspace<'a>>,
}

#[derive(Serialize)]
struct RawWorkspace<'a> {
    id: &'a str,
    name: &'a str,
    color: &'static str,
    todo_path: &'a str,
    created_at: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_order: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    show_deferred: Option<bool>,
}

fn sort_order(order: TodoSortOrder) -> &'static str {
    match order {
        TodoSortOrder::File => "file",
        TodoSortOrder::Due => "due",
    }
}

/// The catalogue's file contents. Refuses a catalogue the Electron app would not read.
pub(crate) fn serialize_catalogue(path: &Path, catalogue: &Catalogue) -> Result<String, CoreError> {
    let invalid = |issues| CoreError::InvalidCatalogue {
        path: path.to_path_buf(),
        issues,
    };
    validate(catalogue).map_err(invalid)?;
    let workspaces = catalogue
        .workspaces
        .iter()
        .map(|w| {
            Ok(RawWorkspace {
                id: &w.id,
                name: &w.name,
                color: w.color.as_str(),
                // `validate` has already refused non-UTF-8 paths.
                todo_path: w.todo_file.to_str().ok_or_else(|| {
                    invalid(vec![format!(
                        "Workspace {} todo_path is not valid UTF-8",
                        w.id
                    )])
                })?,
                created_at: &w.created_at,
                sort_order: w.sort_order.map(sort_order),
                show_deferred: w.show_deferred,
            })
        })
        .collect::<Result<_, CoreError>>()?;
    let raw = RawCatalogue {
        version: 1,
        active_workspace_id: catalogue.active_workspace_id.as_deref(),
        workspaces,
    };
    // serde_json's pretty printer matches `JSON.stringify(value, null, 2)`: two-space indent,
    // `"key": value`, `[]` for an empty array, and the same string escapes (only `"`, `\`, and
    // control characters, with lowercase `\u00xx`).
    let mut text = serde_json::to_string_pretty(&raw).expect("catalogue serialization is total");
    text.push('\n');
    Ok(text)
}

/// Validates and atomically replaces the catalogue at `path`.
pub(crate) fn write_catalogue(path: &Path, catalogue: &Catalogue) -> Result<(), CoreError> {
    let text = serialize_catalogue(path, catalogue)?;
    atomic_replace(path, text.as_bytes(), CATALOGUE_MODE)
}
