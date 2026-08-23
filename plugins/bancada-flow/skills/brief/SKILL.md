---
description: Write or revise the brief for the current branch, the document all three Pauses read. Use when starting briefed work, when Pause 1 refuses a write because no brief exists, or when the work has turned out to be different from what the brief says.
disable-model-invocation: true
argument-hint: "[what the work is]"
model: opus
effort: high
---

# Write this branch's brief

The brief lives at `<flow.briefDir>/<branch>.md`, with slashes in the branch name
flattened to dashes. On `feat/retry-uploads` with the default directory that is
`docs/briefs/feat-retry-uploads.md`.

Find the branch first:

```bash
git rev-parse --abbrev-ref HEAD
```

A detached HEAD has no branch and therefore no brief. Pause 1 asks rather than
refusing in that state; the fix is to check out a branch, not to invent a name.

## What the file has to contain

Four sections. A Pause reads them mechanically, so the headings matter:

```markdown
# <one line: the work, not the solution>

## Problem
<what is wrong now, and for whom. No solution in this section.>

## Done when
- [ ] <something a second person could check without asking you>

## Not doing
- <considered and declined>

## How it will be checked
<the command, or the observation, that produces the evidence>
```

A section that is present but empty is refused, so is a **Done when** with no
checkboxes. Extra sections are allowed and ignored.

## Before writing anything

**Read enough code to know whether the request is the problem.** Most requests
arrive as a solution to something the person has already diagnosed, and the
diagnosis is often right. When it is not, say so here rather than after the work.

**Ask if the criteria would differ between two readings of the request.** One
question, answerable. This document is what three gates enforce; guessing at it
is the most expensive guess available.

## Writing the criteria

This is the part that decides whether the brief is worth its friction.

A criterion has to be settleable by someone who was not in the conversation.
Test each one against that: if checking it requires asking you what you meant, it
is not a criterion yet.

- Not `the parser is robust` — settleable by nobody.
- Yes `a payload with no items key returns 400 rather than 500`.
- Not `performance is acceptable` — acceptable to whom.
- Yes `the sweep over 5k files finishes under 10s on CI`.

Three or four is usually right. One often means the work has not been broken
down. Ten is usually a plan wearing the costume of criteria.

## Revising a brief mid-work

Changing it is correct when the work turns out to be different; changing it to
match what happened is how the whole structure becomes theatre. The distinction
is whether you would have written the new criterion before knowing the result.

When you revise, say in the chat what changed and why. The diff records what;
only you can record why.

## Ticking

Tick a criterion only when the output that settles it exists, and put that output
on the line beneath, indented:

```markdown
- [x] a payload with no items key returns 400 rather than 500
      node --test parser.test.mjs — 14 of 14, including the empty-payload case
```

Pause 3 refuses a tick with nothing underneath it. That rule is the whole project
in one line: the evidence precedes the assertion.

## After writing

Show the owner the brief and say which criterion the work starts from. Do not
start the work in the same turn — Pause 1 exists so that somebody reads this
before the code is written, and satisfying the gate while skipping the reading
satisfies nothing.
