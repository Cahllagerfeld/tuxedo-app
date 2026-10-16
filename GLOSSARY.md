# Tuxedo

Tuxedo organizes a person's todo.txt files into saved workspaces so they can return to and switch between those files easily.

## Language

**Workspace**:
A saved, user-named reference to one todo file, identified by a stable opaque ID and distinguished by a color. Workspace names and Todo-file references are each unique.
_Avoid_: Folder, project, profile

**Todo file**:
The plain-text todo.txt-format file a Workspace references; it remains the source of truth for its tasks.
_Avoid_: Workspace file, workspace root

**Todo item**:
A parsed task represented by one line in a Todo file. A Todo item is either open or completed.
_Avoid_: Task, todo

**Open Todo item**:
A Todo item without a completion marker or Completion date. Uncompleting a Todo item returns it to this state while preserving its Creation date and remaining content.
_Avoid_: Active Todo item, pending Todo item

**Completed Todo item**:
A Todo item with a completion marker that remains part of its Todo file. Completing it in Tuxedo records the current local Completion date and retains its position; the parser also accepts legacy completed items without a Completion date.
_Avoid_: Archived Todo item, Done Todo item

**Todo item deletion**:
The permanent removal of a Todo item's line from its Todo file. It is distinct from completing a Todo item; the deleted line no longer exists in the file.
_Avoid_: Archive, remove, clear

**Todo-item creation**:
Appending a new Todo item to the Active workspace's Todo file through the shared Todo-item editor.

**Todo-item editing**:
Replacing one Todo item's content through the shared Todo-item editor while retaining its physical-line position and line ending. Completed items expose their Completion date as well as their other fields.

**Todo-item reordering**:
Moving the displayed Todo items among their existing physical-line positions. Hidden Todo items, blank lines, skipped lines, and each position's line ending remain in place.

**Undo last change**:
Restoring the Active workspace's Todo file to its state before the most recent successful Todo-item creation, edit, completion, uncompletion, deletion, or reordering. Only one change can be undone; switching Workspaces, closing the app, or discovering an external Todo-file change clears that opportunity.

**Completion date**:
The local calendar date on which an open Todo item became completed.

**Creation date**:
The optional calendar date recorded for a Todo item's creation.

**Due date**:
The optional valid calendar date in a Todo item's effective `due:YYYY-MM-DD` value. Overdue dates precede today, Today dates equal today, and Upcoming dates follow today in the user's local calendar; absent or malformed values belong to No due date.

**Show from date**:
The optional valid absolute date in a Todo item's effective `t:YYYY-MM-DD` value. An open Todo item with a future Show from date is deferred until that local calendar date.

**Show deferred**:
A saved Workspace preference that includes deferred open Todo items alongside actionable items. It is independent of filters and saved views.

**Todo-file summary**:
A read-only projection of one parsed Todo file: its items and skipped lines, counts of total, open, and completed Todo items, and a Skipped-line count. Without a loaded Todo file it is empty, and it does not filter Todo items.

**Todo-file observation**:
Observation of the Active workspace's loaded Todo file for external disk changes. While the Workspace session is idle, a debounced change signal restores confirmed data through the existing session reload path. A changed parsed summary reports an info notice; a stably unreadable Todo file enters the Empty state with a warning. Own writes and mutation conflicts continue to return confirmed results directly.

**Facet**:
A distinct, locale-sorted collection of exact parsed values for one Todo-item attribute, such as Projects, Contexts, or Priorities. Facets preserve source spelling and do not merge values that differ only by case.

**Project**:
An exact `+`-prefixed token parsed from a Todo item. Projects with different spelling are distinct.

**Context**:
An exact `@`-prefixed token parsed from a Todo item. Contexts with different spelling are distinct.

**Skipped line**:
A non-empty Todo-file line that could not be parsed as a Todo item. It is reported separately from parsed Todo-item counts.

**Priority**:
An uppercase letter parsed from a leading Priority token in an open Todo item or a legacy completed Todo item. Completion stores it as `pri:A` metadata, and uncompletion restores a valid single-letter Priority. Priority facets expose leading Priority values and their Todo-item counts in the selected completion view; `pri:` metadata is not a Priority facet.

**Active workspace**:
The most recently successfully selected Workspace and the one the app attempts to open on startup. A failed switch does not change it.

**Workspace session snapshot**:
The coherent state returned after a Workspace lifecycle operation: the persisted Workspace catalogue and, when a Workspace is successfully opened or created, that active Workspace's loaded Todo file.

**Workspace session**:
The current in-app state of the Workspace catalogue and whether the Active workspace's Todo file is loaded. It is Loading, Empty, Ready, or unavailable because the Workspace catalogue cannot be read.

**Workspace session operation**:
An operation that updates confirmed Workspace session data, including restoration, Workspace creation, switching or deletion, and Todo-item creation, editing, completion, deletion, or reordering. Workspace session operations do not overlap.

**Workspace session restoration**:
The startup attempt to return the Workspace session snapshot for the saved Active workspace. If its Todo file cannot open, the Workspace catalogue remains available and the app enters the Empty state with a warning.

**Workspace operation failure**:
An unsuccessful user-initiated Workspace creation, switch, or deletion. It reports an error notice, clears on the next Workspace operation, and leaves the current Workspace session snapshot unchanged.

**Workspace replacement**:
The MVP remedy for a saved Workspace whose name, color, or Todo file must change: delete it, then create a new Workspace. Direct editing is not part of the MVP.

**Workspace deletion**:
The confirmed removal of a Workspace from the saved catalogue followed by a refreshed Workspace session snapshot. It never removes the referenced Todo file; deleting the Active workspace enters the Empty state, while failure to reopen a remaining Active workspace enters the Empty state with a warning without undoing the deletion.

**Empty state**:
The state with no active Todo file loaded. It prompts the user to open an existing Workspace or create one, including after the Active workspace is deleted or cannot be opened.

**Workspace creation**:
The act of saving a new Workspace after its chosen Todo file has been successfully read and parsed. A successful creation opens and makes that Workspace active.

**Workspace color**:
A fixed-palette color token that distinguishes a Workspace and has appropriate light- and dark-theme representations. The initial palette is blue, green, amber, red, violet, pink, cyan, and orange.

**Workspace switcher**:
The sidebar-header control for viewing saved Workspaces, in creation order, choosing the Active workspace, starting Workspace creation, and removing any saved Workspace through its own options menu without opening its Todo file.

**Workspace catalogue**:
The saved collection of Workspaces and the Active workspace reference. If it cannot be read, it is preserved and the app shows an error instead of replacing it.

**Saved view**:
A named, Workspace-specific copy of the Todo-item text search, completion view, and Project, Context, Priority, and Due-date filters. Applying it replaces the current filters, keeps date categories relative to the current local date, and retains absent selections so that they produce zero matches.

**Recurring Todo item**:
A Todo item configured to generate one open successor when completed, with its next Due date relative to the recorded Completion date.

**Successor-generated marker**:
A persistent indication that a Todo item has already generated its successor. It prevents another generation when the original is reopened and completed again.
