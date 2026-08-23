/**
 * The green boundary, as a dispatcher entry on `Stop`.
 *
 * This is the only check that is not a `PreToolUse` gate, and the reason is
 * cost: it runs a type-checker and a test suite. Folding it into the tool-call
 * dispatcher would pay for that on every tool call, and its verdict has no
 * meaning until the assistant thinks it is finished anyway.
 *
 * A verdict of `deny` on `Stop` becomes a block rather than an exit code — the
 * event has no exit-2 form. That translation belongs to the entry point, not
 * here: a check states what it decided and nothing about how the host expresses
 * it, which is what makes the same check reusable under a second host.
 */

import { checkGreen } from "../green.mjs";
import { projectDirOf } from "./where.mjs";

export const greenCheck = {
  name: "green",
  event: "Stop",

  applies(input, config) {
    if (!config.gates.green.enabled) return false;
    return (config.gates.green.commands ?? []).length > 0;
  },

  run(input, config) {
    const result = checkGreen({
      stopHookActive: input.stop_hook_active,
      projectDir: projectDirOf(input),
      settings: config.gates.green,
    });
    return {
      decision: result.decision,
      check: greenCheck.name,
      rule: result.rule,
      reason: result.reason,
      note: result.note,
    };
  },
};
