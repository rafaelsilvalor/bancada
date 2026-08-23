#!/usr/bin/env node
/**
 * bancada-flow's `PreToolUse` entry point.
 *
 * A second process on the same event as bancada's own, which
 * docs/decisions/0002-flow-ships-its-own-dispatcher.md argues for and prices.
 * The short version: the plugins are split by how much evidence stands behind
 * them, and a process gate nobody has measured must not be able to break the
 * gates that have been. Two processes cost about 24 ms more per matching tool
 * call, and only for a project that opted in.
 *
 * The two rules bancada's entry point follows hold here for the same reasons. A
 * gate that cannot decide abstains rather than blocking, so any throw leaves the
 * tool call alone. The telemetry write happens before the verdict is emitted,
 * because emitting ends the process, and it cannot change the verdict because
 * nothing on that path throws.
 */

import { readFileSync } from "node:fs";
import { loadFlowConfig } from "../lib/config.mjs";
import { checkPauses } from "../lib/pauses.mjs";
import { record } from "../lib/record.mjs";

// The exit codes and the JSON shape below are Claude Code's hook contract, not
// bancada's, so implementing them here is not a second copy of anything: it is
// this plugin speaking to the host directly, as any plugin must.
const EXIT_ALLOW = 0;
const EXIT_DENY = 2;

function readInput() {
  try {
    const raw = readFileSync(0, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

try {
  const startedAt = Date.now();
  const input = readInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = loadFlowConfig(projectDir);

  const verdict = checkPauses(input, config, { projectDir });

  if (config.telemetry.enabled) {
    record({ projectDir, telemetryDir: config.telemetry.dir, input, verdict, startedAt });
  }

  if (verdict.decision === "deny") {
    process.stderr.write(String(verdict.reason));
    process.exit(EXIT_DENY);
  }
  if (verdict.decision === "ask") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: String(verdict.reason),
        },
      }),
    );
  }
  process.exit(EXIT_ALLOW);
} catch (e) {
  // bancada-flow's own breakage is not the user's problem. Say what happened on
  // the channel a person will see, then get out of the way.
  try {
    process.stderr.write("bancada-flow abstained: " + String(e?.stack || e?.message || e) + "\n");
  } catch {
    /* nothing left to report with */
  }
  process.exit(EXIT_ALLOW);
}
