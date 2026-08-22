# One dispatcher per event, not one hook per gate

Status: accepted, 2026-08-22

## The question

bancada will end up with several cheap `PreToolUse` gates — commit messages,
secrets, file size, layer boundaries. Each could be its own entry in
`hooks.json`, or they could share one entry point that decides which checks
apply and folds their verdicts.

## What was measured

Claude Code's hooks reference settles the execution model:

> All matching hooks run in parallel. If you define the same handler in more
> than one settings file, it runs once.

So the cost of N hooks is not N startups end to end. But parallel is not free
either. Spawning N copies of the commit gate on a 12-core machine:

```
gates  parallel   serial   ratio
    1        99ms       95ms  0.96x
    2       123ms      185ms  1.50x
    3       157ms      274ms  1.75x
    5       220ms      470ms  2.14x
```

Five gates as five hooks cost 220 ms. The same five checks inside one process
cost about 99 ms, because 83 ms of any single run is node starting up and that
is paid once. The saving is roughly 120 ms on every matching tool call, and it
gets worse on a machine with fewer cores than this one — a CI container or a
laptop has less headroom to absorb five simultaneous process starts.

## The decision

One entry point per event. It loads the config once, runs whichever checks are
enabled and applicable, folds the verdicts, and emits a single decision.

Latency is the smallest of the three reasons.

**Verdict combination becomes ours.** The documentation states that matching
hooks run in parallel; it does not state how conflicting decisions combine when
one denies and another allows. Depending on undocumented behaviour for the
answer to "was this commit refused" is not acceptable in a tool whose whole
claim is that its refusals are deterministic. Inside one process the fold is
explicit: deny beats ask beats allow.

**Telemetry stays coherent.** Five processes appending to one JSONL is five
writers racing, which is exactly how a reader ends up parsing a half-written
line. One process writes one record per tool call, carrying every check that
ran and what each decided — which is also the shape the yield report needs.

**Config is read once** instead of once per gate.

## What stays separate

Gates on different events, and gates whose cost is dominated by their own work
rather than by starting node. The green boundary runs a type-check and a test
suite; it belongs on `Stop`, with its own timeout, and folding it into a
`PreToolUse` dispatcher would be wrong on both counts.

## What this costs

A dispatcher is a place for coupling to accumulate: a check that reaches into
another check's state, or an ordering that quietly becomes load-bearing. The
mitigation is that each check stays a pure function from `(input, config)` to a
verdict, tested on its own, and the dispatcher only folds. If a check ever needs
to know what another check decided, that is the signal the boundary was drawn
wrong.

## Correcting the record

An earlier estimate in this project put five separate hooks at around 400 ms,
by assuming they ran one after another. They do not. The real figure is 220 ms
against 99 ms. The decision is the same; the reason is not, and "it is much
faster" was overstated by more than double.
