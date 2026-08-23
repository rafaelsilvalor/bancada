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
 * **It does not re-check inside one blocking sequence, so it cannot promise the
 * session ends green.** Claude Code sets `stop_hook_active` on a stop that
 * follows a block, and the documented contract is to allow while it is true.
 * Honouring it is the alternative to being overridden after eight consecutive
 * blocks, which costs eight test-suite runs and teaches nothing.
 *
 * The flag does not stay true forever. In an end-to-end run the boundary
 * executed twice across ten turns, so a later stop does begin a fresh sequence —
 * but what resets it is undocumented and was not measured. What this gate
 * therefore guarantees is *at least one check per turn end*, not that a red
 * build cannot get past. Re-running whenever a watched file changed since the
 * last run would make the guarantee unconditional; that needs state carried
 * between stops and is not built.
 *
 * **A boundary that cannot run says so and does not block.** A missing binary is
 * a setup problem. Refusing to let the turn end because the project's test
 * command is misspelled is bancada's bug becoming the user's work stoppage.
 */

import { spawnSync } from "node:child_process";
import { compileGlobs, normalisePath } from "./glob.mjs";
import { runCommand } from "./run.mjs";

/** How many lines of a failing command's output travel back to the model. */
const MAX_OUTPUT_LINES = 60;

/**
 * Files this working tree has changed, tracked and untracked alike.
 *
 * Returns null when git could not answer. Null is not "nothing changed": the
 * caller runs the boundary anyway, because a `watch` list that silently matches
 * nothing would switch the gate off without saying so.
 */
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
    out.push(normalisePath(arrow === -1 ? path : path.slice(arrow + 4)).replace(/^"|"$/g, ""));
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
export function checkGreen({ stopHookActive, projectDir, settings, deps = {} } = {}) {
  if (stopHookActive === true) {
    return { decision: "allow", rule: "green-already-blocked", reason: null, note: null };
  }

  const changed = deps.changed !== undefined ? deps.changed : changedFiles(projectDir, deps);
  const watch = shouldRun(settings?.watch, changed);
  if (!watch.run) {
    return { decision: "allow", rule: "green-unwatched", reason: null, note: null };
  }

  const result = runBoundary(settings?.commands, {
    cwd: projectDir,
    timeoutMs: settings?.timeoutMs ?? 300000,
    ...deps,
  });

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
    ].join("\n"),
  };
}
