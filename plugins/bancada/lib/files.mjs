/**
 * Listing the files a gate should reason about.
 *
 * `git ls-files` is preferred over walking the tree. It is the project's own
 * answer to "what is source here", it already honours `.gitignore`, and it
 * excludes build output and vendored dependencies without bancada needing an
 * opinion about where those live.
 *
 * The walk is a fallback for a directory that is not a git repository. It is
 * deliberately shallow in ambition: skip the usual generated directories, and
 * report that the fallback was used, so a surprising result has a visible cause.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
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

const MAX_WALK_FILES = 20000;

function fromGit(dir) {
  const r = spawnSync("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

function fromWalk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0 && out.length < MAX_WALK_FILES) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue; // an unreadable directory is skipped, not fatal
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
  return out;
}

/**
 * Every file in the project, as forward-slash paths relative to `dir`.
 *
 * Returns `{ files, source, truncated }`. `source` is `"git"` or `"walk"`;
 * `truncated` is true when the walk hit its ceiling, which matters because a
 * truncated list makes a glob look like it matches nothing.
 */
export function listProjectFiles(dir, { git = fromGit, walk = fromWalk } = {}) {
  const tracked = git(dir);
  if (tracked !== null) return { files: tracked, source: "git", truncated: false };
  const files = walk(dir);
  return { files, source: "walk", truncated: files.length >= MAX_WALK_FILES };
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
