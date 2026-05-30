# Workspace Management Milestones

This plan keeps the first workspace-management milestone small enough to ship safely while leaving the app in a usable state afterwards. Later milestones are recorded here so they do not get lost, but they should not be pulled into Milestone 1 unless the implementation uncovers a hard dependency.

## Milestone 1: Recent Workspaces Core

### Goal

Replace the current single saved workspace root with a small recent-workspaces model. After this milestone, the app should still be usable end to end:

- A user can open a workspace directory.
- The app creates or updates a recent workspace entry with a name, color, root path, and active marker.
- The last active workspace restores on launch.
- Existing `todo.txt` parsing continues to work.
- Missing `todo.txt` remains a non-fatal warning, as it is today.
- The shell makes the active workspace name and path clear enough to trust.

### Explicit Non-Goals

- No sidebar workspace switcher dropdown yet.
- No full workspace creation dialog yet.
- No Formsnap.
- No SQLite; keep this as app config data.
- No backwards compatibility requirement for old `workspace.toml`.
- No advanced missing/moved/deleted path recovery beyond a readable error.

### Data Model

Persist workspace metadata in the existing Tauri app config directory as TOML.

Use this config shape:

```rust
pub struct WorkspaceConfig {
    pub active_workspace_id: Option<String>,
    pub recent_workspaces: Vec<WorkspaceEntry>,
}

pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    pub color: String,
    pub root: String,
    pub last_opened_at: String,
}
```

Rules:

- `root` remains a workspace directory, not a direct `todo.txt` file path.
- `todo.txt` is derived as `<root>/todo.txt`.
- Parsed todo contents are never persisted.
- Recent workspaces are deduplicated by `root`.
- Opening an existing root updates that entry and moves it to the top.
- Cap recent workspaces at 10.
- If config parsing fails, return the default empty config because old config compatibility is not required.

### Rust Changes

Update `src-tauri/src/workspace.rs`:

- Replace `WorkspaceConfig { version, root }` with the new active/recent model.
- Keep atomic TOML writes.
- Keep `load_workspace(root)` returning the existing `WorkspaceLoadResult`.
- Keep missing `todo.txt` as `todo_exists: false` and `todo_file: null`.
- Validate workspace roots before saving and before loading.
- Add helper behavior for:
  - creating a default workspace name from the selected folder name
  - choosing a default color
  - generating an id
  - upserting and ordering recent workspaces

Update Tauri commands in `src-tauri/src/lib.rs`:

- `load_workspace_config() -> WorkspaceConfig`
- `save_workspace_entry(root: String) -> WorkspaceConfig`
- `set_active_workspace(id: String) -> WorkspaceConfig`
- `load_workspace(root: String) -> WorkspaceLoadResult`

For Milestone 1, `save_workspace_entry` may accept only `root` and let Rust derive `name`, `color`, `id`, and `last_opened_at`. The richer form-driven metadata editing belongs to the dialog milestone.

### Frontend Changes

Update `src/lib/modules/workspace/domain/workspace.ts`:

- Add Zod schemas for `WorkspaceEntry`, `WorkspaceConfig`, and existing `WorkspaceLoadResult`.
- Remove `version` and single `root` from the config schema.
- Keep readable schema drift errors.

Update `src/lib/modules/workspace/api/workspace-api.ts`:

- Wrap the new Tauri commands.
- Keep `chooseWorkspaceDirectory()` as the only picker flow for this milestone.

Update `src/lib/modules/workspace/state/workspace-state.svelte.ts`:

- Store:
  - `activeWorkspace: WorkspaceEntry | null`
  - `recentWorkspaces: WorkspaceEntry[]`
  - `todoPath`
  - `todoFile`
  - `warning`
  - `error`
  - `isLoading`
- Derive `root` from `activeWorkspace?.root` only if existing todo code still needs it.
- `restore()` loads config, resolves `active_workspace_id`, and loads that workspace.
- `openDirectory()` picks a directory, saves/upserts it, applies config, and loads the active workspace.
- `switchWorkspace(id)` exists for later UI, even if Milestone 1 only uses it in tests or simple controls.
- Canceling the directory picker must leave current state untouched.

Update shell UI minimally:

- `WorkspaceHeader.svelte` should show active workspace name and root path instead of only raw root.
- Keep the existing `Open Workspace` button.
- `WorkspaceStatus.svelte` should keep the current empty/warning/error behavior, updated to read from `activeWorkspace`.
- `WorkspaceStatusBar.svelte` may stay simple but should no longer be misleading placeholder text.
- Do not add a switcher menu yet.

### Usable-State Acceptance Criteria

- Fresh launch with no config shows a clear no-workspace state and an open action.
- Opening a directory with `todo.txt` loads and displays todos.
- Opening a directory without `todo.txt` selects that workspace and shows a warning, not a crash.
- Restarting the app restores the last active workspace and re-reads `todo.txt`.
- Opening a second workspace stores both in recent workspaces and makes the second active.
- Reopening the first workspace deduplicates by root and moves it to the top.
- Existing todo filtering/stat UI continues to derive from the loaded `todoFile`.
- Old single-root config files do not break startup; they reset to empty config.

### Milestone 1 Test Plan

Rust tests:

- Default config has no active workspace and no recents.
- Config round-trips through TOML.
- Invalid/old config returns default empty config.
- Saving a workspace validates root, creates metadata, marks it active, and persists it.
- Saving the same root deduplicates and moves it to the top.
- Recent workspace list caps at 10.
- `load_workspace` parses an existing `todo.txt`.
- `load_workspace` returns `todo_exists: false` for an existing root without `todo.txt`.
- `load_workspace` rejects missing roots and file paths.

Frontend tests:

- Config schema accepts active/recent workspace shape.
- Config parser rejects schema drift with readable messages.
- Load-result schema still accepts parsed and missing-`todo.txt` results.
- `WorkspaceState.restore()` handles empty config, valid active workspace, and load errors.
- `WorkspaceState.openDirectory()` updates active workspace and loaded todo data.
- Canceling `openDirectory()` preserves existing active workspace and todo data.

Verification commands:

```sh
pnpm check
pnpm test:unit
pnpm test:rust
pnpm lint
find src/lib -type d -empty | sort
```

## Remaining Milestones

### Milestone 2: Missing Path And Missing todo.txt Recovery

Make failure states feel deliberate instead of incidental.

- Add explicit frontend statuses such as `idle`, `restoring`, `loading`, `ready`, `missing-root`, `missing-todo`, and `error`.
- Keep missing/deleted workspace roots in recents instead of deleting them.
- Add actions for retry, open different workspace, and remove from recents.
- Add a Rust command to create `<root>/todo.txt` only when the root exists and the file does not.
- Show a `Create todo.txt` action for valid workspaces missing the file.
- Add tests for missing roots, create-file behavior, and state transitions.

### Milestone 3: Sidebar Workspace Switcher

Add the switcher shown in the product direction.

- Place the switcher at the top of `src/lib/modules/workspace/ui/sidebar/index.svelte`.
- Closed state shows color dot, active workspace name, and chevron.
- Open state lists recent workspaces with color dots and active checkmark.
- Include a bottom `New Workspace` or `Open Workspace` action.
- Keep rows compact and desktop-tool oriented.
- Use module-owned workspace UI components; only add shared shadcn primitives if needed.

### Milestone 4: Workspace Creation Dialog

Replace the automatic default metadata flow with an explicit local-state form.

- Add fields for name, folder path, and color.
- Use local Svelte 5 runes state plus Zod validation.
- Do not use Formsnap for this milestone.
- Folder picker fills the root field.
- Name defaults from the selected folder until the user edits it.
- Submit saves/upserts the workspace entry and loads it.

### Milestone 5: Shell Polish And Editing

Round out the management surface after the core behavior is stable.

- Allow renaming and recoloring existing workspaces.
- Improve header and status bar copy for ready, loading, missing, and error states.
- Add remove-from-recents controls where appropriate.
- Consider keyboard and focus behavior for the switcher/dialog.
- Add component tests for the switcher and dialog if the local test setup supports them.
