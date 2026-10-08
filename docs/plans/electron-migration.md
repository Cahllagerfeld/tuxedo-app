# Electron migration

Status: design decisions settled; awaiting confirmation of shared understanding before implementation.

## Scope

Replace Tauri and Rust completely with Electron and a TypeScript backend. Keep SvelteKit in SPA mode. macOS is the first verified target, with Windows and Linux intended later. Initial delivery includes a development command and a locally packaged macOS app; signing, public distribution, and automatic updates are deferred.

Todo files remain external ordinary todo.txt files and the source of truth. Writes remain atomic. Workspace metadata uses versioned JSON in the app's data directory, with no legacy catalogue migration. Preserve legacy configuration and Todo files. Keep the existing one-file-per-Workspace product model and setup workflow for this migration; broader Workspace redesign is deferred. Existing UI components may be reused or replaced as needed.

Preserve current user-visible capabilities and include the three planned features:

- [Todo-file observation, issue #42](https://github.com/Cahllagerfeld/tuxedo-app/issues/42).
- [Inline Todo composer, issue #44](https://github.com/Cahllagerfeld/tuxedo-app/issues/44).
- [Keyboard shortcuts and focus navigation, issue #50](https://github.com/Cahllagerfeld/tuxedo-app/issues/50).

These issues supply feature behavior; this plan and ADR-0003/0004 replace their obsolete Rust/Tauri implementation requirements. For observation, coalesce changes while busy and reconcile afterward instead of dropping events and risking a missed external edit. Full Todo-item editing, search/filtering, undo, multi-window coordination, and a browser product are outside this rewrite.

## Structure and contract

- `electron/`: lifecycle, window configuration, preload, IPC registration, native dialogs, and backend modules.
- Backend modules own parsing, Workspace lifecycle, persistence, observation, and file mutations without importing Electron. Electron integration supplies the desktop adapter.
- `src/shared/desktop/`: renderer-safe schemas and shared request, response, event, error, and channel definitions.
- `src/lib/modules/`: feature-owned Svelte UI and state; `src/routes/` remains thin SPA composition.

Bind channel names to their schemas and inferred TypeScript types. Type-check main handlers, preload methods, and renderer callers against the same contract; validate incoming requests and outgoing responses/events at the transport seam. Use explicit domain outcomes for applied operations, external-edit conflicts, and rejected operations. Do not expose generic IPC or filesystem access through the preload.

The Agent Desktop workshop is a structural reference only. Follow current Electron guidance for sandboxing, context isolation, disabled renderer Node integration, sender and origin validation, navigation and permission restrictions, CSP, and a constrained protocol serving packaged SPA assets. Separate Node and renderer type-checking and enforce their import restrictions.

## Backend behavior

Port the current parser and mutation behavior using existing tests and serialized fixtures as evidence. Preserve file order, untouched raw lines, skipped lines, newline conventions, and local-date semantics. Workspace operations preserve successful-selection and failure invariants. Validate JSON catalogue data and preserve corrupt or unsupported metadata rather than silently overwriting it.

Serialize app-owned reads, writes, and refreshes through the backend session. Bind Todo-item commands to the intended Workspace and expected file content. Reread the current file before mutation, compare the target, preserve unrelated current content, and atomically replace the file. Atomic replacement prevents torn writes; it does not eliminate the interval in which an unrelated external editor can write between the final read/check and replacement.

Observe only the active loaded Todo file. Handle atomic editor replacements, debounce transient missing-file states, retarget on Workspace changes, and clean up subscriptions. Coalesce notifications during operations; reread afterward if dirty. A stably unreadable file clears loaded content with a warning while retaining the catalogue. Reconcile again on app focus to recover from missed notifications. Filesystem observation on unusual/network volumes is best-effort.

## Frontend state

Use Svelte Query for backend data and mutations, initially with a coherent session query. Query reads must be side-effect-free; startup restoration and Workspace transitions remain explicit backend lifecycle operations. Keep ephemeral UI state in Svelte runes and derive counts and facets from the loaded file.

Apply confirmed mutation responses to the same cache. Workspace transitions return coherent session data; Todo-item mutations can return scoped file data with Workspace identity and revision. External-change events invalidate the query and trigger a backend refresh. Reconcile all responses using scoped identity and monotonic session revision so an earlier result cannot replace newer state. Query cancellation alone is not a filesystem or ordering guarantee.

Start with confirmed updates rather than optimistic file mutations. Preserve composer drafts on failure, show typed conflict outcomes, and keep keyboard and mouse actions on the same mutation path. Focus restoration must respect Workspace changes and user movement during asynchronous work.

## Implementation and verification

1. Establish the shared contract, Electron build/dev shell, and secure preload/IPC round trip with the SvelteKit SPA.
2. Implement the TypeScript backend, versioned JSON metadata, coherent lifecycle operations, and atomic Todo-file mutations. Port meaningful backend tests before removing Rust coverage.
3. Connect Svelte Query and observation, exercising mutations and external edits against real temporary files.
4. Implement the composer and keyboard workflows against the accepted feature specifications.
5. Remove Tauri/Rust source, dependencies, generated Rust wire fixtures, configuration, scripts, CI, and development-toolchain requirements once their replacements pass. Retain framework-independent fixtures where useful. Update README, coding standards, and agent instructions to reflect backend ownership and replacement checks.
6. Package the macOS app using current Electron-recommended tooling, initially Electron Forge, and validate packaged asset routing and real desktop behavior.

Checks cover backend parsing/persistence/conflicts, renderer interaction, compile-time contract mismatches, runtime malformed IPC, and a real Electron preload/IPC round trip. Use temporary data for filesystem tests. Verify external replacement, notifications during mutations, old-Workspace events, stale response ordering, and keyboard focus behavior.

Run tools through devenv. The replacement checks include frontend and backend type checking, unit/browser/backend tests, Electron integration tests, formatting, and a production build/package. During migration run Rust tests while Rust remains relevant; after removing it, replace `test:rust` with backend coverage and update the documented finishing commands. Record platforms or manual checks that cannot be exercised. Use new commits, never amend, and remove session temporary files and emptied folders.
