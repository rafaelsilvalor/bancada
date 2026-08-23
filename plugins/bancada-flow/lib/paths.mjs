/**
 * Making a tool call's path comparable with the globs in the config.
 *
 * Copied from bancada's `structure.mjs` for the reason set out in
 * `docs/decisions/0002-flow-ships-its-own-dispatcher.md`, and pinned against the
 * original by `pinned.test.mjs`.
 *
 * It is worth saying why this is its own file rather than three lines inside a
 * Pause. bancada's layering gate shipped without it once: Write hands over an
 * absolute `file_path`, `src/**` never matches `/home/me/proj/src/a.ts`, so the
 * gate attributed nothing, found nothing, and reported success — a configured
 * gate enforcing nothing, which is the failure this whole project is about.
 * Every unit test passed, because every unit test used a relative path.
 *
 * bancada-flow then shipped the same bug. Pause 1 read every write as out of
 * scope and let it through. Again the unit tests passed; again an end-to-end run
 * is what found it. Twice is a pattern, so the fix has a name and a file.
 */

import { normalisePath } from "./glob.mjs";

/** Make a path project-relative, since the globs are written that way. */
export function toProjectRelative(filePath, projectDir) {
  const p = normalisePath(filePath);
  if (!projectDir) return p;
  const root = normalisePath(projectDir).replace(/\/+$/, "");
  if (root === "") return p;
  // Compare case-insensitively: Windows hands back a drive letter whose case
  // does not always match what the session was started with.
  if (p.toLowerCase().startsWith(root.toLowerCase() + "/")) return p.slice(root.length + 1);
  return p;
}
