/**
 * Listing the files a gate should reason about.
 *
 * `git ls-files` is preferred over walking the tree. It is the project's own
 * answer to "what is source here", it already honours `.gitignore`, and it
 * excludes build output and vendored dependencies without bancada needing an
 * opinion about where those live.
 *
 * The walk is a fallback for a directory that is not a git repository, and it
 * lives in `walk.mjs` because the green boundary needs it without needing any of
 * this: it reaches a walk only when git has already refused to answer.
 * Reporting which of the two answered is this module's job, so a surprising
 * result has a visible cause.
 */

import { spawnSync } from "node:child_process";
import { walkFiles } from "./walk.mjs";

function fromGit(dir) {
  const r = spawnSync("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * Every file in the project, as forward-slash paths relative to `dir`.
 *
 * Returns `{ files, source, truncated }`. `source` is `"git"` or `"walk"`;
 * `truncated` is true when the walk hit its ceiling, which matters because a
 * truncated list makes a glob look like it matches nothing.
 */
export function listProjectFiles(dir, { git = fromGit, walk = walkFiles } = {}) {
  const tracked = git(dir);
  if (tracked !== null) return { files: tracked, source: "git", truncated: false };
  const { files, truncated } = walk(dir);
  return { files, source: "walk", truncated };
}

/** Directories that no glob in `settings` covers. A blind spot, not an error. */
export function uncoveredDirs(files, predicate) {
  const dirs = new Map();
  for (const f of files) {
    const top = f.includes("/") ? f.slice(0, f.indexOf("/")) : ".";
    if (!dirs.has(top)) dirs.set(top, { total: 0, covered: 0 });
    const entry = dirs.get(top);
    entry.total++;
    if (predicate(f)) entry.covered++;
  }
  return [...dirs.entries()]
    .filter(([, v]) => v.covered === 0)
    .map(([dir, v]) => ({ dir, files: v.total }))
    .sort((a, b) => b.files - a.files);
}
