#!/usr/bin/env node
/**
 * PreToolUse gate: judge a `git commit` before git runs it.
 *
 * Why here and not in a `commit-msg` git hook: at PreToolUse the refusal lands
 * in the turn that produced the message, as feedback the model reads and acts
 * on. A git hook fires later, after the model has moved on, and the failure
 * shows up as a command that mysteriously did not work.
 *
 * The trade is visibility. This reads a command line, so it is exact for an
 * inline `-m` and blind to a message that comes from a file or an editor —
 * those escalate to `ask` rather than passing. A project that needs the
 * property unconditionally should run both.
 */

import { runGate, readHookInput, allow, deny, ask, eventOf } from "../lib/hook-io.mjs";
import { loadConfig } from "../lib/config.mjs";
import { decideSubject, extractSubject, isShellTool } from "../lib/commit-message.mjs";

await runGate(async () => {
  const input = readHookInput();

  // Not a shell tool: nothing to read, no opinion.
  if (!isShellTool(input.tool_name)) allow();

  const command = input.tool_input?.command;
  if (typeof command !== "string" || command === "") allow();

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const { config } = loadConfig(projectDir);

  if (!config.gates.commit.enabled) allow();

  const verdict = decideSubject(extractSubject(command), config.gates.commit);

  if (verdict.decision === "deny") deny(verdict.reason);
  if (verdict.decision === "ask") ask(verdict.reason, eventOf(input));
  allow();
});
