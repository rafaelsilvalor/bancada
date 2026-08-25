/**
 * What the end-to-end verification tries.
 *
 * Split from the harness in `verify-hooks.mjs` because the two grow for
 * different reasons: the harness changes when the way a verdict is observed
 * changes, this file changes every time a gate is added. Keeping them together
 * put the whole thing past this project's own line ceiling — and when this file
 * later crossed it alone, the throwaway repository the cases run in moved to
 * `verify-sandbox.mjs`. A fair thing for a gate to have caught in its own
 * repository, twice.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A credential-shaped string, assembled so this file is not one itself. */
const GITHUB_TOKEN = "ghp_" + "0123456789abcdefghij0123456789abcdef";

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

/**
 * A brief that validates, so Pause 1 has something to be satisfied by.
 *
 * The sandbox is initialised on `main`, so this is the brief for that branch.
 */
function seedBrief(dir) {
  mkdirSync(join(dir, "docs", "briefs"), { recursive: true });
  writeFileSync(
    join(dir, "docs", "briefs", "main.md"),
    [
      "# Add a thing to the library",
      "",
      "## Problem",
      "Callers work around the missing thing by hand.",
      "",
      "## Done when",
      "- [ ] the thing exists in src/lib",
      "",
      "## Not doing",
      "- the other thing",
      "",
      "## How it will be checked",
      "node --test",
      "",
    ].join("\n"),
  );
}

/** Files a sandbox case writes. If one appears here, the sandboxing failed. */
export const SANDBOX_ARTEFACTS = [
  "src/lib/order.mjs",
  "src/lib/probe.mjs",
  "src/lib/creds.mjs",
  "src/lib/long.mjs",
  "src/lib/order.test.mjs",
  "green-runs.log",
  "green-boundary.mjs",
  "GREEN",
  "src/lib/unbriefed.mjs",
  "src/lib/briefed.mjs",
  "docs/briefs/main.md",
  "some-message-file.txt",
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
    // The message file is seeded, and that is the fix for a flaky case rather
    // than a convenience. Without it the model checks whether the file exists
    // before committing, that check is refused by the tool allowlist, and the
    // run reports a denial that has nothing to do with bancada. The gate's
    // behaviour is identical either way: the message is in a file, and a file is
    // not something a PreToolUse hook can read.
    seed: (dir) => writeFileSync(join(dir, "some-message-file.txt"), "feat: a subject in a file\n"),
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
    name: "a write with no brief for the branch",
    // bancada-flow is a second plugin and a second process. This case is the
    // only thing that proves both are loaded and that the two dispatchers
    // coexist on one event without one swallowing the other.
    plugins: ["bancada", "bancada-flow"],
    forceEnable: ["bancada-flow"],
    config: { flow: { enabled: true, scope: ["src/**"], pauses: ["brief"] } },
    prompt:
      "Use the Write tool to create the file src/lib/unbriefed.mjs with exactly this content and nothing else:\n" +
      "export const thing = 1;\n",
    tools: "Write",
    expect: "deny",
    refusedMatches: /unbriefed\.mjs/,
  },
  {
    name: "the same write once the branch has a brief",
    plugins: ["bancada", "bancada-flow"],
    forceEnable: ["bancada-flow"],
    config: { flow: { enabled: true, scope: ["src/**"], pauses: ["brief"] } },
    seed: seedBrief,
    prompt:
      "Use the Write tool to create the file src/lib/briefed.mjs with exactly this content and nothing else:\n" +
      "export const thing = 1;\n",
    tools: "Write",
    expect: "allow",
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
  {
    name: "a module written with no colocated test, until the model writes one",
    // Like the green cases, not a refusal: the block lands at Stop. The sandbox
    // leaves `src/lib/seed.mjs` staged and untested, so it is excepted — the
    // case is about the file this session writes, not the backlog it inherits.
    // The evidence is the test file itself: its path reaches the model only
    // through bancada's block, never through the prompt.
    config: {
      gates: {
        colocated: {
          enabled: true,
          exceptions: [{ path: "src/lib/seed.mjs", reason: "sandbox seed file", date: "2026-08-25" }],
        },
      },
    },
    prompt:
      "Use the Write tool to create the file src/lib/order.mjs with exactly this content and nothing else:\n" +
      "export const order = 1;\n",
    tools: "Write",
    expect: "block",
    evidence: (dir) => (existsSync(join(dir, "src", "lib", "order.test.mjs")) ? 1 : 0),
    minEvidence: 1,
    evidenceMeans: "the block named the missing test and the model wrote it",
  },
  {
    name: "a green boundary outside a git repository",
    // The same claim as the case above, in a directory where `git status` has
    // nothing to say. That was the one branch where the boundary could not tell
    // a stop that had changed something from one that had not, so it re-ran on
    // every stop and Claude Code's cap of eight ended the sequence.
    //
    // What this case proves is that the walk that replaced git still blocks a
    // red build and still re-checks a fixed one. It does not prove the
    // termination it was written for: that needs a stop where the model changed
    // nothing, which no prompt can guarantee. `green.test.mjs` asserts it
    // against a real filesystem instead.
    git: false,
    config: { gates: { green: { enabled: true, commands: ["node green-boundary.mjs"], timeoutMs: 60000 } } },
    seed: seedGreenBoundary,
    prompt: "Run this shell command exactly as written: node --version",
    // Write as well as Bash, unlike the case above. The claim needs the model to
    // act on the refusal, and one run where it had only a shell ended with the
    // boundary having run once — which is the correct verdict for a stop that
    // changed nothing, and no evidence at all about the branch under test.
    tools: "Bash,Write",
    expect: "block",
    evidence: countRuns,
    minEvidence: 2,
    evidenceMeans: "blocked while red, then re-checked after the fix, with no git to ask what changed",
  },
];
