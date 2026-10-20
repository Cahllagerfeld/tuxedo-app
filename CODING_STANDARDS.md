# Coding Standards

## Layering

- `src/lib`: `app` (wiring) → `modules/<name>` (domain, state, UI, tests together) → `shared` (feature-free).
- Modules import only themselves and `shared`; cross-module imports mark real domain coupling.
- Routes stay thin: compose app, module UI, shared UI.

## Svelte

- `$derived` > event handler > explicit API; `$effect` only for external systems, justified in review.

## UI

- shadcn-svelte primitive first; missing → shadcn CLI.
- Tailwind only; `<style>` for what Tailwind cannot express.
- Forms: shadcn `Form` + Formsnap + Superforms + Effect Schema, `Form.Field` → `Form.Control` → input → `Form.Description`/`Form.FieldErrors`.

## Desktop contract and ownership

- Electron-independent domain operations in `electron/backend` own filesystem access, persistence validation, todo.txt parsing, operation serialization, and atomic writes. Electron main supplies platform integration and IPC transport.
- The renderer uses only the narrow `window.desktop` preload API. Shared channel/request/response types and runtime schemas in `src/lib/shared/desktop/contract.ts` validate both transport directions; change main, preload, renderer, and contract tests together.
- TanStack Query owns confirmed renderer data. Universal loads ensure queries through the shared QueryClient, and components subscribe to that same cache. Shell session and Workspace-keyed destination queries each read a coherent backend session confirmation; destination reads validate the confirmed Active workspace and preserve the outgoing reader during navigation. Saved views use a separate query. Keep query-key factories feature-local, ordered from broad Workspace keys to session, views, or destination and its ID. Derive counts and facets from the confirmed Todo file. Read projections stay separate from commands, with no second mutable controller snapshot or copy of query data in load results.
- Treat typed desktop methods as Promise-based RPCs. Query mutations await invalidation after successful writes or conflicts; a small command coordinator retains synchronous admission through refresh and contextual outcomes. Confirmed contents stay visible. A saved write followed by a failed refresh must not be retried or reported as unsaved. IPC queries and mutations use `networkMode: "always"`; mutations never retry automatically. Dialogs, drafts, filters, focus, and selection remain ephemeral Svelte state.
- Keep repeatable reads separate from Workspace activation. Loads/preloads and invalidation must not persist selection, retarget observation, clear Undo, or advance an existing mutation revision. Only actual admitted navigation activates a Workspace; mutation controls require matching route identity and backend confirmation. Backend scope, revision, Workspace identity, path, and targeted-content validation remain authoritative.
- Test backend public operations with real temporary files, command behavior through typed desktop adapters, reactive UI integration with Svelte harnesses, and preload/IPC through real Electron. Renderer imports cannot expose Node/Electron capabilities; backend domain modules remain Electron-independent.

## Shared Schema validation

- Effect 4 Schema is canonical for desktop requests, responses, observation events, persisted catalogues, and forms. Reuse shared constraints in `src/lib/shared/desktop`; do not add parallel validator definitions.
- Forms use Superforms `standard`/`standardClient` with `Schema.toStandardSchemaV1` and explicit defaults. Keep form strings distinct from nullable/optional desktop dates and preserve field error paths.
- Decode Effect desktop payloads synchronously with strict excess-property checks, retaining plain DTOs and Promise-based operations. Use `effectValidator` at desktop and persisted-data boundaries. Empty requests use `Schema.Record(Schema.String, Schema.Never)` because an empty `Struct` accepts excess properties.

## Backend Effect orchestration

- Main constructs one managed application runtime; desktop handlers retain plain Promise-based requests and responses. `session-runtime.ts` owns runtime composition and the desktop Promise bridge. `WorkspaceCatalogue` owns strict disk reads, decoding, and atomic catalogue persistence; only Workspace lifecycle initialization treats a missing catalogue as empty. `WorkspaceSession` captures its implementation dependencies during layer construction, so callers require only the session service. `WorkspaceSession` in `session.ts` owns the authoritative confirmed state and one Effect semaphore for all lifecycle, Todo-item, and observation operations. `workspace-lifecycle.ts` owns Workspace lifecycle decisions and returns loaded data for the session to accept; `todo-operations.ts` uses that same session state.
- `application-runtime.ts` owns synchronous desktop/lifecycle admission, tracking of admitted work, and the application Scope around that managed runtime. Main runs startup, activation, dialogs, and IPC only at lifecycle/transport edges; Electron calls remain thin scoped adapters. Window child Scopes release native-theme subscriptions and windows; the application Scope releases IPC handlers, protocol and permission/header handlers, and platform subscriptions, including on startup failure.
- Normal quit closes desktop and observation admission synchronously, drains admitted requests (including queued requests), stops observation, closes platform Scopes, then disposes the runtime. Do not dispose the runtime or close observers ahead of an admitted mutation's commit and confirmation. A 10-second wall-clock deadline covers the whole sequence; log the blocked phase and pending operation names and exit with code 1 on timeout/failure. Never retry ambiguous writes; forced exit can interrupt a write. Repeated quit/disposal requests share completion.
- Todo-file observation adapters acquire watchers and subscriptions in the supplied Scope and emit raw change signals. The session owns each confirmed target's Scope, 250 ms stream debounce, and scoped background work; retargeting, Empty/unavailable states, and runtime disposal close that Scope. Observation acquisition and release failures stay best-effort, and callbacks from released targets cannot emit desktop events.
- Use `effect/FileSystem` with `@effect/platform-node/NodeFileSystem.layer`; inject that service and date/identity capabilities rather than adding a parallel filesystem adapter. Keep parsing and line transformations as functions. Map expected typed operation failures to existing outcomes; log unexpected defects with the operation name and return a safe message.
- Atomic persistence acquires exclusive adjacent temporary files in a scope, preserves permissions, synchronizes, closes before rename, and cleans up on failure. Protect replacement and confirmed-state acceptance together from interruption. Backend operations compose as Effects against the application layer; convert to Promises only at the desktop edge. Observation callbacks enter through that same managed runtime.
- Use `@effect/vitest` for Effect-native tests with scoped fixtures; retain plain Vitest tests for the desktop Promise API. Filesystem tests use live services (`it.live` or `layer` with `excludeTestServices`).
