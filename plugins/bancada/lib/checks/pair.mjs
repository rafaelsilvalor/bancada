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
 *
 * Of the three gates that read `writeTargets`, this is the one the shell route
 * costs nothing at all: the verdict needs the path and not the text, so
 * `sed -i src/thing.test.mjs` from the code role is refused as surely as the
 * same edit through `Edit`. There is no unreadable case here and no coverage gap
 * to record — and there could be no sweep to fall back on either, because which
 * role wrote a line is not a fact the repository keeps.
 */

import { checkPair } from "../pair.mjs";
import { foldOwn } from "../dispatch.mjs";
import { writeTargets } from "../writes.mjs";
import { toProjectRelative } from "../structure.mjs";
import { projectDirOf } from "./where.mjs";

export const pairCheck = {
  name: "pair",
  event: "PreToolUse",

  applies(input, config) {
    if (!config.pair.enabled) return false;
    if (typeof input.agent_type !== "string" || input.agent_type === "") return false;
    return writeTargets(input).length > 0;
  },

  run(input, config) {
    const projectDir = projectDirOf(input);
    const verdicts = writeTargets(input).map((target) => {
      const result = checkPair(input.agent_type, toProjectRelative(target.path, projectDir), config.pair);
      return { decision: result.decision, check: pairCheck.name, rule: result.rule, reason: result.reason };
    });
    return foldOwn(pairCheck.name, verdicts);
  },
};
