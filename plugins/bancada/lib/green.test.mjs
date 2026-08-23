import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFiles, checkGreen, fallbackSet, runBoundary, shouldRun, watchedChanges } from "./green.mjs";

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

const SETTINGS = { enabled: true, commands: ["typecheck", "test"], watch: [], timeoutMs: 300000, maxBlocks: 0 };

/**
 * An in-memory stand-in for the state file, plus a fingerprint the test drives
 * directly. The point of these cases is what the gate decides given a prior
 * state, not how the digest is computed — that is green-state's own suite.
 */
const memory = (initial = null) => {
  const box = { state: initial, writes: [] };
  return {
    box,
    readState: () => box.state,
    writeState: (_dir, state) => {
      box.state = state;
      box.writes.push(state);
      return true;
    },
  };
};


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

test("bancada's own writes are not read as the model making progress", () => {
  // The telemetry stream grows on every tool call and the state file is written
  // by this check. Counted as changes, they would buy a re-run of the test suite
  // every time, for ever — the instrument registering its own output.
  const spawn = () => ({
    status: 0,
    stdout: ["?? .bancada/green-state.json", "?? .bancada/telemetry/gates.jsonl", " M src/a.ts"].join(NL) + NL,
  });
  assert.deepEqual(changedFiles("/proj", { spawn }), ["src/a.ts"]);
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

// --- what the boundary remembers between stops ---

test("a stop inside a blocking sequence with nothing changed is allowed", () => {
  // Nothing could have been fixed, so blocking again would be a loop with no
  // progress in it.
  const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "still red" } });
  const m = memory({ session: "s1", fingerprint: "same", blocks: 1 });
  const r = checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    session: "s1",
    settings: SETTINGS,
    deps: { run, changed: [], fingerprint: () => "same", ...m },
  });
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "green-no-progress");
  assert.deepEqual(run.log, [], "no test suite was run to learn what could not have changed");
});

test("a stop inside a blocking sequence after a real edit is re-checked", () => {
  // The gap this closes: without it the model is told its tests fail, fixes
  // them, stops again, and is waved through unverified.
  const run = runner({ typecheck: { ran: true, ok: true, status: 0, output: "" } });
  const m = memory({ session: "s1", fingerprint: "before", blocks: 1 });
  const r = checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    session: "s1",
    settings: SETTINGS,
    deps: { run, changed: ["src/a.ts"], fingerprint: () => "after", ...m },
  });
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "green-ok");
  assert.deepEqual(run.log, ["typecheck", "test"], "the boundary actually ran again");
});

test("a re-check that is still red blocks again and counts the attempt", () => {
  const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "still red" } });
  const m = memory({ session: "s1", fingerprint: "before", blocks: 1 });
  const r = checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    session: "s1",
    settings: SETTINGS,
    deps: { run, changed: ["src/a.ts"], fingerprint: () => "after", ...m },
  });
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /2th consecutive block; the previous change did not fix it/);
  assert.equal(m.box.state.blocks, 2);
});

test("an unknown fingerprint never compares equal to another unknown", () => {
  // Two unknowns reading as "nothing changed" would skip the check exactly when
  // the gate has least idea what is going on.
  const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "red" } });
  const m = memory({ session: "s1", fingerprint: null, blocks: 1 });
  const r = checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    session: "s1",
    settings: SETTINGS,
    deps: { run, changed: null, fingerprint: () => null, ...m },
  });
  assert.equal(r.decision, "deny", "it ran rather than assuming nothing had happened");
});

test("state from another session is not trusted, so the boundary runs", () => {
  const run = runner({ typecheck: { ran: true, ok: true, status: 0, output: "" } });
  // readState is what discards a foreign session; here it returns null for one.
  const m = memory(null);
  const r = checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    session: "s2",
    settings: SETTINGS,
    deps: { run, changed: [], fingerprint: () => "x", ...m },
  });
  assert.equal(r.rule, "green-ok");
  assert.deepEqual(run.log, ["typecheck", "test"]);
});

test("the baseline is taken after the run, not before", () => {
  // A test suite writes a log, a coverage directory, a build cache. A baseline
  // taken beforehand would read the boundary's own leavings as the model's
  // progress on the next stop, and the loop would never terminate.
  const run = runner({});
  const m = memory(null);
  checkGreen({
    projectDir: "/proj",
    session: "s1",
    settings: SETTINGS,
    // The digest names how many commands had run when it was taken.
    deps: { run, changed: [], fingerprint: () => `after-${run.log.length}-commands`, ...m },
  });
  assert.equal(m.box.state.fingerprint, "after-2-commands");
});

test("a passing boundary resets the block count", () => {
  const m = memory({ session: "s1", fingerprint: "before", blocks: 3 });
  checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    session: "s1",
    settings: SETTINGS,
    deps: { run: runner({}), changed: ["src/a.ts"], fingerprint: () => "after", ...m },
  });
  assert.equal(m.box.state.blocks, 0);
});

test("maxBlocks lets a project stop paying for a suite it cannot afford eight times", () => {
  const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "red" } });
  const m = memory({ session: "s1", fingerprint: "before", blocks: 2 });
  const r = checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    session: "s1",
    settings: { ...SETTINGS, maxBlocks: 2 },
    deps: { run, changed: ["src/a.ts"], fingerprint: () => "after", ...m },
  });
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "green-gave-up");
  assert.match(r.note, /blocked 2 time\(s\) in a row/);
  assert.deepEqual(run.log, [], "and it did not pay for one more run on the way out");
});

test("the default defers to the host rather than inventing a second cap", () => {
  const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "red" } });
  const m = memory({ session: "s1", fingerprint: "before", blocks: 7 });
  const r = checkGreen({
    stopHookActive: true,
    projectDir: "/proj",
    session: "s1",
    settings: SETTINGS,
    deps: { run, changed: ["src/a.ts"], fingerprint: () => "after", ...m },
  });
  assert.equal(r.decision, "deny", "Claude Code's own cap of eight is the backstop, not ours");
});

test("only watched files count as progress", () => {
  assert.deepEqual(watchedChanges(["src/**"], ["src/a.ts", "README.md"]), ["src/a.ts"]);
  assert.deepEqual(watchedChanges([], ["README.md"]), ["README.md"]);
  assert.equal(watchedChanges(["src/**"], null), null);
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

// --- when there is no git to ask what changed ---

/** A tree with one source file, and a git that refuses to answer about it. */
const untracked = () => {
  const root = mkdtempSync(join(tmpdir(), "bancada-green-"));
  writeFileSync(join(root, "a.ts"), "const a = 1;");
  return root;
};

const NO_GIT = { spawn: () => ({ status: 128, stdout: "" }) };

test("the fingerprint set falls back to the watched tree, not the whole of it", () => {
  const root = untracked();
  writeFileSync(join(root, "README.md"), "docs");
  try {
    assert.deepEqual(fallbackSet(root, ["**/*.ts"]).sort(), ["a.ts"]);
    assert.deepEqual(fallbackSet(root, []).sort(), ["README.md", "a.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a truncated walk is unknown, which still means run it again", () => {
  // The subset a truncated walk reached is arbitrary. A digest over it can
  // compare equal while a file outside it changed, and that would allow a turn
  // the boundary meant to re-check.
  assert.equal(fallbackSet("/proj", [], { walk: () => ({ files: ["a.ts"], truncated: true }) }), null);
});

test("outside a git repository, a stop that changed nothing is no longer re-checked", () => {
  // The gap this closes. With no `git status` to read, "has anything changed"
  // had no answer at all, so every stop inside a blocking sequence paid for the
  // whole boundary again and the host's cap of eight was what ended it.
  const root = untracked();
  try {
    const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "red" } });
    const m = memory(null);
    const deps = { run, ...NO_GIT, ...m };

    const first = checkGreen({ projectDir: root, session: "s1", settings: SETTINGS, deps });
    assert.equal(first.decision, "deny", "the first stop ran the boundary and found it red");

    const second = checkGreen({ stopHookActive: true, projectDir: root, session: "s1", settings: SETTINGS, deps });
    assert.equal(second.decision, "allow");
    assert.equal(second.rule, "green-no-progress");
    assert.deepEqual(run.log, ["typecheck"], "the boundary was not paid for a second time");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outside a git repository, a real edit still buys a re-check", () => {
  const root = untracked();
  try {
    const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "red" } });
    const m = memory(null);
    const deps = { run, ...NO_GIT, ...m };

    checkGreen({ projectDir: root, session: "s1", settings: SETTINGS, deps });
    writeFileSync(join(root, "a.ts"), "const a = 2;");

    const second = checkGreen({ stopHookActive: true, projectDir: root, session: "s1", settings: SETTINGS, deps });
    assert.equal(second.decision, "deny");
    assert.match(second.reason, /2th consecutive block/);
    assert.deepEqual(run.log, ["typecheck", "typecheck"], "the edit bought one more run, and only one");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an edit outside the watch list is not progress, even with no git to ask", () => {
  const root = untracked();
  try {
    const run = runner({ typecheck: { ran: true, ok: false, status: 1, output: "red" } });
    const m = memory(null);
    const settings = { ...SETTINGS, watch: ["**/*.ts"] };
    const deps = { run, ...NO_GIT, ...m };

    checkGreen({ projectDir: root, session: "s1", settings, deps });
    writeFileSync(join(root, "NOTES.md"), "not a fix");

    const second = checkGreen({ stopHookActive: true, projectDir: root, session: "s1", settings, deps });
    assert.equal(second.rule, "green-no-progress", "a note is not a repair of a failing type-check");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stop outside a blocking sequence does not pay for a walk it will not read", () => {
  // The fingerprint set costs a tree walk and a digest where there is no git,
  // and the one taken before the boundary runs is only read when a prior state
  // exists. Asking for it unconditionally was up to five seconds per stop for
  // an answer nothing looks at.
  let walks = 0;
  const walk = () => {
    walks++;
    return { files: [], truncated: false };
  };
  const m = memory(null);
  const deps = { run: runner({}), ...NO_GIT, walk, ...m };

  checkGreen({ projectDir: "/proj", session: "s1", settings: SETTINGS, deps });
  assert.equal(walks, 1, "only the baseline taken after the run needed one");

  checkGreen({ stopHookActive: true, projectDir: "/proj", session: "s1", settings: SETTINGS, deps });
  assert.equal(walks, 2, "and a stop inside a blocking sequence reads it once, then stops");
});
