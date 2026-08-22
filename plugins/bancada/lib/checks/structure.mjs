/**
 * The layering check, as a dispatcher entry.
 *
 * It runs on writes rather than on commits. A layering violation is created the
 * moment a file gains an import, and refusing it there puts the reason in front
 * of the model in the same turn. Waiting for the commit means the violation is
 * already spread across whatever else was written since.
 *
 * Only the text being introduced is judged, not the file as it will end up.
 * For an edit that means the replacement string: bancada has no reliable view
 * of the file on disk from the hook payload, and inventing one by reading the
 * file would judge lines nobody in this turn wrote.
 */

import { checkLayering } from "../structure.mjs";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** The text a write tool is introducing, whatever shape the tool uses for it. */
export function introducedText(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  if (typeof toolInput.content === "string") return toolInput.content;
  if (typeof toolInput.new_string === "string") return toolInput.new_string;
  if (Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .map((e) => (typeof e?.new_string === "string" ? e.new_string : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export const structureCheck = {
  name: "structure",
  event: "PreToolUse",

  applies(input, config) {
    if (!config.gates.structure.enabled) return false;
    if ((config.gates.structure.layers ?? []).length === 0) return false;
    if (!WRITE_TOOLS.has(input.tool_name)) return false;
    return typeof input.tool_input?.file_path === "string" && input.tool_input.file_path !== "";
  },

  run(input, config) {
    const text = introducedText(input.tool_input);
    const result = checkLayering(input.tool_input.file_path, text, config.gates.structure.layers);
    return {
      decision: result.decision,
      check: structureCheck.name,
      rule: result.rule,
      reason: result.reason,
    };
  },
};
