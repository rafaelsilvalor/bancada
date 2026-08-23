# bancada-flow runs its own process, and duplicates six small things to do it

Status: accepted, 2026-08-23

## The question

`docs/decisions/0001-one-dispatcher-per-event.md` settled that bancada runs one
entry point per event rather than one hook per gate, and the reasons were
verdict combination, coherent telemetry, and latency. bancada-flow adds three
more `PreToolUse` checks. By that decision they belong in the same process.

Putting them there means the opinionated process's code runs inside the core
plugin, on every tool call, for everyone. Keeping them out means a second
process on the same event — the thing the earlier decision argued against — and
a plugin that cannot import the first plugin's code.

## What was measured

Spawning both hooks, in parallel, on the same payload, median of 15:

```
  bancada alone          98 ms
  bancada-flow alone     92 ms
  both, in parallel     114 ms
```

The second process costs **16 ms** on a matching tool call, and only for a
project that installed a plugin that ships disabled.

The first version of that measurement said 81 ms. bancada-flow was spawning
`git rev-parse` to learn the current branch, which on this machine costs 49 ms,
paid on every tool call to read one line of `.git/HEAD`. Reading the file
instead took the plugin from more expensive than the core to slightly cheaper
than it. The measurement is what found that; the number would otherwise have
gone into this document as the price of the decision, when it was the price of a
subprocess nobody needed.

## The decision

bancada-flow ships its own `PreToolUse` entry point.

**The split is epistemic and it has to survive contact with the code.** The
README says what has proof goes in the core and what has only conviction goes in
a package you opt into. The three Pauses have no measurement behind them at all.
Putting their code inside the process that runs the commit gate means a bug in
an unproven process gate can take down gates that were verified refusing real
input — and it means everyone pays to parse it, including the people who
declined it.

**16 ms is a price the opted-in can pay.** It is not free and it is not
recovered anywhere; it is simply smaller than the thing it buys.

## What gets duplicated, and why that is acceptable

A plugin cannot import from another plugin's directory without assuming where
the host put it. A marketplace install does keep them as siblings — that was
checked in the local plugin cache rather than assumed — but an install layout
nobody documented is not a thing to build a plugin boundary on.

So bancada-flow carries its own copy of six small things: the `flow` and `pair`
defaults, the telemetry defaults, the telemetry record's key order, the glob
matcher, the path reconciliation, and the gate name it writes into the shared
stream. The last two arrived after this decision was accepted, which is the
duplication doing exactly what was expected of it: growing where the boundary
is, and being caught by the test rather than by somebody noticing.

The mitigation is the same one this project uses everywhere else: the
duplication is not prevented, it is detected. `plugins/bancada-flow/lib/pinned.test.mjs`
imports both sides and fails on the first divergence. Those tests can only run
in this repository, which is the right place for them — a consumer never sees
the two copies, only the behaviour they are pinned to agree on.

One thing is deliberately not duplicated. The knobs are declared once, in
bancada's `SPEC`, so a project gets one validator, one generated JSON Schema and
one `doctor` report. bancada never acts on the `flow` group; it only validates
it. Leaving it out of the SPEC would make a correctly configured project report
an unknown key.

## What this costs

Two processes means two writers on one telemetry stream. `telemetry.mjs` already
states that short appends do not interleave in practice and that the reader
counts damaged lines rather than trusting they cannot happen, so the risk is
bounded and visible rather than assumed away. It is still a real change: the
stream now has two writers where the earlier decision was partly justified by
having one.

`bancada yield` named gates that never fired from bancada's own registry, so
flow's Pauses appeared in the report only once they had fired at least once. A
Pause that was switched on and never fired was therefore invisible to the report
that exists to find exactly that. `bancada doctor` covered half of it — it listed
`flow (bancada-flow)` as on — but the two reports disagreed about what they could
see.

**Resolved, after this decision was accepted.** Both reports now read one
declaration, `FOREIGN_CHECKS` in bancada's `lib/checks/index.mjs`, and the gate
name became the sixth thing pinned across the boundary. It is left in this
document rather than deleted because it was a real price of the split, paid for a
while: the second writer on the stream was visible to the reader from the start,
but what that writer was *supposed* to have written was not.
