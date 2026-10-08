# Replace Tauri and Rust with Electron

Tuxedo will replace Tauri and its Rust backend with Electron while retaining Svelte as the frontend technology. The owner prefers Electron's browser behavior and accepts the larger application bundle; removing both Tauri and Rust is a requirement of the migration. The existing UI may be replaced.

The backend may be rewritten rather than ported mechanically. Ordinary todo.txt files remain the source of truth, and writes must remain atomic. Tuxedo is a desktop application; a browser product is outside this rewrite's scope. The first supported platform is macOS, with Windows and Linux intended later.

Workspace metadata persistence, Workspace lifecycle design, and compatibility with existing app metadata remain open decisions. This decision reopens the Rust ownership described in ADR-0001 and ADR-0002; their other choices are still under review.
