# bancada

**Gates for Claude Code that block until the evidence exists — and record that they blocked.**

A *bancada* is a workbench: the table with the instruments in plain view. Nothing
counts because someone said so; it counts because it was measured, and the
instrument is left out where anyone can check it.

That is the whole design. An instruction in `CLAUDE.md` is a request. A hook that
denies the tool call is enforcement. bancada is the second kind, plus the
telemetry to tell you whether the enforcement is worth what it costs.

> **Status: early. All ten phases are closed and nothing is released — the
> manifests say v0.1.0, no tag exists and no marketplace serves it.**
> Six gates exist in the core — commit messages, secrets, file size, layering,
> the test/code pair, and a green boundary on `Stop` that re-checks until the
> turn is actually green. The flow plugin adds three Pauses, a brief format with
> a validator and four agent roles, and ships disabled. Every gate has been
> verified refusing real input inside a real session, bar one caveat each for the
> pair gate and the Pauses, both recorded in the CHANGELOG. The context plugin
> ships a probe, a skill factory and a listing-budget meter. Four starting
> configs live in [`examples/`](examples/), each one's globs counted against real
> repositories of that stack before it was written. See
> [Project status](#project-status) for exactly what exists.

## Why it exists

Three problems, and a claim about each.

**Architecture drifts faster than review catches it.** Fitness functions —
ArchUnit, dependency-cruiser, import-linter — already solved *how* to check a
layering rule. What they get wrong is *when*: a check that runs in CI after the
pull request is open teaches the agent nothing, because the agent is gone.
bancada runs the same check at `PreToolUse`, so the violation is refused in the
turn that created it and the reason goes straight back to the model. That holds
for a file written with `cat > file <<'EOF'` as much as through the write tools —
it did not until it was measured, and `bancada doctor` now prints which routes
each write gate reaches rather than only that it is on.

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
| `bancada` | The engine: config loading, the hook contract, telemetry, six gates, `doctor` and `yield` | The mechanism is proven in prior use; this implementation is new |
| `bancada-context` | The probe, the skill factory, the context budget meter | Mechanism is documented by Anthropic; the savings are unmeasured here |
| `bancada-flow` | Three review Pauses, a brief format with a validator, four agent roles | Weakest evidence of the three. The Pauses are enforced and verified; that they are *worth their friction* is unmeasured. Ships disabled on purpose |

The split is not organizational, it is epistemic: what has proof goes in the
core, what has only conviction goes in a package you opt into.

## Design commitments

These are constraints on the project, checked in CI where a machine can check
them. What CI checks, and which class of defect each check was measured catching,
is in the phase 10 entry of the [CHANGELOG](CHANGELOG.md).

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
   Each entry point is counted separately, because they are paid for at
   different times: the tool-call dispatcher on every tool call, the green
   boundary once when a turn ends, the CLI only when a human runs a command.
   Growth past the tolerance fails until someone records a new
   baseline, so every increase is a decision in the history. Latency is measured
   and reported but never enforced — CI runners vary too much for a millisecond
   threshold to mean anything. *(enforced: `scripts/check-cost.mjs`)*
7. **English in the product; the consumer's language in what it emits.** Code,
   comments, docs and commits are English. Deny reasons and report output follow
   a `language` setting.

## Project status

Ten phases, all of them closed. The release itself is not.

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
| 7 | Remaining gates: green boundary, secrets, size, test/code pair | **done** |
| 7b | The green boundary re-checks instead of standing down | **done** |
| 8 | `bancada-flow`: the three Pauses, the brief, four roles | **done** |
| 8b | Two gaps closed, and one settled by experiment | **done** |
| 9 | Docs, examples, public v0.1.0 release | docs and examples **done**; the release is not cut |
| 10 | Full CI | **done** |

No version was bumped, no `[Unreleased]` section was closed and no tag exists.
[`docs/releasing.md`](docs/releasing.md) has the procedure and says which parts
of it have never been run.

## Getting started

**1. Load the plugin.** From a clone, which is the path every end-to-end
verification in the CHANGELOG used:

```bash
claude --plugin-dir ./plugins/bancada
```

Once this repository is published, the marketplace path is
`claude plugin marketplace add <owner>/bancada` followed by
`claude plugin install bancada`. That path is written from the CLI's own help
and has not been run — there is no published repository to run it against yet.

**2. Copy a starting config** into the root of the project you want guarded, and
change nothing yet:

```bash
cp examples/python/bancada.config.json ./bancada.config.json
```

[`examples/`](examples/) has four: `minimal`, `typescript`, `python` and `go`.
Every glob in them was counted against real repositories of that stack, and each
example records the counts and the commit that produced them.

**3. Ask what is actually running.** This is the report the whole project is
built around, and the line to look for is a setting that guards nothing:

```bash
./plugins/bancada/bin/bancada doctor
```

A plugin cannot put a command on your `PATH`, so the CLI is a script inside the
plugin directory — `bancada` on a shell, `bancada.cmd` on Windows, both two
lines that hand off to `bancada.mjs`. Alias it if you will run it often; the
rest of these docs write it as plain `bancada`.

**4. Watch a gate refuse something.** The hook fires on Claude's tool calls, not
on what you type in your own shell, so the request has to go through Claude:

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
.claude/settings.json             bancada's own gates, run against this repository
.claude-plugin/marketplace.json   the catalog
plugins/bancada/                  the engine
plugins/bancada-context/          context discipline
plugins/bancada-flow/             opinionated process, disabled by default
schema/                           JSON Schema for bancada.config.json, generated from the SPEC
scripts/                          CI hygiene and cost checks
docs/configuration.md             every setting, and what each gate refuses, asks about or cannot see
docs/decisions/                   architecture decisions, with the measurements behind them
docs/briefs/                      one brief per branch, when bancada-flow is on
examples/                         starting configs per stack, each counted against a real repository
```

## Documentation

- [Configuration](docs/configuration.md) — every setting with its default, and
  per gate: what it refuses, when it asks instead, and what it cannot see.
- [Examples](examples/) — four starting configs, with the file counts each glob
  produced on the repositories they were measured against.
- [Decisions](docs/decisions/) — why there is one dispatcher per event, and why
  bancada-flow runs its own. Both carry the measurement that settled them.
- [CHANGELOG](CHANGELOG.md) — what each phase delivered, what it measured, and
  what it explicitly left undone.
- [Releasing](docs/releasing.md) — the four places a version lives, and which
  parts of publishing have never been run.

This repository runs its own gates. `.claude/settings.json` points the
`PreToolUse` and `Stop` hooks at the scripts in `plugins/bancada/hooks/`, so a
session working on bancada is refused by bancada. It registers the hooks rather
than loading the plugin — skills and agents do not arrive this way — and turning
it on found one false refusal that had been sitting in the secret gate's own
test, which the CHANGELOG records.

## License

MIT. See [LICENSE](LICENSE).
