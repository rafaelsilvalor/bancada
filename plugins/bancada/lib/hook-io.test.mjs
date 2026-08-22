import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  buildAsk,
  buildBlockStop,
  buildNote,
  effortOf,
  eventOf,
  EXIT_ALLOW,
  EXIT_DENY,
  parseHookInput,
} from "./hook-io.mjs";

// `import.meta.url` is already a file URL. Passing its `pathname` through
// `pathToFileURL` would double the drive letter on Windows (`file:///D:/D:/...`).
const MODULE_URL = JSON.stringify(new URL("./hook-io.mjs", import.meta.url).href);

/** Run a snippet in a child process so exit codes and streams are real, not mocked. */
function runInChild(body, { stdin = "" } = {}) {
  const script = `import * as io from ${MODULE_URL};\n${body}`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    input: stdin,
    encoding: "utf8",
  });
  // A child that died on a module or syntax error looks like an ordinary
  // assertion failure otherwise, which sends you hunting in the wrong file.
  if (r.status === 1 && /SyntaxError|Cannot find|ERR_/.test(r.stderr ?? "")) {
    throw new Error(`child failed to start:\n${r.stderr}`);
  }
  return r;
}

// --- parsing: the gate must survive whatever arrives on stdin ---

test("a well-formed payload parses", () => {
  assert.deepEqual(parseHookInput('{"hook_event_name":"PreToolUse"}'), {
    hook_event_name: "PreToolUse",
  });
});

test("empty, blank, malformed and non-object input all yield an empty object", () => {
  for (const raw of ["", "   ", "not json", "{oops", "null", "[1,2]", '"a string"', "42"]) {
    assert.deepEqual(parseHookInput(raw), {}, `input: ${JSON.stringify(raw)}`);
  }
});

test("non-string input yields an empty object rather than throwing", () => {
  for (const raw of [undefined, null, 42, {}, []]) {
    assert.deepEqual(parseHookInput(raw), {});
  }
});

// --- reading the payload ---

test("the event name defaults to PreToolUse when absent or blank", () => {
  assert.equal(eventOf({ hook_event_name: "Stop" }), "Stop");
  assert.equal(eventOf({}), "PreToolUse");
  assert.equal(eventOf({ hook_event_name: "" }), "PreToolUse");
  assert.equal(eventOf(undefined), "PreToolUse");
});

test("effort comes from the payload first, then the environment, then null", () => {
  assert.equal(effortOf({ effort: { level: "max" } }, { CLAUDE_EFFORT: "low" }), "max");
  assert.equal(effortOf({}, { CLAUDE_EFFORT: "low" }), "low");
  assert.equal(effortOf({}, {}), null);
  assert.equal(effortOf(undefined, {}), null);
});

// --- verdict shapes ---

test("an ask verdict names the event it belongs to", () => {
  assert.deepEqual(buildAsk("because", "PostToolUse"), {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "because",
    },
  });
});

test("an ask verdict defaults to PreToolUse", () => {
  assert.equal(buildAsk("r").hookSpecificOutput.hookEventName, "PreToolUse");
});

test("a stop block uses the decision field, because Stop has no exit-2 form", () => {
  assert.deepEqual(buildBlockStop("tests are red"), {
    decision: "block",
    reason: "tests are red",
  });
});

test("a note carries no verdict", () => {
  const n = buildNote("just saying");
  assert.deepEqual(n, { systemMessage: "just saying" });
  assert.equal("decision" in n, false);
  assert.equal("hookSpecificOutput" in n, false);
});

test("reasons are coerced to strings so a thrown object cannot corrupt the payload", () => {
  assert.equal(typeof buildBlockStop({ toString: () => "obj" }).reason, "string");
  assert.equal(buildAsk(42).hookSpecificOutput.permissionDecisionReason, "42");
});

// --- the channels, observed in a real process ---

test("allow exits 0 and writes nothing", () => {
  const r = runInChild("io.allow();");
  assert.equal(r.status, EXIT_ALLOW);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("deny exits 2 and puts the reason on stderr where the model reads it", () => {
  const r = runInChild('io.deny("no bare git push");');
  assert.equal(r.status, EXIT_DENY);
  assert.equal(r.stderr, "no bare git push");
  assert.equal(r.stdout, "", "a refusal travels on stderr, not stdout");
});

test("ask exits 0 and emits the structured verdict on stdout", () => {
  const r = runInChild('io.ask("check this", "PreToolUse");');
  assert.equal(r.status, EXIT_ALLOW);
  assert.deepEqual(JSON.parse(r.stdout), buildAsk("check this", "PreToolUse"));
});

test("blockStop exits 0 and emits the block on stdout", () => {
  const r = runInChild('io.blockStop("build is red");');
  assert.equal(r.status, EXIT_ALLOW);
  assert.deepEqual(JSON.parse(r.stdout), buildBlockStop("build is red"));
});

// --- the invariant that matters most: a broken gate never blocks ---

test("abstain exits 0, so a gate that cannot run does not stop the work", () => {
  const r = runInChild('io.abstain("config unreadable");');
  assert.equal(r.status, EXIT_ALLOW);
  assert.match(r.stderr, /bancada abstained: config unreadable/);
  assert.equal(r.stdout, "");
});

test("runGate turns a thrown error into an abstain, not a deny", () => {
  const r = runInChild('await io.runGate(() => { throw new Error("boom"); });');
  assert.equal(r.status, EXIT_ALLOW, "a bug in a gate must not block a tool call");
  assert.match(r.stderr, /bancada abstained/);
  assert.match(r.stderr, /boom/);
});

test("runGate turns a rejected promise into an abstain too", () => {
  const r = runInChild('await io.runGate(async () => { throw new Error("async boom"); });');
  assert.equal(r.status, EXIT_ALLOW);
  assert.match(r.stderr, /async boom/);
});

test("a gate body that returns without emitting is an allow", () => {
  const r = runInChild("await io.runGate(() => {});");
  assert.equal(r.status, EXIT_ALLOW);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("a gate body may still deny from inside runGate", () => {
  const r = runInChild('await io.runGate(() => io.deny("refused from inside"));');
  assert.equal(r.status, EXIT_DENY);
  assert.equal(r.stderr, "refused from inside");
});

test("readHookInput returns an empty object when stdin is empty", () => {
  const r = runInChild("process.stdout.write(JSON.stringify(io.readHookInput()));", { stdin: "" });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), {});
});

test("readHookInput parses a payload piped on stdin", () => {
  const r = runInChild("process.stdout.write(JSON.stringify(io.readHookInput()));", {
    stdin: '{"hook_event_name":"Stop","cwd":"/tmp"}',
  });
  assert.deepEqual(JSON.parse(r.stdout), { hook_event_name: "Stop", cwd: "/tmp" });
});
