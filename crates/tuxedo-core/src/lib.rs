//! Domain core for the Tuxedo native app: todo.txt parsing, the Workspace catalogue, the
//! Workspace session, and the commands that write Todo files. No UI dependencies.

mod atomic_file;
mod catalogue;
mod catalogue_write;
mod completion;
mod date;
mod error;
mod recurrence;
mod session;
mod todo;
mod todo_query;
mod todo_write;

pub use catalogue::{load_catalogue, Catalogue, TodoSortOrder, Workspace, WorkspaceColor};
pub use date::TodoDate;
pub use error::CoreError;
pub use session::{OpenRequest, RereadRequest, RereadResult, WorkspaceSession, WorkspaceSnapshot};
pub use todo::{
    parse_todo_text, read_todo_file, DueCategory, LineEnding, SkippedLine, SourceLine, TodoFile,
    TodoFileSummary, TodoItem, TodoItemEdit,
};
pub use todo_query::{
    deferred_count, group_todos_by_due, invalid_due_count, is_deferred, project_todos, todo_facets,
    CompletionView, DueGroup, DueGroupKind, FacetValue, Facets, TodoFilters,
};
pub use todo_write::{TodoTarget, TodoWriteRequest, TodoWriteResult, TodoWriteStatus, UndoToken};

/// Test-only fault injection for crates that test against this one; never in release builds.
#[cfg(all(feature = "fault-injection", debug_assertions))]
#[doc(hidden)]
pub use atomic_file::fault::fail_directory_sync;

#[cfg(test)]
mod tests;
