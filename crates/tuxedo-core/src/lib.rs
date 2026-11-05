//! Domain core for the Tuxedo native app: todo.txt parsing, the Workspace catalogue, the
//! Workspace session, and the commands that write Todo files. No UI dependencies.

mod atomic_file;
mod catalogue;
mod completion;
mod date;
mod error;
mod recurrence;
mod session;
mod todo;
mod todo_write;

pub use catalogue::{load_catalogue, Catalogue, TodoSortOrder, Workspace, WorkspaceColor};
pub use date::TodoDate;
pub use error::CoreError;
pub use session::{OpenRequest, RereadRequest, RereadResult, WorkspaceSession, WorkspaceSnapshot};
pub use todo::{
    parse_todo_text, read_todo_file, DueCategory, LineEnding, SkippedLine, SourceLine, TodoFile,
    TodoFileSummary, TodoItem, TodoItemEdit,
};
pub use todo_write::{TodoTarget, TodoWriteRequest, TodoWriteResult, TodoWriteStatus, UndoToken};

/// Test-only fault injection for crates that test against this one.
#[cfg(feature = "fault-injection")]
#[doc(hidden)]
pub use atomic_file::fault::fail_directory_sync;

#[cfg(test)]
mod tests;
