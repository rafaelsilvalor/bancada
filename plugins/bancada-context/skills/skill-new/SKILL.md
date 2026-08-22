---
description: Author a new skill with a description written to actually trigger, and register the cost it adds to the listing budget.
disable-model-invocation: true
argument-hint: "<what the skill should do>"
model: sonnet
effort: medium
---

# Write a new skill

Most skills that fail do not fail in the body. They fail because the model never
reached for them, and that is decided entirely by the `description`.

A second thing decides it, invisibly. Claude Code loads every skill's name and
description into every session, under a budget of about 1% of the model's
context window. When that overflows, descriptions are dropped starting with the
skills invoked least — so the newest skill, the one that most needs to be
discovered, is the first to go quiet. Adding a skill is never free, and this is
where that cost gets accounted for.

## Step 1 — Decide whether this should be a skill at all

- Something that must happen every time, with no judgement? That is a **hook**,
  not a skill. An instruction is a request; a hook is enforcement.
- A fact true in every session? That belongs in **CLAUDE.md**.
- A procedure, a checklist, or reference material needed sometimes? **Skill.**

If it is a skill, ask who invokes it. A skill with side effects — one that
writes files, pushes, deploys — should be invoked deliberately, and gets
`disable-model-invocation: true`. That also removes it from the listing
entirely, so it costs nothing at all. It is the strongest lever available and
it is free whenever only a person should be pulling the trigger.

## Step 2 — Write the description for triggering, not for documenting

The description is matched against what someone types. Write what they would
say, not what the skill is.

- **Put the key use case in the first sentence.** Description and `when_to_use`
  are truncated together at 1,536 characters, and truncation eats the end.
- **Use the words a user would use.** "Research a topic across many files"
  beats "Contextual information retrieval subsystem".
- **Say when *not* to use it.** A description that only says yes triggers on
  everything, and a skill that fires when it should not is worse than one that
  never fires: it burns context and produces confident irrelevance.
- Put trigger phrases in `when_to_use` rather than padding the description.

## Step 3 — Set the model and the effort on purpose

Two axes, and they answer different failures. The model is *capability* — it did
not know enough. The effort is *thoroughness* — it did not try hard enough.

- Search, summarise, format, mechanical transform → a small model, low effort.
- Authoring from a template, routine implementation → mid model, medium effort.
- Architecture, ambiguity, a decision that is expensive to get wrong → the
  largest model, high effort. A smaller model here is confidently wrong, and on
  a hard task the larger one often costs less in total because the smaller one
  grinds.

## Step 4 — Write it

```
skills/<name>/SKILL.md
```

Frontmatter carries at least `description`; add `when_to_use`, `model`,
`effort`, and `disable-model-invocation` where the steps above called for them.
Keep the body imperative and short. A body nobody finishes reading is a body
that was not read.

## Step 5 — Account for the cost

```bash
bancada doctor --skills
```

Report the number: what this skill added, and how much of the budget is now
spent. If the listing is over, or if entries are already being truncated, say so
and offer the lever — the skills only a person invokes should be
model-invisible, and each one that becomes so leaves the listing completely.

Then, once the skill has been in use for a while:

```bash
bancada yield --skills
```

A skill that has never fired is either dead weight or has a description nobody
matches. Both are worth knowing; neither is visible without asking.
