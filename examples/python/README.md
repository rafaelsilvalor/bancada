# Python

Commit messages, secrets and a file-size ceiling, with the one change that
matters most in a Python repository: a test glob Python actually uses.

```bash
cp examples/python/bancada.config.json ./bancada.config.json
bancada doctor
```

## The default test glob matches nothing in a Python repository

`pair.testGlobs` defaults to `["**/*.test.*", "**/*.spec.*"]`, which is
JavaScript's naming convention. Counted against two real Python repositories,
that default matches 0 of 236 files in pallets/flask and 0 of 3139 in
fastapi/fastapi. This example replaces it with `test_*.py`, `*_test.py`,
`tests/**` and `conftest.py`, which matches 48 and 611.

That glob is not decoration while the pair gate is off. The size gate reads it
to decide which ceiling a file answers to, so with the default in place every
Python test file is held to `maxFileLines` instead of `testCeiling` — a stricter
limit on exactly the files that are long for a good reason.

## Measured against a src layout and a flat one

`src/**/*.py` would have been the tidier glob and it matches 24 of 236 files in
flask and **0 of 3139** in fastapi, which keeps its package at the repository
root. `**/*.py` with a list of excludes matches both:

| Repository | Commit | Files | `source.include` | `pair.testGlobs` |
| --- | --- | --- | --- | --- |
| pallets/flask | `d318b6834711` | 237 | 83 | 48 |
| fastapi/fastapi | `c3f316b7e814` | 3140 | 1138 | 611 |

```
$ node plugins/bancada/bin/bancada.mjs doctor --dir flask
bancada doctor

config: flask\bancada.config.json
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
  237 file(s) from git ls-files
  83 file(s)  source.include
  0 file(s)  source.exclude
  83 file(s)  gates.green.watch
  48 file(s)  pair.testGlobs

Blind spots
  ./ — 10 file(s), matched by no source glob
  .github/ — 9 file(s), matched by no source glob
  .devcontainer/ — 2 file(s), matched by no source glob

No problems found.
```

`0 file(s) source.exclude` is the healthy reading: neither reference checkout
contains a `.venv/`, a `__pycache__/` or a `migrations/` directory, and an
exclude that subtracts nothing is never reported as a problem. Drop
`**/migrations/**` if you are not on Django and want the generated files
measured.

## What the ceilings cost on day one

| Repository | Code files over 400 | Test files over 800 |
| --- | --- | --- |
| pallets/flask | 7 of 35 | 2 of 48 |
| fastapi/fastapi | 14 of 527 | 7 of 611 |

flask's 7 of 35 is the number to look at before copying this file: a fifth of a
small, careful codebase is already over a 400-line ceiling, because a framework
keeps a few large modules on purpose. The gate still allows every edit that
makes such a file shorter. If that trade is wrong for your repository, the
number is yours to change — bancada does not pick it.

## The green boundary is filled in and switched off

`python -m pytest -q` is the command in the example. Switch
`gates.green.enabled` on once that is the command your project runs, with the
virtual environment the session will have. A command that cannot start at all is
reported as a setup problem and lets the turn end; a command that runs and exits
non-zero blocks it.

## Test colocation is filled in and switched off

`gates.colocated` carries both Python spellings — `test_mod.py` and
`mod_test.py` next to `mod.py`. A repository that keeps its tests in a
`tests/` mirror instead declares that under `gates.colocated.suites`, one
`{ "test", "covers" }` entry per suite file, rather than by loosening the
patterns. Run `bancada doctor` first and read the **Test colocation** section:
it counts how many modules already have a test under these patterns and names
the rest — the list you either shrink or record as dated `exceptions` on the
day you switch the gate on.
