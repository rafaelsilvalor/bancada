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
 *
 * The same abstention now covers the shell route. `cat > big.mjs <<'EOF'` hands
 * over the whole resulting file and is judged exactly as `Write` is — it was
 * not, before this, and a 400-line file walked past a 300-line ceiling by being
 * written with a heredoc. `sed -i` names the file and not its contents, so it
 * stays `size-unknown`. **There is no sweep behind this one.** `bancada check`
 * catches a layering violation that arrived unseen; nothing anywhere answers
 * "which files are over the ceiling", so what this check does not see at the
 * hook is not seen later either.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { checkSize } from "../size.mjs";
import { foldOwn } from "../dispatch.mjs";
import { targetResult, writeTargets } from "../writes.mjs";
import { inSource, projectDirOf } from "./where.mjs";
import { toProjectRelative } from "../structure.mjs";

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
    const projectDir = projectDirOf(input);
    return writeTargets(input).some((t) => inSource(toProjectRelative(t.path, projectDir), config));
  },

  run(input, config, { readFile = readFileSync } = {}) {
    const projectDir = projectDirOf(input);

    const verdicts = writeTargets(input)
      .map((target) => {
        const rel = toProjectRelative(target.path, projectDir);
        // A command line can write several files at once, only some of them
        // source. The ones that are not are this check's business in no way at
        // all, so they produce no verdict rather than an abstention.
        if (!inSource(rel, config)) return null;

        const absolute = isAbsolute(target.path) ? target.path : join(projectDir, target.path);

        // A file that does not exist yet reads as null, not as an error: a new
        // file has no previous size, which is a fact rather than a failure.
        let current = null;
        try {
          current = readFile(absolute, "utf8");
        } catch {
          current = null;
        }

        const result = checkSize(
          rel,
          targetResult(target, current),
          current,
          config.gates.size,
          config.pair.testGlobs,
        );
        return { decision: result.decision, check: sizeCheck.name, rule: result.rule, reason: result.reason };
      })
      .filter(Boolean);

    return foldOwn(sizeCheck.name, verdicts);
  },
};
