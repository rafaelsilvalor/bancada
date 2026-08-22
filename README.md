# bancada

**Gates for Claude Code that block until the evidence exists — and record that they blocked.**

A *bancada* is a workbench: the table with the instruments in plain view. Nothing
counts because someone said so; it counts because it was measured, and the
instrument is left out where anyone can check it.

That is the whole design. An instruction in `CLAUDE.md` is a request. A hook that
denies the tool call is enforcement. bancada is the second kind, plus the
telemetry to tell you whether the enforcement is worth what it costs.

> **Status: early. v0.1.0, Phase 6 of 10.**
> Two gates exist — commit messages and layering — both verified refusing real
> input, and the commit gate verified inside a real session. The context plugin
> ships a probe, a skill factory and a listing-budget meter. The remaining gates
> are not written and nothing is installable from a marketplace yet. See
> [Project status](#project-status) for exactly what exists.

## Why it exists

Three problems, and a claim about each.

**Architecture drifts faster than review catches it.** Fitness functions —
ArchUnit, dependency-cruiser, import-linter — already solved *how* to check a
layering rule. What they get wrong is *when*: a check that runs in CI after the
pull request is open teaches the agent nothing, because the agent is gone.
bancada runs the same check at `PreToolUse`, so the violation is refused in the
turn that created it and the reason goes straight back to the model.

**Context is spent without anyone counting.** A subagent that researches in an
isolated window and returns a summary is a real saving — but a *custom* subagent
reloads the whole `CLAUDE.md` hierarchy on every call, which is the cost it was
supposed to avoid. bancada ships the version that doesn't, and measured it: on
one research question, delegating cost 0.58x of answering inline. See the
CHANGELOG for the numbers and for what that measurement cannot tell you.

**Skills hit a ceiling nobody sees.** Claude Code budgets the skill listing at
about 1% of the model's context window. When it overflows, descriptions are
dropped starting with the least-invoked skills — the skill still exists, but the
model stops knowing when to reach for it. bancada meters that budget and records
which skills ever fire.

The common thread: **measure the harness, don't just believe it.**

## What it is not

- Not a `CLAUDE.md` generator. Your conventions are yours; a template goes stale
  the day it is copied.
- Not a folder you vendor into your repo. Nothing is copied in. You add two lines
  to `.claude/settings.json` and, if you want to change a default, one config file.
- Not a methodology you have to adopt. The opinionated process lives in a
  separate plugin that ships disabled.

## The three plugins

| Plugin | What it does | How sure we are |
| --- | --- | --- |
| `bancada` | The engine: config loading, the hook contract, telemetry, the structure gate, `doctor` and `yield` | The mechanism is proven in prior use; this implementation is new |
| `bancada-context` | The probe, the skill factory, the context budget meter | Mechanism is documented by Anthropic; the savings are unmeasured here |
| `bancada-flow` | Three review Pauses, a brief format with a validator, four agent roles | Weakest evidence of the three. Ships disabled on purpose |

The split is not organizational, it is epistemic: what has proof goes in the
core, what has only conviction goes in a package you opt into.

## Design commitments

These are constraints on the project, checked in CI where a machine can check them.

1. **Zero npm dependencies in the core.** Node builtins only. A harness that runs
   inside everyone's `PreToolUse` should not carry a dependency tree.
2. **Emission never changes a verdict.** Nothing on the telemetry path may throw,
   in any branch. A gate that breaks because its metric broke is worse than no gate.
3. **Hash inputs, never content.** The stream records a truncated digest so it can
   spot a recurring input, never the input itself.
4. **A glob that matches nothing warns; it never silently approves.** Silent
   coverage gaps are how a checker ends up guarding an empty directory.
5. **No rule-identifier scheme.** Concepts are cited by name. A number means
   nothing in a repository that did not define it. *(enforced:
   `scripts/check-no-rule-ids.mjs`)*
6. **Cost is compared against a recorded baseline, not an invented ceiling.**
   Hot-path code and CLI-only code are counted separately, because they are paid
   for at different times: one on every tool call, the other only when a human
   runs a command. Growth past the tolerance fails until someone records a new
   baseline, so every increase is a decision in the history. Latency is measured
   and reported but never enforced — CI runners vary too much for a millisecond
   threshold to mean anything. *(enforced: `scripts/check-cost.mjs`)*
7. **English in the product; the consumer's language in what it emits.** Code,
   comments, docs and commits are English. Deny reasons and report output follow
   a `language` setting.

## Project status

Ten phases. This repository is at the end of the sixth.

| Phase | What it delivers | State |
| --- | --- | --- |
| 1 | Skeleton, manifests, CI | **done** |
| 2 | Core: hook contract, config loader, `doctor` | **done** |
| 3 | First gate: commit messages | **done** |
| 3.5 | One dispatcher per event | **done** |
| 4 | Telemetry and `yield` | **done** |
| 5 | The structure gate | **done** |
| 5b | `/bancada:structure` and the external-tool adapter | **done** |
| 6 | `bancada-context`: probe, skill factory, budget meter | **done** |
| 7 | Remaining gates: green boundary, secrets, size, test/code pair | next |
| 8 | `bancada-flow` | |
| 9 | Docs, examples, public v0.1.0 release | |
| 10 | Full CI | |

## Try it locally

Nothing is published yet, so load it from disk:

```bash
claude --plugin-dir ./plugins/bancada
```

Then ask Claude to run a commit with a message the gate should refuse. The hook
fires on Claude's tool calls, not on what you type in your own shell, so the
request has to go through Claude:

> Run this in the shell exactly as written, without correcting the message:
> `git commit -m "adding a thing"`

The commit is refused before git runs, and the reason goes back to the model.
Asking for `git commit -F somefile.txt` instead produces a confirmation prompt:
bancada cannot read a message that lives in a file, and a gate that cannot see
what it is judging escalates rather than approving.

Validate the manifests:

```bash
claude plugin validate . --strict
```

## Repository layout

```
.claude-plugin/marketplace.json   the catalog
plugins/bancada/                  the engine
plugins/bancada-context/          context discipline
plugins/bancada-flow/             opinionated process, disabled by default
schema/                           JSON Schema for bancada.config.json
scripts/                          CI hygiene and cost checks
docs/decisions/                   architecture decisions, with the measurements behind them
examples/                         starting configs per stack
```

## License

MIT. See [LICENSE](LICENSE).
