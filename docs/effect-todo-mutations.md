# Todo-item mutations through Effect

Issue #94 and ADR-0006 moved Todo-item orchestration into the shared Effect
application layer alongside Workspace lifecycle operations. Issue #96 verifies
completion, uncompletion, deletion, and reordering against that implementation;
it does not require another runtime, queue, or renderer state owner.

```text
plain desktop request
  session-runtime.ts: managed runtime Promise bridge
    session.ts: WorkspaceSession and shared semaphore
      todo-operations.ts: validate target, reread disk, transform
        atomic-write.ts: scoped replacement
      accept confirmed Todo file and advance revision
plain applied/conflict/rejected outcome
```

Completion, uncompletion, and deletion protect the targeted physical line and
preserve unrelated external edits. Reordering protects the whole confirmed raw
Todo file and moves only the requested Todo items among their existing positions.
All four verify scope, revision, Active workspace, and persisted Workspace path.
Replacement and confirmation share an uninterruptible region. Rejections retain
confirmed data; conflicts accept the current disk contents. These checks do not
provide a transaction with arbitrary external editors.

`electron/backend/todo-mutations.spec.ts` uses scoped real files and the public
WorkspaceSession operations to verify fixed expected bytes, permissions, unchanged
catalogue data, failed-rename cleanup and recovery, persisted-path protection, and
confirmation despite interruption while a stale mutation is queued. Dates are
injected as a local calendar date. Existing completion, deletion, and reordering
suites cover line transformations, legacy completed Todo items, raw-content
conflicts, and stale targets. Existing desktop Promise, controller, Svelte harness,
and Electron tests retain their original seams. Creation/editing and observation
continue through the same application layer.

The reference source and installed Effect packages both use 4.0.3 (upstream commit
`7547a99f81fa6f7e651d52f3d42081f399bfbca8`). Test resource handling follows
`.repos/effect/ai-docs/src/01_effect/05_resources/10_acquire-release.ts` and
`ai-docs/src/09_testing/{10_effect-tests,20_layer-tests}.ts`. Interruption uses the
public `Effect.uninterruptible` / `Fiber.interrupt` APIs; runtime behavior is
documented in `packages/effect/test/ManagedRuntime.test.ts` under that checkout.
