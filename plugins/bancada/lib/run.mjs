/**
 * Running a command the project configured, and telling apart the two ways it
 * can go wrong.
 *
 * A checker that reports a problem and a checker that never started look
 * identical from an exit code, and conflating them is how a harness reports an
 * uninstalled binary as a violation. That already happened once here: with
 * `shell: true` a missing command does not surface as a spawn error, because the
 * shell starts fine and exits 127. The adapter in `bancada check` reported it as
 * a layering violation, and the tests are what caught it.
 *
 * Two callers now need that distinction — the architecture adapter and the green
 * boundary — so the rule lives in one place. Two copies of it would disagree the
 * first time one of them learned a new exit code.
 *
 *   { ran: false, reason }              could not start; a setup problem
 *   { ran: true, ok, status, output }   started; `ok` is what it decided
 */

import { spawnSync } from "node:child_process";

/** Exit codes a shell uses for "there is no such command". 9009 is cmd.exe. */
const NOT_FOUND = new Set([126, 127, 9009]);

const NOT_FOUND_TEXT = /not found|not recognized|No such file or directory/i;

export const DEFAULT_TIMEOUT_MS = 120000;

export function runCommand(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, spawn = spawnSync } = {}) {
  let result;
  try {
    result = spawn(command, {
      cwd,
      shell: true,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    return { ran: false, reason: String(e?.message ?? e) };
  }

  if (result.error) return { ran: false, reason: String(result.error.message ?? result.error) };
  // Overrunning the budget is flagged separately from failing to start. Both
  // leave the check with no verdict, but a caller reporting a test suite that
  // took too long as "the command could not be found" would send whoever reads
  // it looking for a typo.
  if (result.signal) {
    return { ran: false, timedOut: true, reason: `killed by ${result.signal} after ${timeoutMs} ms` };
  }

  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (NOT_FOUND.has(result.status) || NOT_FOUND_TEXT.test(stderr)) {
    const first = stderr.trim().split(/\r?\n/)[0];
    return {
      ran: false,
      reason: `the command could not be found (exit ${result.status})${first ? `: ${first}` : ""}`,
    };
  }

  const output = [result.stdout, result.stderr].filter((s) => typeof s === "string" && s.trim() !== "").join("\n");
  return { ran: true, ok: result.status === 0, status: result.status, output: output.trim() };
}
