import { test } from "node:test";
import assert from "node:assert/strict";
import { runSweep } from "./sweep.mjs";
import { defaults, merge } from "./config.mjs";
import { structureCheck } from "./checks/structure.mjs";

const LAYERS = [
  { name: "lib", match: "src/lib/**", mayImport: [] },
  { name: "app", match: "src/app/**", mayImport: ["lib"] },
];

const loader = (override) => () => ({
  config: merge(defaults(), override),
  source: "file",
  file: "/proj/bancada.config.json",
  errors: [],
  warnings: [],
});

const filesOf = (names, source = "git") => () => ({ files: names, source, truncated: false });
const reader = (map) => (path) => {
  const key = String(path).replace(/\\/g, "/").replace(/^.*?\/(src\/.*)$/, "$1");
  if (key in map) return map[key];
  throw new Error("ENOENT");
};

const configured = { gates: { structure: { enabled: true, layers: LAYERS } } };

// --- the sweep ---

test("with no layering configured there is nothing to check", () => {
  const r = runSweep({ loadConfig: loader({}), listFiles: filesOf([]), readFile: () => "" });
  assert.equal(r.exitCode, 0);
  assert.equal(r.summary.configured, false);
  assert.match(r.lines.join("\n"), /No layering is configured/);
});

test("a clean project reports no violation and exits zero", () => {
  const r = runSweep({
    loadConfig: loader(configured),
    listFiles: filesOf(["src/lib/a.ts", "src/app/b.ts"]),
    readFile: reader({
      "src/lib/a.ts": 'import { x } from "./x.js";',
      "src/app/b.ts": 'import { a } from "../lib/a.js";',
    }),
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.summary.violations, 0);
  assert.equal(r.summary.checked, 2);
});

test("an existing violation fails the sweep, because a rule nothing enforces is a comment", () => {
  const r = runSweep({
    loadConfig: loader(configured),
    listFiles: filesOf(["src/lib/a.ts"]),
    readFile: reader({ "src/lib/a.ts": 'import { b } from "../app/b.js";' }),
  });
  assert.equal(r.exitCode, 1, "this one is meant to be runnable in CI");
  assert.equal(r.summary.violations, 1);
  const text = r.lines.join("\n");
  assert.match(text, /src\/lib\/a\.ts/);
  assert.match(text, /"lib" → "app"/);
});

test("files outside every layer are not counted as checked", () => {
  const r = runSweep({
    loadConfig: loader(configured),
    listFiles: filesOf(["src/lib/a.ts", "scripts/build.mjs", "README.md"]),
    readFile: reader({ "src/lib/a.ts": "" }),
  });
  assert.equal(r.summary.checked, 1);
});

test("non-source files are skipped without being read", () => {
  let reads = 0;
  runSweep({
    loadConfig: loader(configured),
    listFiles: filesOf(["src/lib/notes.md", "src/lib/data.json", "src/lib/a.ts"]),
    readFile: (p) => {
      reads++;
      return "";
    },
  });
  assert.equal(reads, 1, "only the source file was opened");
});

test("a file that cannot be read is skipped rather than reported as a violation", () => {
  const r = runSweep({
    loadConfig: loader(configured),
    listFiles: filesOf(["src/lib/gone.ts"]),
    readFile: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.summary.checked, 0);
});

test("unattributed imports are counted and disclosed rather than implied away", () => {
  const r = runSweep({
    loadConfig: loader(configured),
    listFiles: filesOf(["src/lib/a.ts"]),
    readFile: reader({ "src/lib/a.ts": 'import fs from "node:fs";\nimport z from "zod";' }),
  });
  assert.equal(r.summary.unknown, 2);
  assert.match(r.lines.join("\n"), /2 import\(s\) could not be attributed/);
});

test("every violation in a file is listed, not only the first", () => {
  const r = runSweep({
    loadConfig: loader(configured),
    listFiles: filesOf(["src/lib/a.ts"]),
    readFile: reader({ "src/lib/a.ts": 'import { b } from "../app/b.js";\nimport { c } from "../app/c.js";' }),
  });
  assert.equal(r.summary.violations, 2);
});

// --- the check adapter ---

test("the check applies only to write tools, and only when layers exist", () => {
  const config = merge(defaults(), configured);
  const write = { tool_name: "Write", tool_input: { file_path: "src/lib/a.ts", content: "" } };

  assert.equal(structureCheck.applies(write, config), true);
  assert.equal(structureCheck.applies({ ...write, tool_name: "Bash" }, config), false);
  assert.equal(structureCheck.applies({ tool_name: "Write", tool_input: {} }, config), false);

  const noLayers = merge(defaults(), { gates: { structure: { enabled: true, layers: [] } } });
  assert.equal(structureCheck.applies(write, noLayers), false);

  const disabled = merge(defaults(), { gates: { structure: { enabled: false, layers: LAYERS } } });
  assert.equal(structureCheck.applies(write, disabled), false);
});

test("the check reports the gate name and the rule separately", () => {
  const config = merge(defaults(), configured);
  const v = structureCheck.run(
    { tool_name: "Write", tool_input: { file_path: "src/lib/a.ts", content: 'import x from "../app/b.js";' } },
    config,
  );
  assert.equal(v.decision, "deny");
  assert.equal(v.check, "structure");
  assert.equal(v.rule, "structure-layer");
});
