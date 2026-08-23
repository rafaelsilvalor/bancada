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
 *
 * A write tool is not the only route. This check used to accept only those, so
 * `cat > src/lib/x.mjs <<'EOF'` crossed a layer boundary unrefused while the
 * same content through `Write` was denied — measured, 5 of 6 paired payloads.
 * It now reads `writeTargets`, and a shell write whose text is on the command
 * line is judged identically. A shell write whose text cannot be known is
 * `structure-unreadable`: allowed, and recorded under its own rule so `bancada
 * yield` counts how often the gate could not look rather than implying it always
 * could. That is the same call `size-unknown` and the unattributed-import count
 * already make — a gate that guesses at what it cannot see is how a layering
 * rule earns its first false refusal and gets switched off.
 */

import { checkLayering, compileLayers, layerOf, toProjectRelative } from "../structure.mjs";
import { foldOwn } from "../dispatch.mjs";
import { writeTargets } from "../writes.mjs";
import { projectDirOf } from "./where.mjs";

export const structureCheck = {
  name: "structure",
  event: "PreToolUse",

  applies(input, config) {
    if (!config.gates.structure.enabled) return false;
    if ((config.gates.structure.layers ?? []).length === 0) return false;
    return writeTargets(input).length > 0;
  },

  run(input, config) {
    const layers = config.gates.structure.layers;
    // Write and Edit hand over an absolute path and a shell command line
    // usually carries a relative one; layer globs are written relative to the
    // project, so the two have to be reconciled here.
    const projectDir = projectDirOf(input);
    const compiled = compileLayers(layers);

    const verdicts = writeTargets(input).map((target) => {
      if (typeof target.text === "string") {
        const result = checkLayering(target.path, target.text, layers, projectDir);
        return { decision: result.decision, check: structureCheck.name, rule: result.rule, reason: result.reason };
      }

      // Nothing to say about a file no layer claims, whether or not its text
      // was readable. Counting those as gaps would bury the ones that matter.
      const rel = toProjectRelative(target.path, projectDir);
      const from = layerOf(rel, compiled);
      return {
        decision: "allow",
        check: structureCheck.name,
        rule: from ? "structure-unreadable" : "structure-outside",
        reason: null,
      };
    });

    return foldOwn(structureCheck.name, verdicts);
  },
};
