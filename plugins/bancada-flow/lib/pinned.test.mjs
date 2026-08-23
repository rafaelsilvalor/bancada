/**
 * The duplication between the two plugins, held in place.
 *
 * bancada-flow copies four small things from bancada: the flow and pair
 * defaults, the telemetry defaults, the telemetry record's key order, and the
 * glob matcher. It copies them because a plugin cannot import from another
 * plugin's directory without assuming where the host put it — a marketplace
 * install does keep them as siblings, which was checked, but an install layout
 * nobody documented is not a thing to build on.
 *
 * These tests are the price of that decision, and they are the reason it is an
 * acceptable one. They can only run here, in the repository that holds both
 * plugins, and they fail on the first divergence rather than after somebody
 * notices the Pauses reading a different config from the gates.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults as bancadaDefaults } from "../../bancada/lib/config.mjs";
import { RECORD_KEYS as BANCADA_KEYS, STREAM_FILE as BANCADA_STREAM } from "../../bancada/lib/telemetry.mjs";
import { compileGlob as bancadaGlob } from "../../bancada/lib/glob.mjs";
import { toProjectRelative as bancadaRelative } from "../../bancada/lib/structure.mjs";
import { toProjectRelative } from "./paths.mjs";
import { FLOW_DEFAULTS, PAIR_DEFAULTS, TELEMETRY_DEFAULTS } from "./config.mjs";
import { RECORD_KEYS, STREAM_FILE, DEFAULT_TELEMETRY_DIR } from "./record.mjs";
import { compileGlob } from "./glob.mjs";

test("the flow defaults match the SPEC that validates them", () => {
  assert.deepEqual(FLOW_DEFAULTS, bancadaDefaults().flow);
});

test("the pair defaults match, so the two gates agree on what a test is", () => {
  assert.deepEqual(PAIR_DEFAULTS, bancadaDefaults().pair);
});

test("the telemetry defaults match, so both plugins write to one stream", () => {
  assert.deepEqual(TELEMETRY_DEFAULTS, bancadaDefaults().telemetry);
  assert.equal(DEFAULT_TELEMETRY_DIR, bancadaDefaults().telemetry.dir);
  assert.equal(STREAM_FILE, BANCADA_STREAM);
});

test("the record key order matches, so one reader parses both writers", () => {
  assert.deepEqual(RECORD_KEYS, BANCADA_KEYS);
});

test("the copied path reconciliation agrees with the original", () => {
  const BS = String.fromCharCode(92);
  const cases = [
    ["/home/me/proj/src/a.ts", "/home/me/proj"],
    ["src/a.ts", "/home/me/proj"],
    ["/elsewhere/src/a.ts", "/home/me/proj"],
    ["src/a.ts", ""],
    ["src/a.ts", undefined],
    [["D:", "Projects", "p", "src", "a.ts"].join(BS), "d:/Projects/p"],
    ["/home/me/proj/src/a.ts", "/home/me/proj/"],
  ];
  for (const [file, root] of cases) {
    assert.equal(
      toProjectRelative(file, root),
      bancadaRelative(file, root),
      `the copies disagree on ${file} under ${root}`,
    );
  }
});

test("the copied glob matcher agrees with the original", () => {
  const cases = [
    ["src/**", "src/a/b.ts"],
    ["src/**", "srcx/a.ts"],
    ["**/*.test.*", "a/b/c.test.mjs"],
    ["**/*.test.*", "a/b/ctest.mjs"],
    ["src/*.ts", "src/a.ts"],
    ["src/*.ts", "src/a/b.ts"],
    ["{a,b}/**", "b/c.ts"],
    ["docs/briefs/**", "docs/briefs/main.md"],
    ["[abc]/x", "b/x"],
    ["[!abc]/x", "b/x"],
    ["a?c.ts", "abc.ts"],
    ["**/node_modules/**", "x/node_modules/y/z.js"],
  ];
  for (const [pattern, path] of cases) {
    assert.equal(
      compileGlob(pattern)(path),
      bancadaGlob(pattern)(path),
      `the copies disagree on ${pattern} against ${path}`,
    );
  }
});
