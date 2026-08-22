---
description: Research a question in an isolated context and return a lean answer. Use for a sweep across many files or directories, for output the conversation will never re-read, or for several independent lines of enquiry at once. Not for a file you can already name.
when_to_use: searching a codebase by convention rather than by path, tracing where something is used, reading a long log or test output, surveying several subsystems in parallel
context: fork
agent: Explore
model: haiku
effort: low
argument-hint: "<what to find out>"
---

Research the following and return only what is needed to act on it:

$ARGUMENTS

## What to return

A lean answer. The point of running here is that the exploration stays in this
window and only the conclusion crosses back, so the conversation that asked
never pays for the search.

- Lead with the answer. If the question has one, give it in the first sentence.
- Cite `path:line` for anything a reader would want to confirm.
- Quote sparingly. A quoted block is a claim you are asking someone to trust;
  three lines that settle the question beat thirty that describe it.
- Say what you did not find, and where you looked. "Not present in `src/` or
  `packages/`" is a result. Silence reads as "did not check".
- If two readings of the question are possible, answer the likelier one and name
  the other in a line rather than answering both at length.

## What not to do

Do not restate the question. Do not narrate the search. Do not list every file
you opened — list the ones that mattered.

Do not pad an uncertain answer into a confident one. If the evidence supports
"probably, on this reading of two files", say exactly that. A wrong answer
returned crisply costs more than an uncertain one returned honestly, because
the caller cannot see what you saw.
