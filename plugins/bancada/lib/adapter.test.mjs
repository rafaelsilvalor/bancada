import { test } from "node:test";
import assert from "node:assert/strict";
import { runAdapter, runSweep } from "./sweep.mjs";
import { defaults, merge } from "./config.mjs";

const NL = String.fromCharCode(10);

/** A fake spawn, so the tests never depend on a tool being installed. */
const spawner = (result) => () => result;
const throwing = (message) => () => {
  throw new Error(message);
};

// --- running the project's own checker ---

test("no command configured means no adapter result at all", () => {
  for (const command of ["", "   ", null, undefined, 42]) {
    assert.equal(runAdapter(command, "/proj", { spawn: spawner({}) }), null);
  }
});

test("a checker that exits zero reports no problem", () => {
  const r = runAdapter("depcruise src", "/proj", { spawn: spawner({ status: 0, stdout: "ok", stderr: "" }) });
  assert.equal(r.ran, true);
  assert.equal(r.ok, true);
  assert.equal(r.status, 0);
});

test("a checker that exits non-zero carries its own output as the reason", () => {
  const r = runAdapter("depcruise src", "/proj", {
    spawn: spawner({ status: 1, stdout: "error dep-cycle: a -> b -> a", stderr: "" }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 1);
  assert.match(r.output, /dep-cycle/);
});

test("stdout and stderr are both kept, since checkers disagree about which to use", () => {
  const r = runAdapter("x", "/proj", { spawn: spawner({ status: 1, stdout: "from stdout", stderr: "from stderr" }) });
  assert.match(r.output, /from stdout/);
  assert.match(r.output, /from stderr/);
});

test("an empty stream is not joined into stray blank lines", () => {
  const r = runAdapter("x", "/proj", { spawn: spawner({ status: 1, stdout: "only this", stderr: "" }) });
  assert.equal(r.output, "only this");
});

test("a command that cannot start is reported as not run, not as a violation", () => {
  const missing = runAdapter("depcruise", "/proj", { spawn: spawner({ error: new Error("ENOENT") }) });
  assert.equal(missing.ran, false);
  assert.match(missing.reason, /ENOENT/);

  const threw = runAdapter("depcruise", "/proj", { spawn: throwing("spawn failed") });
  assert.equal(threw.ran, false);
  assert.match(threw.reason, /spawn failed/);
});

test("a command killed by timeout is reported as not run", () => {
  const r = runAdapter("slow", "/proj", { spawn: spawner({ signal: "SIGTERM" }) });
  assert.equal(r.ran, false);
  assert.match(r.reason, /SIGTERM/);
});

// --- how the sweep uses it ---

const LAYERS = [
  { name: "lib", match: "src/lib/**", mayImport: [] },
  { name: "app", match: "src/app/**", mayImport: ["lib"] },
];

const loader = (adapterCommand = "") => () => ({
  config: merge(defaults(), { gates: { structure: { enabled: true, layers: LAYERS, adapterCommand } } }),
  source: "file",
  file: "/proj/bancada.config.json",
  errors: [],
  warnings: [],
});

const filesOf = (names) => () => ({ files: names, source: "git", truncated: false });
const clean = { "src/lib/a.ts": 'import { x } from "./x.js";' };
const dirty = { "src/lib/a.ts": 'import { b } from "../app/b.js";' };
const reader = (map) => (p) => {
  const key = String(p).replace(/\\/g, "/").replace(/^.*?(src\/.*)$/, "$1");
  if (key in map) return map[key];
  throw new Error("ENOENT");
};

/**
 * The sweep cannot inject a spawn, so these drive it through the real one with
 * shell commands that exist everywhere.
 */
const sweep = (adapterCommand, files) =>
  runSweep({
    projectDir: process.cwd(),
    loadConfig: loader(adapterCommand),
    listFiles: filesOf(Object.keys(files)),
    readFile: reader(files),
  });

test("a failing checker fails the sweep even when the native rules are clean", () => {
  const r = sweep("node -e \"process.exit(3)\"", clean);
  assert.equal(r.exitCode, 1);
  assert.equal(r.summary.violations, 0, "the native rules found nothing");
  assert.equal(r.summary.adapter.ok, false);
  assert.match(r.lines.join(NL), /own checker reported a problem \(exit 3\)/);
});

test("a passing checker leaves a clean sweep clean", () => {
  const r = sweep("node -e \"process.exit(0)\"", clean);
  assert.equal(r.exitCode, 0);
  assert.match(r.lines.join(NL), /own checker reported no problem/);
});

test("a checker that does not exist is reported without failing the sweep", () => {
  const r = sweep("this-binary-does-not-exist-anywhere --check", clean);
  assert.equal(r.exitCode, 0, "a missing binary is a setup problem, not a layering violation");
  assert.match(r.lines.join(NL), /setup problem, not a violation/);
});

test("native violations and a checker failure are both reported, not one or the other", () => {
  const r = sweep("node -e \"console.log('cycle found'); process.exit(1)\"", dirty);
  const text = r.lines.join(NL);
  assert.equal(r.exitCode, 1);
  assert.match(text, /src\/lib\/a\.ts/, "the native violation is still listed");
  assert.match(text, /cycle found/, "and so is the checker's own output");
});

test("with no adapter configured the summary says so rather than inventing a result", () => {
  const r = sweep("", clean);
  assert.equal(r.summary.adapter, null);
  assert.doesNotMatch(r.lines.join(NL), /own checker/);
});
