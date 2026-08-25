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
`green` enabled with no commands, `secrets` with no pattern families, `size` or
`colocated` with no `source.include`, `structure` with neither layers nor an
adapter, a `flow` Pause with an empty scope. That state costs the same as a working gate
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

## What counts as a write, for the three gates that judge one

`gates.size`, `gates.structure` and `pair` all judge a file being written, and a
write tool is not the only way one happens. A session told to work through the
shell writes with `cat > file <<'EOF'`, `printf ... > file` or `sed -i`, and for
a while those three gates saw none of it: six paired payloads through the real
hook, the same violation each way, **5 of 6 refused through `Write` and allowed
through the shell**. Only `gates.secrets` saw both, because it was the only one
reading a command line.

They all read both routes now. What that means per route:

- **A write tool** — `Write`, `Edit`, `MultiEdit`, `NotebookEdit`. Fully judged.
- **A shell command carrying its own text** — a heredoc, or PowerShell's
  here-string piped into `Set-Content`. Fully judged, and the refusal is the same
  text a write tool would have earned.
- **A shell command that names a file without saying what goes in it** —
  `sed -i`, a redirect fed by another program, `cp`. The path is known and the
  resulting text is not. `pair` judges it anyway, because its verdict needs only
  the path. `gates.structure` and `gates.size` cannot, and record the gap as
  `structure-unreadable` and `size-unknown` so `bancada yield` counts how often
  they could not look, rather than the silence reading as a clean pass.
- **A program that writes files of its own accord** — `npm run build`, `make`,
  `git checkout`, a formatter. Invisible, and named as such in
  `plugins/bancada/lib/shell-writes.mjs`, which lists every shape it does not
  read and has a test per entry.

`bancada doctor` prints this split under **Write routes** whenever one of the
three gates is on, because `on structure` on its own is a claim about coverage
the gate does not have.

**The two things this does not cover.** `bancada check` sweeps the repository for
a layering violation that arrived unseen; nothing sweeps for a file over the
ceiling, so what `gates.size` misses at the hook is missed for good. And
bancada-flow's Pauses still read write tools only — the same blindness, in the
plugin that ships disabled.

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
- A file written by shell counts as a write; see [what counts as a
  write](#what-counts-as-a-write-for-the-three-gates-that-judge-one).
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
- A file written by shell counts as a write; see [what counts as a
  write](#what-counts-as-a-write-for-the-three-gates-that-judge-one).
- Don't hand-write the layers. `/bancada:structure` derives them from the code
  that exists, counts the violations each proposed rule would create, and writes
  the decision record next to the config.

## `gates.colocated` — a changed module must have its test

The one gate that asks whether a test is *missing*, which no other gate can
see: an absent test fails nothing and appears in no report. Runs on `Stop`: a
turn that changed a source file and left it untested is blocked, with each
missing test path named. It is not a write gate — a brand-new module cannot
have its test at the instant the module file is written, so refusing the write
would refuse scaffolding itself. The turn is the unit asked to contain both
halves; [decision 0003](decisions/0003-colocated-blocks-the-turn-not-the-write.md)
records the alternative and why it lost.

- A module is every file `source.include` claims, minus `source.exclude` and
  minus test files — and what counts as a test is `pair.testGlobs`, the same
  definition the size gate reads. **Set that glob for your language even with
  the pair gate off**, or your test files are themselves asked for tests.
- `patterns` spells out where the test lives, relative to the module's own
  directory: `{stem}` is the file name without extension, `{ext}` the extension
  without its dot. The default is `{stem}.test.{ext}`; Python's convention is
  `test_{stem}.{ext}`, Go's is `{stem}_test.{ext}`, and a pattern may descend
  (`__tests__/{stem}.test.{ext}`). Any one pattern resolving to a real file
  covers the module.
- `suites` declares coverage that lives elsewhere — `{ "test": path, "covers":
  [globs] }` — for the real shape where one suite exercises a directory. This
  repository covers `lib/checks/*.mjs` with `lib/checks.test.mjs` one level up.
  A suite whose test file does not exist covers nothing, and `doctor` reports
  it dead. Declarations, not import tracing: a guessed mapping wrong in either
  direction is a silent hole.
- `exceptions` accepts a gap on purpose: `{ "path", "reason", "date" }`, one
  literal file each — never a glob, so each one can be checked. They are the
  adoption path: turn the gate on with the current gaps listed and let
  `doctor` watch the list shrink. It reports an exception whose file is gone
  and one whose file has since gained a test.
- "Changed this turn" is what `git status` says — the same answer the green
  boundary reads. Declared limits: a tree already carrying an uncovered change
  when the turn began is asked for that test anyway; a turn that commits
  everything before stopping is asked for nothing; outside a git repository the
  boundary does not run and says so in a note. In every case `bancada doctor`
  still reports the whole repository's colocation, gate on or off, under
  **Test colocation** — the count, the missing files by expected path, and the
  state of every suite and exception.

## `pair` — the role that writes the test is not the role that writes the code

- Off by default. It reads `agent_type`, which is present inside a subagent or
  on the main thread of a session started with `--agent`; a payload without one
  is the ordinary main thread and is left alone.
- `testAgent` and `codeAgent` default to the names bancada-flow ships its roles
  under, so the two fit together without configuration.
- `testGlobs` is read by the size gate too. It is the one setting in this group
  that matters even when the gate is off.
- This is the one of the three write gates with no blind route at all: the
  verdict needs the path and not the text, so `sed -i` on a test file is
  refused as surely as `Edit` on one. There could be no sweep behind it
  either — which role wrote a line is not a fact the repository keeps.

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
| `gates.colocated.enabled` | `boolean` | `false` |
| `gates.colocated.patterns` | `string[]` | `["{stem}.test.{ext}"]` |
| `gates.colocated.suites` | `suite[]` | `[]` |
| `gates.colocated.exceptions` | `exception[]` | `[]` |
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
