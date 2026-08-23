/**
 * The size check, as a dispatcher entry.
 *
 * This is the one check that reads a file from disk, and the exception is worth
 * naming. Every other write check judges the text the turn introduces, because
 * that is what the turn is responsible for. A file's length is a property of the
 * file, so an edit's effect on it cannot be known from the edit alone — and the
 * arithmetic shortcut, subtracting the old lines and adding the new, is wrong
 * for `replace_all` and wrong for a replacement that appears twice.
 *
 * So the current contents are read and the replacement applied. A file that
 * cannot be read yields no verdict: the check abstains under its own rule name,
 * so `bancada yield` shows how often it could not look instead of implying it
 * always could.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { checkSize } from "../size.mjs";
import { isWrite, resultingText } from "../writes.mjs";
import { inSource, projectDirOf, relativeTarget } from "./where.mjs";

export const sizeCheck = {
  name: "size",
  event: "PreToolUse",

  // The only write check that asks whether the file is source at all. A line
  // ceiling is a statement about modules; applied to everything it refuses a
  // long fixture, a generated lockfile or a changelog, and the ceiling is then
  // the thing that gets deleted rather than the file. The secret check makes the
  // opposite call on purpose — a credential in a `.env` is exactly the one worth
  // catching, and `.env` is in nobody's source globs.
  applies(input, config) {
    if (!config.gates.size.enabled) return false;
    if (!isWrite(input)) return false;
    return inSource(relativeTarget(input), config);
  },

  run(input, config, { readFile = readFileSync } = {}) {
    const given = input.tool_input.file_path;
    const absolute = isAbsolute(given) ? given : join(projectDirOf(input), given);

    // A file that does not exist yet reads as null, not as an error: a new file
    // has no previous size, which is a fact rather than a failure.
    let current = null;
    try {
      current = readFile(absolute, "utf8");
    } catch {
      current = null;
    }

    const result = checkSize(
      relativeTarget(input),
      resultingText(input.tool_input, current),
      current,
      config.gates.size,
      config.pair.testGlobs,
    );

    return {
      decision: result.decision,
      check: sizeCheck.name,
      rule: result.rule,
      reason: result.reason,
    };
  },
};
