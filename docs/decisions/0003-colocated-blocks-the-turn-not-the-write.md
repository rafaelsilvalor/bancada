# The colocation gate blocks the turn, not the write

Status: accepted, 2026-08-25

## The question

The seventh gate asks a question none of the other six can: is a test
*missing*? Every other gate judges something that exists — a commit message, a
written file, a red build. An absence fails nothing and appears in no report.

Where should that question be asked? The two candidates were the same two every
gate chooses between: `PreToolUse`, refusing the write that creates or edits an
untested module, or `Stop`, blocking the end of a turn that leaves one behind.

## What was measured

In one consumer repository (tyto, a rendering tool with a measured-gotchas
catalog), 13 of its 30 documented traps were guarded by no test at all, 10 of
those because the module had no test file. All six existing gates, fully
enabled, would have caught 0 of the 13. The colocation report over that
repository's `press/**/*.mjs` names 13 modules of 23 as missing a test — the
same 13 files the catalog's unguarded traps live in.

In this repository, at the commit where the gate landed: 31 of 56 source
modules had no test named `<stem>.test.<ext>` next to them. 20 of the 31 were
genuinely tested — by a suite one level up (`lib/checks.test.mjs` over
`lib/checks/*.mjs`), by the wiring tests that spawn the entry points, or by the
pinned-duplicate tests in bancada-flow. A same-directory rule with no way to
say "covered elsewhere" would have flagged this project's own repository 20
times falsely, so the mechanism is part of the gate, not an afterthought.

## The decision

The gate runs on `Stop`. At the end of a turn, every source file the turn
changed must have its test — colocated by pattern, covered by a declared suite,
or excepted on purpose — and a turn that leaves one behind is blocked with the
missing paths named.

`PreToolUse` was considered and rejected, and the reason is creation order. A
brand-new module cannot have its test at the instant the module file is first
written: whichever of the pair is written first, the other one does not exist
yet. A write-time deny therefore refuses the dominant, legitimate flow —
scaffold the module, then write its test — at the first keystroke, and it
refuses every edit to a module whose test does not exist yet, including the
edits that are part of fixing exactly that. The write is the wrong unit of
account. The turn is the unit that can fairly be asked to contain both halves,
which is the same reasoning that put the green boundary on `Stop` in decision
0001 — there for cost, here for causality.

Two supporting choices, made for the same visibility reasons the rest of the
project runs on:

- **Suites are declarations, not discovery.** bancada does not trace imports to
  guess which test covers which module; a wrong guess in either direction is a
  silent hole. The project declares `{ test, covers }`, `doctor` counts what
  each `covers` glob matches, and a suite whose test file no longer exists
  covers nothing and is reported dead.
- **Exceptions are literal paths, dated and reasoned.** A glob exception is a
  standing blind spot that grows to fit whatever lands under it. A literal path
  can be checked: `doctor` reports an exception whose file is gone and one
  whose file has since gained a test, so the adoption list — turn the gate on
  with the current gaps written down — can only shrink out loud.

## What this costs

- **The turn-end bucket grows.** The `Stop` closure went from 660 to 977 lines,
  recorded in `cost-baseline.json` as a decision rather than a drift. The added
  work per stop is a `git status`, a `git ls-files` and set lookups — no suite
  run — so no green-boundary-style state is kept between stops: re-checking is
  always affordable, and a stop that fixed nothing is re-blocked until Claude
  Code's cap of eight consecutive blocks ends the sequence.
- **"Changed this turn" is what `git status` says**, the same answer the green
  boundary reads. Two declared limits follow. A working tree that already
  carried an uncovered change when the turn started is asked for that test even
  though this turn did not write it. And a turn that commits everything before
  stopping shows a clean status and is asked for nothing — the gap does not
  hide, because `doctor` reports the whole repository's colocation whatever the
  boundary saw, but the block will not fire.
- **Outside a git repository the boundary does not run.** There is no answer to
  "what did this turn touch", and judging the whole tree instead would block
  the turn for every gap the repository already had. It says so in a note on
  every stop rather than passing silently, and the report in `doctor` still
  counts the gap.
