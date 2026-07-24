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
A Todo item marked as completed with the current local date that remains part of its Todo file and retains its position among the other Todo items.
_Avoid_: Archived Todo item, Done Todo item

**Todo item deletion**:
The permanent removal of a Todo item's line from its Todo file. It is distinct from completing a Todo item; the deleted line no longer exists in the file.
_Avoid_: Archive, remove, clear

**Completion date**:
The local calendar date on which an open Todo item became completed.

**Creation date**:
The optional calendar date recorded for a Todo item's creation.

**Todo item creation**:
The addition of a new open Todo item as the final line of a Todo file. Todo items created by Tuxedo have the current local date as their Creation date and write Description, Projects, then Contexts; creation does not reorder or otherwise alter existing lines.

**Todo composer**:
The inline form for creating a Todo item. It captures a Description, Projects, and Contexts; it normalizes Description whitespace and cannot contain standalone tokens that todo.txt would parse as a Project, Context, or Metadata.

**Todo-file summary**:
A read-only projection of one parsed Todo file: its items and skipped lines, summary counts, and sorted project, context, and priority facets. Without a loaded Todo file it is empty, and it does not filter Todo items.

**Facet**:
A distinct, locale-sorted collection of exact parsed values for one Todo-item attribute, such as Projects, Contexts, or Priorities. Facets preserve source spelling and do not merge values that differ only by case.

**Project**:
An exact `+`-prefixed token parsed from a Todo item. Projects with different spelling are distinct.

**Project suggestion**:
A Project discovered from any parsed Todo item in the loaded Todo file and offered while creating a Todo item. Suggestions are not an independently stored catalogue; a Project disappears from them when no Todo item uses it.

**Context**:
An exact `@`-prefixed token parsed from a Todo item. Contexts with different spelling are distinct.

**Context suggestion**:
A Context discovered from any parsed Todo item in the loaded Todo file and offered while creating a Todo item. Suggestions are not an independently stored catalogue; a Context disappears from them when no Todo item uses it.

**Metadata**:
An exact `key:value` token parsed from a Todo item. A Todo item has at most one parsed value for each Metadata key.
_Avoid_: Property tag, free-form tag

**Skipped line**:
A non-empty Todo-file line that could not be parsed as a Todo item. It is reported separately from parsed Todo-item counts.

**Priority**:
An uppercase priority parsed from an incomplete Todo item. A Todo-file summary counts items with a parsed Priority and exposes their distinct values as a sorted facet.

**Active workspace**:
The most recently successfully selected Workspace and the one the app attempts to open on startup. A failed switch does not change it.

**Workspace session snapshot**:
The coherent state returned after a Workspace lifecycle operation: the persisted Workspace catalogue and, when a Workspace is successfully opened or created, that active Workspace's loaded Todo file.

**Workspace session**:
The current in-app state of the Workspace catalogue and whether the Active workspace's Todo file is loaded. It is Loading, Empty, Ready, or unavailable because the Workspace catalogue cannot be read.

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
The sidebar-header control for viewing saved Workspaces, in creation order, choosing the Active workspace, and starting Workspace creation.

**Workspace catalogue**:
The saved collection of Workspaces and the Active workspace reference. If it cannot be read, it is preserved and the app shows an error instead of replacing it.
