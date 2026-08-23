# Starting configs

Four configs to copy into a project root as `bancada.config.json`. None of them
is a template to adopt whole: they are a first draft that `bancada doctor` can
immediately tell you the truth about.

| Example | For | Gates it switches on |
| --- | --- | --- |
| [`minimal/`](minimal/) | any project, day one | commit messages, secrets |
| [`typescript/`](typescript/) | a TypeScript service, library or app | commit messages, secrets, file size |
| [`python/`](python/) | a Python package or service | commit messages, secrets, file size |
| [`go/`](go/) | a Go module | commit messages, secrets, file size |

Copy one, then run the report that says whether it fits:

```bash
cp examples/python/bancada.config.json ./bancada.config.json
bancada doctor
```

A plugin cannot put a command on your `PATH`, so `bancada` here is shorthand for
the script in the plugin directory: `./plugins/bancada/bin/bancada` from a
clone, `bancada.cmd` on Windows.

## Every glob here was counted against a real repository first

A glob that matches nothing is not a slow gate or a lenient one. It is a gate
that has silently stopped existing, and it reports success forever. That is the
failure this project exists to catch, so an example config that shipped with one
would be worse than shipping no examples at all.

So each config was run through `bancada doctor` against real repositories of its
kind before it was written down, and the counts are recorded per example. The
whole table:

| Example | Reference repository | Commit | Files | `source.include` | `pair.testGlobs` |
| --- | --- | --- | --- | --- | --- |
| `typescript` | honojs/hono | `5e5b83d6ed96` | 487 | 311 | 140 |
| `typescript` | nestjs/nest | `55425779a1e2` | 2298 | 899 | 466 |
| `typescript` | vercel/commerce | `3761e52e60df` | 79 | 64 | **0** |
| `python` | pallets/flask | `d318b6834711` | 237 | 83 | 48 |
| `python` | fastapi/fastapi | `c3f316b7e814` | 3140 | 1138 | 611 |
| `go` | cli/cli | `5d3c4817f161` | 1362 | 920 | 363 |
| `go` | gin-gonic/gin | `dcaa4296d111` | 131 | 99 | 40 |
| `minimal` | pallets/flask | `d318b6834711` | 237 | declares none | **0** |

The two zeros are real and both are explained in the example that produced them:
`vercel/commerce` has no test files at all, and `minimal` leaves `pair.testGlobs`
at a default written for JavaScript. Neither is a glob that was never checked,
which is the only kind that matters.

Reproduce any row:

```bash
git clone --depth 1 https://github.com/honojs/hono /tmp/hono
cp examples/typescript/bancada.config.json /tmp/hono/
node plugins/bancada/bin/bancada.mjs doctor --dir /tmp/hono
```

The file counts are one higher than `git ls-files` reports for a clean checkout,
because the config copied in is itself an untracked file and bancada lists
untracked files on purpose — a gate has to see the file the turn just wrote.

## What these configs deliberately leave off

**The layering.** No example declares `gates.structure.layers`. A layering
copied from someone else's repository is a rule nobody in yours chose, and the
first person who finds it inconvenient deletes it. Run `/bancada:structure`
instead: it works the layering out from the code that exists, counts the
violations each proposed rule would create before anything is written, and
records the reason in an architecture decision record next to the rules.

**The green boundary, switched on.** Each stack example carries
`gates.green.commands` filled in with the conventional commands for that stack,
and `gates.green.enabled` set to `false`. Turn it on once those two or three
commands are the ones your project actually runs. A command that exits non-zero
for any reason blocks the turn from ending, and "npm ERR! missing script: test"
is a reason that has nothing to do with your build being red.

A command that cannot start at all is treated differently, and that is verified
rather than asserted:

```
$ node plugins/bancada/hooks/stop.mjs <<< '{"hook_event_name":"Stop", ...}'
{"systemMessage":"bancada's green boundary did not run: `a-command-nobody-installed --version`
the command could not be found (exit 1) ...
A command that will not start is a setup problem, not a red build, so the
turn was allowed to end. Fix gates.green.commands in bancada.config.json."}
(exit 0)
```

**bancada-flow.** The three Pauses need a brief per branch and a decision that
the friction is worth it. Nothing here switches them on.

## Reading `bancada doctor` output

Every example's README shows the real report for its reference repositories.
Three lines are worth knowing how to read:

- `N file(s)  source.include` — the gate sees N files. If this says
  **`no matches ... this setting guards nothing`**, fix the glob before doing
  anything else.
- `Blind spots` — top-level directories no source glob reaches. Some of those
  are correct (`docs/`, `.github/`) and some are the reason a gate never fired.
- `0 file(s)  source.exclude` — normal. An exclude that matches nothing is the
  healthy case, which is why it is never reported as a problem.

`scripts/check-docs.mjs`, run in CI, loads every config in this directory
through the same validator the gates use and fails on an error or an unknown
key. It cannot tell you a glob went stale in a repository it has never seen —
only `bancada doctor`, run where you work, can do that.
