# Tuxedo

Tuxedo is a macOS Electron desktop application with a SvelteKit SPA. It organizes existing todo.txt files into saved Workspaces and supports completion, uncompletion, and precise Todo-item deletion.

## Development

Install dependencies with `devenv shell -- pnpm install --frozen-lockfile`, then launch with `devenv shell -- pnpm dev`. Vite and vite-plugin-electron build/watch main and preload and serve the renderer at `http://127.0.0.1:1420`; Ctrl-C stops the application. Renderer updates use Vite HMR. `pnpm dev:electron` is an equivalent explicit desktop command.

The Electron-independent TypeScript backend owns parsing, JSON catalogue persistence, atomic replacement, and operation serialization. The isolated preload exposes a runtime-validated typed desktop API. Svelte Query holds one confirmed renderer session; counts and facets derive from its Todo file.

Metadata is stored in Electron's application-data directory as `workspaces.json`. The rewrite begins with a fresh JSON catalogue; existing legacy metadata and external Todo files are preserved. Catalogue-only Workspace deletion never deletes a Todo file. Setting `TUXEDO_USER_DATA` to a temporary directory isolates development/integration data.

## Verification

Run these commands through `devenv shell --`: `pnpm check`, `pnpm test:unit`, `pnpm test:backend`, `pnpm lint`, `pnpm build`, and `pnpm test:electron`. `check` covers Svelte/renderer types, backend/main/preload/contract types, and import restrictions. Unit tests include Chromium renderer behavior; install its browser with `pnpm exec playwright install chromium` when needed. Backend tests use real temporary files and preserve framework-independent todo.txt fixtures in `electron/backend/fixtures`.

`pnpm build` produces the static SPA in `build` and desktop bundles in `dist-electron`. `pnpm test:electron` builds and launches real Electron to exercise production protocol loading, trusted preload/IPC, runtime input validation, Workspace lifecycle, completion, conflicts, and deletion with temporary data. `pnpm test:electron:dev` verifies development startup. macOS CI runs types, formatting, browser/backend tests, production build, and real Electron integration. `pnpm test:package` builds an unsigned Forge macOS app and launches its actual executable to repeat the transport/workflow checks, verify bundled assets, route fallback/reload, and reject protocol traversal. Development renderer origin configuration is ignored in packaged apps. Signed distribution, automatic updates, and Windows/Linux verification are deferred.

Application icons retained from the previous runtime live in `assets` for packaging.

## Local macOS application

Run `devenv shell -- pnpm package:macos` on macOS. Forge packages the bundled ESM main/backend, sandboxed CommonJS preload, static SPA, and package metadata from a temporary allowlisted directory. Runtime dependencies are bundled; repository sources, tests, build tools, and pnpm's symlinked dependency tree are excluded. The resulting unsigned application is `out/Tuxedo-darwin-<host arch>/Tuxedo.app`. Launch it with `open out/Tuxedo-darwin-arm64/Tuxedo.app`, or run `Contents/MacOS/Tuxedo` with a temporary `TUXEDO_USER_DATA` directory for isolated checks.

`devenv shell -- pnpm test:package` is the repeatable package verification command and runs in macOS CI. It verifies actual executable loading, security preferences and preload validation, JS/CSS/font assets, route reload, traversal rejection, Workspace ordering/switching and process-restart restoration, catalogue-only deletion, completion/uncompletion/deletion, and current-file conflicts using disposable data. Native file-dialog selection/cancellation should also be checked manually in the packaged app: create a temporary Todo file, choose Create workspace, choose the file in the native picker, enter name/color, create, restart, switch, and delete the Workspace while confirming the Todo file remains. Automated IPC tests do not claim native picker verification.

Local package checks were performed on macOS 26.6.2 arm64 with Node 24.20.0. This is local unsigned delivery; Windows/Linux, signing, notarization, installers, and public distribution are unverified.
