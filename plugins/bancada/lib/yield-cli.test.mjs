import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults } from "./config.mjs";
import { runYield } from "./yield-cli.mjs";

/** A loaded config, with only the knobs a case cares about overridden. */
const configOf = (over = {}) => {
  const config = defaults();
  return { config: { ...config, ...over }, source: "file", file: "bancada.config.json", errors: [], warnings: [] };
};

const streamOf = (records) => () => records.map((r) => JSON.stringify(r)).join("\n") + "\n";

const REC = {
  ts: "2026-08-23T10:00:00.000Z",
  session: "s-1",
  event: "PreToolUse",
  tool: "Bash",
  decision: "allow",
  check: "commit",
  inputKind: "command",
  inputHash: "aaaaaaaaaaaa",
  checks: [{ name: "commit", rule: "commit-none", decision: "allow" }],
};

const run = (over, records) =>
  runYield({ projectDir: "/proj", loadConfig: () => configOf(over), readFile: streamOf(records) });

test("telemetry switched off is reported rather than read as an empty stream", () => {
  const r = runYield({
    projectDir: "/proj",
    loadConfig: () => configOf({ telemetry: { enabled: false, dir: ".bancada/telemetry" } }),
    readFile: () => {
      throw new Error("should not be read");
    },
  });
  assert.equal(r.summary.enabled, false);
  assert.match(r.lines.join("\n"), /Telemetry is disabled/);
});

test("an absent stream is itself a finding, not an error", () => {
  const r = runYield({
    projectDir: "/proj",
    loadConfig: () => configOf(),
    readFile: () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.summary.stream, false);
  assert.match(r.lines.join("\n"), /its absence is itself a finding/);
});

test("a Pause that is switched on and never fired is named in the report", () => {
  // The gap this closes. The list came from bancada's own registry, so the one
  // gate this report could not see was the one from the plugin with the least
  // evidence behind it — the plugin the report matters most for.
  const r = run({ flow: { ...defaults().flow, enabled: true } }, [REC]);
  const names = r.summary.neverFired.map((c) => c.name);
  assert.ok(names.includes("flow"), `flow was missing from ${JSON.stringify(names)}`);
  assert.match(r.lines.join("\n"), /flow \(bancada-flow\)/);
});

test("a Pause nobody switched on is not named, because that would be noise", () => {
  const r = run({}, [REC]);
  assert.equal(defaults().flow.enabled, false, "the default is off, which is what this case rests on");
  assert.ok(
    !r.summary.neverFired.some((c) => c.name === "flow"),
    "a plugin the project never asked for was reported as dead weight",
  );
});

test("a Pause that did report is not named, and is counted as a gate", () => {
  const flowRecord = { ...REC, check: "flow", checks: [{ name: "flow", rule: "pause-brief-ok", decision: "allow" }] };
  const r = run({ flow: { ...defaults().flow, enabled: true } }, [REC, flowRecord]);
  assert.ok(!r.summary.neverFired.some((c) => c.name === "flow"));
  assert.equal(r.summary.checks.find((c) => c.name === "flow").applied, 1);
});

test("bancada's own gates are named whether or not they are switched on", () => {
  // Their registry is complete, so silence from one of them has a single
  // meaning. `doctor` is where a reader checks which are on.
  const r = run({}, [REC]);
  const names = r.summary.neverFired.map((c) => c.name);
  for (const name of ["secrets", "size", "green", "structure", "pair"]) {
    assert.ok(names.includes(name), `${name} was missing from ${JSON.stringify(names)}`);
  }
  assert.ok(r.summary.neverFired.every((c) => c.plugin === null || c.plugin === "bancada-flow"));
});
