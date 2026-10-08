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
- Forms: shadcn `Form` + Formsnap + Superforms + Zod, `Form.Field` → `Form.Control` → input → `Form.Description`/`Form.FieldErrors`.

## Desktop contract and ownership

- Electron-independent domain operations in `electron/backend` own filesystem access, persistence validation, todo.txt parsing, operation serialization, and atomic writes. Electron main supplies platform integration and IPC transport.
- The renderer uses only the narrow `window.desktop` preload API. Shared channel/request/response types and runtime Zod schemas in `src/lib/shared/desktop/contract.ts` validate both transport directions; change main, preload, renderer, and contract tests together.
- Svelte Query owns confirmed backend data. Lifecycle results update one coherent session; scoped Todo-item results require the matching Workspace, backend scope, and revision. Counts and facets derive from that cache; dialogs and form inputs remain ephemeral Svelte state.
- Test backend public operations with real temporary files, renderer behavior through typed desktop adapters and Query composition, and preload/IPC through real Electron. Renderer imports cannot expose Node/Electron capabilities; backend domain modules remain Electron-independent.
