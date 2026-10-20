# Use Effect for backend orchestration

Use Effect 4 for Electron main-process orchestration, retaining the Electron-independent backend in ADR-0004. Renderer data ownership now follows TanStack Query with SvelteKit load prefetching in ADR-0008, which supersedes ADR-0007. The desktop API remains narrow, plain-data, and Promise-based. Todo files and the version-1 JSON Workspace catalogue keep their existing formats; this adoption requires no user-data migration. The specification is [issue #91](https://github.com/Cahllagerfeld/tuxedo-app/issues/91).

## Validation and failures

Effect Schema is the canonical definition for desktop requests, responses, observation events, persisted catalogue data, and forms. Desktop and persistence boundaries decode synchronously with strict excess-property checks through `effectValidator`; main and preload validate both transport directions. Forms use Superforms `standard`/`standardClient` with `Schema.toStandardSchemaV1`, explicit defaults, and shared constraints. Form strings remain distinct from nullable/optional desktop dates, and refinements retain field error paths. Superforms' Effect 3 adapters are not used.

Expected filesystem and operation failures remain typed in backend Effects and map to existing rejected outcomes or restoration states. Conflicts return confirmed disk data. Unexpected defects are logged with operation context and return a safe message; unreadable catalogue data is preserved. There is no automatic retry of an ambiguous write.

## State and persistence

Main constructs one managed runtime. `session-runtime.ts` composes `WorkspaceSession`, the built-in `effect/FileSystem` with `@effect/platform-node/NodeFileSystem.layer`, and injected identity/date capabilities; it owns the desktop Promise bridge. `session.ts` owns authoritative confirmed backend state and one semaphore for lifecycle, Todo-item, and observation operations. `WorkspaceCatalogue` owns strict catalogue reads, decoding, and atomic persistence, shared by Workspace lifecycle and Todo-item operations. Only Workspace lifecycle initialization treats a missing catalogue as empty; Todo-item mutations require a fresh successful read. `workspace-lifecycle.ts` owns lifecycle decisions, and `todo-operations.ts` composes Todo-item operations against that same state. `WorkspaceSession` captures its filesystem, identity, and catalogue dependencies during layer construction; its callers require only the session service. Parsing and line transformations remain pure functions.

Mutations validate backend scope, revision, Active workspace, and persisted Workspace path. Creation and reordering check the whole confirmed Todo file; editing, completion, uncompletion, and deletion check the targeted physical line while preserving unrelated external edits. Atomic replacement acquires an exclusive adjacent temporary file, preserves permissions, synchronizes, closes before rename, and cleans up on failure. Replacement and confirmed-state acceptance share interruption protection. These checks do not provide a transaction with arbitrary external editors.

## Resources and shutdown

Todo-file observation adapters acquire watchers and subscriptions in the supplied Scope. Each confirmed observation target has a session-owned Scope containing its signal queue, 250 ms stream debounce, and background reads. Retargeting, Empty/unavailable states, and disposal release it, including partial acquisition. Stale callbacks cannot emit desktop events; observation failures remain best-effort. Events trigger an authoritative backend refresh followed by targeted query invalidation under ADR-0008.

`application-runtime.ts` owns synchronous admission, tracking of admitted work, and the application Scope. Main supplies thin scoped Electron adapters for startup, activation, dialogs, IPC, protocol/security handlers, and windows. Window child Scopes release native-theme subscriptions and windows. Startup failure follows the same cleanup path as shutdown.

Normal quit closes desktop and observation admission synchronously, drains admitted work (including queued operations), stops observation, closes platform Scopes, and disposes the runtime last. Repeated disposal and quit requests share completion. One 10-second wall-clock deadline covers the entire sequence. Timeout diagnostics identify the blocked phase and pending operation names; cleanup failure logs its cause. Successful shutdown resumes Electron quit with exit code 0; startup failure, cleanup failure, or timeout exits with code 1. Forced termination can interrupt a write, and timeout does not retry or claim rollback.

## Reference and verification

The application and read-only reference subtree both use Effect 4.0.4 at upstream commit `e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab`. Runtime composition follows `ai-docs/src/04_integration/10_managed-runtime.ts`; ownership follows `ai-docs/src/01_effect/05_resources/10_acquire-release.ts` and public `Scope.fork`/`Scope.close`. `packages/effect/test/ManagedRuntime.test.ts` demonstrates that disposal interrupts fibers, which is why the application drains admitted work first.

Real-file backend operations, typed desktop/command tests, Svelte form harnesses, and real Electron tests verify these boundaries. The macOS package test copies the application outside the checkout and clears Node resolution overrides before exercising both package assets and desktop workflows. Runtime dependencies must be bundled; no development dependency directory or runtime installation is required. Production bundle/dependency measurements and full-suite results belong in the delivery PR, not another migration document.
