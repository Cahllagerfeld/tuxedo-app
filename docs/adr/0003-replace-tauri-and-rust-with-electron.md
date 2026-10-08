# Replace Tauri and Rust with Electron

Tuxedo will replace Tauri and its Rust backend with Electron while retaining SvelteKit in SPA mode. The owner prefers Electron's browser behavior and accepts the larger application bundle; removing both Tauri and Rust is a requirement of the migration. The existing UI may be replaced.

The backend may be rewritten rather than ported mechanically. Ordinary todo.txt files remain the source of truth, and writes must remain atomic. Tuxedo is a desktop application; a browser product is outside this rewrite's scope. The first supported platform is macOS, with Windows and Linux intended later.

Workspace metadata will use a versioned JSON file with atomic writes. This metadata is managed by the application rather than intended for manual editing, so Node's built-in JSON support avoids a TOML dependency. The rewrite starts a fresh catalogue without migrating legacy app metadata and preserves the old catalogue and external Todo files. This supersedes ADR-0001's TOML format choice; its atomic-write and Todo-file source-of-truth principles remain.

Workspace lifecycle operations retain coherent backend responses, and Svelte Query manages backend data in the renderer. ADR-0004 supersedes the Rust ownership described in ADR-0001 and ADR-0002. The implementation plan lives in `docs/plans/electron-migration.md`.

The first rewrite includes current functionality plus Todo-item creation, observation of external Todo-file edits, and keyboard navigation. Redesigning the Workspace setup workflow remains a separate scope question rather than a prerequisite for replacing the desktop runtime.

Initial delivery includes a development command and a locally packaged macOS app. Signing, public distribution, and automatic updates are deferred.
