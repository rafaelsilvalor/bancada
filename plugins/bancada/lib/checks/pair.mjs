/**
 * The test/code pair check, as a dispatcher entry.
 *
 * The whole gate rests on one field, so where that field comes from is recorded
 * here rather than assumed. Claude Code's hook payload carries `agent_type`,
 * described by the CLI itself as: present when the hook fires from within a
 * subagent, alongside `agent_id`, or on the main thread of a session started
 * with `--agent` and then without `agent_id`. Both of those are ways a role can
 * be entered, and both are covered by reading `agent_type` alone.
 *
 * A payload with no `agent_type` is the ordinary main thread. It is allowed, not
 * refused: a session that entered no role is not doing pair work, and enforcing
 * the split on the owner's own edits would be enforcing a discipline nobody
 * asked to be in. That is also why the gate ships disabled.
 */

import { checkPair } from "../pair.mjs";
import { isWrite } from "../writes.mjs";
import { relativeTarget } from "./where.mjs";

export const pairCheck = {
  name: "pair",
  event: "PreToolUse",

  applies(input, config) {
    if (!config.pair.enabled) return false;
    if (typeof input.agent_type !== "string" || input.agent_type === "") return false;
    return isWrite(input);
  },

  run(input, config) {
    const result = checkPair(input.agent_type, relativeTarget(input), config.pair);
    return {
      decision: result.decision,
      check: pairCheck.name,
      rule: result.rule,
      reason: result.reason,
    };
  },
};
