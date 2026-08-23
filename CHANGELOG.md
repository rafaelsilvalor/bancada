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

**Known gaps in this release**

- Validation messages are English even when `language` is `pt-BR`. Section
  headings translate; the validator's own strings do not, because it returns
  formatted text rather than keys. Fixing it properly means the validator
  returning `{key, params}` — a deliberate change, not a patch.
- Whether a plugin can ship `.claude/rules/` was established by omission from the
  official component table, not by experiment. **Settled by experiment at the end
  of this release: it cannot.**
- Deny reasons from the four new gates are English whatever `language` says.
  They are formatted text, the same shape as the validator's strings above, and
  they get fixed by the same change.
- The green boundary trusted `git status` to say what changed. In a directory that
  is not a git repository it could not tell, so it re-ran on every stop inside a
  blocking sequence and relied on the host's cap to end it. **Closed at the end of
  this release.**
- `bancada yield` named gates that never fired from bancada's own registry, so a
  Pause that was switched on and never fired was invisible to the report that
  exists to find exactly that. `doctor` covered half of it by listing
  `flow (bancada-flow)`; the two reports disagreed about what they could see.
  **Closed at the end of this release.**
- No gate reads what is already in the repository. The secret gate judges the
  text a turn introduces, so a credential committed before bancada was installed
  is invisible to it; that is `git secrets` over history, a different job. The
  size gate has the same shape and, unlike layering, has no `bancada check`
  sweep to answer "how many files are already over" before the ceiling is
  chosen.

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

### Two gaps closed, and one settled by experiment

Three entries from the "Known gaps in this release" list in the `bancada` section
above, taken one at a time. Each is marked there as well, so the list is not left
asserting something that has stopped being true.

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
