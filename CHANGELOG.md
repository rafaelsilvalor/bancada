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
  checks — no inherited rule identifiers in prose, a size budget for the core,
  and a generated-schema freshness check.

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

- `lib/commit-message.mjs` and `hooks/commit-guard.mjs`: a `PreToolUse` gate
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
