# Rebuild Tuxedo as a native Rust/GPUI app

Tuxedo will be rebuilt as a native Rust application whose UI is rendered with gpui-kit on GPUI. A packaged Electron build is about 254 MB, of which about 250 MB is the bundled Chromium and Node runtime; the read-only native prototype's release binary is about 20 MB. The owner now prefers a small, fast-starting, natively rendered app over Electron's browser behavior. Both apps coexist on the `rust-gpui` branch until the native app reaches parity; then the Electron app and the TypeScript packages are removed. The specification is [issue #251](https://github.com/Cahllagerfeld/tuxedo-app/issues/251).

## What this supersedes

- [ADR-0003](0003-replace-tauri-and-rust-with-electron.md): the Electron platform choice and the requirement to remove Rust. Todo files as the source of truth, atomic writes, the versioned JSON Workspace catalogue, macOS first, and the deferral of legacy-configuration migration remain.
- [ADR-0004](0004-own-domain-operations-in-the-electron-main-process.md) and [ADR-0006](0006-use-effect-for-backend-orchestration.md): the TypeScript backend in Electron main, the typed preload/IPC contract, Effect services, Layers, the managed runtime, and the Effect-specific shutdown sequence. Their domain guarantees remain: domain code is independent of the GUI and tested directly, Workspace session operations do not overlap, stale results cannot affect another Workspace, mutations check the file they expect before atomic replacement, and failures leave confirmed state unchanged.
- [ADR-0007](0007-own-renderer-resources-in-sveltekit-route-data.md) and [ADR-0008](0008-simplify-loader-owned-dataflow.md): SvelteKit loaders as owners of displayed data, invalidation, and the renderer command coordinator. One GPUI session entity replaces them.

## Domain behavior stays; architecture follows Rust

Glossary rules, todo.txt semantics, and the Workspace catalogue's format and location stay exactly as in the Electron app; the person switches without migrating anything. State management follows idiomatic Rust/GPUI practice instead of porting the TypeScript architecture. Where the two differ, the Rust way wins.

The domain crate `tuxedo-core` has no GUI dependency and owns todo.txt parsing, the Workspace catalogue, the Workspace session, and every write command. The app crate `tuxedo-app` owns gpui-kit/GPUI rendering, the theme, and platform integration (catalogue path discovery, file picker, file watching, appearance), and talks to `tuxedo-core` only through its public API. Opening a Workspace is split into a foreground prepare step, a background load step, and a foreground accept step; a failed load leaves the selection unchanged. A single retained GPUI session entity wraps the domain session: replacing an in-flight read cancels a stale load, while writes are serialized through the session so every accepted command commits or fails visibly.

## Lenient catalogue reads

While the native app only reads the Workspace catalogue, decoding is deliberately lenient: anything the Electron app can persist must load, so the two apps never disagree about which Workspaces exist. The rule ends with the first change in which the native app writes the catalogue. From then on, catalogue validation and atomic writes match the Electron app's rules exactly, and a catalogue that cannot be read is preserved and reported rather than replaced.

## Verification

Domain behavior is tested at the `tuxedo-core` Workspace session against real temporary files, porting focused cases from the TypeScript backend tests to prove parity. GPUI's test application context covers only what that seam cannot show, such as async ordering and interaction rules. CI runs `cargo fmt`, `cargo clippy` with warnings as errors, and `cargo test` for the workspace on macOS for every change touching the Rust crates, separately from the unchanged Electron CI.
