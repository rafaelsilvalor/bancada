# TypeScript

Commit messages, secrets and a file-size ceiling, on a source glob that covers
the three layouts a TypeScript project usually has: `src/`, an app-router tree
of `app/ components/ lib/`, and a `packages/` monorepo.

```bash
cp examples/typescript/bancada.config.json ./bancada.config.json
bancada doctor
```

## The source glob is a union because the obvious one guarded nothing

The first draft was `src/**/*.{ts,tsx,mts,cts}`, which is what a TypeScript
project looks like right up until it does not. Run against three real
repositories it matched 311 of 487 files in honojs/hono, and nothing at all in
the other two:

```
$ node plugins/bancada/bin/bancada.mjs doctor --dir nest
Glob coverage
  2298 file(s) from git ls-files
  no matches  source.include  — this setting guards nothing
  0 file(s)  source.exclude
  no matches  gates.green.watch  — this setting guards nothing
  466 file(s)  pair.testGlobs
```

nestjs/nest keeps its code in `packages/*/`, vercel/commerce in
`app/`, `components/` and `lib/`. The shipped glob names all five directories,
and then matches in all three:

| Repository | Commit | Files | `source.include` | `pair.testGlobs` |
| --- | --- | --- | --- | --- |
| honojs/hono | `5e5b83d6ed96` | 487 | 311 | 140 |
| nestjs/nest | `55425779a1e2` | 2298 | 899 | 466 |
| vercel/commerce | `3761e52e60df` | 79 | 64 | 0 |

The full report on hono, which is the layout the example is written for:

```
$ node plugins/bancada/bin/bancada.mjs doctor --dir hono
bancada doctor

config: hono\bancada.config.json
session effort: xhigh

Gates
  on   commit
  on   secrets
  on   size
  off  green
  off  structure
  off  pair
  off  flow (bancada-flow)

Glob coverage
  487 file(s) from git ls-files
  311 file(s)  source.include
  1 file(s)  source.exclude
  311 file(s)  gates.green.watch
  140 file(s)  pair.testGlobs

Blind spots
  benchmarks/ — 71 file(s), matched by no source glob
  runtime-tests/ — 46 file(s), matched by no source glob
  ./ — 19 file(s), matched by no source glob
  perf-measures/ — 12 file(s), matched by no source glob
  .github/ — 11 file(s), matched by no source glob
  docs/ — 9 file(s), matched by no source glob
  build/ — 5 file(s), matched by no source glob
  .vscode/ — 2 file(s), matched by no source glob

No problems found.
```

Blind spots are not automatically wrong. hono's `runtime-tests/` and
`benchmarks/` are code the size ceiling does not apply to under this config,
which is a choice you can make differently by adding them to `source.include`.

On vercel/commerce the same command reports `pair.testGlobs — this setting
guards nothing`, and that one is true about the repository rather than about the
glob: it contains no test file of any kind.

## What the ceilings cost on day one

`maxFileLines` is 400 and `testCeiling` is 800, and the gate judges the file the
edit produces rather than the edit. Files already over the line when you install
it:

| Repository | Code files over 400 | Test files over 800 |
| --- | --- | --- |
| honojs/hono | 11 of 187 | 18 of 123 |
| nestjs/nest | 25 of 623 | 9 of 276 |
| vercel/commerce | 1 of 64 | no test files |

An over-sized file stays editable downward, so those files are not frozen; an
edit that shortens one is allowed even while it is still over. Raise the numbers
if that count is high enough to make the gate noise rather than signal.

## Two knobs worth a second look

`pair.testGlobs` is what the size gate reads to decide which ceiling a file
answers to, which is why it is set even though the pair gate is off. The default
already fits TypeScript — `*.test.*` and `*.spec.*` — and the example adds
`**/__tests__/**` for projects that put them in a directory.

`gates.green.commands` is filled in and `gates.green.enabled` is `false`. Change
`npx tsc --noEmit` and `npm test` to whatever your project actually runs, then
switch it on. `npm test` in a package with no `test` script exits non-zero,
which the boundary reads as a red build.

`gates.colocated` ships off with the patterns filled in — `a.test.ts` or
`a.spec.ts` next to `a.ts`, or under a `__tests__/` directory. Before switching
it on, run `bancada doctor` and read the **Test colocation** section: it counts
how many modules already have a test under these patterns and names the ones
that do not, which is the list you either shrink or record as dated
`exceptions` on the day you enable the gate.
