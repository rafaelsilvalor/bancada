#!/usr/bin/env node
/**
 * The single `PreToolUse` entry point.
 *
 * Every cheap gate that runs before a tool call lives behind this one process:
 * config is read once, the applicable checks run, and their verdicts are folded
 * here rather than by the host. See
 * docs/decisions/0001-one-dispatcher-per-event.md for why, and for the
 * measurement that says how much it saves.
 *
 * There is deliberately almost nothing in this file. Anything that grows here
 * belongs in a check.
 */

import { runGate, readHookInput, allow, deny, ask, eventOf } from "../lib/hook-io.mjs";
import { loadConfig } from "../lib/config.mjs";
import { dispatch } from "../lib/dispatch.mjs";
import { CHECKS } from "../lib/checks/index.mjs";

await runGate(async () => {
  const input = readHookInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const { config } = loadConfig(projectDir);

  const verdict = await dispatch(input, config, CHECKS, "PreToolUse");

  if (verdict.decision === "deny") deny(verdict.reason);
  if (verdict.decision === "ask") ask(verdict.reason, eventOf(input));
  allow();
});
