/**
 * The green boundary: the turn does not end on a red build.
 *
 * Every other gate here is cheap and runs before a tool call. This one runs a
 * type-checker and a test suite, so it belongs where its seconds are paid once —
 * at `Stop`, when the assistant is finished — and not in the `PreToolUse`
 * dispatcher. That split is the one docs/decisions/0001-one-dispatcher-per-event
 * names as the thing that stays separate, and this is it.
 *
 * The point is not that CI would have caught it. CI catches it after the pull
 * request is open, by which time the agent that broke it is gone and a person
 * has to reconstruct what it was doing. Blocking the stop puts the failing
 * output back in front of the model while the context that produced it is still
 * loaded.
 *
 * **A stop inside a blocking sequence is re-checked when something changed, and
 * only then.** Claude Code sets `stop_hook_active` on a stop that follows a
 * block, and its documented advice is to allow while that is true. Following
 * that literally means the model can be told its tests fail, fix them, stop
 * again and be waved through unverified — the gate would guarantee one check per
 * turn end rather than a green turn. So the flag is read as a question rather
 * than an instruction: it says a block is already in progress, and `green-state`
 * says whether anything has happened since. Unchanged means nothing could have
 * been fixed, and the turn is allowed; changed means there is a new answer worth
 * getting.
 *
 * That terminates on its own, because it is the model's own edits that buy each
 * re-check: it either goes green or it stops changing files. Claude Code's cap
 * of eight consecutive blocks is the backstop underneath, and `maxBlocks` is
 * there for a project whose suite is too expensive to pay for eight times.
 *
 * **It terminates outside a git repository too, which it did not.** "Has
 * anything changed" was git's answer alone, so where git could not answer the
 * gate fell back on the host's cap and paid for as many as seven boundary runs
 * that nothing had bought. `fallbackSet` walks the tree instead. That is slower
 * than reading `git status` and the numbers are recorded next to it, because a
 * fallback whose price is not written down is the kind of thing that gets
 * discovered by someone waiting for it.
 *
 * **A boundary that cannot run says so and does not block.** A missing binary is
 * a setup problem. Refusing to let the turn end because the project's test
 * command is misspelled is bancada's bug becoming the user's work stoppage.
 */

import { spawnSync } from "node:child_process";
import { compileGlobs, normalisePath } from "./glob.mjs";
import { fingerprint as realFingerprint, readState as realReadState, writeState as realWriteState } from "./green-state.mjs";
import { runCommand } from "./run.mjs";
import { walkFiles } from "./walk.mjs";

/** How many lines of a failing command's output travel back to the model. */
const MAX_OUTPUT_LINES = 60;

/**
 * Files this working tree has changed, tracked and untracked alike.
 *
 * Returns null when git could not answer. Null is not "nothing changed": the
 * caller runs the boundary anyway, because a `watch` list that silently matches
 * nothing would switch the gate off without saying so.
 *
 * bancada's own directory is excluded, and that is not tidiness. The telemetry
 * stream grows on every tool call and the boundary's state file is written by
 * this very check, so a project that has not ignored `.bancada/` would see
 * bancada's own writes in `git status`, read them as the model making progress,
 * and re-run the test suite until the host's cap stopped it. An instrument that
 * registers its own output as a reading is the failure this project is about.
 * A relocated `telemetry.dir` is only covered if the project ignores it in git.
 */
const OWN_OUTPUT = /^\.bancada\//;

export function changedFiles(projectDir, { spawn = spawnSync } = {}) {
  let r;
  try {
    r = spawn("git", ["-C", projectDir, "status", "--porcelain=v1", "-uall"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  if (r?.error || r?.status !== 0 || typeof r.stdout !== "string") return null;

  const out = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    // `XY path`, or `XY old -> new` for a rename. The destination is the file
    // that now exists, so that is the one a watch glob should see.
    const path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    const rel = normalisePath(arrow === -1 ? path : path.slice(arrow + 4)).replace(/^"|"$/g, "");
    if (OWN_OUTPUT.test(rel)) continue;
    out.push(rel);
  }
  return out;
}

/**
 * Whether the boundary is worth running for what this turn touched.
 *
 * An empty `watch` means always. A non-empty one means the project has said
 * which changes could break the build, and running a test suite because the
 * turn edited a README is a tax that gets the gate turned off.
 */
export function shouldRun(watch, changed) {
  if (!Array.isArray(watch) || watch.length === 0) return { run: true, why: "no watch list" };
  if (changed === null) return { run: true, why: "git could not list changes" };
  const match = compileGlobs(watch);
  const hit = changed.find(match);
  return hit ? { run: true, why: `${hit} changed` } : { run: false, why: "no watched file changed" };
}

/**
 * The changed files the fingerprint should cover.
 *
 * With a watch list, only the files on it. An edit to a README is not progress
 * on a failing test suite, and counting it as progress would buy the model
 * another run of the boundary for nothing.
 */
export function watchedChanges(watch, changed) {
  if (!Array.isArray(changed)) return null;
  if (!Array.isArray(watch) || watch.length === 0) return changed;
  return changed.filter(compileGlobs(watch));
}

/**
 * The file set a fingerprint covers when git could not say what changed.
 *
 * Outside a git repository the boundary knew nothing about the previous stop, so
 * every stop inside a blocking sequence re-ran the whole boundary and the host's
 * cap of eight consecutive blocks ended it — up to seven runs bought by nothing.
 * A walk cannot say what *changed*, but a digest over the watched tree answers
 * the only question the re-check has: is this the same tree as last time?
 *
 * git is not asked a second time. `changedFiles` already tried and failed, and
 * `git ls-files` fails in the same directory for the same reasons, so asking
 * would be a subprocess per turn end to be told so twice.
 *
 * **It is not free, and the price is the tree's size.** Walking and hashing a
 * synthetic tree of 2 KB source files, median of 7, from
 * `scripts/measure-green-fallback.mjs`:
 *
 *   200 files    33 ms      5 000 files   1 261 ms
 *   1 000 files 177 ms     20 000 files   5 265 ms
 *
 * At the walk's ceiling that is five seconds per stop, and it buys not paying
 * for as many as seven runs of the project's own test suite. Any suite worth
 * gating on costs more than that; a `watch` list narrows both numbers together.
 *
 * A truncated walk is null. The subset it reached is arbitrary, so a digest over
 * it can compare equal while a file outside it changed, which would allow a turn
 * the boundary meant to re-check. Unknown has to keep meaning "run it again".
 */
export function fallbackSet(projectDir, watch, { walk = walkFiles } = {}) {
  const { files, truncated } = walk(projectDir ?? ".");
  if (truncated) return null;
  if (!Array.isArray(watch) || watch.length === 0) return files;
  return files.filter(compileGlobs(watch));
}

/**
 * Run the configured commands in order, stopping at the first failure.
 *
 * Stopping early is deliberate. A type error usually makes the test suite fail
 * too, and reporting both makes the model fix the symptom before the cause.
 * `timeoutMs` is the budget for the whole boundary, not for each command.
 */
export function runBoundary(commands, { cwd, timeoutMs = 300000, run = runCommand, now = Date.now } = {}) {
  const startedAt = now();
  const ran = [];

  for (const command of commands ?? []) {
    const remaining = timeoutMs - (now() - startedAt);
    if (remaining <= 0) {
      return { outcome: "timeout", command, ran, timeoutMs };
    }
    const result = run(command, { cwd, timeoutMs: remaining });
    ran.push(command);
    if (!result.ran) {
      const outcome = result.timedOut ? "timeout" : "unrunnable";
      return { outcome, command, reason: result.reason, ran, timeoutMs };
    }
    if (!result.ok) return { outcome: "failed", command, status: result.status, output: result.output, ran };
  }

  return { outcome: "passed", ran };
}

const clip = (output) => {
  const text = String(output ?? "").trim();
  // A command that fails silently still has to produce a legible refusal. Two
  // blank lines where the output should be reads as a broken gate.
  if (text === "") return ["(the command printed nothing; it failed on its exit code alone)"];
  const lines = text.split(/\r?\n/);
  if (lines.length <= MAX_OUTPUT_LINES) return lines;
  return [...lines.slice(0, MAX_OUTPUT_LINES), `… ${lines.length - MAX_OUTPUT_LINES} more line(s) not shown`];
};

/**
 * Decide whether the turn may end.
 *
 * Returns `{ decision, rule, reason, note }`. `note` carries something the
 * person should see when there is no verdict to state — a boundary that could
 * not start is not a refusal, but it is not silence either.
 */
export function checkGreen({ stopHookActive, projectDir, session, settings, deps = {} } = {}) {
  const {
    fingerprint = realFingerprint,
    readState = realReadState,
    writeState = realWriteState,
    ...rest
  } = deps;

  // Two different questions, and they are asked separately because the second
  // one is not cheap. `changed` decides whether the boundary is worth running,
  // which only git can answer. `watchedOf` is what the fingerprint covers, and
  // outside a repository that is a tree walk and a digest — so a stop that is
  // not inside a blocking sequence must never pay for one it will not read.
  const look = () => (rest.changed !== undefined ? rest.changed : changedFiles(projectDir, rest));
  const watchedOf = (files) =>
    files === null ? fallbackSet(projectDir, settings?.watch, rest) : watchedChanges(settings?.watch, files);

  let changed = look();
  const prior = stopHookActive === true ? readState(projectDir, session, rest) : null;

  if (prior) {
    // Null never equals null: an unknown fingerprint means "run it again", not
    // "nothing changed". Comparing two unknowns as equal would skip the check
    // precisely when the gate has least idea what is going on.
    const current = fingerprint(projectDir, watchedOf(changed), rest);
    if (current !== null && current === prior.fingerprint) {
      return { decision: "allow", rule: "green-no-progress", reason: null, note: null };
    }
    const maxBlocks = settings?.maxBlocks ?? 0;
    if (maxBlocks > 0 && prior.blocks >= maxBlocks) {
      return {
        decision: "allow",
        rule: "green-gave-up",
        reason: null,
        note:
          `bancada's green boundary has blocked ${prior.blocks} time(s) in a row and is letting\n` +
          "the turn end. The build was still failing at the last check. Raise\n" +
          "gates.green.maxBlocks if it should keep trying.",
      };
    }
  }

  const watchVerdict = shouldRun(settings?.watch, changed);
  if (!watchVerdict.run) {
    return { decision: "allow", rule: "green-unwatched", reason: null, note: null };
  }

  const result = runBoundary(settings?.commands, {
    cwd: projectDir,
    timeoutMs: settings?.timeoutMs ?? 300000,
    ...rest,
  });

  // After the run, not before: the boundary writes things — a log, a coverage
  // directory, a build cache — and a baseline taken beforehand would read its
  // own leavings as the model's progress on the next stop, buying an unbounded
  // sequence of re-runs.
  changed = look();
  const blocks = result.outcome === "failed" ? (prior?.blocks ?? 0) + 1 : 0;
  writeState(
    projectDir,
    { session: session ?? null, fingerprint: fingerprint(projectDir, watchedOf(changed), rest), blocks },
    rest,
  );

  if (result.outcome === "passed") {
    return { decision: "allow", rule: "green-ok", reason: null, note: null };
  }

  if (result.outcome === "unrunnable") {
    return {
      decision: "allow",
      rule: "green-unrunnable",
      reason: null,
      note:
        `bancada's green boundary did not run: \`${result.command}\` ${result.reason}.\n` +
        "A command that will not start is a setup problem, not a red build, so the\n" +
        "turn was allowed to end. Fix gates.green.commands in bancada.config.json.",
    };
  }

  if (result.outcome === "timeout") {
    return {
      decision: "allow",
      rule: "green-timeout",
      reason: null,
      note:
        `bancada's green boundary hit its ${result.timeoutMs} ms budget at \`${result.command}\`` +
        `${result.reason ? ` (${result.reason})` : ""}.\n` +
        "The turn was allowed to end unchecked. Raise gates.green.timeoutMs, or split\n" +
        "the boundary into something that fits inside it.",
    };
  }

  return {
    decision: "deny",
    rule: "green-red",
    note: null,
    reason: [
      `The green boundary failed. \`${result.command}\` exited ${result.status}.`,
      "",
      ...clip(result.output).map((l) => `  ${l}`),
      "",
      "Fix this before ending the turn. The context that produced the failure is",
      "still loaded now and will not be when someone reads it in CI.",
      ...(result.ran.length < (settings?.commands ?? []).length
        ? ["", `The remaining ${(settings?.commands ?? []).length - result.ran.length} command(s) were not run.`]
        : []),
      // Reported, not enforced. The model cannot see how long it has been going
      // round, and a count is the cheapest way to say "what you tried last time
      // did not work" without bancada deciding when to give up.
      ...(blocks > 1 ? ["", `This is the ${blocks}th consecutive block; the previous change did not fix it.`] : []),
    ].join("\n"),
  };
}
