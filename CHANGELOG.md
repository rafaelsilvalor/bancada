# Changelog

All notable changes are recorded here, per plugin. This project follows
[Semantic Versioning](https://semver.org/).

A **MAJOR** bump means one of: a gate now denies what it previously allowed,
`bancada.config.json` changed incompatibly, or an agent or skill was renamed.

## [Unreleased]

### bancada

- The commit gate's `ask` now names which unreadable form it hit and carries
  the command that would be readable, instead of the one generic sentence it
  used for all three. `-F`, `--amend --no-edit` and a bare `git commit` are
  different mistakes with different fixes: telling someone amending to run a
  plain `git commit -m` creates a second commit rather than editing the first.
  The old text asked the owner to confirm and taught nothing, so the same `ask`
  arrived again the next day; it cost a real session an interruption where the
  owner had to relay the reason back to the agent by hand, because an `ask`
  routes its text to the human and never to the caller that produced the
  command. `extractSubject` now tags the extraction with `form`
  (`file` | `reused` | `editor`) so a caller can branch on it. No decision
  changed: the three forms were `ask` before and are `ask` now.

- `scripts/measure-gate-precision.mjs`: replays a candidate gate against the
  session transcripts under `~/.claude/projects` and reports what it would have
  caught against what it would have wrongly blocked. It exists because a gate
  argued from its target's failure rate is argued from the wrong number — a
  heredoc ban was proposed on an 8.2% failure rate and measured at 10.5%
  precision against a 7.2% base rate, costing 8.6 correct blocks per catch. It
  was dropped, and so was a Write|Edit syntax validator that caught 1 error in
  four weeks while 16 of 29 arrived through the shell, where it is blind.
  Loud failures only: silent corruption that reported success is invisible to
  it, so it cannot settle a gate whose claim is about false greens.

## [0.1.0] — 2026-08-25

First release: the seven gates (commit, secrets, size, structure, green,
pair, colocated), the flow and context plugins, doctor and yield. The
standing end-to-end evidence is the full sweep on Claude Code v2.1.240
(Haiku, 13 of 13 conclusive cases), which predates the colocated gate; that
gate's end-to-end case is written into `scripts/verify-cases.mjs` and has
not been run in a paid session yet.

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

**Phase 5 - the structure gate** (partial; see what is not done, below)

- `lib/imports.mjs` and `lib/structure.mjs`: layering enforced when a file is
  written, not when it is committed and not in CI. A violation is created the
  moment a file gains an import, and refusing it there puts the reason in front
  of the model in the turn that produced it.
- Imports are found by pattern, not by parsing. An import form that is not
  recognised is not checked, rather than checked wrongly, and the shapes that
  are invisible are named in the module: dynamic specifiers built from
  variables, re-exports through a barrel, and Go's grouped import block.
- The gate will not guess. An import it cannot attribute to a layer is an
  unknown, not a violation, and the count of unknowns is reported so coverage
  is visible rather than implied. A false violation is what gets a layering
  gate switched off, after which it guards nothing.
- `bancada check`: a whole-project sweep, exiting non-zero on a violation. The
  gate covers code being written now and says nothing about what was already
  there, which is the number a project needs before deciding whether its
  layering is true or aspirational.
- `bancada doctor` now counts files per layer glob, so a layer that matches
  nothing is visible as a dead rule.
- bancada declares its own layering and passes it: `lib/` imports nothing from
  `hooks/` or `bin/`. That is the seam the portability claim rests on — if the
  judgement ever reaches into a host entry point, a second host stops being
  cheap — and it is now enforced rather than asserted.

**Phase 5b - arriving at a layering, and reusing the project's own checker**

- `/bancada:structure`: an interview that works out a layering from the code
  that exists and writes both artifacts together — the rules in
  `bancada.config.json` and the reason in an architecture decision record.
  Neither is worth much alone: rules with no recorded reason get deleted by the
  next person who finds them inconvenient, and a reason with no rules is a
  comment the code drifts away from.
- The skill counts the violations a proposed rule would create before anything
  is written, and offers the choice out loud rather than quietly proposing the
  weaker rule. A layering half the files violate on day one gets switched off by
  the end of the week.
- It is `disable-model-invocation: true`, because it writes files and because a
  skill only the owner invokes costs nothing at all in the listing budget.
- `gates.structure.adapterCommand` is now used. bancada does not reimplement
  `dependency-cruiser`, `import-linter` or `depguard`: a project already running
  one has encoded its rules there, and two copies of a rule disagree eventually.
  The adapter runs in `bancada check` rather than the write gate, because a
  whole-project analyser takes seconds and seconds per edit is a tax nobody
  keeps paying.
- A checker that is not installed is reported as a setup problem and does not
  fail the sweep. The tests caught this: with `shell: true` a missing binary
  does not surface as a spawn error — the shell starts fine and exits 127 — so
  the first version reported an uninstalled tool as a layering violation, which
  is exactly the conflation the branch exists to prevent.

**Phase 7 - the remaining gates**

- `lib/secrets.mjs`: a credential is refused in the turn that writes it, in a
  written file or on a shell command line. This is the only gate that is on by
  default, which decides what a pattern has to earn: the `provider` and `key`
  families are prefix-anchored shapes an issuer hands out — `AKIA`, `ghp_`,
  `sk-ant-`, a PEM header — and the `generic` family, which matches
  `password = "..."`, is the most useful and the noisiest and is opted into.
  A default-on refusal that fires on somebody's fixture does not get narrowed;
  it gets the whole harness switched off, and then every gate is gone at once.
- The refusal never repeats the secret. It carries the family, the line and four
  characters of prefix, because a gate whose complaint about a leaked key is to
  quote the key has leaked it a second time. A value naming itself an example is
  not a finding, AWS's own documentation key included.
- `lib/size.mjs`: a ceiling on the resulting file, not on the edit. The
  arithmetic shortcut — subtract the old lines, add the new — is wrong for
  `replace_all` and wrong for a string that occurs twice, so the replacement is
  applied to the current contents instead. A file that cannot be read gets no
  verdict under its own rule name, so the coverage gap appears in `bancada
  yield` rather than being implied.
- An over-sized file stays editable downward. A ceiling that refuses every edit
  to a file already past it makes the only fix impossible, and the first thing
  anyone does about that is delete the ceiling.
- The size gate is the one write check that asks whether the file is source at
  all, through `source.include`. Applied to everything it would refuse a long
  fixture or a generated lockfile. The secret gate makes the opposite call for
  the same reason in reverse: a credential in a `.env` is exactly the one worth
  catching, and `.env` is in nobody's source globs.
- `lib/pair.mjs`: the role that writes the code does not edit the test, and the
  role that writes the test does not edit the code. The gate reads `agent_type`,
  which the CLI documents as present inside a subagent or on the main thread of
  a session started with `--agent`. A payload without it is the ordinary main
  thread and is left alone: a session that entered no role is not doing pair
  work.
- `lib/green.mjs` and `hooks/stop.mjs`: the turn does not end on a red build.
  This is the gate docs/decisions/0001-one-dispatcher-per-event named as the one
  that stays out of the tool-call dispatcher, because it runs a type-check and a
  test suite. It has its own entry point, its own registry and its own timeout,
  and `timeoutMs` is a budget for the whole boundary rather than for each
  command. The first failure stops the rest: a type error usually makes the
  tests fail too, and reporting both makes the model fix the symptom.
- A boundary that cannot start is a setup problem, not a red build. It reports
  itself through `systemMessage` and lets the turn end, because bancada's bug
  becoming the user's work stoppage is how a harness gets uninstalled.
- One registry per event, mirroring one entry point per event.
  `hooks/pre-tool-use.mjs` imports the tool-call registry alone, so the green
  boundary's module — which reaches for `child_process` — is never loaded on a
  tool call that could not use it. The cost check now counts three buckets
  instead of two for the same reason: hot path, turn end, and CLI. The first
  recording filed the boundary under "on demand", which was wrong by however
  many turns a session has.
- `lib/writes.mjs`, `lib/run.mjs` and `lib/checks/where.mjs`: what a write tool
  is doing, how to run a configured command, and how to reconcile an absolute
  path against the project root. Four checks needed each of those, and the
  path-reconciliation one had already produced a gate that attributed nothing.

**Measured**

- Hot path 1483 → 2212 lines, tolerance exceeded, new baseline recorded on
  purpose. Latency for a `git commit` payload is 103 ms median of 11, of which
  25 ms is bancada and 78 ms is node starting up — five gates in one process,
  against the 99 ms two of them cost in the dispatcher decision.
- That latency probe was writing its eleven synthetic tool calls into this
  project's own telemetry, where `bancada yield` counted them as real. It now
  runs against a copy of the config in a throwaway directory. The gate still
  does its full work, telemetry write included; only the records land somewhere
  disposable.
- bancada's own `maxFileLines` of 300 refused two of its own files the moment the
  gate existed: `scripts/verify-hooks.mjs` at 382 lines and `lib/config.mjs` at
  309. Both were split along a seam that was already there — the case table from
  the harness, the cross-field warnings from the SPEC-derived validator — rather
  than by raising the number to fit the code.

**Verified end to end** (Claude Code v2.1.240, Haiku, each case with and without
the plugin, in a throwaway repository)

```
ok    a write carrying a credential
        denied with the plugin, allowed without it
ok    a write past the line ceiling
        denied with the plugin, allowed without it
????  the code role editing a test
        refused with and without the plugin, so this run cannot attribute it
ok    a green boundary that fails when the turn ends
        the boundary ran 2 time(s) with the plugin and 0 without
        turns: 10 with the plugin, 2 without (reported, not enforced)

9 of 9 conclusive case(s) behaved as expected.
1 case(s) inconclusive: the model never issued the command under test.
Cost of this verification: $0.7883
```

- The pair case is attributable and was attributed on its own run — "denied with
  the plugin, allowed without it" — and came back inconclusive in the sweep
  above, where the control arm refused the same write for a reason that is not
  bancada's. One conclusive run is what exists; the flakiness is in the
  attribution, not in the gate.
- The green boundary corrected something written into its own module, and then
  the correction changed the design. The comment claimed that honouring
  `stop_hook_active` meant blocking once per session; the boundary ran twice
  across ten turns, so a later stop starts a fresh sequence. Writing down what
  the gate therefore guaranteed — one check per turn end, not a green turn — is
  what made the gap impossible to leave alone. Phase 7b closes it.

**Phase 7b - the green boundary re-checks instead of standing down**

- `lib/green-state.mjs`: the one fact a single stop cannot supply — has anything
  changed since the boundary last ran. With it, `stop_hook_active` is read as a
  question rather than an instruction. It says a block is already in progress;
  the fingerprint says whether the model has done anything since. Unchanged
  means nothing could have been fixed and the turn is allowed. Changed means
  there is a new answer worth getting, and the boundary runs again.
- That closes the hole the phase 7 verification exposed: the model was told its
  tests failed, fixed them, stopped again, and was waved through unverified. The
  gate now answers "the turn ended green" rather than "the turn was checked once".
- It terminates on its own, because it is the model's own edits that buy each
  re-check: it either goes green or it stops changing files. `gates.green.maxBlocks`
  is there for a project whose suite is too expensive to run repeatedly, and
  defaults to 0 — defer to Claude Code, which overrides a hook after eight
  consecutive blocks. That number already exists and was read off the binary;
  inventing a second one here would be the failure `check-cost.mjs` exists to
  remember.
- **The fingerprint is taken after the boundary runs, not before.** A test suite
  writes a log, a coverage directory, a build cache. Taken beforehand, the next
  stop would read the boundary's own leavings as the model's progress, buy
  another run, and never stop buying them.
- For the same reason `.bancada/` is excluded from the changed-file set. The
  telemetry stream grows on every tool call and the state file is written by this
  very check, so a project that had not ignored that directory would have seen
  bancada's own writes in `git status` and re-run its test suite until the host
  intervened. Found while designing the verification case, not while running it.
- Contents are hashed rather than timestamps compared. A false negative here
  skips the check, which is the direction that costs something.
- State is scoped to the session and discarded when it belongs to another one.
  Two sessions in one checkout would otherwise read each other's fingerprints,
  and the failure mode of trusting a stranger's is skipping a check.

**Verified against a real working tree** (no API; the Stop hook driven through a
whole blocking sequence)

```
  1. first stop, build red                       ran 1, BLOCKED
  2. stop again, nothing changed                 ran 0, allowed
  3. stop after an edit that does not fix it     ran 1, BLOCKED
  4. stop after the edit that fixes it           ran 1, allowed
  5. a later stop, still green                   ran 1, allowed
  6. red again, a fresh sequence                 ran 1, BLOCKED
  7. a different session's stop                  ran 1, BLOCKED
```

Step 4 is the one that used to pass unchecked. Step 2 is what keeps step 4 from
becoming a loop.

**Verified end to end** (Claude Code v2.1.240, Haiku)

```
ok    a green boundary blocking, then passing once it is fixed
        the boundary ran 2 time(s) with the plugin and 0 without — blocked while
        red, then re-checked after the fix (took a second attempt; the model did
        not issue it the first time)
        turns: 6 with the plugin, 2 without (reported, not enforced)
```

The sandbox boundary is fixable on purpose, and the instruction for fixing it
reaches the model only through bancada's refusal. Two runs therefore means the
block landed and the re-check happened; one would have meant only that the hook
fired. It took two attempts: on the first the model did not act on the reason at
all, so this case measures the model as well as the gate.

**Phase 8b - two gaps closed, and one settled by experiment**

Three entries that were in the "Known gaps in this release" list below, taken
one at a time. They are gone from that list rather than marked closed in it:
that list is a claim about what ships, not a history, and somebody installing
v0.1.0 should not read "known gaps" and find three things that are not gaps.
Where each hole was is recorded here and, for the one that was a stated cost of
a decision, in that decision's own record.

**The green boundary terminates outside a git repository, which it did not**

`git status` was the only answer to "has anything changed since the last stop", so
in a directory that is not a repository the boundary re-ran on every stop inside a
blocking sequence and Claude Code's cap of eight consecutive blocks was what ended
it — as many as seven runs of the project's own suite bought by nothing.

The tree walk that `files.mjs` kept private is now `lib/walk.mjs`, and the
boundary fingerprints the watched tree when git declines to answer. git is not
asked twice: `git ls-files` fails in that directory for the same reason
`git status` did, so asking again would be one more subprocess per turn end to be
told so a second time.

Slower than reading one subprocess's output, and the price is the tree's size:

```
$ node scripts/measure-green-fallback.mjs
Green boundary fallback, median of 7

files    walk ms   fingerprint ms   total ms
  200          2               31         33
 1000          8              168        177
 5000         39             1222       1261
20000        155             5110       5265

20000 is the walk's ceiling, so the last row is the worst case, not a limit found by trying.
```

**Five seconds per stop at the ceiling**, against as many as seven runs of a suite
worth gating on. A `watch` list narrows both numbers together, because the
fingerprint then covers only the files the list names.

- A truncated walk produces no fingerprint at all. The subset it reached is
  arbitrary, so a digest over it can compare equal while a file outside it
  changed, and that would allow a turn the boundary meant to re-check. Unknown
  keeps meaning "run it again".
- The pre-run fingerprint is asked for and not computed alongside `git status`.
  Only a stop already inside a blocking sequence reads it, and the first version
  of this change paid for the walk on every stop, including the ones that throw
  the answer away.
- The turn-end cost bucket grew from 541 lines to 660 — 22%, inside the 25%
  tolerance, so the gate passed and nothing was ratified by it. The baseline was
  re-recorded anyway, in its own commit: leaving it at 541 would have pushed this
  increase into whichever commit next touched that path.

**`bancada yield` and `bancada doctor` no longer disagree about what they can see**

`yield` built its "never fired" list from bancada's own registry, so the one gate
it could not see belonged to the plugin with the least evidence behind it — a
Pause switched on and never fired was invisible to the report that exists to find
exactly that. `doctor` listed `flow (bancada-flow)`; `yield` did not.

Both now read one declaration, `FOREIGN_CHECKS` in `lib/checks/index.mjs`. On a
project with `flow.enabled` true and one commit-gate record in the stream:

```
$ node plugins/bancada/bin/bancada.mjs doctor --dir <project>
Gates
  on   commit
  on   secrets
  off  size
  off  green
  off  structure
  off  pair
  on   flow (bancada-flow)

$ node plugins/bancada/bin/bancada.mjs yield --dir <project>
Never fired
  secrets — registered but has not reported once. Dead weight, or never applicable here.
  size — registered but has not reported once. Dead weight, or never applicable here.
  structure — registered but has not reported once. Dead weight, or never applicable here.
  pair — registered but has not reported once. Dead weight, or never applicable here.
  green — registered but has not reported once. Dead weight, or never applicable here.
  flow (bancada-flow) — switched on in this project's config and has not reported once.
    Either nothing has matched it yet, or bancada-flow is not installed.
```

- A foreign gate is named only when the config switched it on. bancada's own
  registry is complete, so silence from one of its gates has one meaning; silence
  from another plugin's has two, and the report states both rather than choosing.
- The gate name is the sixth thing the two plugins duplicate, after the flow and
  pair defaults, the telemetry defaults, the record's key order, the glob matcher
  and the path reconciliation. It is held the same way: `pinned.test.mjs` imports
  both sides and fails on the first divergence, now including on whether
  bancada's predicate for "switched on" agrees with flow's own `pauseEnabled`.
- `docs/decisions/0002-flow-ships-its-own-dispatcher.md` recorded this
  disagreement as an unresolved cost of the split. It is marked resolved there
  rather than deleted, and its count of duplicated things — stale before this
  change, at four — is corrected to six.
- `runYield` had no test file. It has one now, which is how the default
  `knownChecks` argument turned out to need resolving after the config is read
  rather than in a default parameter.
- `bancada yield --json` changed shape: `neverFired` is now `[{ name, plugin }]`
  where it was `["name"]`. Nothing in this repository reads it, and a consumer
  parsing it had no way to say which plugin owns a gate, which is the point.

**A plugin cannot ship `.claude/rules/`. Run, not inferred**

The claim rested on the component table not mentioning it. Run instead, on Claude
Code v2.1.240: a rule file defining a codeword no model can guess, a prompt asking
for it, and every file-reading tool denied so the answer cannot come from reading
the file.

```
project .claude/rules/codeword.md      TIJOLO-4417
plugin  rules/codeword.md              "I don't have a project codeword..."
plugin  .claude/rules/codeword.md      "I don't see a project codeword..."
plugin  no rules at all (control)      "I don't see a project codeword..."
```

Each plugin also carried a `SessionStart` hook that appends to a file, so **that
the plugin loaded at all is decided by the filesystem rather than by reading a
model's answer**. The marker appeared in all three runs: the plugins loaded, their
rules did not.

A second and independent answer, from the validator, when the manifest declares
the directory instead of merely containing it:

```
$ claude plugin validate . --strict
⚠ Found 1 warning:

  ❯ rules: Unknown field 'rules'. Claude Code ignores it at load time.

✘ Validation failed (--strict treats warnings as errors)
```

- **An undeclared `rules/` or `.claude/rules/` inside a plugin passes `--strict`
  in silence.** Validation is not a way to discover this, which is part of why the
  gap survived as an inference for as long as it did.
- The consequence: writing the file into the consumer's project is the only route,
  which is what `bancada rules` was already sketched as in the CLI's usage text.
  It is still not implemented, and it is now the sketch of the only thing that can
  work rather than of the cheaper of two options.
- What this does not establish: whether a marketplace install differs from
  `--plugin-dir`. Both plugin variants were loaded from a directory. The manifest
  warning is install-path independent, which is the stronger of the two signals,
  but the behavioural half was measured on one install path only.

**Verified end to end** (Claude Code v2.1.240, Haiku, the full sweep)

```
ok    a green boundary outside a git repository
        the boundary ran 3 time(s) with the plugin and 0 without — blocked while
        red, then re-checked after the fix, with no git to ask what changed
        turns: 7 with the plugin, 2 without (reported, not enforced)

13 of 13 conclusive case(s) behaved as expected.
Cost of this verification: $0.9924
```

`makeSandbox` grew a `git: false` option for it, because the branch where git has
no answer is the one that never gets exercised by accident.

- **This case does not prove the termination it was written for.** That needs a
  stop where the model changed nothing, and no prompt can guarantee one. What it
  proves is that the walk which replaced git still blocks a red build and still
  re-checks a fixed one. `green.test.mjs` asserts the termination against a real
  filesystem instead — a temp tree, no git, the real fingerprint.
- One earlier run of this case ended with the boundary having run once, which is
  the correct verdict for a stop that changed nothing and no evidence at all about
  the branch under test. The case now offers `Write` alongside `Bash` so the model
  has an unambiguous way to act on the refusal.
- The first attempt at the sweep was thrown away. `green.mjs` was edited while it
  was running and the script loads the plugin from `plugins/` live, so the run
  measured a mixture of two versions. Killed and re-run against the final tree;
  the wasted API cost was about $0.60. Worth recording because the failure is
  invisible in a passing report.

**Known gaps in this release**

- Validation messages are English even when `language` is `pt-BR`. Section
  headings translate; the validator's own strings do not, because it returns
  formatted text rather than keys. Fixing it properly means the validator
  returning `{key, params}` — a deliberate change, not a patch.
- Deny reasons from the four new gates are English whatever `language` says.
  They are formatted text, the same shape as the validator's strings above, and
  they get fixed by the same change.
- No gate reads what is already in the repository. The secret gate judges the
  text a turn introduces, so a credential committed before bancada was installed
  is invisible to it; that is `git secrets` over history, a different job. The
  size gate has the same shape and, unlike layering, has no `bancada check`
  sweep to answer "how many files are already over" before the ceiling is
  chosen.
- bancada-flow's three Pauses judge a write tool and nothing else. bancada's
  own write gates read a shell command's heredoc as a write; the Pauses do not,
  so a file written with `cat > file` is out of scope for Pause 1 and Pause 2
  however the branch's brief reads. Same defect, in the plugin with the least
  evidence behind it, left open because closing it duplicates a 279-line module
  across the plugin boundary.
- **No minimum Node version is declared, so none is tested.** The hooks run in
  whatever `node` the host resolves, and this repository never says which
  versions that may be: there is no `engines` field and no statement in the docs.
  The newest API in any shipped file is `structuredClone`, which puts the real
  floor at Node 17, but that is a reading of the code and not a promise, and CI
  tests one version. A consumer on an older Node than the one that happens to
  work finds out from a hook that fails to load.

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

**Three write gates were walked around by writing the file with a heredoc**

- `gates.structure`, `gates.size` and `pair` accepted only the write tools, so
  the same violation was refused through `Write` and allowed through
  `cat > file <<'EOF'`. Six pairs — one intent expressed twice — through the real
  `PreToolUse` entry point in a throwaway repository,
  `scripts/measure-shell-writes.mjs`:

  ```
  gate      write tool  shell   intent                                     before / after
  structure deny        deny    a lib file gains an import from hooks         allow / deny
  structure deny        allow   the same import, appended by a redirect       allow / allow
  structure deny        allow   the same import, inserted by sed              allow / allow
  size      deny        deny    a 400-line file against a 300-line ceiling    allow / deny
  pair      deny        deny    the code role writing a test file             allow / deny
  secrets   deny        deny    a credential in a file (the control)          deny  / deny

  5 of 6 refused by the write route and allowed by the shell route, before.
  2 of 6, after — and both of those now carry structure-unreadable in the stream.
  ```

- The control row is what shows this was about the route rather than the gates:
  `gates.secrets` refused both arms all along, because it was the only write
  check reading a command line. `doctor` printed `on structure`, `on size`
  regardless, which is a claim about coverage the gates did not have.

- **This came out of the first yield data this project has had outside a test.**
  91 records from a real working session: 91 of 91 `allow`, 86 of 91 `Bash`, and
  **not one write-tool record** in a session that created two files and edited
  three. It wrote everything through the shell. Four of the six gates never
  fired, and three of those four could not have.

**What the split between the three verdicts rests on, since all three were defensible**

The population divides, so the answer divides with it, and each half follows a
rule this repository had already written down.

- **Text on the command line is judged.** A heredoc with a quoted delimiter, or
  PowerShell's here-string piped into `Set-Content`, carries both the path and
  the contents. `commit-message.mjs` already extracts a heredoc for
  `git commit -F -` on exactly that reasoning; this points the mechanism at
  three more gates, and the refusal is the same text a write tool would have
  earned.
- **Text that cannot be known is recorded, not escalated.** `sed -i`, a redirect
  fed by another program, `cp`. The commit gate answers `ask` when it cannot read
  a message, and that is right for a commit: discrete, rare, consequential. A
  write is none of those — 86 of 91 records were shell calls — and `size-unknown`
  had already decided this same question the other way: *the gate did not look,
  which is a different fact from finding nothing, and the telemetry records which
  one happened so a coverage gap shows up in `bancada yield`.* An `ask` per
  unreadable shell write is the friction-rather-than-feedback failure the yield
  report exists to detect. So the gap gets a rule name — `structure-unreadable`,
  `size-unknown` — and becomes countable.
- **`pair` has no unreadable case at all.** Its verdict needs the path and not
  the text, so `sed -i` on a test file from the code role is refused as surely as
  `Edit` on one. It is also the gate that could never have a sweep behind it:
  which role wrote a line is not a fact the repository keeps.

`bancada doctor` grew a **Write routes** section, printed whenever one of the
three is on, because `on structure` on its own was the report this whole project
is built around saying less than it looked.

**The instrument named the wrong file, and the recorded rule is what caught it**

The first pass split an in-place edit's arguments on whitespace and stopped at
the first `;`. A sed script contains one:

```
sed -i '1i import { entry } from "../hooks/entry.mjs";' src/lib/seed.mjs
```

so the last word was `../hooks/entry.mjs` and the gate judged **a file the
command does not touch**. It reported `structure-outside` where the truth was
`structure-unreadable` — a wrong answer wearing the shape of a right one, and
invisible in the pass/fail column, which said `allow` either way. It was found by
printing the rule the stream recorded next to the decision. `argumentsOf` tracks
quote state for that one reason, and a path containing whitespace is now not read
at all rather than read as two.

- `lib/shell-writes.mjs` lists every shape it does not read, and **each entry has
  a test asserting no target rather than a wrong one**. A list of limitations
  that nothing checks is a list that quietly stops being true.
- Narrowed on the same grounds: `New-Item` and `install` were dropped from the
  patterns, and a PowerShell cmdlet's path has to be the first argument or follow
  `-Path`. Left wide, they read `-ItemType Directory` as a write to `Directory`
  and `Set-Content -Encoding utf8` as a write to `utf8`.

**Measured**

- Hot path 2260 to 2674 lines against a limit of 2822 — 18%, inside the 25%
  tolerance, so the gate passed and ratified nothing. The baseline is re-recorded
  anyway, in its own commit, for the reason phase 8b re-recorded the turn-end
  bucket: leaving it would push this increase into whichever commit next touches
  the hot path. The `cli` bucket goes 1319 to 1355 against 1429, from the doctor
  section and its strings.
- Tests 505 to 559. `lib/shell-writes.mjs` is 279 lines against this project's
  own 300-line ceiling, which leaves 21.
- No new dependency, no new hook, no new event. The three checks read one more
  function; the dispatcher gained `foldOwn`, which is `fold` for the several
  files one tool call can write.

**Not closed, and not pretended to be**

- **No real session.** Every other gate change in this file carries an end-to-end
  verification through `claude -p`. This one has the real entry point spawned
  with real payloads, and the wiring tests do the same on every push — but a
  session deciding to write with a heredoc and being refused has not been
  observed. That is a run of `verify-hooks.yml`, about $1.00, and the owner's to
  spend.
- **The 91 records cannot say how common each shape is.** Design commitment 3
  hashes inputs and never records content, so the stream that proved the gap
  exists cannot say whether the shell writes in it were heredocs, redirects or
  `sed`. Whether the judged half or the recorded-gap half is the larger one is
  unmeasured.
- **`gates.size` still has no net.** `bancada check` sweeps for a layering
  violation that arrived unseen — shown in the measurement above, exit 1 on the
  file the shell wrote — and nothing anywhere answers "which files are over the
  ceiling". What the size gate misses at the hook is missed for good.
- **bancada-flow's Pauses have the identical blindness**, and are untouched.
  Pause 1 and Pause 2 read a private `WRITE_TOOLS` set in
  `plugins/bancada-flow/lib/pauses.mjs`. Closing it there means a seventh thing
  duplicated across the plugin boundary, and a 279-line module is not a fifth
  small copy — that is a decision about
  `docs/decisions/0002-flow-ships-its-own-dispatcher.md`, not a patch.
- A `>` inside a quoted string is read as a redirect, so a command echoing the
  text `see > src/lib/a.mjs` names that file with unknown contents. It allows and
  inflates the gap count; it cannot refuse, because a heredoc's destination is
  the last redirect on the line.

**A replacement string was read as a pattern, and refused a file it had inflated**

Found by being refused. An edit to `lib/writes.mjs` whose replacement text
contained a dollar-sign sequence was reported as **545 lines for a file that
would have been 157**, by this repository's own size gate, on a legitimate
change.

`resultingText` applied an edit with `text.replace(old, new)`. `String.replace`
reads a dollar sequence in a *replacement string* as a reference to the match, so
the everything-before-the-match sequence expanded to the 148 lines above it. The
gate then applied the ceiling to a file the edit would never have written.

```
current                  a b c d              4 lines
replacement              the before-match sequence
computed, before         a b a b   d          6 lines
computed, after          a b <sequence> d     4 lines
```

- It goes both ways. A sequence standing for the matched text or for a capture
  group shrinks the computed file, so the gate can approve a write that breaks
  the ceiling as easily as refuse one that does not.
- **The `replace_all` branch was already correct**, because `Array.join`
  interprets nothing. One function, two branches, and the one with the harder
  arithmetic was the right one — which is why this survived every test.
- The fix is a replacer function. The fix's own comment contains the sequences,
  so the buggy gate refused the fix; it went in through a whole-file write, which
  is the path `resultingText` answers outright. Both branches are now asserted to
  agree.

### bancada-context

**Phase 6 - context discipline**

- `/bancada-context:probe`: research in an isolated window, returning only the
  conclusion. It is a skill with `context: fork` and `agent: Explore`, not a
  custom subagent, and that distinction is the whole point — a non-fork subagent
  loads the full CLAUDE.md hierarchy and a git-status snapshot on every call,
  which is the cost a probe exists to avoid. Explore skips both by design.
- `/bancada-context:skill-new`: authoring a skill so it actually triggers. Most
  skills fail in the description, not the body, and adding one is never free.
- `bancada doctor --skills`: what the listing costs against its budget of about
  1% of the model's context window. It reports the model it assumed, because a
  listing calibrated on a 1M-token window can overflow on a 200K one.
- A skill with `disable-model-invocation` leaves the listing entirely and costs
  nothing. The meter names that lever, because it is the strongest one available
  and it is free for every skill only a person should invoke.
- An unknown model falls back to the *smallest* known window. Guessing large
  would under-report the risk, and this report exists to warn.

**Measured** (`scripts/measure-probe.mjs`, Haiku 4.5, 2 runs per arm)

The same research question, answered inline and through the probe:

```
arm      runs      billed input      output    cache read      cost USD     wall s
inline      2             38906        4014        226081        0.1195       35.6
probe       2             23955        3164        238931        0.0696       36.9
```

Delegating cost **0.58x** — cheaper, not dearer. That was not the expected
result. Anthropic's published multi-agent figures put a multi-agent system at
roughly 15x a single agent, but those describe an orchestrator fanning out to
several workers. A forked skill is a different shape: it *replaces* the main
turn rather than adding to it, and the Explore agent it runs on skips the
CLAUDE.md hierarchy and the git-status snapshot on purpose.

**What this does not measure, and cannot.** The probe mainly exists so an
ongoing conversation does not accumulate the exploration. A one-shot `-p` run
has no ongoing conversation — it ends immediately, so there is no later turn to
be cheaper. That needs a two-turn session, reading the cache-read tokens on the
second turn to see what the first left behind. Not built.

n is 2. Variance is unknown.


### bancada-flow

**Phase 8 - the three Pauses**

- There are three Pauses because there are four roles, and a Pause is a
  handover. The planner hands a brief to the test role, the test role hands a
  failing test to the code role, and the code role hands finished work back.
  Each is a point where the work changes hands and nobody has looked at it yet,
  which is the cheapest moment to look and the last cheap one.

  ```
  1  brief     nothing in scope is written until a brief exists and validates
  2  tests     the code role does not write code until a test exists
  3  evidence  a commit against an unsatisfied brief asks before it lands
  ```

- `lib/brief.mjs`: the artifact all three read. Four sections, each stopping a
  specific failure — a problem stated without its solution, criteria as
  checkboxes because Pause 3 counts the ticks, the scope that was declined so
  creep and thoroughness stop looking alike, and how it will be checked, written
  before anyone knows whether it will pass.
- A ticked criterion must carry its evidence on an indented line beneath it.
  That rule is mechanical on purpose: a tick with nothing under it is the
  assertion without the evidence, which is the one thing this project is about.
- **Pause 3 asks; it does not refuse.** An unsatisfied brief at commit time
  usually means an intermediate commit, which is ordinary. It sometimes means
  somebody is about to call unfinished work finished. The gate cannot tell those
  apart, and one that cannot tell escalates — the same rule the commit gate
  follows for a message it cannot read.
- The Pauses are ordered and the first refusal wins, which is the opposite of
  bancada's dispatcher. That is deliberate: Pause 2 has nothing to say if there
  is no brief, and Pause 3 reads a document Pause 1 is still refusing to let you
  skip. Reporting all three would report one problem and two of its consequences.
- Four roles ship as agents — `planner`, `executor`, `test`, `code` — named to
  match what `pair.testAgent` and `pair.codeAgent` already defaulted to, so the
  pair gate recognises them without configuration. Pause 2 is the only one that
  needs a role, which is why they ship together.
- `/bancada-flow:brief` authors or revises the brief for the current branch.
- Every Pause writes to bancada's telemetry stream, and every Pause that looked
  is in the record rather than only the one that spoke. This is the plugin with
  the least evidence behind it; the denominator is the half that decides whether
  the friction is worth it.

**Its own process, and the four things it copies**

- `docs/decisions/0002-flow-ships-its-own-dispatcher.md`. The split between the
  plugins is epistemic, so an unproven process gate must not be able to take down
  gates that were verified refusing real input, and people who declined it must
  not pay to parse it.
- Measured, median of 15: bancada alone 98 ms, bancada-flow alone 92 ms, both in
  parallel 114 ms. **The second process costs 16 ms** on a matching tool call,
  for a project that opted into a plugin that ships disabled.
- The first version of that measurement said 81 ms. bancada-flow was spawning
  `git rev-parse` to learn the branch — 49 ms on this machine, paid on every tool
  call to read one line of `.git/HEAD`. Reading the file took the plugin from
  more expensive than the core to slightly cheaper than it.
- A plugin cannot import from another plugin's directory without assuming where
  the host put it. A marketplace install does keep them as siblings — checked in
  the local plugin cache rather than assumed — but that is not a thing to build a
  boundary on. So bancada-flow carries its own copy of the flow and pair
  defaults, the telemetry defaults, the record's key order, the glob matcher and
  the path reconciliation. `lib/pinned.test.mjs` imports both sides and fails on
  the first divergence: the duplication is detected, not trusted.
- The knobs themselves are declared once, in bancada's `SPEC`, so a project gets
  one validator, one generated schema and one `doctor` report. bancada never acts
  on the `flow` group; leaving it out would make a correct config report an
  unknown key.

**Verified end to end** (Claude Code v2.1.240, Haiku, with and without the
plugins)

```
ok    a write with no brief for the branch
        denied with the plugin, allowed without it
ok    the same write once the branch has a brief
        allowed, as it should be

11 of 12 conclusive case(s) behaved as expected.   [the full sweep, $1.0066]
```

The one failure in that sweep was not a flow case and not a gate: on
`git commit -F some-message-file.txt` the model ran `Test-Path` first to see
whether the file existed, that check was refused by the tool allowlist, and the
run reported a denial with nothing to do with bancada. Seeding the message file
removes the variance without changing what the gate sees — a message in a file
is unreadable to a `PreToolUse` hook whether or not the file is there — and the
case then passes.

- **Both cases run against a copy of the plugin with `defaultEnabled` removed,
  and that is a real caveat.** Loading a `defaultEnabled: false` plugin with
  `--plugin-dir` loads it and leaves it off. Three `enabledPlugins` key shapes
  were tried, in `--settings` and in `.claude/settings.local.json`, and the hook
  stayed silent in all five runs. What is verified is therefore a plugin
  differing from the shipped one in one manifest field, whose only effect is
  whether the host switches it on.
- The first end-to-end run failed, and it failed for a bug every unit test had
  passed over: Write hands the hook an absolute path, `src/**` matched nothing,
  and Pause 1 read every write as out of scope and allowed it. bancada's layering
  gate shipped exactly this bug in Phase 5. Twice is a pattern, so the fix has its
  own file (`lib/paths.mjs`) and its own regression test naming both occurrences.
- Driven against a real working tree with no API, the whole sequence behaves:
  write refused before a brief, the brief itself always writable, an invalid
  brief refused with its reasons, the code role refused before a test exists, the
  same write allowed once one does, an unsatisfied brief asked about at commit,
  a tick with no evidence asked about, and a satisfied brief let through. Twelve
  steps, twelve as designed, twelve telemetry records in bancada's stream.

**What is not established**

- That any of this is worth its friction. The Pauses are enforced and verified;
  whether they catch more than they cost is unmeasured, and `bancada yield` is
  where that gets settled rather than argued.
- This repository does not switch flow on for itself. Enabling Pause 1 here would
  require a brief per branch, which is a workflow decision rather than a
  verification, so the plugin is dogfooded through its tests and not through use.

### the repository

**Phase 9 - docs and examples**

- `examples/`, promised by the repository layout since phase 1 and empty until
  now: `minimal`, `typescript`, `python` and `go`, each a `bancada.config.json`
  plus a README carrying the counts it was measured against.
- **Every glob was counted against real repositories before it was written
  down.** An example that ships a glob matching nothing is a gate that has
  silently stopped existing, which is the failure the whole project is aimed at,
  so shipping one would have been worse than shipping no examples. Seven
  checkouts, at the commits recorded per example:

  ```
  example      repository        files   source.include   pair.testGlobs
  typescript   honojs/hono         487              311              140
  typescript   nestjs/nest        2298              899              466
  typescript   vercel/commerce      79               64                0
  python       pallets/flask       237               83               48
  python       fastapi/fastapi    3140             1138              611
  go           cli/cli            1362              920              363
  go           gin-gonic/gin       131               99               40
  ```

- The measurement changed the TypeScript example before it shipped.
  `src/**/*.{ts,tsx,mts,cts}` matched 311 of 487 files in hono and **nothing at
  all** in nest, which keeps its code in `packages/*/`, or in commerce, which
  uses `app/`, `components/` and `lib/`. The shipped glob names all five
  directories and matches in all three.
- The default `pair.testGlobs` — `**/*.test.*` and `**/*.spec.*` — matches **0
  of 236** files in flask, 0 of 3139 in fastapi, 0 of 1361 in cli/cli and 0 of
  130 in gin. It is JavaScript's naming convention, and it is read by the size
  gate as well as the pair gate, so a Python or Go project on the default holds
  every test file to `maxFileLines` instead of `testCeiling`. Both stack
  examples replace it, and that is the single change worth copying out of them.
- Ceilings were chosen from the distribution rather than from the default. Go's
  ninetieth-percentile non-test file in cli/cli is 479 lines, so 400 would have
  put 74 of 548 files over on installation day; the Go example uses 500 and 1000,
  which leaves 50 and 31. Every example records that count, because nothing in
  bancada answers "how many files are already over" before you choose.

**No example enables the layering gate, and for Go that is not a preference**

Configured with `cmd`, `internal` and `pkg` as layers, against cli/cli:

```
$ bancada check --dir cli
863 file(s) in a declared layer, from git ls-files.
50 import(s) could not be attributed to a layer and were not judged.

No layering violation.
```

Those 863 files hold 8091 import specifiers. `lib/imports.mjs` saw 54 of them,
could not attribute 50, and therefore judged 4 — because 827 of the 863 use Go's
grouped `import ( ... )` block, which the module states it does not parse. The
clean result is what a gate looks like when it examined nothing, so the Go
example says to reach for `gates.structure.adapterCommand` instead. The other
examples leave the layering out for the ordinary reason: it is what
`/bancada:structure` derives from the code that exists.

**Docs**

- `docs/configuration.md`: every setting, and per gate what it refuses, when it
  asks instead, and what it cannot see. The settings table at the end is
  generated from the SPEC by `scripts/gen-schema.mjs`, which now emits two
  artifacts and checks both — a documented default that is not the default is
  the same class of lie as a schema that disagrees with the validator.
- `docs/releasing.md`: the four places a version lives, including
  `const VERSION` in the CLI, which is the one that gets forgotten.
- README gains a getting-started sequence, a documentation index, and the fact
  that a plugin cannot put a command on your `PATH`, so `bancada` is shorthand
  for a script inside the plugin directory.

**Checked by a machine, not by remembering**

- `scripts/check-docs.mjs` loads every example through the same validator the
  gates use and fails on an error or an unknown key: a knob renamed in the SPEC
  otherwise turns every example that sets it into a setting silently ignored,
  and the reader's gate is not running. It also fails when the version the CLI
  prints is not the version the manifest ships. Both were verified by breaking
  them on purpose — a typo'd knob, a wrong type, and a bumped `VERSION` — before
  being verified passing.
- What it cannot check is whether a glob still matches anything in a repository
  it has never seen. Only `bancada doctor`, run where someone works, answers
  that, which is why the counts and their commits are recorded per example.
- CI gains both checks; the hygiene job now runs four.

**Not done, and not pretended to be**

- **The release is not cut.** No version was bumped, no `[Unreleased]` section
  was closed, and no tag exists. `claude plugin tag --dry-run` was run for all
  three plugins and reports that each manifest agrees with its marketplace
  entry, which is the last check before tagging rather than the tagging.
- The marketplace install path in the README is written from the CLI's own help
  and has never been run: there is no published remote to run it against. Every
  end-to-end verification in this file loaded the plugin from disk.
- No `gates.green.commands` in any example was executed against its reference
  repository. What is verified about that gate here is one property, driven
  through the real hook: a command that cannot start is reported as a setup
  problem and the turn is allowed to end.
- `bancada doctor` reports `pair.testGlobs` as guarding nothing even when both
  gates that read it are off, which is how the `minimal` example looks in a
  Python repository. The line is true and, in that configuration, useless.
- The examples were measured on one machine, at one commit per repository, with
  `git ls-files` as the file universe. A repository whose `.gitignore` differs
  will count differently.

**Self-hosting the gates**

- `.claude/settings.json` registers bancada's `PreToolUse` and `Stop` hooks
  against the scripts in this repository, so a session working on bancada is
  gated by bancada. Until now the project's own `denyTrailers`, layering and
  ceilings held by the discipline of whoever was typing: an audit of all 28
  commits found no attribution trailer and one author, but nothing had been
  enforcing that, which is the difference the README's first paragraph is about.
- This registers the hooks, not the plugin. Skills, agents and commands do not
  load this way, and they are not what self-hosting is for. A plugin loaded with
  `--plugin-dir` cannot be reached by `enabledPlugins`, and adding a local
  marketplace is refused by enterprise policy on the machine this was built on,
  so pointing the hooks at the files directly is the honest route rather than a
  workaround.
- One false refusal had to be fixed first, and it was found by asking what
  self-hosting would do rather than by reading. Ten realistic payloads were put
  through the real hooks against the real config: nine were correct — a layer
  crossing refused, an assistant trailer refused, a message in a file escalated,
  an 836-line CHANGELOG allowed because it is outside `source.include` — and one
  was wrong. The secret gate refused an edit to `secrets.test.mjs`, on a
  connection string that had been pasted in whole while every other fixture in
  that file was assembled from parts to avoid exactly this.
- That file now checks itself. Its last test scans its own source and fails if
  the default families find anything, because the comment saying "assemble every
  fixture from parts" was written in the same commit as the fixture that ignored
  it. A rule the suite enforces on itself does not depend on the next person
  reading the comment.
- What this does not fix: a logic bug that makes a hook return `deny` rather
  than throw would lock the session, since the matcher covers the write and
  shell tools needed to undo it. `runGate` turns any throw into an abstention,
  which is why self-hosting is safe against crashes but not against a confident
  wrong verdict. The way out is outside Claude Code.

**Phase 10 - full CI**

**The question was which defects reach `main` with nothing complaining, not
which jobs could be added.** Ten defects a person could plausibly commit were
written into the tree one at a time, and all nine checks the previous CI ran were
run against each — the 457 unit tests, the four hygiene scripts, and
`claude plugin validate --strict` on the marketplace and on each of the three
plugins. The before column was measured on a fresh clone of `97b2d84`, so it is
the previous CI and not this one with parts switched off. What noticed:

```
                                                        before  after
a hook entry point stops emitting its deny              MISSED  test
the Stop entry point stops emitting its block           MISSED  test
bancada-flow's entry point cannot load                  MISSED  test
bancada-flow's entry point stops emitting its deny      MISSED  test
hooks.json points at a script that does not exist       MISSED  test
the CLI cannot load                                     MISSED  test
a layering violation in a file nothing imports          MISSED  bancada check
a test file outside plugins/*/lib/ never runs           MISSED  test
a hook entry point cannot load                          cost    test
a script under scripts/ cannot load                     cost    cost
```

**Eight of the ten met nothing.** The two the cost check caught, it caught by
accident and not by looking: `check-cost.mjs` walks each entry point's import
closure, so a broken import moves files out of one bucket and into another, and
the *receiving* bucket grows past its tolerance. A typo in a leaf import, which
moves few enough lines to stay inside 25%, would have passed.

The common shape of the six that involve an entry point: everything under `lib/`
tests judgement — a payload in, a verdict out — and nothing tested the lines that
carry that verdict to Claude Code. Deleting
`if (verdict.decision === "deny") deny(verdict.reason)` from the tool-call
dispatcher leaves a plugin that refuses nothing at all, and left 457 tests green.

**What was added, all of it inside jobs that already existed**

- `plugins/bancada/hooks/wiring.test.mjs` and
  `plugins/bancada-flow/hooks/wiring.test.mjs`: 22 tests that read the command
  out of `hooks/hooks.json`, substitute `${CLAUDE_PLUGIN_ROOT}` the way the host
  does, spawn it with a payload on stdin, and read the exit code and the streams
  the way the host reads them. Each runs in a throwaway git repository, because a
  real spawn writes real telemetry and a run against this repository would put
  synthetic tool calls into the stream `bancada yield` reports on.
- Deriving the command from `hooks.json` is what closes the manifest hole.
  `claude plugin validate --strict` validates a plugin's manifest; it does not
  open `hooks/hooks.json`. A malformed one fails the per-plugin validation and
  passes the marketplace validation, and a well-formed one naming a script that
  does not exist passed both.
- `bancada check` now runs in the hygiene job, which is the product's own sweep
  pointed at the repository that ships it. The `PreToolUse` gate already refuses
  a violation in the turn that writes one — that is the whole argument for
  gating at the hook — but only for a turn that went through the hook. A
  violation arriving by merge, from an editor without the plugin, or from a
  session with the plugin switched off met nothing.
- The test glob widened from `plugins/*/lib/**/*.test.mjs` to
  `plugins/*/**/*.test.mjs`. Under the narrower one an always-failing test
  dropped in `hooks/` was collected by nothing and reported by nothing; it was
  measured passing CI. Both globs matched the same 26 files before the two
  wiring files were added, so the widening changed nothing except where a future
  test file is allowed to live.
- No new job, and no new dependency. Median of three runs on this machine, at
  `62db6d8` — the commit that made the change, before anything merged on top of
  it:

  ```
  $ node --test "plugins/*/lib/**/*.test.mjs"     457 tests   1662 ms
  $ node --test "plugins/*/**/*.test.mjs"         479 tests   7493 ms
  ```

  Both counts have grown since and neither reproduces today. What the pair
  measures is what widening the glob cost, not what the suite happens to hold.
  The 5.8 seconds buys 17 throwaway git repositories and 23 spawns of an entry
  point, paid once per operating system inside a job that was already running.
- All four cost buckets are unchanged at 2257 / 660 / 934 / 1143 lines. A test
  file is in no entry point's import closure, so none of this is paid by anyone
  running the gates.

**One thing the wiring test pinned rather than fixed.** With `flow.enabled`
false — the state of a project that enabled the plugin and switched the Pauses
off — the hook allows, says nothing to the host, and still appends a record
saying `pause-none`. That is one write per matching tool call to a project the
Pauses are doing nothing for. It is arguably correct, because the stream is what
answers "did this Pause ever look" and silence cannot answer it, and it is
arguably a cost nobody agreed to. The test states the behaviour so that changing
it has to be a decision.

**The paid sweep gets a button, not a schedule and not a label**

`.github/workflows/verify-hooks.yml` runs `scripts/verify-hooks.mjs` on
`workflow_dispatch` only. The three sweeps recorded above billed $0.7883,
$0.9924 and $1.0066 on Haiku, so **about $1.00 a run**, and the workflow fails
with that number rather than skipping when `ANTHROPIC_API_KEY` is absent — a run
that quietly did nothing and reported success is the silent coverage gap the
fourth design commitment forbids.

- **Not on a label or on `pull_request`.** The script needs a credential, and a
  fork's pull request cannot read secrets. A label trigger would therefore
  either fail for the contributors it is meant to serve, or be written with
  `pull_request_target` plus a checkout of the pull request's head — which runs a
  stranger's code with this repository's API key. That is an exfiltration path
  bought for $1 of coverage.
- **Not on a schedule**, and that is a decision left open rather than one taken.
  The case for one is real: the hook contract lives in Claude Code, not here, and
  it has moved under this project twice — `pluginConfigs` stopped being read from
  project settings in v2.1.207, and the `ask` path turned out to be exit 0 with
  JSON on stdout. A cron entry is what catches the third one without a human
  remembering. It is also a standing charge, about $12 a year monthly or $52
  weekly, and whose money that is decides it.
- What running it on a runner buys over running it locally is a frozen tree. The
  script points `--plugin-dir` at `plugins/` live, so editing the plugin during a
  sweep makes the report mix two versions and look like a clean pass — already
  paid for once, at about $0.60.
- **This workflow has never been run.** The script has, three times, on Windows.
  What is untested is the file: the secret plumbing, the CLI install, and whether
  `claude -p` behaves the same in a container. Recorded here rather than
  discovered by the first person to press the button.

**Considered and not added**

- **A second Node version in the matrix.** Nothing in this repository declares a
  minimum Node version — no `engines`, no statement in the README or the docs —
  so a second leg would test a contract nobody has written down, and picking one
  in a CI file would make a guess look like a decision. That is the failure
  `check-cost.mjs` exists to prevent, applied to a version floor instead of a
  line count. What the shipped code actually needs was measured: the newest API
  in any file inside an entry point's closure is `structuredClone`, which is Node
  17, and `path.matchesGlob` is named only in the comment explaining why it is
  not used. The floor is therefore low and untested, and the two facts are
  separate: the *product* needs Node 17 or later, while `node --test` with a glob
  pattern needs Node 21 or later and is a fact about this CI, not about bancada.
  The instrument is in place — the wiring tests spawn the entry points on
  whatever Node the matrix supplies — so declaring a floor is all that is left,
  and it is the owner's to declare.
- **A syntax check over the scripts CI never runs** — `verify-hooks.mjs`,
  `verify-cases.mjs`, `measure-green-fallback.mjs`, `measure-probe.mjs`. A break
  in one of those announces itself on the next run, at no cost and with no
  ambiguity, so a job to find it earlier buys a few seconds on every pull request
  for the rest of the project's life.
- **A separate job for `bancada check`.** One second of work behind fifteen
  seconds of runner start. It is a step in `hygiene`, which is where the other
  repository-wide invariants are.

**A layer can guard without matching a file, and doctor said otherwise**

- `bancada doctor` called `gates.structure.layers[i].match` dead whenever it
  matched no file. But `targetLayer` also attributes a *bare* specifier to a
  layer through that layer's `aliases`, so the configuration that expresses
  "only `adapters/` may `require('photoshop')`" is a layer whose `match` is
  deliberately unmatchable — the import target is not a file in the repository.
  The one report that has to be worth trusting was printing a false line about a
  rule that works.
- The rule does work. Five cases through `checkLayering`, against that layering:
  `require('photoshop')`, `import ps from 'photoshop'` and `require('uxp')` are
  refused outside the adapters layer and allowed inside it — **5 of 5 behaved as
  the rule requires**, before anything was changed. The report was the only
  thing wrong.

  ```
  $ node plugins/bancada/bin/bancada.mjs doctor        # before
    no matches  gates.structure.layers[2].match  — this setting guards nothing

  $ node plugins/bancada/bin/bancada.mjs doctor        # after
    no file matches  gates.structure.layers[2].match  — guarding 2 bare specifier(s) by alias
  ```

- The layer gets its own line rather than being folded into the covered count. A
  `0 file(s)` row would be true and would still read as a glob somebody should go
  fix, which is the same false alarm in quieter type.
- Design commitment 4 keeps its teeth. A layer with an unmatchable `match` and no
  `aliases` guards nothing, still warns, and still lands in
  `summary.emptySettings`; only a layer that declares at least one alias is
  spared. Both branches have a test, so the exemption cannot widen by accident.
- The alias count is carried on the coverage entry rather than recomputed in
  `doctor`, because `globSettings` is where the layer is already being read and a
  second reader is a second thing to keep in step.

**A mistyped flag was a confident report about the wrong project**

- `bin/bancada.mjs` read its arguments in a loop whose last branch pushed
  anything it did not recognise onto a list nothing ever read. So an invented
  flag and a typo both ran the command against the current working directory and
  printed a whole report about a project the caller had not named. Measured at
  `4c1d93c`, from a pristine bancada checkout, against a three-file throwaway
  repository:

  ```
  $ bancada doctor --dir <throwaway> --json
    configSource=file  fileCount=3    gatesOn=["commit","secrets"]                  exit=0

  $ bancada doctor --project <throwaway> --json
    configSource=file  fileCount=121  gatesOn=["commit","secrets","size","structure"]  exit=0

  $ bancada doctor --dirr <throwaway> --json
    configSource=file  fileCount=121  gatesOn=["commit","secrets","size","structure"]  exit=0

  $ bancada doctor --dir                    # the flag with no value
    exit=0
  ```

- Rows two and three are the defect, and `121` is this repository, not the
  throwaway. A config source, a file count and a gate list are what a working
  report looks like, so **the wrong answer was indistinguishable from the right
  one** — in the one command the README tells people to run first. It was found
  by a session that assumed `--project` existed, read the wrong report, and
  worked around it by changing directory rather than noticing that its flag had
  been dropped.

- Same four invocations, after:

  ```
  $ bancada doctor --dir <throwaway> --json
    configSource=file  fileCount=3    gatesOn=["commit","secrets"]   exit=0

  $ bancada doctor --project <throwaway> --json
    bancada: unknown flag "--project"                                exit=2

  $ bancada doctor --dirr <throwaway> --json
    bancada: unknown flag "--dirr"                                   exit=2

  $ bancada doctor --dir
    bancada: flag "--dir" needs a value: --dir <path>                 exit=2
  ```

- An unknown flag is now refused the way an unknown command already was: exit 2,
  the offender quoted, the usage printed. Both go through one emitter and are
  decided by one reader, so they cannot end up with different exit codes later.
  The wiring test compares the two exit codes against each other rather than
  writing either of them down.

- `--dir` pointing at something that is not a directory was in scope after all.
  It did not refuse; it fell through to the defaults and reported on them —
  `--dir <a file>` exited 0 with "running on defaults" and "0 file(s) from a
  directory walk", which is a report about nothing that reads like a report about
  something. It now says `no such directory` or `not a directory`. That refusal
  skips the usage text, because a wrong path is not a mistyped invocation; the
  exit code is the same.

- The reader is `lib/args.mjs`, a new module rather than a home in
  `lib/config.mjs`, which is at 291 lines against this repository's own 300-line
  ceiling. It is the only copy: `doctor`, `yield` and `check` all take `--dir`,
  and three readers is how one of them ends up disagreeing with the other two.

- The spec is data, and a flag carries its effect next to its spelling, so a flag
  cannot be accepted by the parser and then dropped by whatever reads the result
  — the same defect one layer down. Flags are declared per command, which is why
  `bancada yield --skills` is refused by name instead of printing a report
  missing the section that was asked for.

- Also refused now: a bare argument where a flag belongs, and a value-taking flag
  whose value is another flag. `--dir --json` used to set the project directory
  to the string `--json`.

- Beyond the brief, and found while writing the spec: `bancada --help` and
  `bancada -h` exited 2 with `unknown command "--help"`. `--version` was already
  read where a command belongs; `--help` was the one place the CLI refused
  something it plainly understood.

- Cost: the `cli` bucket goes from 1161 to 1319 lines against a limit of 1429, so
  the recorded baseline of 1143 is unchanged. Tests go from 483 to 505 — eighteen
  in `lib/args.test.mjs` for what the reader decides, four in
  `hooks/wiring.test.mjs` for whether the decision reaches the caller, including
  one that walks the declared commands and fails if any of them falls past the
  dispatch.

**Phase 11 - the colocated-test gate: a missing test is a visible gap**

- The seventh gate, and the first that judges an absence. Every other gate
  reads something that exists — a commit message, a written file, a red build —
  so a module nobody tested fails nothing, refuses nothing and appears in no
  report. Measured in a consumer repository before this was built: 13 of the 30
  traps its gotcha catalog documents were guarded by no test at all, 10 of
  those because the module had no test file, and all six existing gates fully
  enabled would have caught **0 of the 13**.
- The rule: every file `source.include` claims (minus `source.exclude`, minus
  test files as `pair.testGlobs` defines them) has a test found by
  `gates.colocated.patterns` next to it, is covered by a declared suite, or is
  excepted on purpose. Enforced on `Stop` — a turn that changed a source file
  and left it untested is blocked with each missing test path named. Not at
  `PreToolUse`, because a brand-new module cannot have its test at the instant
  the module file is written; the creation-order argument and what the choice
  costs are docs/decisions/0003-colocated-blocks-the-turn-not-the-write.md.
- Coverage that lives elsewhere is declared, not guessed:
  `suites: [{ test, covers }]`. A suite whose test file does not exist covers
  nothing and `doctor` reports it dead. Exceptions are one literal path each,
  with a required reason and date — the adoption path is switching the gate on
  with the current gaps written down, and `doctor` reports an exception whose
  file is gone and one whose file has since gained a test, so the list can only
  shrink out loud.
- `bancada doctor` grew a **Test colocation** section, printed whenever
  `source.include` is non-empty, gate on or off: modules counted against
  tested, excepted and missing, each missing file named with the path its test
  was expected at, plus dead suites and stale exceptions. The prose list caps
  at 20 files; the count never does, and `--json` carries every path.
- Pointed at the consumer repository that motivated it, with
  `source.include: ["press/**/*.mjs"]` and default settings, the report names
  **13 of 23 modules** as missing tests — the same 13 files the unguarded traps
  live in, matched exactly against the list drawn from the catalog by hand.
- Run on this repository, the gate found its own medicine bitter twice. The
  same-directory rule alone would have flagged 31 of 56 modules, 20 of them
  falsely — tested by `checks.test.mjs` one level up, by the wiring tests that
  spawn the entry points, or by bancada-flow's pinned-duplicate tests — which
  is why `suites` exists. After eight suite declarations and one new colocated
  test (`lib/files.test.mjs`), the honest remainder is **50 of 60 modules
  tested, 10 excepted, 0 missing**: the ten exceptions are the `scripts/`
  utilities, each dated 2026-08-25.
- The size gate refused this work mid-flight: `scripts/verify-cases.mjs` was
  already past the 300-line ceiling and the new end-to-end case could not be
  added until the sandbox moved to `scripts/verify-sandbox.mjs`.
  `lib/config.mjs` was split the same way (`lib/config-types.mjs` now holds the
  leaf-type validators) to make room for the two new structured types.
- `lib/files.mjs` stopped listing a worktree-deleted file as present:
  `git ls-files --cached` keeps a file the working tree no longer has until the
  deletion is staged, so a test removed with `rm` kept counting as coverage
  until the next commit. The deleted set is now subtracted, and the wiring for
  it is a real throwaway repository in `lib/files.test.mjs`.
- Cost: the turn-end bucket goes from 660 to 977 lines, recorded in the
  baseline as a decision. The added work per stop is a `git status`, a
  `git ls-files` and set lookups; no state rides between stops, because
  re-checking is always affordable and Claude Code's cap of eight consecutive
  blocks is the backstop. Tests go from 559 to 611.
- Verified at the spawned-hook level in `hooks/wiring.test.mjs`: the declared
  `Stop` hook, fired at a real sandbox repository, blocks with the missing path
  in the reason and allows on the very next stop once the test file exists,
  untracked and uncommitted. **Not verified end to end in a paid session**: the
  case is written into `scripts/verify-cases.mjs` (block, then the model writes
  the named test), but the sweep costs about $1.00 a run and has not been run
  for this gate. The next button press covers it.
- Declared limits, all in the decision record: "changed this turn" is what
  `git status` says, so a turn that commits everything before stopping is asked
  for nothing, and a tree already carrying an uncovered change when the turn
  began is asked for it; outside a git repository the boundary does not run and
  says so in a note on every stop.
