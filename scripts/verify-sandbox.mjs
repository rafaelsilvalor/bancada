/**
 * The throwaway repository the end-to-end cases run in.
 *
 * Split from `verify-cases.mjs` when that file crossed this repository's own
 * line ceiling: the cases grow with every gate, the sandbox only changes when
 * the way a sandbox is built changes, and the size gate is right that those are
 * two files.
 *
 * **The sandbox is not optional.** An earlier version ran the cases in this
 * repository. The control arm — a session with no plugin and therefore no gate —
 * did exactly what it was designed to do and committed four times to the real
 * history. A verification that can damage what it verifies is not one.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Deep merge, so a case states only the settings it cares about. */
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" ? merge(out[k], v) : v;
  }
  return out;
}

const BASE_CONFIG = {
  source: { include: ["src/**"] },
  gates: {
    commit: {
      enabled: true,
      conventional: true,
      maxSubject: 72,
      denyTrailers: ["^Co-Authored-By:.*(Claude|Anthropic|noreply@anthropic)"],
    },
    structure: {
      enabled: true,
      layers: [
        { name: "lib", match: "src/lib/**", mayImport: [] },
        { name: "hooks", match: "src/hooks/**", mayImport: ["lib"] },
      ],
    },
  },
};

/** A minimal repository with the gates configured, and nothing worth losing. */
export function makeSandbox(overrides, seed, { git: useGit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bancada-verify-"));
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });

  // A case may ask for no repository. Several gates read `git status` to learn
  // what a turn touched, and the branch where git has no answer is the one that
  // never gets exercised by accident — a sandbox is a repository unless someone
  // decides otherwise.
  if (useGit) {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "bancada verification");
    git("config", "user.email", "verification@example.invalid");
    git("config", "commit.gpgsign", "false");
  }

  mkdirSync(join(dir, "src", "lib"), { recursive: true });
  mkdirSync(join(dir, "src", "hooks"), { recursive: true });
  writeFileSync(join(dir, "src", "lib", "seed.mjs"), "export const seed = 1;\n");
  writeFileSync(join(dir, "src", "hooks", "entry.mjs"), 'import { seed } from "../lib/seed.mjs";\n');
  writeFileSync(join(dir, "bancada.config.json"), JSON.stringify(merge(BASE_CONFIG, overrides), null, 2) + "\n");
  if (seed) seed(dir);

  if (useGit) {
    git("add", "-A");
    git("commit", "-q", "-m", "chore: seed the sandbox");
    // Leave something staged, so a commit the gate allows has content and does
    // not fail for the unrelated reason of an empty index.
    writeFileSync(join(dir, "src", "lib", "seed.mjs"), "export const seed = 2;\n");
    git("add", "-A");
  }
  return dir;
}
