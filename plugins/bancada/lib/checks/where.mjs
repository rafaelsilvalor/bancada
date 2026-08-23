/**
 * Where the project is, and where in it a tool call is pointing.
 *
 * Every write check has to answer the same two questions before it can judge
 * anything, and getting the first one wrong is not a wrong answer but no answer:
 * the layering gate once attributed nothing at all because it compared an
 * absolute `file_path` against globs written relative to the project, found no
 * match, and reported success. A configured gate enforcing nothing is the
 * failure this project exists to catch, so the reconciliation lives in one place
 * that four checks share.
 */

import { compileGlobs } from "../glob.mjs";
import { toProjectRelative } from "../structure.mjs";

/** The project root, from the host's environment or the payload. */
export function projectDirOf(input) {
  return process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
}

/** The file a tool call names, made relative to the project root. */
export function relativeTarget(input) {
  return toProjectRelative(input?.tool_input?.file_path ?? "", projectDirOf(input));
}

/**
 * Whether a path is source, as this project defines source.
 *
 * A check that reasons about code has to know which files are code, and
 * `source.include` is where the project already said. Guessing instead is how a
 * line ceiling meant for modules ends up refusing a data fixture or a long
 * changelog, after which the ceiling is the thing that gets deleted.
 *
 * An empty `include` is not "everything". The project has said nothing, so a
 * check that depends on this answer does not apply — reported by `bancada
 * doctor` and warned about by the config validator, because a gate that is on
 * and matches nothing has to be visible.
 */
export function inSource(relPath, config) {
  const include = config?.source?.include ?? [];
  if (include.length === 0) return false;
  if (!compileGlobs(include)(relPath)) return false;
  return !compileGlobs(config?.source?.exclude ?? [])(relPath);
}
