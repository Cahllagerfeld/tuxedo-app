# Tuxedo Product Spec

## Summary

Tuxedo is a local-first desktop app for working with portable `todo.txt` files. It is built with Tauri, SvelteKit, Svelte 5 runes, and Rust. The app should make plain text task files easier to browse, edit, filter, and maintain while preserving the portability and inspectability of the underlying files.

This spec is written for autonomous implementation agents. Agents should implement features incrementally, keep changes scoped to the existing module ownership boundaries, and harden each milestone with tests before moving on.

## Product Principles

- `todo.txt` family files are the durable source of truth.
- Frontend state is derived from disk and may be discarded or rebuilt at any time.
- Rust owns filesystem access, workspace persistence, and todo file writes.
- Frontend command responses must be validated with Zod before applying state.
- All app-owned writes must be atomic.
- The app must remain useful without accounts, cloud sync, proprietary storage, or network access.
- Plain text files must stay readable and compatible with common `todo.txt` tooling.

## Current Baseline

The app already supports a single workspace root stored in Tauri app config, derives `todo.txt` from that root, parses existing tasks through Rust, validates responses in the frontend, and renders a basic task list with sidebar counts.

The practical v1 work should build from that baseline rather than replacing the architecture. Keep:

- App composition in `src/lib/app`.
- Todo domain, state, UI, and tests in `src/lib/modules/todo`.
- Workspace domain, state, UI, API, and tests in `src/lib/modules/workspace`.
- Shared primitives in `src/lib/shared`.
- The route shell in `src/routes/+layout.svelte`.
- `src/routes/+page.svelte` thin.

## Implementation Checklist

Agents should update these boxes as work lands. Check an item only when the implementation, nearby tests, and relevant documentation are complete.

### Milestone 1: Baseline Hardening

- [x] Replace template README content or link it to this spec.
- [x] Mark `docs/workspace-persistence-plan.md` as historical/superseded.
- [x] Improve workspace empty, loading, warning, and error states.
- [x] Add skipped-line diagnostics UI.
- [x] Expand Rust tests for workspace restore and missing-file behavior.
- [x] Expand frontend tests for workspace restore state and todo derivations.
- [ ] Run `pnpm check`.
- [ ] Run `pnpm test:unit`.
- [ ] Run `pnpm test:rust`.
- [ ] Run `pnpm lint`.

### Milestone 2: Safe Mutations

- [x] Add Rust helpers for guarded line replacement and atomic todo file writes.
- [x] Add `append_todo_item`.
- [x] Add `update_todo_item`.
- [x] Add `toggle_todo_item_completed`.
- [x] Add `delete_todo_item`.
- [x] Add frontend API wrappers, Zod schemas, and TypeScript types for mutation responses.
- [ ] Add a form for adding new items, giving comboboxes for contexts etc...
- [ ] Add quick-capture UI.
- [x] Add task complete/uncomplete UI.
- [ ] Add task edit UI.
- [ ] Add task delete UI.
- [x] Reload workspace state from disk after every successful mutation.
- [ ] Watch active workspace `todo.txt` for external changes and refresh the UI.
- [ ] Add stale raw-line guard tests.
- [ ] Add atomic write and preservation tests.
- [ ] Run `pnpm check`.
- [ ] Run `pnpm test:unit`.
- [ ] Run `pnpm test:rust`.
- [ ] Run `pnpm lint`.

### Milestone 3: Navigation

- [ ] Add filter state to `TodoViewState`.
- [ ] Add sort state to `TodoViewState`.
- [ ] Derive visible items from filters and sorting.
- [ ] Add status filters for all, open, and completed.
- [ ] Add priority, project, context, due bucket, and text filters.
- [ ] Add stable sorting by file order, priority, due date, creation date, and completed-last.
- [ ] Make sidebar facets actionable.
- [ ] Make active filters visible.
- [ ] Add reset-filters action.
- [ ] Make `WorkspaceViewToggler` functional for all tasks, focus, and completed views.
- [ ] Add due-date display and due filters.
- [ ] Add filter, sort, and view state tests.
- [ ] Run `pnpm check`.
- [ ] Run `pnpm test:unit`.
- [ ] Run `pnpm test:rust`.
- [ ] Run `pnpm lint`.

### Milestone 4: Archive And Polish

- [ ] Add `archive_completed_todo_items`.
- [ ] Create `done.txt` when archiving and the file is missing.
- [ ] Preserve existing `done.txt` contents when appending archived tasks.
- [ ] Remove only completed tasks from `todo.txt`.
- [ ] Show archived task count after archive completes.
- [ ] Improve task row layout for metadata density.
- [ ] Add keyboard-friendly focus states and accessible labels.
- [ ] Add final component and state coverage for common workflows.
- [ ] Run `pnpm check`.
- [ ] Run `pnpm test:unit`.
- [ ] Run `pnpm test:rust`.
- [ ] Run `pnpm lint`.

## Public Interfaces

### Rust Commands

The backend should expose command-level operations rather than allowing the frontend to mutate files directly.

Required v1 commands:

- [x] `load_workspace_config`: return persisted workspace config or a valid default.
- [x] `save_workspace_config`: validate and persist the selected workspace root.
- [x] `load_workspace`: resolve workspace files and parse existing `todo.txt`.
- [x] `append_todo_item`: append one valid task line to `todo.txt`.
- [x] `update_todo_item`: replace one task line by line number with a raw-line guard.
- [x] `toggle_todo_item_completed`: complete or reopen one task by line number with a raw-line guard.
- [x] `delete_todo_item`: remove one task by line number with a raw-line guard.
- [ ] `archive_completed_todo_items`: move completed items from `todo.txt` to `done.txt`.

Mutation commands must:

- Validate workspace root and target file paths.
- Read the latest file contents from disk.
- Use the provided line number and raw-line guard to avoid overwriting stale UI state.
- Construct the complete next file contents in memory.
- Write with `atomicwrites::AtomicFile`.
- Re-read and re-parse after writing.
- Return the same workspace/todo response shape used by reload paths where practical.

### Frontend Types

Every Rust response shape consumed by Svelte must have a matching Zod schema and inferred TypeScript type. If a Rust command response changes, update the Rust struct, frontend schema, frontend type, and nearby tests in the same milestone.

The frontend should treat schema failures as hard integration errors and show a readable app error rather than applying partial state.

## Features

### 1. Workspace Management

Goal: make workspace selection, startup restore, and missing-file handling reliable.

Behavior:

- [x] On startup, load the saved workspace config.
- [ ] If no workspace is configured, show an empty state with an open-workspace action.
- [x] If the saved root no longer exists, show a clear error and keep the app usable.
- [x] If the root exists but `todo.txt` is missing, show a warning and allow task creation.
- [x] Let the user choose a new workspace directory at any time.
- [x] Persist only workspace metadata, never parsed task data.

Implementation notes:

- Keep persistence in `src-tauri/src/workspace.rs`.
- Keep frontend loading flow in `WorkspaceState`.
- Derive `todo.txt` and `done.txt` from the workspace root.
- Treat missing `done.txt` as non-fatal.

Tests:

- [x] Missing config returns a default.
- [x] Invalid workspace roots are rejected.
- [x] Missing `todo.txt` returns a warning, not a crash.
- [x] Startup restore loads and parses the saved workspace.

### 2. Todo List Reading

Goal: parse and display the current `todo.txt` accurately.

Behavior:

- [x] Display open and completed tasks from the parsed file.
- [x] Preserve and expose raw lines and 1-based line numbers.
- [x] Preserve skipped-line diagnostics for invalid task lines.
- [ ] Show a useful empty state when the file has no valid tasks.
- [ ] Show skipped-line warnings without blocking valid tasks.

Implementation notes:

- Keep todo parsing in `src-tauri/src/todo_txt`.
- Keep frontend parsing schemas in `src/lib/modules/todo/domain`.
- Do not mutate file order during read-only operations.

Tests:

- [x] Parser handles priorities, completion markers, dates, projects, contexts, and metadata.
- [x] Invalid date-shaped tokens are skipped with diagnostics.
- [x] Empty and whitespace-only lines do not produce tasks.
- [x] Frontend state derives counts and facets from loaded data.

### 3. External File Watching

Goal: keep the UI in sync when `todo.txt` is edited outside the app.

Behavior:

- [ ] Watch the active workspace `todo.txt` for changes made by external editors, sync tools, or shell commands.
- [ ] When the file changes on disk, reload and re-parse `todo.txt` and refresh the UI.
- [ ] Debounce or coalesce rapid successive writes so the app does not thrash on save.
- [ ] Ignore or suppress reload loops caused by the app's own atomic writes.
- [ ] If the user has in-progress edits that would be overwritten, show a clear stale-state or conflict warning instead of silently discarding UI state.
- [ ] Stop watching the previous file when the workspace changes or the app shuts down.

Implementation notes:

- Rust should own filesystem watching and emit change events to the frontend.
- Prefer a dedicated watcher in `src-tauri/src/workspace.rs` or a small sibling module rather than polling from Svelte.
- Reuse the existing `load_workspace` reload path instead of introducing a separate parse flow.
- Only watch files for the currently active workspace root.

Tests:

- [ ] External edits to `todo.txt` trigger a UI refresh.
- [ ] App-owned writes do not cause redundant reload loops.
- [ ] Switching workspaces updates the watched path.
- [ ] Missing or deleted `todo.txt` during watch produces a readable warning, not a crash.

### 4. Task CRUD

Goal: support common task changes while preserving plain text fidelity.

Behavior:

- [x] Add a task from a compact quick-capture input.
- [ ] Edit an existing task's full text.
- [x] Complete and uncomplete a task.
- [ ] Delete a task after an explicit user action.
- [x] Reload the workspace after every successful mutation.
- [ ] Show a stale-state error if a line changed on disk after the UI loaded it.

Implementation notes:

- Use raw-line guards for edit, toggle, and delete.
- Complete tasks using todo.txt-compatible syntax: `x YYYY-MM-DD ...`.
- Reopening a task should remove the leading completion marker and completion date, while preserving creation date and metadata when possible.
- Appending should create `todo.txt` if the workspace root is valid and the file is missing.
- Do not silently discard skipped or unrelated lines.

Tests:

- [x] Append creates or extends `todo.txt`.
- [x] Toggle complete adds a completion marker and current local date.
- [x] Toggle reopen removes completion marker without losing description metadata.
- [x] Edit and delete reject stale raw-line guards.
- [x] Mutations preserve unrelated lines.

### 5. Metadata And Display

Goal: make todo.txt metadata visible and useful without hiding the raw format.

Behavior:

- [ ] Show priority, projects, contexts, creation date, completion date, and metadata chips.
- [ ] Treat `due:YYYY-MM-DD` as a first-class due date in display and filters.
- [ ] Keep unknown metadata visible as `key:value`.
- [ ] Use clear visual states for completed, overdue, due today, and upcoming tasks.

Implementation notes:

- The parser should continue returning generic metadata as a map.
- Derived due-date behavior belongs in frontend todo state unless backend validation is required.
- Invalid metadata tokens should remain description text, matching current parser policy.

Tests:

- [ ] Due buckets classify overdue, today, upcoming, and no-due tasks.
- [ ] Unknown metadata remains visible.
- [ ] Completed tasks do not show as overdue unless the UI explicitly filters for completed due items.

### 6. Filtering, Views, And Sorting

Goal: make large todo files navigable.

Behavior:

- [ ] Filter by status: all, open, completed.
- [ ] Filter by priority, project, context, due bucket, and free-text search.
- [ ] Combine filters with AND semantics.
- [ ] Show visible count versus total count.
- [ ] Sort by file order, priority, due date, creation date, and completed-last.
- [ ] Make the existing view toggler functional with practical v1 views: all tasks, focus, and completed.

Implementation notes:

- Store filter and sort state in `TodoViewState`.
- Keep derived visible items reactive.
- Sidebar facet buttons should update filter state.
- File order must remain the default sort.

Tests:

- [ ] Filters combine correctly.
- [ ] Clearing filters restores all tasks.
- [ ] Sorts are stable for equal values.
- [ ] Counts reflect visible and total items.

### 7. Sidebar

Goal: turn the sidebar into actionable task navigation.

Behavior:

- [ ] Show overview counts for open, completed, priority, projects, contexts, and skipped lines.
- [ ] Show clickable priority, project, context, and due-date facets.
- [ ] Indicate active filters.
- [ ] Provide a clear action to reset filters.
- [ ] Surface skipped-line diagnostics in a compact warning section.

Implementation notes:

- Keep sidebar UI under `src/lib/modules/workspace/ui/sidebar` only if it remains workspace shell UI.
- Move todo-specific sidebar subcomponents into `src/lib/modules/todo/ui` if they grow beyond shell composition.
- Avoid feature-level barrel files unless they remove meaningful import churn.

Tests:

- [ ] Sidebar renders empty states without broken controls.
- [ ] Clicking facets updates visible tasks.
- [ ] Skipped diagnostics render line number, reason, and raw text.

### 8. Archive Completed

Goal: keep active `todo.txt` files manageable while preserving completed history.

Behavior:

- [ ] Archive completed tasks from `todo.txt` to `done.txt`.
- [ ] Create `done.txt` if missing.
- [ ] Preserve archived raw task lines.
- [ ] Remove only completed tasks from `todo.txt`.
- [ ] Show how many tasks were archived.
- [ ] No-op cleanly when there are no completed tasks.

Implementation notes:

- Use `done.txt` as the v1 archive file for compatibility with todo.txt conventions.
- Perform both file updates atomically as much as practical. If true multi-file atomicity is unavailable, write `done.txt` first and only then rewrite `todo.txt`; return a clear error if either step fails.
- Reload workspace after archive completes.

Tests:

- [ ] Completed tasks move to `done.txt`.
- [ ] Open tasks remain in `todo.txt`.
- [ ] Existing `done.txt` contents are preserved and appended to.
- [ ] No completed tasks leaves files unchanged.

## Milestones

### Milestone 1: Baseline Hardening

- [ ] Replace template README content or link it to this spec.
- [x] Mark `docs/workspace-persistence-plan.md` as historical/superseded.
- [ ] Improve empty, loading, warning, and error states.
- [ ] Add skipped-line diagnostics UI.
- [ ] Expand Rust and frontend tests around current workspace restore behavior.

Acceptance:

- [ ] Existing read-only workflow is reliable and well-covered.
- [ ] `pnpm check`, `pnpm test:unit`, `pnpm test:rust`, and `pnpm lint` pass.

### Milestone 2: Safe Mutations

- [ ] Add Rust mutation commands.
- [ ] Add frontend API wrappers and Zod schemas.
- [ ] Add quick capture, complete/uncomplete, edit, and delete UI.
- [ ] Reload from disk after every successful mutation.
- [ ] Watch `todo.txt` for external edits and refresh the UI automatically.

Acceptance:

- [ ] Users can manage tasks without touching the text file manually.
- [ ] Manual edits to `todo.txt` made outside the app appear in the UI without restarting.
- [ ] Stale line guards prevent accidental overwrites.
- [ ] All file writes are atomic.

### Milestone 3: Navigation

- [ ] Add filter and sort state.
- [ ] Make sidebar facets actionable.
- [ ] Make the view toggler functional.
- [ ] Add due-date display and due filters.

Acceptance:

- [ ] Users can quickly narrow large todo files.
- [ ] Counts, facets, and visible tasks stay consistent.

### Milestone 4: Archive And Polish

- [ ] Add archive completed workflow.
- [ ] Improve task row layout for metadata density.
- [ ] Add keyboard-friendly focus states and accessible labels.
- [ ] Add final component and state coverage for common workflows.

Acceptance:

- [ ] Completed tasks can be safely moved to `done.txt`.
- [ ] The app is usable with keyboard and screen-reader basics.

## Verification

Run after every structural or behavioral milestone:

```sh
pnpm check
pnpm test:unit
pnpm test:rust
pnpm lint
```

If `pnpm` is unavailable in a Codex sandboxed shell, use:

```sh
PATH=/Users/juliankarl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm check
PATH=/Users/juliankarl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm test:unit
PATH=/Users/juliankarl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm test:rust
PATH=/Users/juliankarl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm lint
```

Vitest may try to bind a local `::1` listener. If tests pass but the process reports `listen EPERM`, rerun outside the sandbox or request permission to run with local binding access.

## Agent Rules

- Read `AGENTS.md` before editing.
- Use shadcn-svelte shared primitives for standard UI controls; install missing components with `pnpm dlx shadcn-svelte@latest add <component>` instead of custom-styled elements.
- Do not create old top-level buckets such as `src/lib/components` or `src/lib/state`.
- Prefer existing module patterns over new abstractions.
- Keep tests close to the code they validate.
- Update Rust structs, Zod schemas, TypeScript types, and tests together for command response changes.
- Never write task data from the frontend directly.
- Never use partial in-place file mutation for todo files.
- Do not delete or rewrite unrelated user changes.
- After moving files, remove unused empty folders and verify with:

```sh
find src/lib -type d -empty | sort
```

## Out Of Scope For Practical V1

- Cloud sync.
- Accounts or authentication.
- Collaboration.
- Mobile apps.
- AI task generation inside the app.
- Calendar integrations.
- Recurring task engines.
- Proprietary database storage for task data.
