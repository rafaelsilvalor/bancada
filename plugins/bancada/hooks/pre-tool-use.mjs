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
 * The telemetry write happens before the verdict is emitted, because emitting
 * ends the process. It cannot change the verdict — `record` swallows everything
 * — and it is deliberately not checked, since there is nothing useful to do
 * about a failed write in the middle of a tool call.
 *
 * There is otherwise almost nothing in this file. Anything that grows here
 * belongs in a check.
 */

import { runGate, readHookInput, allow, deny, ask, eventOf } from "../lib/hook-io.mjs";
import { loadConfig } from "../lib/config.mjs";
import { dispatch } from "../lib/dispatch.mjs";
import { PRE_TOOL_USE_CHECKS } from "../lib/checks/pre-tool-use.mjs";
import { record } from "../lib/telemetry.mjs";

await runGate(async () => {
  const startedAt = Date.now();
  const input = readHookInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const { config } = loadConfig(projectDir);
  const event = eventOf(input);

  const verdict = await dispatch(input, config, PRE_TOOL_USE_CHECKS, "PreToolUse");

  record({ projectDir, config, input, verdict, event, startedAt });

  if (verdict.decision === "deny") deny(verdict.reason);
  if (verdict.decision === "ask") ask(verdict.reason, event);
  allow();
});
