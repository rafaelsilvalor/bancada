/**
 * Finding what a file depends on, without parsing it.
 *
 * A real parser per language would be more accurate and would also be a
 * dependency tree, a build step, and a reason for this gate to fail on a
 * language nobody anticipated. Regular expressions over import syntax are
 * enough for the question being asked — which module does this file reach for —
 * and they degrade in the right direction: an import form that is not
 * recognised is simply not checked, rather than being checked wrongly.
 *
 * That trade has a cost and it is stated rather than hidden: dynamic imports
 * built from variables, re-exports through a barrel file, and imports inside
 * strings or comments are not seen. A layering rule enforced here is a fast
 * first line, not a proof.
 */

/**
 * Per-language patterns. Each capture group 1 is the module specifier.
 *
 * The Python bare-import pattern is the delicate one. Written loosely as
 * `import (\w+)` it also matches JavaScript's `import fs from "node:fs"` and
 * captures `fs` — the local binding, not a module. That turns every JS default
 * import into a phantom dependency. It is anchored to end-of-statement instead,
 * which is what distinguishes Python's `import os` from JavaScript's
 * `import os from "..."`.
 *
 * Go's grouped import block is not covered. Matching a bare quoted string on
 * its own line would also match array entries and string constants in other
 * languages, and a false violation is far more expensive than a missed one.
 */
const PATTERNS = [
  // JavaScript / TypeScript
  /^\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm,
  /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/gm,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  // Python
  /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+/gm,
  /^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+\w+)?\s*(?:,|$)/gm,
  // Go, single-line form only
  /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm,
];

/** Strip line and block comments so a commented-out import is not counted. */
function stripComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1")
    .replace(/^\s*#[^\n]*/gm, "");
}

/**
 * Every module specifier a source file references.
 *
 * Returns a de-duplicated array in first-seen order, so a report reads in the
 * order someone would find them by scrolling.
 */
export function extractImports(source) {
  if (typeof source !== "string" || source === "") return [];
  const clean = stripComments(source);
  const found = [];
  const seen = new Set();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    for (const m of clean.matchAll(pattern)) {
      const spec = m[1];
      if (!spec || seen.has(spec)) continue;
      seen.add(spec);
      found.push(spec);
    }
  }
  return found;
}

/** True when a specifier points at a path rather than at a package. */
export function isRelative(spec) {
  return typeof spec === "string" && (spec.startsWith("./") || spec.startsWith("../"));
}

/**
 * Resolve a relative specifier against the importing file, as a repo-relative
 * forward-slash path with no extension.
 *
 * The extension is dropped because `./order`, `./order.js` and `./order.ts` are
 * the same module to a layering rule, and keeping it would make a glob author
 * guess which spelling the code used.
 */
export function resolveRelative(fromFile, spec) {
  const parts = String(fromFile).replace(/\\/g, "/").split("/");
  parts.pop(); // drop the file name; specifiers are relative to its directory
  for (const segment of String(spec).split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/").replace(/\.[cm]?[jt]sx?$/, "");
}
