//! Domain core for the Tuxedo native prototype: todo.txt parsing and the
//! read-only Workspace catalogue. No UI dependencies.

mod catalogue;
mod error;
mod todo;

pub use catalogue::{default_catalogue_path, load_catalogue, Catalogue, Workspace};
pub use error::CoreError;
pub use todo::{parse_todo_text, read_todo_file, SkippedLine, TodoFile, TodoFileSummary, TodoItem};
