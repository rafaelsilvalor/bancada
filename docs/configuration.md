# Configuration

Everything bancada enforces is read from one file, `bancada.config.json`, at the
root of the project it is guarding. Plugin settings are deliberately not used:
since Claude Code v2.1.207 `pluginConfigs` is not read from a project's
`.claude/settings.json`, so a repository cannot feed values into a plugin's
hooks, and per-project policy has to be a file the gate reads itself.

Everything is optional. A missing file is not an error — bancada runs on the
defaults in the table at the end of this page, so installing it costs nothing on
day one. A malformed file *is* reported rather than silently replaced.

Start from [`examples/`](../examples/), which are configs whose globs were
counted against real repositories before they were written down, then run the
report that tells you whether yours still match anything:

```bash
bancada doctor
```

For editor completion, add a `$schema` key pointing at
`schema/bancada.config.schema.json` — the copy in this repository if you are
working here, the copy inside the installed plugin otherwise. The examples omit
it, because the right path depends on where the plugin was installed and a
`$schema` that resolves to nothing turns validation off without saying so.
bancada never reads the key itself; it validates against the SPEC either way.

## How the settings are validated

A **wrong type** is an error. Guessing what the author meant is how a gate ends
up enforcing something nobody asked for.

An **unknown key** is a warning, not an error, so a config written for a newer
bancada still runs on an older one.

A **glob that matches nothing** is reported by `bancada doctor`, never treated
as satisfied — for `include`-shaped settings only. An `exclude` matching nothing
is the normal case and is never flagged.

A gate that is **on and guarding nothing** is reported by the validator itself:
`green` enabled with no commands, `secrets` with no pattern families, `size`
with no `source.include`, `structure` with neither layers nor an adapter, a
`flow` Pause with an empty scope. That state costs the same as a working gate
and catches nothing, so it is never allowed to be silent.

## `language`

`en` or `pt-BR`, and it changes what bancada emits, not what it enforces. Report
headings and section titles translate. Deny reasons and validator messages do
not yet: they are formatted text rather than message keys, and fixing that
properly means changing what a check returns.

## `source`

Which files are code, as your project defines code. `include` is a list of
globs and `exclude` subtracts from it.

Only the size gate consults this to decide whether it applies at all. An empty
`include` means the project has said nothing, so the size gate does not apply —
it is not read as "everything". The secret gate makes the opposite call on
purpose and judges every file, because a credential in a `.env` is exactly the
one worth catching.

## `gates.commit` — the commit message

Runs on `PreToolUse` against `git commit` on a command line, so a refusal lands
in the turn that can still fix it, before git runs.

- Conventional Commits shape, a subject-length ceiling, and the imperative mood.
  The imperative rule is morphological — gerunds and past tense — with an
  exception set, so `bring`, `embed` and `spread` are not refused for their
  endings. A project that wants a word list instead gets `denyVerbs`.
- `denyTrailers` matches regular expressions, case-insensitively, against whole
  lines of the message. This is how a project keeps attribution it never asked
  for out of its history.
- A message the gate cannot see — `-F path`, `--amend --no-edit`, a bare
  `git commit` — produces a confirmation prompt, never a verdict. `-F -` with a
  heredoc is readable and is read.

## `gates.secrets` — credentials in a write or a command

The only gate that is on by default, which is what decides its patterns.

- The `provider` and `key` families are prefix-anchored shapes an issuer hands
  out. The `generic` family, which matches things like `password = "..."`, is
  the most useful and the noisiest, and is opted into by adding it to `builtin`.
- The refusal never repeats the secret: it carries the family, the line and four
  characters of prefix.
- A value naming itself an example is not a finding.
- It judges the text a turn introduces. A credential committed before bancada
  was installed is invisible to it — that is a history scan, a different job.

## `gates.size` — a ceiling on the resulting file

- The ceiling is on the file the edit produces, not on the edit, so the gate
  reads the current contents and applies the replacement.
- An over-sized file stays editable downward. A ceiling that refuses every edit
  to a file already past it makes the only fix impossible.
- Tests get `testCeiling`, and what counts as a test is `pair.testGlobs` — the
  same definition the pair gate uses. **Set that glob for your language even if
  the pair gate is off**, or your test files answer to `maxFileLines`. The
  default is JavaScript's naming convention and matches nothing in a Python or
  Go repository.
- It applies only to files `source.include` claims, so a long fixture or a
  generated lockfile is not judged.
- There is no sweep for this one: nothing reports how many files are already
  over the ceiling you are about to choose. The stack examples record that count
  for their reference repositories.

## `gates.green` — the turn does not end on a red build

Runs on `Stop`, with its own process and its own timeout, because it runs your
type-checker and your test suite.

- `commands` run in order and the first failure stops the rest.
- `timeoutMs` is the budget for the whole boundary, not for each command. The
  hook's own timeout is the hard bound above it.
- `watch` limits which changed files are worth a run. An empty list means
  always; a non-empty one that matches nothing is reported by `doctor`.
- A command that **cannot start** is a setup problem, not a red build: it is
  reported through a system message and the turn is allowed to end. A command
  that starts and exits non-zero blocks the turn.
- Blocking is not once per session. When the model changes files and stops
  again, the boundary runs again; when nothing changed, there is nothing to
  re-check and the turn is allowed. `maxBlocks` caps that at a number of your
  own, and `0` defers to Claude Code, which overrides a hook after eight
  consecutive blocks.

## `gates.structure` — the layering

- A layer is a name, a glob, and the layers it may import from. First match
  wins, so order matters when two globs overlap.
- Imports are found by pattern, not by parsing. An import the gate cannot
  attribute is an unknown, not a violation, and `bancada check` reports how many
  it could not attribute — read that number before trusting a clean result.
  **Go's grouped `import ( ... )` block is not among the recognised shapes**, so
  a Go module needs `adapterCommand` rather than layers.
- `aliases` on a layer names specifier prefixes that also mean that layer, for
  code that imports through `@domain/` rather than a relative path. This is also
  how you fence off a dependency that is not a file here at all — give the layer
  a `match` nothing can match and the alias does the guarding, which is what
  "only `adapters/` may `require('photoshop')`" looks like. `bancada doctor`
  reports such a layer as guarding by alias rather than as guarding nothing.
- `adapterCommand` runs the project's own checker — dependency-cruiser,
  import-linter, depguard — inside `bancada check` instead of reimplementing it.
  It is not run on every edit: a whole-project analyser takes seconds, and
  seconds per edit is a tax nobody keeps paying.
- Don't hand-write the layers. `/bancada:structure` derives them from the code
  that exists, counts the violations each proposed rule would create, and writes
  the decision record next to the config.

## `pair` — the role that writes the test is not the role that writes the code

- Off by default. It reads `agent_type`, which is present inside a subagent or
  on the main thread of a session started with `--agent`; a payload without one
  is the ordinary main thread and is left alone.
- `testAgent` and `codeAgent` default to the names bancada-flow ships its roles
  under, so the two fit together without configuration.
- `testGlobs` is read by the size gate too. It is the one setting in this group
  that matters even when the gate is off.

## `flow` — the three Pauses

Declared here, enforced by the `bancada-flow` plugin, which ships disabled. With
that plugin absent these settings do nothing; they are validated anyway so that
a correctly configured project is not reported as a misconfigured one.

`scope` decides which files require a brief, and an empty scope means no Pause
ever fires. See [`plugins/bancada-flow`](../plugins/bancada-flow/) for the brief
format and the four roles.

## `telemetry`

One record per tool call, written by the dispatcher into `dir` as JSONL, read
back by `bancada yield`. Nothing on this path may change a verdict, and content
is never written — only a truncated digest, so the stream can spot the same
input being refused twice without holding the input.

Add that directory to `.gitignore`. The green boundary already ignores it when
deciding whether anything changed, but leaving it tracked puts bancada's own
writes in your `git status`.

## Every setting

Generated from the SPEC in `plugins/bancada/lib/config.mjs` by
`scripts/gen-schema.mjs`, which CI re-runs with `--check` so this table cannot
drift from what the gates enforce.

<!-- generated: settings -->

| Setting | Type | Default |
| --- | --- | --- |
| `language` | `en` or `pt-BR` | `"en"` |
| `source.include` | `string[]` | `[]` |
| `source.exclude` | `string[]` | `["**/node_modules/**","**/dist/**"]` |
| `gates.commit.enabled` | `boolean` | `true` |
| `gates.commit.conventional` | `boolean` | `true` |
| `gates.commit.maxSubject` | `number` | `72` |
| `gates.commit.requireImperative` | `boolean` | `true` |
| `gates.commit.denyVerbs` | `string[]` | `[]` |
| `gates.commit.denyTrailers` | `string[]` | `[]` |
| `gates.green.enabled` | `boolean` | `false` |
| `gates.green.commands` | `string[]` | `[]` |
| `gates.green.watch` | `string[]` | `[]` |
| `gates.green.timeoutMs` | `number` | `300000` |
| `gates.green.maxBlocks` | `number` | `0` |
| `gates.secrets.enabled` | `boolean` | `true` |
| `gates.secrets.builtin` | `string[]` | `["provider","key"]` |
| `gates.secrets.custom` | `string[]` | `[]` |
| `gates.size.enabled` | `boolean` | `false` |
| `gates.size.maxFileLines` | `number` | `400` |
| `gates.size.testCeiling` | `number` | `800` |
| `gates.structure.enabled` | `boolean` | `false` |
| `gates.structure.layers` | `layer[]` | `[]` |
| `gates.structure.adapterCommand` | `string` | `""` |
| `gates.structure.adrDir` | `string` | `"docs/decisions/"` |
| `pair.enabled` | `boolean` | `false` |
| `pair.testAgent` | `string` | `"test"` |
| `pair.codeAgent` | `string` | `"code"` |
| `pair.testGlobs` | `string[]` | `["**/*.test.*","**/*.spec.*"]` |
| `flow.enabled` | `boolean` | `false` |
| `flow.briefDir` | `string` | `"docs/briefs/"` |
| `flow.scope` | `string[]` | `[]` |
| `flow.pauses` | `string[]` | `["brief","tests","evidence"]` |
| `telemetry.enabled` | `boolean` | `true` |
| `telemetry.dir` | `string` | `".bancada/telemetry"` |

<!-- /generated -->
