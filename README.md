# Tuxedo

Tuxedo is a macOS Electron desktop application with a SvelteKit SPA. It organizes existing todo.txt files into saved Workspaces and supports completion, uncompletion, and precise Todo-item deletion.

## Development

Install dependencies with `devenv shell -- pnpm install --frozen-lockfile`, then launch with `devenv shell -- pnpm dev`. Vite and vite-plugin-electron build/watch main and preload and serve the renderer at `http://127.0.0.1:1420`; Ctrl-C stops the application. Renderer updates use Vite HMR. `pnpm dev:electron` is an equivalent explicit desktop command.

The Electron-independent TypeScript backend owns parsing, JSON catalogue persistence, atomic replacement, and operation serialization. The isolated preload exposes a runtime-validated typed desktop API. Svelte Query holds one confirmed renderer session; counts and facets derive from its Todo file.

Metadata is stored in Electron's application-data directory as `workspaces.json`. The rewrite begins with a fresh JSON catalogue; existing legacy metadata and external Todo files are preserved. Catalogue-only Workspace deletion never deletes a Todo file. Setting `TUXEDO_USER_DATA` to a temporary directory isolates development/integration data.

## Verification

Run these commands through `devenv shell --`: `pnpm check`, `pnpm test:unit`, `pnpm test:backend`, `pnpm lint`, `pnpm build`, and `pnpm test:electron`. `check` covers Svelte/renderer types, backend/main/preload/contract types, and import restrictions. Unit tests include Chromium renderer behavior; install its browser with `pnpm exec playwright install chromium` when needed. Backend tests use real temporary files and preserve framework-independent todo.txt fixtures in `electron/backend/fixtures`.

`pnpm build` produces the static SPA in `build` and desktop bundles in `dist-electron`. `pnpm test:electron` builds and launches real Electron to exercise production protocol loading, trusted preload/IPC, runtime input validation, Workspace lifecycle, completion, conflicts, and deletion with temporary data. `pnpm test:electron:dev` verifies development startup. macOS CI runs types, formatting, browser/backend tests, production build, and real Electron integration. Local application packaging is tracked in #61; signed distribution, automatic updates, and Windows/Linux verification are deferred.

Application icons retained from the previous runtime live in `assets` for packaging.
