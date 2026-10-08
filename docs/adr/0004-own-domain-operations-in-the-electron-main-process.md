# Own domain operations in the Electron main process

The Electron main process will host a TypeScript backend that owns todo.txt parsing, persistence-related validation, Workspace persistence, and atomic file writes. Domain modules remain independent of Electron so they can be tested directly; Electron supplies desktop integration and IPC transport.

The Svelte renderer accesses explicit domain operations through a narrow, typed preload bridge. It does not receive general filesystem or generic IPC access. This retains a clear ownership boundary while replacing the Rust backend and its transport. ADR-0001 and ADR-0002's Rust ownership is superseded by this decision; metadata format and session response design remain under review.

The backend/frontend IPC contract must be shared and type-checked across main handlers, preload methods, and renderer callers, including request, response, and event payloads. The Agent Desktop workshop at `learning/electron-agent-apps/workshop/agent-desktop` in the owner's `llm-wiki` repository is a reference for this separation. Its typed renderer interface is useful, but its channel strings and unchecked transport results do not by themselves enforce agreement with main handlers; Tuxedo's contract must close that gap.

The workshop is a structural reference, not an implementation template. Current Electron best practices govern the implementation: context isolation, sandboxing, disabled renderer Node integration, trusted sender checks, validation of IPC payloads, and a constrained custom protocol for packaged renderer assets. Verification includes real preload/IPC round trips as well as backend and renderer tests.

Electron's [process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation), and [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) describe the capabilities and practices used here.
