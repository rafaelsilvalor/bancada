# Changelog

All notable changes are recorded here, per plugin. This project follows
[Semantic Versioning](https://semver.org/).

A **MAJOR** bump means one of: a gate now denies what it previously allowed,
`bancada.config.json` changed incompatibly, or an agent or skill was renamed.

## [Unreleased]

### bancada

**Phase 1 — skeleton**

- Marketplace catalog and three plugin manifests. All four pass
  `claude plugin validate --strict`.
- `hooks/ping.mjs`: a plumbing probe, not a gate. It reports whether a
  plugin-supplied hook fires at all and never blocks. To be deleted once a real
  gate covers the same path.
- CI: manifest validation, tests on Linux/macOS/Windows, and three hygiene
  checks — no inherited rule identifiers in prose, cost against a recorded
  baseline, and a generated-schema freshness check.

**Phase 2 — the core**

- `lib/hook-io.mjs`: the hook contract. `allow` / `deny` (exit 2, reason on
  stderr) / `ask` / `blockStop` / `note`, plus `abstain` and `runGate`. A gate
  that throws abstains; it never denies. Verified in child processes, so the
  exit codes and streams asserted are the real ones.
- `lib/config.mjs`: one `SPEC` produces both the defaults and the validator, so
  the two cannot drift. A wrong type is an error; an unknown key is a warning,
  so a config written for a newer bancada still runs on an older one. Config is
  read from `bancada.config.json` in the project, because since Claude Code
  v2.1.207 `pluginConfigs` is deliberately not read from a project's settings.
- `lib/glob.mjs`: a glob matcher rather than a dependency. `path.matchesGlob` is
  experimental and prints to stderr — the channel a hook uses to state a
  refusal.
- `lib/files.mjs`: `git ls-files` for the file universe, with a directory walk
  as a disclosed fallback.
- `lib/messages.mjs`: `en` and `pt-BR` catalogs for what bancada emits. The
  product itself stays in English.
- `lib/doctor.mjs` and `bin/bancada`: `bancada doctor` reports the resolved
  config, which gates are on, how many files each glob matches, and which
  directories no source glob reaches. An `include` matching nothing is called
  out; an `exclude` matching nothing is not, because that is the healthy case.

**Phase 3 - the commit gate**

- `lib/commit-message.mjs`: a `PreToolUse` gate
  that reads a `git commit` off the command line and judges it before git runs,
  so a refusal lands in the turn that can still fix it.
- No vocabulary of approved verbs. The imperative rule is morphological -
  gerunds and past tense - with an exception set so `bring`, `embed` and
  `spread` are not refused for ending in -ing or -ed. Projects that want a word
  list get `denyVerbs`.
- `denyTrailers` matches regular expressions against whole lines of the
  message, so a project can keep attribution it never asked for out of its
  history. Empty by default.
- A message the gate cannot see - `-F path`, `--amend --no-edit`, a bare
  `git commit` - returns `ask`, never a verdict. `-F -` with a heredoc is
  readable and is extracted before the unreadable check runs.
- The Phase 1 plumbing probe was deleted, as its own comment required, now that
  a real gate covers the same event.

**Phase 3.5 - one dispatcher per event**

- `lib/dispatch.mjs` and `hooks/pre-tool-use.mjs`: a single entry point per
  event. Config is read once, applicable checks run in registry order, and
  their verdicts are folded here rather than by the host: deny beats ask beats
  allow. When several checks land on the same decision every reason is
  reported, because handing back one problem at a time turns one refusal into a
  sequence of them.
- A check that throws is recorded as an abstention and cannot suppress another
  check's real refusal. One broken gate must not disable the rest, and a crash
  must never read as a deny.
- `lib/checks/commit.mjs` is now a thin seam: when the check applies, and where
  its settings live. All the judgement stays in `commit-message.mjs`, which
  knows nothing about hooks or events — which is what makes a second host cheap.
- `hooks/commit-guard.mjs` is gone; the same six payloads produce the same six
  verdicts through the dispatcher.

**Phase 4 - telemetry and yield**

- `lib/telemetry.mjs`: one record per tool call, written by the dispatcher.
  Emission never changes a verdict — nothing on this path throws, on any branch,
  because a gate that refuses a commit over a failed metrics write fails in a
  way nobody can explain. Content is never written, only a truncated digest.
- An absent input hashes to the empty string rather than to the digest of "".
  Otherwise every input-less event would share one digest and read as the same
  input recurring, corrupting the exact measurement the stream exists to make.
- A record names both the gate and the rule that fired. Reporting only the rule
  makes `commit-ok` and `commit-trailer` look like separate gates; reporting
  only the gate hides what it found. The first version conflated them, and the
  first real report is what showed it.
- `lib/yield.mjs` and `bancada yield`: decisions by outcome, per gate with a
  rule breakdown, gates that never fired, and the sharpest signal in the report
  — the same input refused more than once, which means the reason is not
  landing and the gate has become friction rather than feedback.
- A damaged line in the stream is counted, never skipped. A reader that hides
  damage turns a real problem into a quietly smaller denominator.
- An empty stream says so explicitly, and says that it cannot distinguish
  "the gates found nothing" from "the gates are not running".

**Known gaps in this release**

- Validation messages are English even when `language` is `pt-BR`. Section
  headings translate; the validator's own strings do not, because it returns
  formatted text rather than keys. Fixing it properly means the validator
  returning `{key, params}` — a deliberate change, not a patch.
- Whether a plugin can ship `.claude/rules/` is still established by omission
  from the official component table, not by experiment.

**Verified end to end in a real session** (Claude Code v2.1.240, plugin loaded
with `--plugin-dir`)

- `/hooks` lists the plugin's `PreToolUse` entry against `Bash|PowerShell`, so
  `${CLAUDE_PLUGIN_ROOT}` resolves and the exec form (`command` plus `args`)
  spawns. Both had been assumptions.
- `git commit -m "adding a thing"` is refused before git runs, with the reason
  reaching the model. It reports the Conventional Commits check rather than the
  imperative one, which is the documented order: shape first, because the other
  checks depend on it.
- A message carrying `Co-Authored-By: Claude Opus 5` is refused, quoting the
  offending line and the pattern that matched it. The subject `feat: add a
  thing` passed the Conventional Commits, length and imperative checks first,
  so this also demonstrates the chain running to its last check rather than
  short-circuiting at the first.
- `git commit -F mensagem.txt` produces a confirmation prompt carrying bancada's
  explanation, rather than passing. This one mattered: the `ask` path exits 0
  with JSON on stdout, and the `/hooks` panel describes exit 0 as
  "stdout/stderr not shown", which left it unclear whether the structured
  verdict would be read at all. It is. A message the gate cannot read escalates
  to the owner instead of being approved in silence.

### bancada-context

- Manifest only.

### bancada-flow

- Manifest only. Ships disabled (`defaultEnabled: false`).
