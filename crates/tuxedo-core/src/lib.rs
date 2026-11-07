//! Domain core for the Tuxedo native app: todo.txt parsing, the Workspace catalogue, the
//! Workspace session, and the commands that write Todo files. No UI dependencies.

mod atomic_file;
mod catalogue;
mod catalogue_write;
mod completion;
mod date;
mod electron_import;
mod error;
mod observation;
mod recurrence;
mod saved_views;
mod session;
mod todo;
mod todo_edit;
mod todo_query;
mod todo_write;
mod workspace_write;

pub use catalogue::{js_trim, load_catalogue, Catalogue, TodoSortOrder, Workspace, WorkspaceColor};
pub use date::TodoDate;
pub use electron_import::{import_electron_data, ElectronImport, ImportReport, CATALOGUE_FILE};
pub use error::CoreError;
pub use observation::{ObserveRequest, ObserveResult, Observed, TODO_FILE_RELOADED};
pub use saved_views::{
    read_saved_views, saved_views_path, SavedView, SavedViewChange, SavedViewWriteRequest,
    SavedViewWriteResult, SavedViews, SAVED_VIEWS_FILE,
};
pub use session::{OpenRequest, RereadRequest, RereadResult, WorkspaceSession, WorkspaceSnapshot};
pub use todo::{
    parse_todo_text, read_todo_file, DueCategory, LineEnding, SkippedLine, SourceLine, TodoFile,
    TodoFileSummary, TodoItem, TodoItemEdit,
};
pub use todo_edit::{
    validate_metadata_token, validate_tag, DraftField, FieldError, PriorityChoice, RepeatUnit,
    TodoDraft, TodoFields,
};
pub use todo_query::{
    deferred_count, group_todos_by_due, invalid_due_count, is_deferred, project_todos,
    query_final_word, query_with_condition, query_with_condition_at, query_word_at, todo_facets,
    AbsentSelections, CompletionView, DueGroup, DueGroupKind, FacetValue, Facets, QueryCondition,
    QueryError, QueryErrorKind, QueryKey, TodoFilters, COMPLETION_VALUES, DUE_VALUES,
    QUERY_GRAMMAR_VERSION,
};
pub use todo_write::{TodoTarget, TodoWriteRequest, TodoWriteResult, TodoWriteStatus, UndoToken};
pub use workspace_write::{WorkspaceChange, WorkspaceWriteRequest, WorkspaceWriteResult};

/// Test-only fault injection for crates that test against this one; never in release builds.
#[cfg(all(feature = "fault-injection", debug_assertions))]
#[doc(hidden)]
pub use atomic_file::fault::fail_directory_sync;

#[cfg(test)]
mod tests;
