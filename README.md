# Tauri + SvelteKit + TypeScript

This template should help get you started developing with Tauri, SvelteKit and TypeScript in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## Electron migration development

Run `devenv shell -- pnpm install`, then `devenv shell -- pnpm dev:electron`.
`vite-plugin-electron` builds and watches main and preload alongside the SvelteKit
renderer. Main changes restart Electron; preload changes reload the window.
`pnpm build:electron` builds the SPA and desktop bundles together, keeping a
self-contained CommonJS preload for the sandboxed renderer.
This builds the TypeScript main process and bundled sandboxed preload, starts the
SvelteKit SPA on the explicit loopback origin `http://127.0.0.1:1420`, and launches
Electron. Stop it with Ctrl-C; renderer changes use Vite HMR. The existing `pnpm tauri dev` command remains usable
until the migration is complete.

Electron starts a fresh catalogue at `Tuxedo Electron/workspaces.json` under the
platform application-data directory (`~/Library/Application Support` on macOS).
The legacy Tauri catalogue and external Todo files are preserved. Catalogue JSON
uses version 1 and the Workspace domain field names; unreadable or invalid files
are preserved and shown as unavailable. Active-file restoration and Workspace
mutations are implemented by subsequent migration slices.

Run `devenv shell -- pnpm check`, `pnpm test:backend`, `pnpm test:unit`,
`pnpm test:rust`, and `pnpm lint` through devenv. `pnpm test:electron` builds the
SPA and crosses the real Electron preload/IPC boundary using an isolated temporary
data location; it verifies the Empty state and sandbox/isolation settings.

The desktop contract is `src/lib/shared/desktop/contract.ts`; backend operations
are serialized in `electron/backend/session.ts`. Confirmed renderer data lives in
Svelte Query with scoped ordered revisions, no automatic refetching, and no
mutation retries. Electron-local operations use `networkMode: "always"` so they
remain available offline. `pnpm check` also enforces renderer import boundaries and
checks main/preload separately. Security follows the primary
[Electron guidance](https://www.electronjs.org/docs/latest/tutorial/security);
query integration follows [Svelte Query](https://tanstack.com/query/latest/docs/framework/svelte/overview).
