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
- One Svelte session controller holds confirmed backend data and the current operation and target, and reports errors. Startup read errors remain session state; action outcomes report operation errors for contextual UI notifications. Admission is synchronous: Workspace session operations do not overlap, and confirmed data remains visible until a result is accepted. Lifecycle results replace one coherent session; scoped Todo-item results require the matching Workspace, backend scope, and revision. Counts and facets derive from the confirmed Todo file; dialogs and form inputs remain ephemeral Svelte state.
- Test backend public operations with real temporary files, controller behavior through typed desktop adapters, reactive UI integration with Svelte harnesses, and preload/IPC through real Electron. Renderer imports cannot expose Node/Electron capabilities; backend domain modules remain Electron-independent.

## Shared Schema migration

- Effect 4 Schema is canonical for desktop requests, responses, observation events, persisted catalogues, and forms. Reuse shared constraints in `src/lib/shared/desktop`; do not add parallel validator definitions.
- Forms use Superforms `standard`/`standardClient` with `Schema.toStandardSchemaV1` and explicit defaults. Keep form strings distinct from nullable/optional desktop dates and preserve field error paths.
- Decode Effect desktop payloads synchronously with strict excess-property checks, retaining plain DTOs and Promise-based operations. Use `effectValidator` at desktop and persisted-data boundaries. Empty requests use `Schema.Record(Schema.String, Schema.Never)` because an empty `Struct` accepts excess properties.

## Backend Effect migration

- Main constructs one managed application runtime; desktop handlers retain plain Promise-based requests and responses. `WorkspaceSession` owns the authoritative confirmed state and one Effect semaphore for all lifecycle, transitional Todo-item, and observation operations.
- Inject filesystem and date/identity capabilities through services. Keep parsing and line transformations as functions. Map expected typed lifecycle failures to existing outcomes; log unexpected defects with the operation name and return a safe message.
- Atomic persistence acquires exclusive adjacent temporary files in a scope, preserves permissions, synchronizes, closes before rename, and cleans up on failure. Protect replacement and confirmed-state acceptance together from interruption. Transitional Promise operations bridge into the same runtime rather than creating a second state owner or queue.
