import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecord, hashInput, record, RECORD_KEYS } from "./record.mjs";

const at = Date.parse("2026-08-23T12:00:00.000Z");
const build = (input, verdict, startedAt = at - 4) =>
  buildRecord({ input, verdict, startedAt, now: at, env: {} });

test("a record carries the plugin as the gate and the Pause as the rule", () => {
  // One gate name for the whole plugin. The report then reads "flow applied N
  // times, and here is which Pause spoke", which is the question worth asking of
  // a process nobody has proved yet.
  const r = build({ tool_name: "Write" }, { decision: "deny", rule: "pause-brief-missing" });
  assert.equal(r.check, "flow");
  assert.equal(r.rule, "pause-brief-missing");
  assert.equal(r.decision, "deny");
});

test("every Pause that looked is in the record, not only the one that spoke", () => {
  const verdict = {
    decision: "deny",
    rule: "pause-brief-missing",
    verdicts: [
      { decision: "deny", rule: "pause-brief-missing" },
      { decision: "allow", rule: "pause-tests-out-of-scope" },
    ],
  };
  const r = build({ tool_name: "Write" }, verdict);
  assert.equal(r.checks.length, 2);
  assert.deepEqual(
    r.checks.map((c) => c.rule),
    ["pause-brief-missing", "pause-tests-out-of-scope"],
  );
  assert.ok(r.checks.every((c) => c.name === "flow"));
});

test("keys appear in the fixed order, so one reader parses both plugins' writes", () => {
  const r = build({ tool_name: "Bash", tool_input: { command: "git commit" } }, { decision: "allow", rule: "x" });
  const seen = Object.keys(r);
  assert.deepEqual(seen, RECORD_KEYS.filter((k) => seen.includes(k)));
});

test("absent optional fields are dropped rather than written as blanks", () => {
  const r = build({ tool_name: "Write" }, { decision: "allow", rule: "pause-brief-ok" });
  assert.equal("agent" in r, false, "no role on the payload is not a blank role");
  assert.equal("effort" in r, false);
});

test("a command is hashed, never written", () => {
  const command = 'git commit -m "something private"';
  const r = build({ tool_name: "Bash", tool_input: { command } }, { decision: "ask", rule: "pause-evidence-open" });
  assert.equal(r.inputKind, "command");
  assert.equal(r.inputHash.length, 12);
  assert.equal(JSON.stringify(r).includes("something private"), false);
});

test("an absent input hashes to the empty string, not to the digest of one", () => {
  // Otherwise every input-less event shares a digest and reads as one input
  // recurring, corrupting the measurement the stream exists to make.
  assert.equal(hashInput(undefined), "");
  assert.equal(hashInput(""), "");
  assert.notEqual(hashInput("x"), "");
});

test("a write that cannot happen returns false rather than throwing", () => {
  // Emission never changes a verdict, on any path.
  assert.equal(
    record({ projectDir: "\0invalid", input: {}, verdict: { decision: "allow" } }),
    false,
  );
});
