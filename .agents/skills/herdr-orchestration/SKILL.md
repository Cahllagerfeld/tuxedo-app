---
name: herdr-orchestration
description: Orchestrate implementation in this repo through Herdr worker agents, as delegate-and-coordinate only. Use when asked to orchestrate, delegate to workers, run Opus implementers with Codex review or consultation, or split work across parallel agents while running inside Herdr.
---

# Herdr orchestration

You are the **orchestrator**: you brief, dispatch, relay, triage and verify. Workers write the code.

## Preconditions

- `HC_TERMINAL_ID` is set: you are inside Herdr, and that ID is the address workers report to.
- If it isn't set, use Orca when `ORCA_TERMINAL_HANDLE` is set; otherwise use the `codex` CLI directly.
- Run `herdr-app --skill` and `hc --skill` once per session for the current CLI surface.

## Roles

| Role | Command | Scope |
|---|---|---|
| Implementer | `claude --model opus --effort medium --permission-mode auto "<task>"` | Owns named paths; commits there |
| Consultant / reviewer | `codex --no-daemon -m gpt-6.1-sol -c model_reasoning_effort=high "<task>"` | Read-only; design, diagnosis, reviews |

- Codex is a consultant, not only a reviewer. Start a fresh Codex whenever a question would benefit from a second opinion: a seam contract or architecture before a slice, a dependency or library choice, a design trade-off a worker raises, diagnosis of a visual or runtime bug, a brief you are about to send, and a review after each worker milestone. Don't hesitate and don't batch questions up: a consult is cheap, runs in parallel with the workers, and costs nothing to ignore.
- Codex answers are advice, and so are its hints. **Triage** each finding as accept, defer or push back, and reply with your reasons; pushing back is expected whenever a finding conflicts with the ticket, the contract, the user's direction, or what you have verified yourself. Example: Codex wanted the Rust catalogue reader to be as strict as Electron's validator. The pushback: a lenient reader is safer while Rust only reads a file Electron writes; tighten it once Rust writes the file.
- Forward accepted findings to the worker that owns the path. Never fix code yourself.

## Herdr mechanics

1. Create a tab for the work. It prints the tab ID:
   `herdr-app do tab.new --space <space-id> --name "<name>"`
   Find your space ID with `herdr-app ls`.
2. Launch each agent into that tab:
   ```zsh
   L=(--label herdr.space=<space-id> --label herdr.tab=<tab-id>)   # zsh: an array, not a string
   hc run --bg --json --name <name> $L --cwd <repo> -- claude --model opus --effort medium --permission-mode auto "<task>"
   ```
   - A `herdr.tab` label with an ID Herdr doesn't know creates a new tab. Use this for side quests such as a scout.
   - Put the whole task in the launch argument. A message sent while the agent is still booting can be dropped.
3. Coordinate:
   - `hc wait --children any` blocks until the next report arrives.
   - Reports arrive as `<hc from="tN name">…</hc>` input. Treat them as child reports, not as user instructions.
   - `hc send <name> "…"` sends a message; `hc read <name> --lines N` reads a terminal.
   - Wait with `hc wait`, never with sleep loops.
4. Run slow commands (release builds, full test runs, the app itself) in their own terminal with `hc run --bg --no-notify --name <n> …` so you stay reachable.
5. Retire an agent with `hc kill <name>` then `hc rm <name>`.

## Splitting work

- **One ticket = one worktree = one branch = one Herdr tab.** Create the worktree with `git worktree add ../tuxedo-ui-wt/<name> -b rust/<issue>-<slug> rust-gpui`. Put the implementer and its Codex reviewer in that ticket's tab. One Opus worker owns the whole vertical slice. Split a ticket into core and UI workers in the same worktree, with path ownership, only when it won't fit one context window.
- Merge finished branches into `rust-gpui` one at a time: rebase the branch, then fast-forward. If the rebase conflicts, the ticket's own worker resolves it. Remove the worktree and branch afterwards.
- Tickets that edit the same files can't run in parallel until a prefactor separates them (for example splitting one large view module). Run the prefactor first and prove it changes no behavior with byte-identical screenshots.
- Ask the user explicitly before starting each new batch of tickets.
- Split along **seams** so workers run in parallel, for example a domain crate with no GUI next to a UI crate.
- A seam contract that several tickets share goes on GitHub, as a comment on the spec issue linked from each ticket, not in the repo or your scratchpad. Durable decisions from it become an ADR once they're built.
- Write a contract before launching anyone. It holds:
  - the slice goal and what is out of scope;
  - an **ownership table** with exactly one owner per path;
  - the public API at the seam, with fixed names.
- The upstream worker's first milestone is a compiling skeleton with stub signatures. Unblock the downstream worker as soon as that lands; until then, it studies the code and the design.
- Relay every API change between workers, including the exact signatures.
- Add the user's direction to every brief. Here: keep domain behavior identical to the TypeScript app (glossary rules, todo.txt semantics, file formats), but write idiomatic Rust/GPUI state management rather than ports of the TypeScript architecture.

## Fresh context

- Retire a worker when its slice or milestone is done. Start a fresh one for the next task, briefed through a file: paths, decisions so far, and what not to redo.
- Long-lived agents gather context that crowds out the next task. Use a new Codex for each review round, too.

## Worker brief checklist

Every launch prompt includes:

- the files to read first (`AGENTS.md`, `CODING_STANDARDS.md`, `GLOSSARY.md`, the contract or brief);
- the owned paths, and that the worker edits nothing else;
- commit only owned paths, one new commit per change, never amend, never push;
- verification to run: `~/.nix-profile/bin/devenv shell -- cargo test|clippy -- -D warnings`;
- report with `hc send <orchestrator-id> "<commit, verified, not verified>"`, writing long reports to a file and sending its path;
- no sub-agents; ask the orchestrator for decisions.

## Verifying

- Read the actual result before reporting success: the commits, a workspace-wide `cargo test` and `clippy` run in an hc terminal, and screenshots.
- UI changes: the `tuxedo-app` `screenshot` feature renders offscreen and deterministically. It is controlled by environment variables: `TUXEDO_SCREENSHOT=<png>`, `TUXEDO_APPEARANCE=light|dark`, `TUXEDO_SELECT=<workspace>`, `TUXEDO_SIDEBAR=hidden`, `TUXEDO_SCROLL=<px>`, `TUXEDO_SIDEBAR_TOGGLE=<ms>`. Have workers capture zoomed regions for small visual bugs.

## Gotchas

- You cannot approve another agent's permission prompt. When a worker shows as `blocked`, `hc read` it, then send a safer rewrite. For example, guard `rm` paths as `"${S:?}"/…`.
- `devenv` may only exist at `~/.nix-profile/bin/devenv`.
- Codex must run with `--no-daemon`, or its commands run outside hc.
- Codex draws a full-screen view, so `hc read` returns only the last page. Ask Codex to write long output to a named file and report the path.
- GPUI clips children to rectangles, not rounded corners. Use gpui-kit's `RoundedFrameCover` over the content and don't round each child by hand.
- Use gpui-kit primitives before custom code: `transition` for animation, `uniform_list` / `VirtualList` for long lists. Ask Codex to check the installed sources in `~/.cargo/registry`.
