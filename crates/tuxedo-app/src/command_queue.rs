//! The foreground command queue. Every write command (Todo-file and Workspace commands) is
//! admitted here in order and runs one at a time: the running command's task is retained until
//! the foreground has accepted its result, and only then is the next command dequeued and
//! prepared against the session as it is by then. A running write task is never dropped or
//! replaced to start another, so every admitted command commits or fails visibly.

use std::collections::VecDeque;

use gpui_kit::Task;
use tuxedo_core::TodoTarget;

/// A command the person issued, with the expectations captured at admission. A command whose
/// expectations no longer hold when it is dequeued fails visibly; it is never retargeted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Complete (`completed`) or reopen the targeted Todo item.
    Complete { target: TodoTarget, completed: bool },
    /// Undo the last Todo-file change of the Workspace shown at admission.
    #[allow(dead_code, reason = "issued by the Undo control, landing next in #253")]
    Undo { workspace_id: String, revision: u64 },
    // Workspace commands (#258: Create/Update/Delete/Select) join here as one variant.
}

#[derive(Default)]
pub struct CommandQueue {
    pending: VecDeque<Command>,
    /// The command in flight: its background step and the foreground acceptance after it.
    running: Option<Task<()>>,
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

    /// Retains the task running the command just dequeued.
    pub fn start(&mut self, task: Task<()>) {
        debug_assert!(self.running.is_none(), "one command at a time");
        self.running = Some(task);
    }

    /// Called by the running task once the foreground has accepted its result, which frees the
    /// queue for the next command. The finishing task completes on its own.
    pub fn accept(&mut self) {
        if let Some(task) = self.running.take() {
            task.detach();
        }
    }

    /// Whether every admitted command has finished (normal quit waits for this).
    #[allow(dead_code, reason = "read by the quit drain, landing next in #253")]
    pub fn is_drained(&self) -> bool {
        self.running.is_none() && self.pending.is_empty()
    }
}
