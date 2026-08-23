/**
 * Walking the tree, for a caller that cannot ask git.
 *
 * `git ls-files` is the better answer to "what is source here": it is the
 * project's own answer, it already honours `.gitignore`, and it needs no opinion
 * from bancada about where build output lives. `files.mjs` asks it first and
 * only falls back here.
 *
 * This is its own module because the second caller cannot use the git path at
 * all. The green boundary reaches a walk precisely when git has already declined
 * to answer, so importing the git-preferring listing would put a subprocess
 * known to fail on the path that runs when every turn ends — and would charge
 * the turn-end entry point for code it can never reach.
 *
 * Deliberately shallow in ambition: skip the usual generated directories, stop
 * at a ceiling, and say when the ceiling was hit. A truncated list makes a glob
 * look like it matches nothing, and a caller that cannot tell those two apart
 * draws a wrong conclusion from both.
 */

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".bancada",
]);

export const MAX_WALK_FILES = 20000;

/**
 * Every file under `dir`, as forward-slash paths relative to it.
 *
 * Returns `{ files, truncated }`. An unreadable directory is skipped rather than
 * fatal: a permission error in one corner of a tree is not a reason to have no
 * answer about the rest of it.
 */
export function walkFiles(dir, { readdir = readdirSync } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0 && out.length < MAX_WALK_FILES) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      out.push(relative(dir, join(current, entry.name)).split(sep).join("/"));
    }
  }
  return { files: out, truncated: out.length >= MAX_WALK_FILES };
}
