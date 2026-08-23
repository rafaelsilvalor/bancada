import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults, merge } from "./config.mjs";
import { CHECKS, PRE_TOOL_USE_CHECKS, STOP_CHECKS } from "./checks/index.mjs";
import { dispatch } from "./dispatch.mjs";
import { secretsCheck } from "./checks/secrets.mjs";
import { sizeCheck } from "./checks/size.mjs";
import { pairCheck } from "./checks/pair.mjs";
import { greenCheck } from "./checks/green.mjs";

const NL = String.fromCharCode(10);
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join(NL);
const AWS = "AKIA" + "JQ3XN7ZP4LMTKW2D";

const config = (over) => merge(defaults(), over ?? {});
const write = (file_path, content) => ({ tool_name: "Write", tool_input: { file_path, content } });

// --- the registries ---

test("each registry holds only checks for its own event", () => {
  assert.ok(PRE_TOOL_USE_CHECKS.every((c) => c.event === "PreToolUse"));
  assert.ok(STOP_CHECKS.every((c) => c.event === "Stop"));
  assert.equal(CHECKS.length, PRE_TOOL_USE_CHECKS.length + STOP_CHECKS.length);
});

test("no two checks share a name, because the report keys on it", () => {
  const names = CHECKS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
});

test("the tool-call registry carries no Stop check", () => {
  // The behavioural half of keeping the green boundary out of the hot path. The
  // other half — that its module is not even loaded there — is held by the
  // committed hotPathFiles list in cost-baseline.json.
  assert.equal(
    PRE_TOOL_USE_CHECKS.some((c) => c.name === "green"),
    false,
  );
});

test("every check declares the four things the dispatcher calls", () => {
  for (const c of CHECKS) {
    assert.equal(typeof c.name, "string", `${c.name}: name`);
    assert.equal(typeof c.event, "string", `${c.name}: event`);
    assert.equal(typeof c.applies, "function", `${c.name}: applies`);
    assert.equal(typeof c.run, "function", `${c.name}: run`);
  }
});

// --- the secret check ---

test("the secret check reads a write and a shell command, and nothing else", () => {
  const c = config();
  assert.equal(secretsCheck.applies(write("src/a.mjs", "x"), c), true);
  assert.equal(secretsCheck.applies({ tool_name: "Bash", tool_input: { command: "echo hi" } }, c), true);
  assert.equal(secretsCheck.applies({ tool_name: "Read", tool_input: { file_path: "a" } }, c), false);
  assert.equal(secretsCheck.applies(write("a", "x"), config({ gates: { secrets: { enabled: false } } })), false);
});

test("a credential in a shell command is refused, naming the command not a file", () => {
  const v = secretsCheck.run({ tool_name: "Bash", tool_input: { command: `export AWS_KEY=${AWS}` } }, config());
  assert.equal(v.decision, "deny");
  assert.equal(v.check, "secrets");
  assert.match(v.reason, /this shell command/);
});

test("a credential in a written file is refused, naming the file", () => {
  const v = secretsCheck.run(write("src/creds.mjs", `export const k = "${AWS}";`), config());
  assert.equal(v.decision, "deny");
  assert.match(v.reason, /src\/creds\.mjs/);
});

// --- the size check ---

const sized = (over) =>
  config(merge({ source: { include: ["src/**"] }, gates: { size: { enabled: true } } }, over ?? {}));

test("the size check applies only to writes, and only when it is on", () => {
  const on = sized();
  assert.equal(sizeCheck.applies(write("src/a.mjs", ""), on), true);
  assert.equal(sizeCheck.applies({ tool_name: "Bash", tool_input: { command: "ls" } }, on), false);
  assert.equal(sizeCheck.applies(write("src/a.mjs", ""), config()), false, "the gate ships off");
});

test("a file outside the project's source globs is not measured", () => {
  const on = sized();
  assert.equal(sizeCheck.applies(write("data/orders.json", ""), on), false);
  assert.equal(sizeCheck.applies(write("src/a.mjs", ""), sized({ source: { exclude: ["src/**"] } })), false);
});

test("with no source.include the size gate has nothing to measure and says nothing", () => {
  // Silently applying to everything would refuse a long fixture; silently
  // applying to nothing is what the config validator warns about.
  const on = config({ gates: { size: { enabled: true } } });
  assert.equal(sizeCheck.applies(write("src/a.mjs", ""), on), false);
});

test("a new file over the ceiling is refused without any file on disk", () => {
  const on = sized({ gates: { size: { maxFileLines: 10 } } });
  const v = sizeCheck.run(write("src/long.mjs", lines(40)), on, {
    readFile: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(v.decision, "deny");
  assert.equal(v.rule, "size-over");
});

test("an edit is judged against what the file will contain, read from disk", () => {
  const on = sized({ gates: { size: { maxFileLines: 10 } } });
  const input = { tool_name: "Edit", tool_input: { file_path: "src/a.mjs", old_string: "x", new_string: lines(40) } };
  const v = sizeCheck.run(input, on, { readFile: () => "x" });
  assert.equal(v.decision, "deny");
});

test("an unreadable file leaves the size check with no verdict rather than a guess", () => {
  const on = sized({ gates: { size: { maxFileLines: 10 } } });
  const input = { tool_name: "Edit", tool_input: { file_path: "src/a.mjs", old_string: "x", new_string: lines(40) } };
  const v = sizeCheck.run(input, on, {
    readFile: () => {
      throw new Error("EACCES");
    },
  });
  assert.equal(v.decision, "allow");
  assert.equal(v.rule, "size-unknown");
});

test("a test file gets the test ceiling through pair.testGlobs", () => {
  const on = sized({ gates: { size: { maxFileLines: 10, testCeiling: 100 } } });
  const v = sizeCheck.run(write("src/a.test.mjs", lines(40)), on, { readFile: () => null });
  assert.equal(v.decision, "allow");
});

// --- the pair check ---

test("the pair check does not apply without a role on the payload", () => {
  const on = config({ pair: { enabled: true } });
  assert.equal(pairCheck.applies(write("a.test.mjs", ""), on), false);
  assert.equal(pairCheck.applies({ ...write("a.test.mjs", ""), agent_type: "code" }, on), true);
  assert.equal(pairCheck.applies({ ...write("a.test.mjs", ""), agent_type: "code" }, config()), false);
});

test("the code role writing a test is refused through the check", () => {
  const on = config({ pair: { enabled: true } });
  const v = pairCheck.run({ ...write("src/a.test.mjs", ""), agent_type: "code" }, on);
  assert.equal(v.decision, "deny");
  assert.equal(v.check, "pair");
  assert.equal(v.rule, "pair-code-writes-test");
});

// --- the green check ---

test("the green check needs both the flag and at least one command", () => {
  assert.equal(greenCheck.applies({}, config()), false);
  assert.equal(greenCheck.applies({}, config({ gates: { green: { enabled: true } } })), false);
  assert.equal(
    greenCheck.applies({}, config({ gates: { green: { enabled: true, commands: ["npm test"] } } })),
    true,
  );
});

// --- through the dispatcher ---

test("two gates refusing one write report both problems at once", async () => {
  const c = sized({ gates: { size: { maxFileLines: 5 } } });
  const input = write("src/creds.mjs", `const k = "${AWS}";` + NL + lines(40));
  const r = await dispatch(input, c, PRE_TOOL_USE_CHECKS, "PreToolUse");
  assert.equal(r.decision, "deny");
  assert.equal(r.check, "secrets+size");
});

test("a clean write passes every gate that looked at it", async () => {
  const c = sized();
  const r = await dispatch(write("src/a.mjs", "export const a = 1;"), c, PRE_TOOL_USE_CHECKS, "PreToolUse");
  assert.equal(r.decision, "allow");
  assert.deepEqual(
    r.verdicts.map((v) => v.check),
    ["secrets", "size"],
    "the commit and layering gates did not apply and left no verdict",
  );
});
