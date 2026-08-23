import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, formatReport, parseStream } from "./yield.mjs";

const rec = (over = {}) => ({
  ts: "2026-08-22T12:00:00.000Z",
  session: "s-1",
  event: "PreToolUse",
  tool: "Bash",
  decision: "allow",
  check: "none",
  inputKind: "command",
  inputHash: "aaaaaaaaaaaa",
  checks: [],
  ...over,
});

const lines = (records) => records.map((r) => JSON.stringify(r)).join("\n") + "\n";

// --- parsing ---

test("well-formed lines parse and blank lines are ignored", () => {
  const { records, damaged } = parseStream('{"a":1}\n\n{"b":2}\n');
  assert.equal(records.length, 2);
  assert.equal(damaged, 0);
});

test("a damaged line is counted, never silently dropped", () => {
  // Five writers appending to one file can leave a half-written line. Hiding
  // it would shrink the denominator and make every percentage a small lie.
  const { records, damaged } = parseStream('{"a":1}\n{"b":2\n{"c":3}\n');
  assert.equal(records.length, 2);
  assert.equal(damaged, 1);
});

test("a line that is valid JSON but not a record counts as damaged", () => {
  const { records, damaged } = parseStream("[1,2,3]\n\"a string\"\n42\nnull\n");
  assert.equal(records.length, 0);
  assert.equal(damaged, 4);
});

test("an empty or absent stream parses to nothing without error", () => {
  for (const input of ["", "   ", null, undefined]) {
    const { records, damaged } = parseStream(input);
    assert.equal(records.length, 0);
    assert.equal(damaged, 0);
  }
});

// --- aggregation ---

test("decisions are counted and an unknown decision is not swallowed", () => {
  const agg = aggregate([
    rec({ decision: "allow" }),
    rec({ decision: "deny" }),
    rec({ decision: "deny" }),
    rec({ decision: "ask" }),
    rec({ decision: "wat" }),
  ]);
  assert.equal(agg.total, 5);
  assert.deepEqual(agg.totals, { allow: 1, ask: 1, deny: 2, other: 1 });
});

test("sessions are counted distinctly and blanks do not inflate the number", () => {
  const agg = aggregate([rec({ session: "a" }), rec({ session: "a" }), rec({ session: "b" }), rec({ session: "" })]);
  assert.equal(agg.sessions, 2);
});

test("the window spans the earliest and latest timestamp, whatever the order", () => {
  const agg = aggregate([
    rec({ ts: "2026-08-22T15:00:00.000Z" }),
    rec({ ts: "2026-08-22T09:00:00.000Z" }),
    rec({ ts: "2026-08-22T12:00:00.000Z" }),
  ]);
  assert.equal(agg.window.first, "2026-08-22T09:00:00.000Z");
  assert.equal(agg.window.last, "2026-08-22T15:00:00.000Z");
});

test("per-check tallies come from the checks array, not the folded decision", () => {
  const agg = aggregate([
    rec({
      decision: "deny",
      checks: [
        { name: "size", decision: "allow" },
        { name: "commit", decision: "deny" },
      ],
    }),
    rec({ decision: "allow", checks: [{ name: "size", decision: "allow" }] }),
  ]);
  const size = agg.checks.find((c) => c.name === "size");
  const commit = agg.checks.find((c) => c.name === "commit");
  assert.deepEqual({ applied: size.applied, allow: size.allow, deny: size.deny }, { applied: 2, allow: 2, deny: 0 });
  assert.deepEqual({ applied: commit.applied, deny: commit.deny }, { applied: 1, deny: 1 });
});

test("checks are ordered by how often they applied", () => {
  const agg = aggregate([
    rec({ checks: [{ name: "rare", decision: "allow" }] }),
    rec({ checks: [{ name: "common", decision: "allow" }] }),
    rec({ checks: [{ name: "common", decision: "allow" }] }),
  ]);
  assert.equal(agg.checks[0].name, "common");
});

// --- the two findings the report exists for ---

test("a registered check that never appears is named as never fired", () => {
  const agg = aggregate([rec({ checks: [{ name: "commit", decision: "allow" }] })], ["commit", "secrets", "size"]);
  assert.deepEqual(agg.neverFired.map((c) => c.name).sort(), ["secrets", "size"]);
});

test("a gate another plugin enforces is named too, and is named as theirs", () => {
  // The gap this closes. `bancada yield` built this list from bancada's own
  // registry, so a Pause that was switched on and never fired was invisible to
  // the report that exists to find exactly that.
  const agg = aggregate([rec({ checks: [{ name: "commit", decision: "allow" }] })], [
    "commit",
    { name: "flow", plugin: "bancada-flow" },
  ]);
  assert.deepEqual(agg.neverFired, [{ name: "flow", plugin: "bancada-flow" }]);
});

test("a foreign gate that did report is not named as never fired", () => {
  const agg = aggregate([rec({ checks: [{ name: "flow", rule: "pause-brief-ok", decision: "allow" }] })], [
    { name: "flow", plugin: "bancada-flow" },
  ]);
  assert.deepEqual(agg.neverFired, []);
});

test("a rule is attributed to its gate, so the gate does not read as never fired", () => {
  // A record names the gate and the rule separately. Before it did, this
  // needed a prefix match to avoid calling `commit` dead when only
  // `commit-trailer` appeared — a workaround that was really a sign the record
  // was conflating two different facts.
  const agg = aggregate(
    [rec({ checks: [{ name: "commit", rule: "commit-trailer", decision: "deny" }] })],
    ["commit", "secrets"],
  );
  assert.deepEqual(agg.neverFired, [{ name: "secrets", plugin: null }]);
  assert.equal(agg.checks[0].name, "commit");
});

test("rules are counted within their gate, ordered by how often each fired", () => {
  const agg = aggregate([
    rec({ checks: [{ name: "commit", rule: "commit-none", decision: "allow" }] }),
    rec({ checks: [{ name: "commit", rule: "commit-none", decision: "allow" }] }),
    rec({ checks: [{ name: "commit", rule: "commit-trailer", decision: "deny" }] }),
  ]);
  const commit = agg.checks.find((c) => c.name === "commit");
  assert.equal(commit.applied, 3, "one gate, applied three times");
  assert.equal(commit.deny, 1);
  assert.deepEqual(commit.rules, [
    { rule: "commit-none", n: 2 },
    { rule: "commit-trailer", n: 1 },
  ]);
});

test("a check with no rule falls back to its own name, so nothing goes uncounted", () => {
  const agg = aggregate([rec({ checks: [{ name: "secrets", decision: "allow" }] })]);
  assert.deepEqual(agg.checks[0].rules, [{ rule: "secrets", n: 1 }]);
});

test("the report shows the gate once, with its rules beneath it", () => {
  const text = formatReport(
    aggregate([
      rec({ checks: [{ name: "commit", rule: "commit-ok", decision: "allow" }] }),
      rec({ decision: "deny", checks: [{ name: "commit", rule: "commit-trailer", decision: "deny" }] }),
    ]),
  ).join("\n");
  assert.match(text, /commit\s+applied\s+2/);
  assert.match(text, /1\s+commit-ok/);
  assert.match(text, /1\s+commit-trailer/);
});

test("a recurring refusal is labelled by the rule that refused it, not the gate", () => {
  const agg = aggregate([
    rec({ decision: "deny", rule: "commit-conventional", inputHash: "abc123abc123" }),
    rec({ decision: "deny", rule: "commit-conventional", inputHash: "abc123abc123" }),
  ]);
  assert.equal(agg.recurring[0].check, "commit-conventional");
});

test("the same input refused twice is reported as recurring", () => {
  const agg = aggregate([
    rec({ decision: "deny", inputHash: "deadbeefcafe", check: "commit" }),
    rec({ decision: "deny", inputHash: "deadbeefcafe", check: "commit" }),
    rec({ decision: "deny", inputHash: "0123456789ab", check: "commit" }),
  ]);
  assert.equal(agg.recurring.length, 1);
  assert.equal(agg.recurring[0].hash, "deadbeefcafe");
  assert.equal(agg.recurring[0].count, 2);
});

test("the same input allowed twice is not recurring; only refusals count", () => {
  const agg = aggregate([
    rec({ decision: "allow", inputHash: "same" }),
    rec({ decision: "allow", inputHash: "same" }),
  ]);
  assert.deepEqual(agg.recurring, []);
});

test("records with no input hash never group together as one recurring input", () => {
  const agg = aggregate([
    rec({ decision: "deny", inputHash: "" }),
    rec({ decision: "deny", inputHash: "" }),
    rec({ decision: "deny", inputHash: "" }),
  ]);
  assert.deepEqual(agg.recurring, [], "an absent input is not an input seen three times");
});

test("recurring refusals are ordered by how often they repeated", () => {
  const agg = aggregate([
    ...Array(2).fill(rec({ decision: "deny", inputHash: "twice" })),
    ...Array(5).fill(rec({ decision: "deny", inputHash: "fivetimes" })),
  ]);
  assert.equal(agg.recurring[0].hash, "fivetimes");
});

test("a check error is tallied and kept", () => {
  const agg = aggregate([rec({ checks: [{ name: "broken", decision: "allow", error: "boom" }] })]);
  assert.equal(agg.checks.find((c) => c.name === "broken").errors, 1);
  assert.equal(agg.errors[0].error, "boom");
});

// --- the report ---

test("an empty stream says so, and says why that is not the same as clean", () => {
  const text = formatReport(aggregate([])).join("\n");
  assert.match(text, /stream is empty/);
  assert.match(text, /cannot tell the two apart/);
});

test("damaged lines are surfaced in the report, not hidden", () => {
  const text = formatReport(aggregate([rec()]), { damaged: 3 }).join("\n");
  assert.match(text, /3 unreadable line\(s\)/);
});

test("a window with denials reports them with a percentage", () => {
  const text = formatReport(
    aggregate([rec({ decision: "deny" }), rec({ decision: "allow" }), rec({ decision: "allow" })]),
  ).join("\n");
  assert.match(text, /deny\s+33%/);
});

test("a window with no refusal at all says the stream cannot tell you why", () => {
  const text = formatReport(aggregate([rec({ decision: "allow" })])).join("\n");
  assert.match(text, /Nothing has been refused or escalated/);
  assert.match(text, /a deliberately bad input can/);
});

test("a recurring refusal is called friction rather than feedback", () => {
  const text = formatReport(
    aggregate([
      rec({ decision: "deny", inputHash: "abc123abc123", check: "commit" }),
      rec({ decision: "deny", inputHash: "abc123abc123", check: "commit" }),
    ]),
  ).join("\n");
  assert.match(text, /Refused more than once/);
  assert.match(text, /abc123abc123\s+2x/);
  assert.match(text, /friction, not feedback/);
});

test("a never-fired check is named in the report", () => {
  const text = formatReport(aggregate([rec()], ["secrets"])).join("\n");
  assert.match(text, /Never fired/);
  assert.match(text, /secrets/);
});

test("a foreign gate's silence names the plugin and both of its causes", () => {
  // bancada can read the config that switched it on and the stream it did not
  // write to, and nothing in between. Naming one cause would be a guess.
  const text = formatReport(aggregate([rec()], [{ name: "flow", plugin: "bancada-flow" }])).join("\n");
  assert.match(text, /flow \(bancada-flow\)/);
  assert.match(text, /switched on in this project's config/);
  assert.match(text, /bancada-flow is not installed/);
});

test("the report round-trips from a raw stream", () => {
  const raw = lines([rec({ decision: "deny", checks: [{ name: "commit", decision: "deny" }] }), rec()]);
  const { records, damaged } = parseStream(raw);
  const text = formatReport(aggregate(records, ["commit"]), { damaged }).join("\n");
  assert.match(text, /2 tool call\(s\)/);
  assert.match(text, /commit\s+applied\s+1/);
});
