# Own domain operations in the Electron main process

The Electron main process will host a TypeScript backend that owns todo.txt parsing, persistence-related validation, Workspace persistence, and atomic file writes. Domain modules remain independent of Electron so they can be tested directly; Electron supplies desktop integration and IPC transport.

The Svelte renderer accesses explicit domain operations through a narrow, typed preload bridge. It does not receive general filesystem or generic IPC access. This retains a clear ownership boundary while replacing the Rust backend and its transport. ADR-0001 and ADR-0002's Rust ownership is superseded by this decision; metadata format and session response design remain under review.

Electron's [process model](https://www.electronjs.org/docs/latest/tutorial/process-model) and [context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation) describe the main-process capabilities and bridge pattern used here.
