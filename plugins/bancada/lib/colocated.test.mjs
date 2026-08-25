import { test } from "node:test";
import assert from "node:assert/strict";
import { colocationReport, testCandidates } from "./colocated.mjs";

const DEFAULTS = { patterns: ["{stem}.test.{ext}"], suites: [], exceptions: [] };
const TEST_GLOBS = ["**/*.test.*", "**/*.spec.*"];

const report = (files, settings = {}, source = { include: ["src/**"], exclude: [] }) =>
  colocationReport({ files, source, settings: { ...DEFAULTS, ...settings }, testGlobs: TEST_GLOBS });

// --- deriving the expected test path from a module path ---

test("the default pattern puts the test next to the module", () => {
  assert.deepEqual(testCandidates("src/lib/order.mjs", ["{stem}.test.{ext}"]), ["src/lib/order.test.mjs"]);
  assert.deepEqual(testCandidates("order.mjs", ["{stem}.test.{ext}"]), ["order.test.mjs"], "a module at the root");
});

test("patterns cover other stacks' conventions", () => {
  assert.deepEqual(testCandidates("pkg/mod.py", ["test_{stem}.{ext}"]), ["pkg/test_mod.py"], "Python");
  assert.deepEqual(testCandidates("pkg/mod.go", ["{stem}_test.{ext}"]), ["pkg/mod_test.go"], "Go");
  assert.deepEqual(
    testCandidates("src/a.ts", ["__tests__/{stem}.test.{ext}"]),
    ["src/__tests__/a.test.ts"],
    "a pattern may descend into a subdirectory",
  );
});

test("several patterns yield several candidates, deduplicated", () => {
  assert.deepEqual(testCandidates("src/a.ts", ["{stem}.test.{ext}", "{stem}.spec.{ext}"]), [
    "src/a.test.ts",
    "src/a.spec.ts",
  ]);
  assert.deepEqual(testCandidates("src/a.ts", ["{stem}.test.{ext}", "{stem}.test.{ext}"]), ["src/a.test.ts"]);
});

test("a dotfile is a name without an extension, not an empty stem", () => {
  assert.deepEqual(testCandidates("src/.env", ["{stem}.test.{ext}"]), ["src/.env.test."]);
  assert.deepEqual(testCandidates("bin/tool", ["{stem}.test.{ext}"]), ["bin/tool.test."]);
});

test("no patterns means no candidates, so coverage can only come from suites or exceptions", () => {
  assert.deepEqual(testCandidates("src/a.mjs", []), []);
});

// --- the report ---

test("a module with its test next to it is tested; one without is missing, named with the expected path", () => {
  const r = report(["src/a.mjs", "src/a.test.mjs", "src/b.mjs"]);
  assert.equal(r.total, 2);
  assert.equal(r.tested, 1);
  assert.deepEqual(r.missing, [{ file: "src/b.mjs", candidates: ["src/b.test.mjs"] }]);
});

test("test files are never themselves asked for a test", () => {
  const r = report(["src/a.mjs", "src/a.test.mjs", "src/a.spec.mjs"]);
  assert.equal(r.total, 1, "only the module counts");
});

test("source.exclude and files outside source.include are not the gate's business", () => {
  const r = report(["src/a.mjs", "src/a.test.mjs", "src/vendor/x.mjs", "docs/readme.md"], {}, {
    include: ["src/**"],
    exclude: ["src/vendor/**"],
  });
  assert.equal(r.total, 1);
  assert.deepEqual(r.missing, []);
});

// --- suites: covered by a test elsewhere ---

test("a declared suite covers its modules, and its own file is not a module", () => {
  const r = report(["lib/checks/a.mjs", "lib/checks/b.mjs", "lib/checks.test.mjs"], {
    suites: [{ test: "lib/checks.test.mjs", covers: ["lib/checks/*.mjs"] }],
  }, { include: ["lib/**"], exclude: [] });
  assert.equal(r.total, 2);
  assert.equal(r.tested, 2);
  assert.deepEqual(r.missing, []);
});

test("a suite whose test does not exist covers nothing and is reported dead", () => {
  const r = report(["lib/checks/a.mjs"], {
    suites: [{ test: "lib/checks.test.mjs", covers: ["lib/checks/*.mjs"] }],
  }, { include: ["lib/**"], exclude: [] });
  assert.deepEqual(r.suites.dead, ["lib/checks.test.mjs"]);
  assert.equal(r.missing.length, 1, "the mapping to a deleted test must not keep approving");
});

test("a suite test pair.testGlobs does not recognise is still a test, because declaring it says so", () => {
  // The Go shape: `*_test.go` with the default testGlobs. Without this, the
  // declared suite would itself be flagged as a module missing a test.
  const r = colocationReport({
    files: ["pkg/mod.go", "pkg/all_test.go"],
    source: { include: ["pkg/**"], exclude: [] },
    settings: { ...DEFAULTS, suites: [{ test: "pkg/all_test.go", covers: ["pkg/*.go"] }] },
    testGlobs: TEST_GLOBS,
  });
  assert.equal(r.total, 1);
  assert.equal(r.tested, 1);
});

// --- exceptions: the adoption path ---

test("an excepted module is not missing, and is counted apart from the tested", () => {
  const r = report(["src/a.mjs"], {
    exceptions: [{ path: "src/a.mjs", reason: "legacy, being replaced", date: "2026-08-25" }],
  });
  assert.equal(r.excepted, 1);
  assert.deepEqual(r.missing, []);
});

test("an exception whose file no longer exists is stale", () => {
  const r = report(["src/a.mjs", "src/a.test.mjs"], {
    exceptions: [{ path: "src/gone.mjs", reason: "was here once", date: "2026-08-25" }],
  });
  assert.deepEqual(r.exceptions.stale, ["src/gone.mjs"]);
  assert.equal(r.excepted, 0);
});

test("an exception whose file now has a test is reported as no longer needed", () => {
  // Left in place it would silently re-open the gap the day the test is deleted.
  const r = report(["src/a.mjs", "src/a.test.mjs"], {
    exceptions: [{ path: "src/a.mjs", reason: "no test yet", date: "2026-08-25" }],
  });
  assert.deepEqual(r.exceptions.unneeded, ["src/a.mjs"]);
  assert.equal(r.tested, 1, "the test is what covers it; the exception excuses nothing");
});

test("exception paths match after normalisation, so a Windows-style path still excuses", () => {
  const r = report(["src/a.mjs"], {
    exceptions: [{ path: "src\\a.mjs", reason: "r", date: "2026-08-25" }],
  });
  assert.equal(r.excepted, 1);
});

// --- the numbers cannot drift apart ---

test("total is always tested + excepted + missing", () => {
  const r = report(["src/a.mjs", "src/a.test.mjs", "src/b.mjs", "src/c.mjs"], {
    exceptions: [{ path: "src/b.mjs", reason: "r", date: "2026-08-25" }],
  });
  assert.equal(r.total, r.tested + r.excepted + r.missing.length);
  assert.deepEqual(
    { total: r.total, tested: r.tested, excepted: r.excepted, missing: r.missing.length },
    { total: 3, tested: 1, excepted: 1, missing: 1 },
  );
});

test("an empty source.include means the rule applies to nothing, not to everything", () => {
  const r = report(["src/a.mjs"], {}, { include: [], exclude: [] });
  assert.equal(r.total, 0);
  assert.deepEqual(r.missing, []);
});

test("the missing list is sorted, so the report and the refusal are stable", () => {
  const r = report(["src/c.mjs", "src/a.mjs", "src/b.mjs"]);
  assert.deepEqual(
    r.missing.map((m) => m.file),
    ["src/a.mjs", "src/b.mjs", "src/c.mjs"],
  );
});
