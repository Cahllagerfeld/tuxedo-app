//! The foreground command queue. Every write command (Todo-file and Workspace commands) is
//! admitted here in order and runs one at a time: the running command's task is retained until
//! the foreground has accepted its result, and only then is the next command dequeued and
//! prepared against the session as it is by then. A running write task is never dropped or
//! replaced to start another, so every admitted command commits or fails visibly.
//!
//! Commands come in families. Each family module supplies a foreground `prepare` (no I/O), a
//! background request with `execute`, and a foreground `accept` that installs the result into
//! the core session and reports an [`Accepted`]; `SessionModel` runs all families through the
//! same queue, recovery, and outcome code.

use std::collections::VecDeque;

use gpui_kit::Task;
use tuxedo_core::{TodoFields, TodoTarget};

use crate::todo_commands::Reply;
use crate::workspace_commands::WorkspaceCommand;

/// A command the person issued, with the expectations captured at admission. A command whose
/// expectations no longer hold when it is dequeued fails visibly; it is never retargeted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Todo(TodoCommand),
    /// Workspace commands (`workspace_commands`): create, update, delete, select.
    Workspace(WorkspaceCommand),
    /// Test-only: completes with the given acceptance, without touching any file.
    #[cfg(test)]
    Scripted(Accepted),
    /// Test-only: a command whose background step never finishes.
    #[cfg(test)]
    Held,
}

impl Command {
    /// A short name for diagnostics, such as a quit that timed out.
    pub fn name(&self) -> &'static str {
        match self {
            Command::Todo(TodoCommand::Complete {
                completed: true, ..
            }) => "complete Todo item",
            Command::Todo(TodoCommand::Complete { .. }) => "reopen Todo item",
            Command::Todo(TodoCommand::Undo { .. }) => "undo",
            Command::Todo(TodoCommand::Create { .. }) => "create Todo item",
            Command::Todo(TodoCommand::Edit { .. }) => "edit Todo item",
            Command::Workspace(WorkspaceCommand::Create { .. }) => "create Workspace",
            Command::Workspace(WorkspaceCommand::Update { .. }) => "update Workspace",
            Command::Workspace(WorkspaceCommand::SetShowDeferred { .. }) => "save Show deferred",
            Command::Workspace(WorkspaceCommand::Delete { .. }) => "remove Workspace",
            Command::Workspace(WorkspaceCommand::Select { .. }) => "switch Workspace",
            #[cfg(test)]
            Command::Scripted(_) => "scripted",
            #[cfg(test)]
            Command::Held => "held",
        }
    }
}

/// Todo-file commands (`todo_commands`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TodoCommand {
    /// Complete (`completed`) or reopen the targeted Todo item.
    Complete { target: TodoTarget, completed: bool },
    /// Undo the last Todo-file change of the Workspace shown at admission.
    Undo { workspace_id: String, revision: u64 },
    /// Append a new Todo item from the editor to the Workspace shown at admission. `reply`
    /// tells the editor its own outcome.
    Create {
        workspace_id: String,
        revision: u64,
        fields: TodoFields,
        reply: Reply,
    },
    /// Replace the targeted Todo item's line with the editor's fields.
    Edit {
        target: TodoTarget,
        fields: TodoFields,
        reply: Reply,
    },
}

/// The visible outcome of one admitted command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub kind: OutcomeKind,
    /// A short headline, such as "Todo file changed".
    pub title: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutcomeKind {
    /// The change is saved and shown; `message` adds information when present.
    Applied,
    /// The file changed on disk; nothing was written and the current file is shown.
    Conflict,
    /// Nothing was written (or, during recovery, the write could not be confirmed).
    Failed,
}

impl Outcome {
    pub fn new(kind: OutcomeKind, title: impl Into<String>, message: Option<String>) -> Self {
        Self {
            kind,
            title: title.into(),
            message,
        }
    }
}

/// What a family's foreground acceptance concluded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Accepted {
    /// The session holds the confirmed state; the next command may run.
    Done(Outcome),
    /// The disk may differ from the session (an unconfirmed write, or an executed write whose
    /// result could not be accepted). The queue pauses until an authoritative reread is
    /// accepted; the command is never resubmitted.
    Recover(Outcome),
}

#[derive(Default)]
pub struct CommandQueue {
    pending: VecDeque<Command>,
    /// The command (or recovery read) in flight: its background step and foreground acceptance.
    running: Option<(Task<()>, &'static str)>,
}

impl CommandQueue {
    /// Admits a command behind everything already admitted.
    pub fn admit(&mut self, command: Command) {
        self.pending.push_back(command);
    }

    /// The next command to prepare, or `None` while one is running or nothing is pending.
    pub fn dequeue(&mut self) -> Option<Command> {
        if self.running.is_some() {
            return None;
        }
        self.pending.pop_front()
    }

    /// Removes every pending command, for failing them all at once.
    pub fn take_pending(&mut self) -> Vec<Command> {
        self.pending.drain(..).collect()
    }

    /// Retains the task running the command (or recovery) just started, named for diagnostics.
    pub fn start(&mut self, task: Task<()>, name: &'static str) {
        debug_assert!(self.running.is_none(), "one command at a time");
        self.running = Some((task, name));
    }

    /// The running step's name and the pending commands' names, for diagnostics.
    pub fn describe(&self) -> (Option<&'static str>, Vec<&'static str>) {
        let running = self.running.as_ref().map(|(_, name)| *name);
        (running, self.pending.iter().map(Command::name).collect())
    }

    /// Called by the running task once the foreground has accepted its result, which frees the
    /// queue for the next command. The finishing task completes on its own.
    pub fn accept(&mut self) {
        if let Some((task, _)) = self.running.take() {
            task.detach();
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.is_some()
    }

    /// Whether every admitted command has finished (closing the window waits for this).
    pub fn is_drained(&self) -> bool {
        self.running.is_none() && self.pending.is_empty()
    }
}
