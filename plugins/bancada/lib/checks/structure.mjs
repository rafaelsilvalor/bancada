/**
 * The layering check, as a dispatcher entry.
 *
 * It runs on writes rather than on commits. A layering violation is created the
 * moment a file gains an import, and refusing it there puts the reason in front
 * of the model in the same turn. Waiting for the commit means the violation is
 * already spread across whatever else was written since.
 *
 * Only the text being introduced is judged, not the file as it will end up.
 * For an edit that means the replacement string: judging the whole file would
 * refuse the edit over lines nobody in this turn wrote.
 */

import { checkLayering } from "../structure.mjs";
import { introducedText, isWrite } from "../writes.mjs";
import { projectDirOf } from "./where.mjs";

export const structureCheck = {
  name: "structure",
  event: "PreToolUse",

  applies(input, config) {
    if (!config.gates.structure.enabled) return false;
    if ((config.gates.structure.layers ?? []).length === 0) return false;
    return isWrite(input);
  },

  run(input, config) {
    const text = introducedText(input.tool_input);
    // Write and Edit hand over an absolute path; layer globs are written
    // relative to the project, so the two have to be reconciled here.
    const result = checkLayering(
      input.tool_input.file_path,
      text,
      config.gates.structure.layers,
      projectDirOf(input),
    );
    return {
      decision: result.decision,
      check: structureCheck.name,
      rule: result.rule,
      reason: result.reason,
    };
  },
};
