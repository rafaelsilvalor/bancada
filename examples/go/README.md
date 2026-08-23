# Go

Commit messages, secrets and a file-size ceiling, with Go's test naming and
ceilings measured against Go code rather than inherited from JavaScript.

```bash
cp examples/go/bancada.config.json ./bancada.config.json
bancada doctor
```

## Do not switch the layering gate on in a Go module

This is the one example that ships with a warning rather than a suggestion. Go's
grouped import block — the `import ( ... )` form that 827 of the 863 files below
use — is not one of the shapes `lib/imports.mjs` recognises, and the module says
so. The consequence, measured on cli/cli with `cmd`, `internal` and `pkg`
declared as layers:

```
$ node plugins/bancada/bin/bancada.mjs check --dir cli
bancada check

863 file(s) in a declared layer, from git ls-files.
50 import(s) could not be attributed to a layer and were not judged.

No layering violation.
(exit 0)
```

Those 863 files contain 8091 import specifiers. The gate saw 54 of them, could
not attribute 50, and therefore judged 4. "No layering violation" is what a
green result looks like when nothing was looked at, and a `PreToolUse` gate in
that state is worse than no gate: it costs the same, reports the same, and
approves everything.

So `gates.structure` is absent from this config, and adding it is not a matter
of writing the layers correctly. Until the grouped import block is parsed, use
`go vet`, `depguard` or `go-arch-lint` through `gates.structure.adapterCommand`,
which runs the project's own checker in `bancada check` instead of
reimplementing it.

## The default test glob matches nothing in a Go module

`pair.testGlobs` defaults to `["**/*.test.*", "**/*.spec.*"]`, which matches 0
of 1361 files in cli/cli and 0 of 130 in gin-gonic/gin. Go names a test
`something_test.go`, so that is what the example declares — 363 files and 40.

The glob is read by the size gate as well as the pair gate, which is why it is
set here even though `pair.enabled` is `false`. Left at the default, every Go
test file would answer to `maxFileLines` rather than `testCeiling`.

| Repository | Commit | Files | `source.include` | `pair.testGlobs` |
| --- | --- | --- | --- | --- |
| cli/cli | `5d3c4817f161` | 1362 | 920 | 363 |
| gin-gonic/gin | `dcaa4296d111` | 131 | 99 | 40 |

```
$ node plugins/bancada/bin/bancada.mjs doctor --dir cli
bancada doctor

config: cli\bancada.config.json
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
  1362 file(s) from git ls-files
  920 file(s)  source.include
  163 file(s)  source.exclude
  920 file(s)  gates.green.watch
  363 file(s)  pair.testGlobs

Blind spots
  docs/ — 65 file(s), matched by no source glob
  ./ — 11 file(s), matched by no source glob
  build/ — 4 file(s), matched by no source glob
  skills/ — 2 file(s), matched by no source glob
  .devcontainer/ — 1 file(s), matched by no source glob
  .experiments/ — 1 file(s), matched by no source glob

No problems found.
```

The 163 excluded files are `testdata/` fixtures, and 9 of them are Go: table
fixtures and golden files that a line ceiling has no business judging.

## The ceilings are 500 and 1000, not 400 and 800

Go files run longer than the SPEC defaults assume. In cli/cli the ninetieth
percentile of a non-test file is 479 lines, so a 400-line ceiling would put 74
of 548 files over on the day it is installed. At 500 it is 50, and at 1000 the
test ceiling holds 31 of 363:

| Repository | Code files over 500 | Test files over 1000 |
| --- | --- | --- |
| cli/cli | 50 of 548 | 31 of 363 |
| gin-gonic/gin | 4 of 58 | 5 of 40 |

Table-driven tests are why the test ceiling is double. Every file already over
stays editable downward.

## The green boundary is filled in and switched off

`go build ./...`, `go vet ./...` and `go test ./...`, in that order, with the
first failure stopping the rest. Switch `gates.green.enabled` on when you are
ready to pay for a full `go test ./...` at the end of every turn that touched a
`.go` file; on a large module, set `gates.green.timeoutMs` to something the
suite fits inside.
