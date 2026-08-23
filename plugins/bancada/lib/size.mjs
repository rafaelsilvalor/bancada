/**
 * The size gate: a ceiling on how long one file may get.
 *
 * The number is arbitrary and that is fine — the value of a ceiling is not that
 * 400 is correct, it is that crossing it becomes a decision somebody makes on
 * purpose instead of a drift nobody noticed. bancada does not pick the number;
 * the project does, and this file only enforces it.
 *
 * Three properties matter more than the threshold.
 *
 * **It judges the resulting file, not the edit.** A layering violation is
 * created by the line that introduces it, so that gate reads the new text alone.
 * A file being too long is a property of the file, so this one reads what the
 * file will contain — which means reading it from disk, and abstaining when it
 * cannot.
 *
 * **An over-sized file stays editable downward.** A ceiling that refuses every
 * edit to a file already past it makes the only fix impossible, and the first
 * thing anyone does about it is switch the gate off. Shrinking is always
 * allowed, even when the result is still over.
 *
 * **Tests get their own ceiling.** A test file is long because it enumerates
 * cases, which is the point of it, and holding it to the same limit as a module
 * teaches people to write fewer tests. What counts as a test is `pair.testGlobs`
 * — the same definition the pair gate uses, because two definitions of "a test
 * file" in one config would disagree eventually.
 */

import { compileGlobs, normalisePath } from "./glob.mjs";
import { countLines } from "./writes.mjs";

/**
 * The ceiling this path answers to, and which setting set it.
 *
 * `testGlobs` comes from `pair`, not from `gates.size`. That coupling is
 * deliberate and is the only place the two gates touch.
 */
export function ceilingFor(relPath, sizeSettings, testGlobs) {
  const isTest = compileGlobs(testGlobs ?? [])(normalisePath(relPath));
  return isTest
    ? { limit: sizeSettings?.testCeiling ?? 800, setting: "gates.size.testCeiling", kind: "test" }
    : { limit: sizeSettings?.maxFileLines ?? 400, setting: "gates.size.maxFileLines", kind: "source" };
}

/**
 * Judge a write against the ceiling.
 *
 * `resulting` is the text the file will contain, or null when that could not be
 * worked out; `previous` is what it contains now, or null when the file is new
 * or unreadable.
 *
 * Returns `{ decision, rule, reason, lines, limit }`. A null `resulting` is
 * `size-unknown` and allows: the gate did not look, which is a different fact
 * from finding nothing, and the telemetry records which one happened so a
 * coverage gap shows up in `bancada yield` rather than being implied.
 */
export function checkSize(relPath, resulting, previous, sizeSettings, testGlobs) {
  const { limit, setting, kind } = ceilingFor(relPath, sizeSettings, testGlobs);

  if (typeof resulting !== "string") {
    return { decision: "allow", rule: "size-unknown", reason: null, lines: null, limit };
  }

  const lines = countLines(resulting);
  if (lines <= limit) {
    return { decision: "allow", rule: "size-ok", reason: null, lines, limit };
  }

  const was = typeof previous === "string" ? countLines(previous) : null;
  if (was !== null && lines <= was) {
    return { decision: "allow", rule: "size-shrinking", reason: null, lines, limit };
  }

  const growth = was === null ? "" : ` (it has ${was} now)`;
  return {
    decision: "deny",
    rule: "size-over",
    reason: [
      `${relPath} would be ${lines} lines${growth}; this project's ceiling for ` +
        `${kind === "test" ? "a test file" : "a source file"} is ${limit} (${setting}).`,
      "",
      "Split it, or raise the ceiling in bancada.config.json on purpose. Editing",
      "it smaller is never refused, even while it is still over.",
    ].join("\n"),
    lines,
    limit,
  };
}
