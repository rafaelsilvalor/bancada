/**
 * What the green boundary remembers between one stop and the next.
 *
 * The boundary needs one fact that a single stop cannot supply: has anything
 * changed since the last time it ran? Without it, honouring `stop_hook_active`
 * means never re-checking inside a blocking sequence — the model is told its
 * tests fail, fixes them, stops again, and is waved through unverified. With it,
 * a stop that follows a real edit gets a real answer, and a stop that follows
 * nothing is allowed, because nothing could have been fixed and blocking again
 * would be a loop with no progress in it.
 *
 * **The fingerprint is taken after the boundary runs, not before.** A test suite
 * writes things — a log, a coverage directory, a build cache — and a fingerprint
 * taken beforehand would see the boundary's own leavings on the next stop and
 * call them progress. Every run would then look like a change, and the loop this
 * file exists to terminate would never terminate. Taking it afterwards folds the
 * side effects into the baseline they are compared against.
 *
 * **Nothing here throws.** State is an optimisation over re-running, and losing
 * it costs an extra test-suite run, which is the safe direction. A gate that
 * blocks a turn because its own bookkeeping file was unwritable would be the
 * failure the whole project is about.
 *
 * The file lands in `.bancada/`, alongside the telemetry stream, so a project
 * that already ignores that directory needs no second entry.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STATE_DIR = ".bancada";
export const STATE_FILE = "green-state.json";

/** Above this, a file contributes its size and mtime instead of its contents. */
const MAX_HASHED_BYTES = 8 * 1024 * 1024;

export const statePath = (projectDir) => join(projectDir ?? ".", STATE_DIR, STATE_FILE);

/**
 * A digest of the files the boundary's verdict could depend on.
 *
 * Returns null when the file list is unknown, and null never equals null here:
 * "I could not tell what changed" has to mean "run it again", not "nothing
 * changed". Contents are hashed rather than timestamps compared, because a
 * false negative in this direction skips the check.
 */
export function fingerprint(projectDir, files, { readFile = readFileSync, stat = statSync } = {}) {
  if (!Array.isArray(files)) return null;
  const digest = createHash("sha256");
  for (const rel of [...files].sort()) {
    const abs = join(projectDir ?? ".", rel);
    digest.update(rel);
    digest.update("\0");
    try {
      const size = stat(abs).size;
      if (size > MAX_HASHED_BYTES) {
        // Marked as a distinct mode, so a file crossing the threshold in either
        // direction changes the digest rather than silently comparing equal.
        digest.update(`size:${size}:${stat(abs).mtimeMs}`);
      } else {
        digest.update(createHash("sha256").update(readFile(abs)).digest("hex"));
      }
    } catch {
      // A path that cannot be read still counts: a file that appears or vanishes
      // between stops is a change, and it must not hash the same as one whose
      // contents happen to be empty.
      digest.update("unreadable");
    }
    digest.update("\n");
  }
  return digest.digest("hex").slice(0, 32);
}

/**
 * The state left by the last run, or null.
 *
 * State from a different session is discarded rather than trusted. Two sessions
 * working in one checkout would otherwise read each other's fingerprints, and
 * the failure mode of trusting them is skipping a check.
 */
export function readState(projectDir, session, { readFile = readFileSync } = {}) {
  try {
    const parsed = JSON.parse(readFile(statePath(projectDir), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.session !== session) return null;
    return { session: parsed.session, fingerprint: parsed.fingerprint ?? null, blocks: parsed.blocks ?? 0 };
  } catch {
    return null;
  }
}

/** Record what this run saw. Returns whether it was written; no caller may branch on it. */
export function writeState(projectDir, state, { write = writeFileSync, mkdir = mkdirSync } = {}) {
  try {
    mkdir(join(projectDir ?? ".", STATE_DIR), { recursive: true });
    write(statePath(projectDir), JSON.stringify(state) + "\n");
    return true;
  } catch {
    return false;
  }
}
