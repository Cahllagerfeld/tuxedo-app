# Persist workspace metadata in TOML

The app persists the workspace catalogue and active workspace ID in a versioned `workspaces.toml` file in its OS-specific application-config directory. Rust owns this file and writes it atomically; each todo file remains the source of truth for task data and is read again whenever its Workspace opens.

## Considered Options

- Persist a single directory and infer `todo.txt` from it.
- Persist workspace metadata in a frontend-owned browser store.

The TOML catalogue supports multiple named workspaces, keeps filesystem access in Rust, remains user-inspectable, and does not duplicate task data.

## Consequences

The MVP deliberately does not migrate or read the legacy single-workspace configuration; users create a new workspace catalogue.
