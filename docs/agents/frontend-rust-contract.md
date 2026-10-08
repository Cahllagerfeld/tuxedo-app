# Frontend/Rust contract

Rust commands return typed wire values; the renderer trusts them rather than re-parsing routinely.

- Pin the contract with explicit TypeScript wire types, matching Zod schemas, and shared fixtures serialized by Rust and validated in frontend tests. Drift then fails a test.
- When a command's response shape changes, update together: the TypeScript type, Zod schema, shared fixture, and tests in the relevant frontend module.
- Commands are registered in `src-tauri/src/lib.rs`.
