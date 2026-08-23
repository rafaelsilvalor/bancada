# Minimal

Two gates, no globs, any language. This is the config to install on day one,
before you have decided anything about your project's layering, ceilings or
process.

```bash
cp examples/minimal/bancada.config.json ./bancada.config.json
bancada doctor
```

## What it does

**Commit messages** are checked before git runs: Conventional Commits shape, a
subject of at most 72 characters, and the imperative mood. A message the gate
cannot read — `-F somefile`, `--amend --no-edit`, a bare `git commit` — is asked
about rather than approved.

**Secrets** are refused in the turn that writes them, in a file or on a command
line. This is the only gate that is on by default anywhere in bancada, and this
config just states it explicitly so the file shows you the knob exists.

`denyTrailers` is present and empty. Fill it in with a regular expression per
line you do not want in your history — an assistant's `Co-Authored-By`, a tool's
advertisement footer — and the commit carrying it is refused with the offending
line quoted back.

## It declares no glob, which is the point

Everything that can silently stop matching is absent. There is no
`source.include` to go stale when the code moves, and neither gate needs one:
the commit gate reads a command line, and the secret gate deliberately judges
every file, because a credential in a `.env` is exactly the one worth catching
and `.env` is in nobody's source globs.

One line of the report is still worth understanding, here shown against
pallets/flask:

```
$ node plugins/bancada/bin/bancada.mjs doctor --dir flask
bancada doctor

config: flask\bancada.config.json
session effort: xhigh

Gates
  on   commit
  on   secrets
  off  size
  off  green
  off  structure
  off  pair
  off  flow (bancada-flow)

Glob coverage
  237 file(s) from git ls-files
  0 file(s)  source.exclude
  no matches  pair.testGlobs  — this setting guards nothing
```

`pair.testGlobs` is reported because it has a default —
`["**/*.test.*", "**/*.spec.*"]` — and that default is JavaScript's naming
convention, which matches nothing in a Python repository. Nothing reads it while
both the pair gate and the size gate are off, so in this config the line is
noise. It stops being noise the moment you switch the size gate on, because the
test ceiling is applied to whatever this glob matches. The stack examples
([python](../python/), [go](../go/), [typescript](../typescript/)) set it
correctly.

## Where to go next

Run `bancada doctor` after any change to the config, and `bancada yield` after a
few days of work — it reports what the gates actually did, including the one
signal worth acting on: the same input refused more than once, which means the
reason is not landing.

Switch on one more gate at a time. The stack examples show the size gate with a
ceiling measured against real repositories; `/bancada:structure` works out a
layering from the code you already have.
