/**
 * Test colocation: the gate that asks whether a test is *missing*.
 *
 * Every other gate judges something that exists — a commit message, a written
 * file, a red build. None of them can see an absence. Measured in a consumer
 * repository before this existed: of 30 documented traps, 13 were guarded by no
 * test at all, 10 of those because the module had no test file — and all six
 * gates, fully enabled, would have caught 0 of the 13. A missing test fails
 * nothing, refuses nothing and appears in no report; it is the quietest
 * coverage gap there is.
 *
 * The rule: every file `source.include` claims, minus what `source.exclude`
 * subtracts and minus the tests themselves, has a test that lives next to it.
 * `patterns` spells out what "next to it" looks like, relative to the module's
 * own directory. What counts as a test is `pair.testGlobs` — the same
 * definition the size and pair gates already read, so a project has one answer
 * to that question, not three.
 *
 * Two escape hatches, both visible in `bancada doctor`:
 *
 * `suites` declares that a test elsewhere covers a set of modules — the real
 * shape where one suite exercises a directory (this repository covers
 * `lib/checks/*.mjs` with `lib/checks.test.mjs` one level up). A suite whose
 * test file does not exist covers nothing: a mapping to a deleted test must not
 * keep approving. A declared suite's test is also never itself asked for a
 * test, even when `pair.testGlobs` fails to match it — declaring it a suite is
 * declaring it a test.
 *
 * `exceptions` accepts a gap on purpose, one literal path each, dated and
 * reasoned. They are the adoption path: a repository turns the gate on with its
 * current gaps listed, and the list is meant to shrink. An exception whose file
 * is gone, and one whose file now has a test, are both reported, so the list
 * cannot quietly outlive what it excuses.
 *
 * Everything here is pure over a file list, and membership in that list is what
 * "exists" means. The list comes from `git ls-files` (or the disclosed walk),
 * so a test that sits on disk but is ignored by git does not count as coverage
 * — CI would never see it either.
 */

import { compileGlobs, normalisePath } from "./glob.mjs";

/** Split `dir/name.ext` for the pattern placeholders. A leading dot is a name, not an extension. */
function partsOf(relPath) {
  const slash = relPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : relPath.slice(0, slash);
  const name = slash === -1 ? relPath : relPath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return { dir, stem, ext };
}

/** The test paths that would satisfy a module, one per pattern, project-relative. */
export function testCandidates(relPath, patterns) {
  const { dir, stem, ext } = partsOf(normalisePath(relPath));
  const out = [];
  for (const pattern of patterns ?? []) {
    const name = pattern.split("{stem}").join(stem).split("{ext}").join(ext);
    const candidate = normalisePath(dir === "" ? name : `${dir}/${name}`);
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * The whole colocation picture for one file list.
 *
 * Returns:
 *
 *   total       modules the rule applies to
 *   tested      modules covered by a colocated test or a declared suite
 *   excepted    modules excused by an exception that is still doing work
 *   missing     [{ file, candidates }] — no test, no suite, no exception
 *   suites      { declared, dead } — dead names the tests that do not exist
 *   exceptions  { declared, stale, unneeded } — stale names files that are
 *               gone, unneeded names files a test now covers
 *
 * `total === tested + excepted + missing.length`, and the tests hold that
 * invariant so the numbers in the report cannot drift apart.
 */
export function colocationReport({ files, source, settings, testGlobs }) {
  const fileSet = new Set((files ?? []).map(normalisePath));
  const include = compileGlobs(source?.include ?? []);
  const exclude = compileGlobs(source?.exclude ?? []);
  const isTest = compileGlobs(testGlobs ?? []);

  const declaredSuites = (settings?.suites ?? []).map((s) => ({
    test: normalisePath(s.test),
    covers: compileGlobs(s.covers ?? []),
  }));
  const suiteTests = new Set(declaredSuites.map((s) => s.test));
  const dead = declaredSuites.filter((s) => !fileSet.has(s.test)).map((s) => s.test);
  const liveSuites = declaredSuites.filter((s) => fileSet.has(s.test));

  const byPath = new Map((settings?.exceptions ?? []).map((e) => [normalisePath(e.path), e]));

  const modules = [...fileSet]
    .filter((f) => include(f) && !exclude(f))
    .filter((f) => !isTest(f) && !suiteTests.has(f))
    .sort();

  const missing = [];
  const unneeded = [];
  let tested = 0;
  let excepted = 0;

  for (const file of modules) {
    const candidates = testCandidates(file, settings?.patterns);
    const covered = candidates.some((c) => fileSet.has(c)) || liveSuites.some((s) => s.covers(file));
    const exception = byPath.get(file);
    if (covered) {
      tested++;
      // The exception did its job and is now excusing nothing. Left in place it
      // would silently re-open the gap the day the test is deleted.
      if (exception) unneeded.push(file);
      continue;
    }
    if (exception) {
      excepted++;
      continue;
    }
    missing.push({ file, candidates });
  }

  const stale = [...byPath.keys()].filter((p) => !fileSet.has(p));

  return {
    total: modules.length,
    tested,
    excepted,
    missing,
    suites: { declared: declaredSuites.length, dead },
    exceptions: { declared: byPath.size, stale, unneeded },
  };
}
