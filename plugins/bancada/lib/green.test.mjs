import { test } from "node:test";
import assert from "node:assert/strict";
import { changedFiles, checkGreen, runBoundary, shouldRun } from "./green.mjs";

const NL = String.fromCharCode(10);

/** A command runner that answers from a table, and records what it was asked. */
const runner = (table, log = []) => {
  const run = (command) => {
    log.push(command);
    return table[command] ?? { ran: true, ok: true, status: 0, output: "" };
  };
  run.log = log;
  return run;
};

const SETTINGS = { enabled: true, commands: ["typecheck", "test"], watch: [], timeoutMs: 300000 };

// --- running the commands ---

test("commands run in order and all of them run when they pass", () => {
  const run = runner({});
  const r = runBoundary(["a", "b", "c"], { run });
  assert.equal(r.outcome, "passed");
  assert.deepEqual(run.log, ["a", "b", "c"]);
});

test("the first failure stops the rest, so the model fixes the cause not the symptom", () => {
  const run = runner({ a: { ran: true, ok: false, status: 1, output: "type error" } });
  const r = runBoundary(["a", "b"], { run });
  assert.equal(r.outcome, "failed");
  assert.equal(r.command, "a");
  assert.deepEqual(run.log, ["a"], "the test suite was not run after the type-check failed");
});

test("a command that could not start is not a failure", () => {
  const run = runner({ a: { ran: false, reason: "the command could not be found (exit 127)" } });
  assert.equal(runBoundary(["a"], { run }).outcome, "unrunnable");
});

test("the timeout is a budget for the whole boundary, not for each command", () => {
  let clock = 0;
  const now = () => clock;
  const run = runner({});
  const slow = (command, opts) => {
    clock += 400;
    return run(command, opts);
  };
  const r = runBoundary(["a", "b", "c"], { run: slow, now, timeoutMs: 800 });
  assert.equal(r.outcome, "timeout");
  assert.equal(r.command, "c", "two commands fitted inside the budget and the third did not");
});

test("a command killed for overrunning is a timeout, not a missing binary", () => {
  const run = runner({ a: { ran: false, timedOut: true, reason: "killed by SIGTERM after 500 ms" } });
  const r = runBoundary(["a"], { run, timeoutMs: 500 });
  assert.equal(r.outcome, "timeout");
});

// --- when it is worth running at all ---

test("an empty watch list means always", () => {
  assert.equal(shouldRun([], ["README.md"]).run, true);
  assert.equal(shouldRun(undefined, []).run, true);
});

test("a watch list runs the boundary only for the files it names", () => {
  assert.equal(shouldRun(["src/**"], ["README.md"]).run, false);
  assert.equal(shouldRun(["src/**"], ["README.md", "src/a.ts"]).run, true);
});

test("when git cannot say what changed, the boundary runs rather than skipping", () => {
  // A watch list that silently matches nothing would switch the gate off with
  // no way to tell that from a clean tree.
  const r = shouldRun(["src/**"], null);
  assert.equal(r.run, true);
  assert.match(r.why, /git could not list changes/);
});

test("a rename is watched at its destination, which is the file that now exists", () => {
  const spawn = () => ({ status: 0, stdout: "R  src/old.ts -> src/new.ts" + NL });
  assert.deepEqual(changedFiles("/proj", { spawn }), ["src/new.ts"]);
});

test("git failing to answer is null, not an empty list", () => {
  assert.equal(changedFiles("/proj", { spawn: () => ({ status: 128, stdout: "" }) }), null);
  assert.equal(
    changedFiles("/proj", {
      spawn: () => {
        throw new Error("no git");
      },
    }),
    null,
  );
});

// --- the verdict ---

test("a red boundary blocks, quoting the command and its output", () => {
  const run = runner({ typecheck: { ran: true, ok: false, status: 2, output: "src/a.ts(3,1): error" } });
  const r = checkGreen({ projectDir: "/proj", settings: SETTINGS, deps: { run, changed: [] } });
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "green-red");
  assert.match(r.reason, /`typecheck` exited 2/);
  assert.match(r.reason, /src\/a\.ts\(3,1\): error/);
  assert.match(r.reason, /remaining 1 command\(s\) were not run/);
});

test("a green boundary lets the turn end", () => {
  const r = checkGreen({ projectDir: "/proj", settings: SETTINGS, deps: { run: runner({}), changed: [] } });
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "green-ok");
});

test("a boundary that cannot start says so and does not block", () => {
  const run = runner({ typecheck: { ran: false, reason: "the command could not be found (exit 127)" } });
  const r = checkGreen({ projectDir: "/proj", settings: SETTINGS, deps: { run, changed: [] } });
  assert.equal(r.decision, "allow", "a setup problem is not a red build");
  assert.equal(r.rule, "green-unrunnable");
  assert.match(r.note, /could not be found/);
  assert.match(r.note, /gates\.green\.commands/);
});

test("running out of budget is reported, not treated as a pass in silence", () => {
  let clock = 0;
  const slow = () => {
    clock += 400;
    return { ran: true, ok: true, status: 0, output: "" };
  };
  const r = checkGreen({
    projectDir: "/proj",
    settings: { ...SETTINGS, commands: ["a", "b", "c"], timeoutMs: 800 },
    deps: { run: slow, now: () => clock, changed: [] },
  });
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "green-timeout");
  assert.match(r.note, /800 ms budget/);
});

test("nothing watched changed, so nothing ran", () => {
  const run = runner({});
  const r = checkGreen({
    projectDir: "/proj",
    settings: { ...SETTINGS, watch: ["src/**"] },
    deps: { run, changed: ["README.md"] },
  });
  assert.equal(r.rule, "green-unwatched");
  assert.deepEqual(run.log, [], "the test suite did not run for a documentation edit");
});

// --- the loop guard ---

test("a stop that is already being blocked is allowed without re-running anything", () => {
  const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "still red" } });
  const r = checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    settings: SETTINGS,
    deps: { run, changed: [] },
  });
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "green-already-blocked");
  assert.deepEqual(run.log, [], "the boundary is not re-run inside a blocking sequence");
});

test("a command that fails silently still produces a legible refusal", () => {
  const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "" } });
  const r = checkGreen({ projectDir: "/proj", settings: SETTINGS, deps: { run, changed: [] } });
  assert.match(r.reason, /printed nothing; it failed on its exit code alone/);
});

test("the failing output is clipped rather than pasted whole", () => {
  const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join(NL);
  const run = runner({ typecheck: { ran: true, ok: false, status: 1, output } });
  const r = checkGreen({ projectDir: "/proj", settings: SETTINGS, deps: { run, changed: [] } });
  assert.match(r.reason, /140 more line\(s\) not shown/);
});
