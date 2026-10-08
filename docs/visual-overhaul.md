# Inset workspace shell

Use shadcn-svelte's inset Sidebar as the production shell, with a roughly 224px
navigation width and a collapse toggle. Keep the main Todo-file surface inset
inside the window, with its toolbar and reader status in that surface.

The Workspace switcher remains at the top. Compact summary rows, Projects, and
Priorities use confirmed session data. Facets remain read-only; this change does
not introduce filtering, item creation, or Workspace settings.

Todo-item rows use compact inline scan details. Selecting a Todo item opens an
on-demand details panel for dates, metadata, and source text. Completion and
deletion retain the existing backend operations and confirmed-data behavior.
The list keeps its item order and control identity while an operation is pending.

This replaces the resizable sidebar/content split and removes Paneforge.
The shell supports both light and dark theme tokens. Prototype variants and
sample-data interactions are excluded from the production implementation.

The user accepted this direction after comparing Compact, Studio, and Ledger.
Validation uses the agreed WorkspaceContent/TodoList renderer seams and the
Electron app smoke checks, with review against commit `0f9c3a7`.
