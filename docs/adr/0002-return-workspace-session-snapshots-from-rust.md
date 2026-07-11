# Return Workspace session snapshots from Rust

Rust returns canonical Workspace session snapshots for restoration, creation, and switching instead of leaving the frontend to reconcile persisted catalogue facts. This keeps Workspace catalogue version, membership, Active workspace selection, and Todo-file loading behind the Rust lifecycle seam, while the frontend applies one validated snapshot.

## Considered Options

- Keep the frontend's separate catalogue load plus open flow and per-operation catalogue reconciliation.
- Return lifecycle-level Workspace session snapshots from Rust.

The snapshot option preserves Rust ownership of Workspace persistence from ADR-0001 and concentrates transition invariants where they are persisted.
