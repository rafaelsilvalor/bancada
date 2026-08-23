# Releasing

Three plugins ship from one repository, so a release is three tags over one
commit. What follows is the order that keeps the four places a version appears
from disagreeing.

## The checklist

**1. CI is green on the commit you are about to tag.** Everything that has to
pass is in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): the unit
tests on three operating systems, manifest validation, and the four hygiene
checks — no inherited rule identifiers, cost against the recorded baseline, the
schema and settings table against the SPEC, and the example configs against the
validator.

**2. Decide the number.** What forces a MAJOR bump is stated at the top of
[`CHANGELOG.md`](../CHANGELOG.md), and it is about behaviour a consumer depends
on, not about how much code changed.

**3. Bump `version` in all three manifests** under
`plugins/*/.claude-plugin/plugin.json`, and in `const VERSION` in
`plugins/bancada/bin/bancada.mjs`. That fourth one is the one people forget;
`scripts/check-docs.mjs` fails when the version the CLI prints is not the
version the manifest ships, so CI catches it rather than a bug report.

**4. Close the section in the CHANGELOG.** `## [Unreleased]` becomes
`## [x.y.z] — YYYY-MM-DD`, with a fresh empty `[Unreleased]` above it.

**5. Check that the manifests and the catalog agree**, which is what the tag
command validates before it writes anything:

```
$ claude plugin tag plugins/bancada --dry-run
Plugin:  bancada
Version: 0.1.0 (from plugin.json)
Marketplace entry: plugins[0] in .claude-plugin\marketplace.json
Tag:     bancada--v0.1.0

✔ Dry run — would create tag bancada--v0.1.0 at HEAD
  git tag -a bancada--v0.1.0 -m "bancada 0.1.0"
  git push origin refs/tags/bancada--v0.1.0
```

Paths are shortened in that block; the command prints them absolute.

**6. Tag all three**, once the dry run says what you expect:

```bash
for p in plugins/*/; do claude plugin tag "$p" --push; done
```

## What is not automated, and is not pretended to be

Nothing here publishes anything. There is no release workflow, no npm package
and no artifact upload; a release is a tag on a repository people install from
directly.

The marketplace install path in the README — `claude plugin marketplace add`
followed by `claude plugin install` — is written from the CLI's own help and has
never been run, because this repository has no published remote to run it
against. Every end-to-end verification in the CHANGELOG loaded the plugin from
disk with `--plugin-dir`. The first person to publish should run the marketplace
path once and record what happened, the same way every other claim in this
repository was recorded.

`claude plugin tag` refuses a dirty working tree and an existing tag, which is
the check you want; `--force` skips both, which is almost never the check you
want.
