---
name: effect-patterns
description: Consult the local upstream Effect checkout before writing or changing Effect code. Use for Effect services, Layers, schemas, typed failures, runtime integration, scoped resources, concurrency, and Effect tests; ground patterns in version-matched upstream examples, public APIs, and tests.
---

# Effect patterns

Use the original Effect repository as the primary source for implementation patterns. Look up the relevant pattern before writing Effect code instead of relying on remembered APIs or older tutorials.

## Locate and match the source

Resolve `.repos/effect` from this repository's root. This is a committed, squashed subtree available in every clone and worktree. Read `.repos/README.md` for its upstream commit and update procedure. If another upstream checkout was explicitly supplied, use that one.

Compare the application's installed or locked Effect version with `packages/effect/package.json` in the source, and note the upstream commit recorded in `.repos/README.md` (or the branch and commit of an explicitly supplied checkout). For a new adoption, use the version selected for the task. A matching major alone does not prove a recently added API exists in the application's patch version: check the installed declarations or matching local source when they differ. Report material mismatches rather than silently using APIs from upstream main.

Keep the reference checkout read-only. Perform application edits, dependency changes, and validation in the target project under its own instructions. Updating or switching the upstream checkout is a separate action, not part of looking up a pattern.

If the checkout is unavailable, say so and use installed package source and official documentation for the target version. Request a location only when missing evidence prevents a correct implementation.

## Find the pattern before implementing

For each materially new Effect pattern in the change:

1. Search `LLMS.md` for the relevant topic, then read the corresponding example in `ai-docs/src`. These are application-facing guidance; read relevant sections rather than loading the complete documentation. Reuse findings within a task while the source/version remains unchanged.
2. Inspect the chosen public API's declaration and JSDoc in `packages/effect/src` or the relevant platform package. Verify signatures, imports, required services, failure types, scope requirements, and stability annotations against the target version.
3. Read focused upstream runtime tests when behavior matters, especially interruption, finalizers, failure recovery, concurrency, and runtime disposal. Read type tests when inference or assignability drives the design. Library internals can explain behavior, but public examples and exports govern application usage.
4. Choose the smallest upstream-supported pattern that meets the application's behavior and ownership rules. Record the source paths and symbols supporting any non-obvious decision in the work notes or PR explanation; briefly explain necessary adaptations.

Use `rg` for targeted searches. Resolve paths from the checkout root; rediscover moved files instead of treating these pointers as fixed APIs.

| Decision                                             | Start looking here                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Effect functions and Promise/callback boundaries     | `ai-docs/src/01_effect/01_basics`                                                                            |
| Services and Layer composition                       | `ai-docs/src/01_effect/03_services`                                                                          |
| Typed failures and recovery                          | `ai-docs/src/01_effect/04_errors`                                                                            |
| Scoped acquisition and release                       | `ai-docs/src/01_effect/05_resources`                                                                         |
| Embedding a runtime in Electron or another framework | `ai-docs/src/04_integration`, then `packages/effect/test/ManagedRuntime.test.ts`                             |
| Schema checks, codecs, and Standard Schema           | `ai-docs/src/01_effect/02_schema`, relevant sections of `packages/effect/SCHEMA.md`, and Schema source/tests |
| Fibers, state, queues, and serialization             | Relevant public source modules and their tests under `packages/effect/test`                                  |
| Node filesystem/platform adapters                    | `packages/platform/node` and `packages/platform/node-shared`                                                 |
| Effect-aware tests and test Layers                   | `ai-docs/src/09_testing`                                                                                     |

## Apply and verify

Preserve the application's contracts and domain guarantees while adapting the pattern. Keep services around meaningful capabilities, pure helpers as functions, and runtime execution at integration boundaries. An upstream example demonstrates usage; it does not automatically establish the right policy for application writes, shutdown, or retries.

Use exported APIs in application code. Treat internal implementations and regression-test tricks as evidence, not templates to copy. Check stability annotations before choosing experimental or unstable functionality. For migrations, use the checkout's migration guide only where it matches the source and target versions.

Compile against the application's actual dependencies and validate changed behavior through its existing public test seams. For resource and concurrency changes, verify cleanup and failure/interruption paths relevant to the operation. For shared Schema or browser/preload imports, verify the actual production bundle and platform compatibility rather than inferring them from an upstream example.

Completion means the new patterns have upstream evidence, the selected APIs exist in the target version, and the application checks relevant to the change pass. State any unresolved compatibility or validation limitation.
