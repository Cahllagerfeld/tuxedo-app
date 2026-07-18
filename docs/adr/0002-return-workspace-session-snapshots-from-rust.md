# Return Workspace session snapshots from Rust

Rust returns canonical Workspace session snapshots for restoration, creation, switching, and deletion instead of leaving the frontend to reconcile persisted catalogue facts. This keeps Workspace catalogue version, membership, Active workspace selection, and Todo-file loading behind the Rust lifecycle seam, while the frontend applies one validated snapshot.

The snapshot uses the tagged session variants `no_active_workspace`, `active_workspace_loaded`, and `active_workspace_unavailable`. Every variant includes the Workspace catalogue; the loaded variant includes its Todo file, and the unavailable variant includes a warning. This makes invalid combinations of Active workspace, Todo file, and warning unrepresentable in the Rust and TypeScript contract. Failure to read a trustworthy Workspace catalogue remains a rejected command rather than a snapshot variant.

## Considered Options

- Keep the frontend's separate catalogue load plus open flow and per-operation catalogue reconciliation.
- Return lifecycle-level Workspace session snapshots from Rust.

The snapshot option preserves Rust ownership of Workspace persistence from ADR-0001 and concentrates transition invariants where they are persisted.
