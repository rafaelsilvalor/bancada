/**
 * The commit-message check, as a dispatcher entry.
 *
 * All the judgement lives in `../commit-message.mjs`, which knows nothing about
 * hooks, events or Claude Code. This file is the seam between that judgement
 * and the dispatcher: when it applies, and how its settings are found.
 *
 * Keeping the seam this thin is what makes a second host cheap. A Codex adapter
 * reuses the judgement untouched and only re-does the transport.
 */

import { decideSubject, extractSubject, isShellTool } from "../commit-message.mjs";

export const commitCheck = {
  name: "commit",
  event: "PreToolUse",

  applies(input, config) {
    if (!config.gates.commit.enabled) return false;
    if (!isShellTool(input.tool_name)) return false;
    const command = input.tool_input?.command;
    return typeof command === "string" && command !== "";
  },

  run(input, config) {
    const verdict = decideSubject(extractSubject(input.tool_input.command), config.gates.commit);
    // Two names, because the report needs both questions answered: how often
    // did this gate look (`check`), and what did it find (`rule`). Reporting
    // only the rule makes `commit-ok` and `commit-trailer` look like separate
    // gates; reporting only the gate hides which rule fired.
    return {
      decision: verdict.decision,
      check: commitCheck.name,
      rule: verdict.check,
      reason: verdict.reason,
    };
  },
};
