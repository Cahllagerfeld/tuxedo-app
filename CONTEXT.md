# Tuxedo

Tuxedo organizes a person's todo.txt files into saved workspaces so they can return to and switch between those files easily.

## Language

**Workspace**:
A saved, user-named reference to one todo file, identified by a stable opaque ID and distinguished by a color. Workspace names and Todo-file references are each unique.
_Avoid_: Folder, project, profile

**Todo file**:
The plain-text todo.txt-format file a Workspace references; it remains the source of truth for its tasks.
_Avoid_: Workspace file, workspace root

**Active workspace**:
The most recently successfully selected Workspace and the one the app attempts to open on startup. A failed switch does not change it.

**Workspace replacement**:
The MVP remedy for a saved Workspace whose name, color, or Todo file must change: delete it, then create a new Workspace. Direct editing is not part of the MVP.

**Workspace deletion**:
The confirmed removal of a Workspace from the saved catalogue. It never removes the referenced Todo file; deleting the Active workspace enters the Empty state.

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
