//! Domain core for the Tuxedo native prototype: todo.txt parsing, the read-only
//! Workspace catalogue, and a read-only Workspace session. No UI dependencies.

mod catalogue;
mod date;
mod error;
mod session;
mod todo;

pub use catalogue::{load_catalogue, Catalogue, TodoSortOrder, Workspace, WORKSPACE_COLORS};
pub use date::TodoDate;
pub use error::CoreError;
pub use session::{OpenRequest, WorkspaceSession, WorkspaceSnapshot};
pub use todo::{
    parse_todo_text, read_todo_file, DueCategory, LineEnding, SkippedLine, SourceLine, TodoFile,
    TodoFileSummary, TodoItem, TodoItemEdit,
};

#[cfg(test)]
mod tests;
