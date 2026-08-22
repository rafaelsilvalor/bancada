import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRecord, emit, hashInput, record, streamPath, STREAM_FILE } from "./telemetry.mjs";
import { defaults, merge } from "./config.mjs";

const CONFIG = defaults();
const NOW = Date.parse("2026-08-22T12:00:00.000Z");

const input = (over = {}) => ({
  session_id: "s-1",
  tool_name: "Bash",
  tool_input: { command: 'git commit -m "feat: x"' },
  ...over,
});

const verdict = (over = {}) => ({
  decision: "deny",
  check: "commit",
  verdicts: [{ decision: "deny", check: "commit-trailer" }],
  ...over,
});

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), "bancada-tel-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// --- hashing ---

test("a digest is short, stable and hex", () => {
  const h = hashInput("some command");
  assert.equal(h.length, 12);
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(h, hashInput("some command"), "same input, same digest");
  assert.notEqual(h, hashInput("some other command"));
});

test("an absent input hashes to the empty string, never to the digest of empty", () => {
  // Two events with no input must not collide on one digest and read as the
  // same input seen twice. That would corrupt the recurrence measurement, which
  // is the main thing the stream is for.
  for (const absent of [undefined, null, ""]) {
    assert.equal(hashInput(absent), "");
  }
  assert.notEqual(hashInput(""), hashInput(" "), "a space is an input; nothing is not");
});

test("the content itself never appears in a digest", () => {
  const secret = "git commit -m 'token ATATT-super-secret'";
  const h = hashInput(secret);
  assert.doesNotMatch(h, /ATATT/);
  assert.doesNotMatch(h, /secret/);
});

// --- the record ---

test("a record carries the decision, the winning check and every check that ran", () => {
  const r = buildRecord({
    input: input(),
    verdict: verdict({
      verdicts: [
        { decision: "allow", check: "size" },
        { decision: "deny", check: "commit-trailer" },
      ],
    }),
    event: "PreToolUse",
    now: NOW,
    env: {},
  });
  assert.equal(r.decision, "deny");
  assert.equal(r.check, "commit");
  assert.deepEqual(r.checks, [
    { name: "size", decision: "allow" },
    { name: "commit-trailer", decision: "deny" },
  ]);
});

test("keys appear in a fixed order so the stream stays diffable", () => {
  const r = buildRecord({ input: input(), verdict: verdict(), event: "PreToolUse", now: NOW, env: {} });
  const keys = Object.keys(r);
  assert.equal(keys[0], "ts");
  assert.equal(keys[1], "session");
  assert.ok(keys.indexOf("decision") < keys.indexOf("inputHash"));
  assert.equal(keys.at(-1), "checks");
});

test("an unknown field is left out rather than written as an empty value", () => {
  const r = buildRecord({ input: input(), verdict: verdict(), event: "PreToolUse", now: NOW, env: {} });
  assert.equal("agent" in r, false, "no agent_type in the payload means no agent key");
  assert.equal("effort" in r, false);
});

test("a field that is known is written", () => {
  const r = buildRecord({
    input: input({ agent_type: "code", effort: { level: "low" } }),
    verdict: verdict(),
    event: "PreToolUse",
    now: NOW,
    env: {},
  });
  assert.equal(r.agent, "code");
  assert.equal(r.effort, "low");
});

test("effort falls back to the environment when the payload omits it", () => {
  const r = buildRecord({
    input: input(),
    verdict: verdict(),
    event: "PreToolUse",
    now: NOW,
    env: { CLAUDE_EFFORT: "xhigh" },
  });
  assert.equal(r.effort, "xhigh");
});

test("a tool call with no command records that fact rather than a fake hash", () => {
  const r = buildRecord({
    input: input({ tool_input: {} }),
    verdict: verdict({ decision: "allow", check: "none", verdicts: [] }),
    event: "PreToolUse",
    now: NOW,
    env: {},
  });
  assert.equal(r.inputKind, "none");
  assert.equal(r.inputHash, "");
});

test("duration is recorded when a start time was given, and omitted otherwise", () => {
  const withStart = buildRecord({
    input: input(),
    verdict: verdict(),
    event: "PreToolUse",
    startedAt: NOW - 7,
    now: NOW,
    env: {},
  });
  assert.equal(withStart.durationMs, 7);

  const without = buildRecord({ input: input(), verdict: verdict(), event: "PreToolUse", now: NOW, env: {} });
  assert.equal("durationMs" in without, false);
});

test("a check that errored keeps its error in the record", () => {
  const r = buildRecord({
    input: input(),
    verdict: verdict({ verdicts: [{ decision: "allow", check: "broken", error: "boom" }] }),
    event: "PreToolUse",
    now: NOW,
    env: {},
  });
  assert.equal(r.checks[0].error, "boom");
});

// --- writing ---

test("a record lands in the configured directory as one JSON line", () => {
  const { dir, cleanup } = tempProject();
  try {
    const ok = emit(dir, CONFIG, { ts: "t", decision: "deny" });
    assert.equal(ok, true);
    const file = streamPath(dir, CONFIG);
    assert.match(file, new RegExp(STREAM_FILE));
    const contents = readFileSync(file, "utf8");
    assert.equal(contents.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(contents.trim()), { ts: "t", decision: "deny" });
  } finally {
    cleanup();
  }
});

test("records append rather than replace", () => {
  const { dir, cleanup } = tempProject();
  try {
    emit(dir, CONFIG, { n: 1 });
    emit(dir, CONFIG, { n: 2 });
    emit(dir, CONFIG, { n: 3 });
    const lines = readFileSync(streamPath(dir, CONFIG), "utf8").trim().split("\n");
    assert.deepEqual(
      lines.map((l) => JSON.parse(l).n),
      [1, 2, 3],
    );
  } finally {
    cleanup();
  }
});

test("the directory is created if it does not exist", () => {
  const { dir, cleanup } = tempProject();
  try {
    const config = merge(CONFIG, { telemetry: { dir: "deep/nested/place" } });
    assert.equal(emit(dir, config, { n: 1 }), true);
    assert.equal(existsSync(streamPath(dir, config)), true);
  } finally {
    cleanup();
  }
});

test("telemetry disabled writes nothing at all", () => {
  const { dir, cleanup } = tempProject();
  try {
    const config = merge(CONFIG, { telemetry: { enabled: false } });
    assert.equal(emit(dir, config, { n: 1 }), false);
    assert.equal(existsSync(streamPath(dir, config)), false);
  } finally {
    cleanup();
  }
});

// --- the invariant that outranks all the others ---

test("a record that cannot be serialised does not throw", () => {
  const { dir, cleanup } = tempProject();
  try {
    const circular = {};
    circular.self = circular;
    assert.doesNotThrow(() => emit(dir, CONFIG, circular));
    assert.equal(emit(dir, CONFIG, circular), false);
  } finally {
    cleanup();
  }
});

test("an unwritable destination does not throw", () => {
  const config = merge(CONFIG, { telemetry: { dir: "x" } });
  // A path that cannot be a directory, on any platform.
  assert.doesNotThrow(() => emit("\0invalid", config, { n: 1 }));
  assert.equal(emit("\0invalid", config, { n: 1 }), false);
});

test("record() survives being handed nonsense", () => {
  for (const args of [
    {},
    { projectDir: null, config: null, input: null, verdict: null },
    { projectDir: 42, config: CONFIG, input: "not an object", verdict: [] },
  ]) {
    assert.doesNotThrow(() => record(args), JSON.stringify(args));
  }
});

test("record() writes a full record end to end", () => {
  const { dir, cleanup } = tempProject();
  try {
    const ok = record({
      projectDir: dir,
      config: CONFIG,
      input: input(),
      verdict: verdict(),
      event: "PreToolUse",
      startedAt: NOW - 3,
      now: NOW,
    });
    assert.equal(ok, true);
    const written = JSON.parse(readFileSync(streamPath(dir, CONFIG), "utf8").trim());
    assert.equal(written.decision, "deny");
    assert.equal(written.tool, "Bash");
    assert.equal(written.durationMs, 3);
    assert.match(written.inputHash, /^[0-9a-f]{12}$/);
    assert.doesNotMatch(readFileSync(streamPath(dir, CONFIG), "utf8"), /feat: x/, "no content, only a digest");
  } finally {
    cleanup();
  }
});
