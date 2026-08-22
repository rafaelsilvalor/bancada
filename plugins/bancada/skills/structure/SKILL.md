---
description: Work out a project's layering from the code that exists, then write it into bancada.config.json and an architecture decision record in one act. Use when adopting the structure gate, or when the declared layering no longer matches reality.
disable-model-invocation: true
argument-hint: "[optional: a layering you already have in mind]"
model: opus
effort: high
---

# Work out this project's layering

Two artifacts come out of this, written together: the machine-readable rules in
`bancada.config.json`, and the reason for them in an architecture decision
record. Neither is worth much alone. Rules with no recorded reason get deleted
by the next person who finds them inconvenient; a reason with no rules is a
comment that the code drifts away from within a month.

The gate that enforces this refuses an import when a file is written. That
places a real cost on getting the layering wrong, so the work here is to arrive
at something true rather than something tidy.

## What not to do

**Do not propose a layering from directory names.** `src/utils` next to
`src/core` looks like a layering and is usually just a folder someone made once.
Read what the imports actually do first.

**Do not propose the layering you would have designed.** The question is what
this codebase already obeys, or is close to obeying. A rule that half the files
violate on day one will be switched off by the end of the week, and then it
guards nothing.

**Do not write anything until the owner has agreed.** This skill produces two
files that change how every future edit is judged.

## Step 1 — Look

Gather evidence before forming an opinion:

```bash
bancada check --json
```

That reports nothing useful yet if no layering is configured, which is the
expected starting point. What you need instead is the shape of the code:

- The top-level directories under the project's source root, and how many files
  are in each.
- For the three or four largest, which other directories they import from, and
  how often. Relative imports are the reliable signal; a directory that imports
  from everything is probably a leaf utility, and one that nothing imports is
  probably an entry point.
- Whether the codebase imports through path aliases (`@app/…`, `~/lib/…`)
  rather than relative paths. If it does, each layer will need an `aliases`
  entry or the gate will attribute nothing.

## Step 2 — Propose, with the count attached

Present candidate layers as a table: the name, the glob, what it may import,
and **how many files match the glob**. A layer matching zero files is a rule
that will never fire, and `bancada doctor` will flag it later as a dead rule —
better to catch it now.

Say plainly which direction each rule protects and what it costs. "Domain may
not import adapters" means the domain cannot call the Jira client directly and
will need an interface it owns. That is the whole point of the rule and also
the whole objection to it, so state both.

Then, before writing anything, count the violations the proposal would create
in the code as it stands. If the number is large, say so and offer the choice:
adopt the rule and fix them, or adopt a weaker rule that is true today. Do not
quietly propose the weaker one.

## Step 3 — Wait

Show the proposed config block and the draft decision record. Get an explicit
yes. A layering imposed on someone who did not agree to it is friction with
extra steps.

## Step 4 — Write both

Add to `bancada.config.json`:

```jsonc
{
  "gates": {
    "structure": {
      "enabled": true,
      "layers": [
        { "name": "domain",  "match": "src/domain/**",  "mayImport": [] },
        { "name": "app",     "match": "src/app/**",     "mayImport": ["domain"] },
        { "name": "adapter", "match": "src/adapter/**", "mayImport": ["domain", "app"] }
      ]
    }
  }
}
```

Order matters when globs overlap: the first matching layer wins, so put the
narrower one first.

Write the decision record to the directory named by `gates.structure.adrDir`,
numbered after the highest existing one. It should carry:

- **The question** — what was being decided, in one paragraph.
- **What was measured** — the file counts per layer, the import directions
  found, and the violation count the rule creates today. Numbers, not
  adjectives.
- **The decision** — the layers, and for each rule, what it protects.
- **What it costs** — the thing that is now harder to do, named honestly. Every
  layering rule buys one property by making one kind of change more expensive.
- **What stays out of scope** — directories deliberately not in any layer, and
  why.

## Step 5 — Show the damage

Run the sweep and report the result verbatim:

```bash
bancada check
```

If it exits non-zero, the layering is now aspirational rather than true. Say
that in those words, list the violations, and agree what happens to them: fixed
now, fixed on a schedule, or the rule relaxed. Leaving a red sweep unexplained
is how a project learns to ignore its own checks.

## If the project already has a checker

A project running `dependency-cruiser`, `import-linter`, `depguard` or ArchUnit
has already encoded its rules somewhere. Do not translate them into bancada's
layers — two copies of the same rule will disagree eventually. Point
`gates.structure.adapterCommand` at the existing tool instead, and use bancada's
native layers only for what that tool does not cover.

The adapter runs in `bancada check`, not in the write gate: a whole-project
analyser takes seconds, and seconds on every edit is a tax nobody keeps paying.
