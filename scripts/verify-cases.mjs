/**
 * What the end-to-end verification tries, and the throwaway repository it tries
 * it in.
 *
 * Split from the harness in `verify-hooks.mjs` because the two grow for
 * different reasons: the harness changes when the way a verdict is observed
 * changes, this file changes every time a gate is added. Keeping them together
 * put the whole thing past this project's own line ceiling, which is a fair
 * thing for a gate to have caught in its own repository.
 *
 * **The sandbox is not optional.** An earlier version ran the cases in this
 * repository. The control arm — a session with no plugin and therefore no gate —
 * did exactly what it was designed to do and committed four times to the real
 * history. A verification that can damage what it verifies is not one.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A credential-shaped string, assembled so this file is not one itself. */
const GITHUB_TOKEN = "ghp_" + "0123456789abcdefghij0123456789abcdef";

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
export function makeSandbox(overrides, seed) {
  const dir = mkdtempSync(join(tmpdir(), "bancada-verify-"));
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });

  git("init", "-q", "-b", "main");
  git("config", "user.name", "bancada verification");
  git("config", "user.email", "verification@example.invalid");
  git("config", "commit.gpgsign", "false");

  mkdirSync(join(dir, "src", "lib"), { recursive: true });
  mkdirSync(join(dir, "src", "hooks"), { recursive: true });
  writeFileSync(join(dir, "src", "lib", "seed.mjs"), "export const seed = 1;\n");
  writeFileSync(join(dir, "src", "hooks", "entry.mjs"), 'import { seed } from "../lib/seed.mjs";\n');
  writeFileSync(join(dir, "bancada.config.json"), JSON.stringify(merge(BASE_CONFIG, overrides), null, 2) + "\n");
  if (seed) seed(dir);

  git("add", "-A");
  git("commit", "-q", "-m", "chore: seed the sandbox");
  // Leave something staged, so a commit the gate allows has content and does
  // not fail for the unrelated reason of an empty index.
  writeFileSync(join(dir, "src", "lib", "seed.mjs"), "export const seed = 2;\n");
  git("add", "-A");
  return dir;
}

/**
 * A boundary that fails until the model does one specific thing.
 *
 * Fixable on purpose. An always-red boundary proves only that the command ran;
 * this one distinguishes the two states that matter — blocked while broken,
 * allowed once fixed — and the count of runs it leaves behind says which
 * happened. The instruction reaches the model only through bancada's refusal,
 * never through the prompt, so a second run is evidence the block landed.
 */
function seedGreenBoundary(dir) {
  writeFileSync(
    join(dir, "green-boundary.mjs"),
    'import { appendFileSync, existsSync } from "node:fs";\n' +
      'appendFileSync("green-runs.log", "ran\\n");\n' +
      'if (existsSync("GREEN")) process.exit(0);\n' +
      'process.stderr.write("the build is red: it stays red until a file named GREEN exists in the project root\\n");\n' +
      "process.exit(1);\n",
  );
}

const countRuns = (dir) => {
  try {
    return readFileSync(join(dir, "green-runs.log"), "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
};

/** Files a sandbox case writes. If one appears here, the sandboxing failed. */
export const SANDBOX_ARTEFACTS = [
  "src/lib/probe.mjs",
  "src/lib/creds.mjs",
  "src/lib/long.mjs",
  "src/lib/order.test.mjs",
  "green-runs.log",
  "green-boundary.mjs",
  "GREEN",
];

export const CASES = [
  {
    name: "a non-conventional commit subject",
    prompt: 'Run this shell command exactly as written, do not correct the message: git commit -m "adding a thing"',
    tools: "Bash",
    expect: "deny",
    refusedMatches: /adding a thing/,
  },
  {
    name: "a commit carrying assistant attribution",
    // Two -m flags rather than an embedded newline: the model reworded the
    // multi-line form often enough that the case measured its formatting habits
    // rather than the gate.
    prompt:
      'Run this shell command exactly as written: git commit -m "feat: add a thing" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"',
    tools: "Bash",
    expect: "deny",
    refusedMatches: /Co-Authored-By/i,
  },
  {
    name: "a well-formed commit",
    prompt: 'Run this shell command exactly as written: git commit -m "feat: add a well formed subject"',
    tools: "Bash",
    expect: "allow",
  },
  {
    name: "a shell command that is not a commit",
    prompt: "Run this shell command exactly as written: git status --short",
    tools: "Bash",
    expect: "allow",
  },
  {
    name: "a write that crosses a layer boundary",
    prompt:
      'Use the Write tool to create the file src/lib/probe.mjs with exactly this content and nothing else:\nimport { entry } from "../hooks/entry.mjs";\n',
    tools: "Write",
    expect: "deny",
    refusedMatches: /probe\.mjs/,
  },
  {
    name: "a commit whose message the gate cannot read",
    prompt: "Run this shell command exactly as written: git commit -F some-message-file.txt",
    tools: "Bash",
    // With nobody to ask, the escalation resolves as a refusal, which is the
    // safe direction.
    expect: "escalate",
    refusedMatches: /commit -F/,
  },
  {
    name: "a write carrying a credential",
    prompt:
      "Use the Write tool to create the file src/lib/creds.mjs with exactly this content and nothing else:\n" +
      `export const token = "${GITHUB_TOKEN}";\n`,
    tools: "Write",
    expect: "deny",
    refusedMatches: /creds\.mjs/,
  },
  {
    name: "a write past the line ceiling",
    config: { gates: { size: { enabled: true, maxFileLines: 5 } } },
    prompt:
      "Use the Write tool to create the file src/lib/long.mjs with exactly twenty lines, " +
      "where line N is: export const n<N> = <N>;\nWrite all twenty lines and nothing else.",
    tools: "Write",
    expect: "deny",
    refusedMatches: /long\.mjs/,
  },
  {
    name: "the code role editing a test",
    // `agent_type` reaches the hook on the main thread of a session started with
    // --agent, which is what makes this verifiable without a subagent.
    config: { pair: { enabled: true, codeAgent: "code", testAgent: "test" } },
    extraArgs: [
      "--agents",
      JSON.stringify({
        code: { description: "Writes implementation code", prompt: "You write implementation code." },
      }),
      "--agent",
      "code",
    ],
    prompt:
      "Use the Write tool to create the file src/lib/order.test.mjs with exactly this content and nothing else:\n" +
      "export const ok = true;\n",
    tools: "Write",
    expect: "deny",
    refusedMatches: /order\.test\.mjs/,
  },
  {
    name: "a green boundary blocking, then passing once it is fixed",
    // Not a refusal: Stop has no permission to deny, so this is read off a side
    // effect instead. Two runs is the whole claim. One would only prove the
    // Stop hook fired; two means the first blocked, the model acted on a reason
    // it could have got nowhere else, and the boundary was re-checked on the
    // next stop rather than waved through on `stop_hook_active`.
    config: { gates: { green: { enabled: true, commands: ["node green-boundary.mjs"], timeoutMs: 60000 } } },
    seed: seedGreenBoundary,
    prompt: "Run this shell command exactly as written: git status --short",
    tools: "Bash",
    expect: "block",
    evidence: countRuns,
    minEvidence: 2,
    evidenceMeans: "blocked while red, then re-checked after the fix",
  },
];
