/**
 * End-to-end verification: do the gates actually fire inside a real session?
 *
 * Everything else here tests the judgement — payloads in, verdicts out. None of
 * it proves the wiring between a Claude Code session and the hook, which lives
 * outside this codebase and is therefore the part most likely to be quietly
 * wrong. Two real bugs were found this way after every unit test passed: the
 * structure gate silently ignored the absolute paths Write actually sends, and
 * the commit gate read only the first `-m` of a multi-part message.
 *
 * **This runs in a throwaway repository, and that is not optional.** An earlier
 * version ran in this one. The control arm — a session with no plugin and
 * therefore no gate — did exactly what it was designed to do and committed four
 * times to the real history. The gate worked; it was pointed at the wrong
 * target. A verification that can damage what it verifies is not a verification.
 *
 * Each case runs twice, with the plugin and without. Without the control arm a
 * denial only proves that *something* refused; with it, "refused with the plugin
 * and allowed without" is attributable.
 *
 * This costs real API usage and is not part of `npm test`.
 *
 *   node scripts/verify-hooks.mjs [--model haiku] [--keep]
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const MODEL = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : "haiku";
const KEEP = argv.includes("--keep");

const PLUGIN = resolve("plugins/bancada");

/** A minimal repository with the gates configured, and nothing worth losing. */
function makeSandbox() {
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

  const config = {
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
  writeFileSync(join(dir, "bancada.config.json"), JSON.stringify(config, null, 2) + "\n");

  git("add", "-A");
  git("commit", "-q", "-m", "chore: seed the sandbox");
  // Leave something staged, so a commit the gate allows has content and does
  // not fail for the unrelated reason of an empty index.
  writeFileSync(join(dir, "src", "lib", "seed.mjs"), "export const seed = 2;\n");
  git("add", "-A");
  return dir;
}

const CASES = [
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
];

function run(dir, prompt, tools, withPlugin) {
  const args = [
    "-p",
    prompt,
    "--model",
    MODEL,
    "--output-format",
    "json",
    "--allowedTools",
    tools,
    ...(withPlugin ? ["--plugin-dir", PLUGIN] : []),
  ];
  const r = spawnSync("claude", args, {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 600000,
  });
  try {
    const o = JSON.parse(r.stdout);
    const denials = o.permission_denials ?? [];
    return {
      ok: true,
      denied: denials.length > 0,
      // Every denial, not the first: the model may attempt several commands and
      // the one under test is not always the one it tried first.
      commands: denials.map((d) => String(d.tool_input?.command ?? d.tool_input?.file_path ?? "")),
      cost: o.total_cost_usd ?? 0,
    };
  } catch {
    return { ok: false, error: (r.stderr || r.stdout || "no output").slice(0, 200), cost: 0 };
  }
}

let spent = 0;
let failures = 0;
let inconclusive = 0;

console.log(`Hook verification — ${MODEL}, each case with and without the plugin`);
console.log("Running in a throwaway repository; nothing here touches this one.\n");

for (const c of CASES) {
  // A fresh sandbox per case, so one case's commits cannot change what the
  // next one sees.
  const dir = makeSandbox();
  try {
    let withP = run(dir, c.prompt, c.tools, true);
    const withoutP = run(dir, c.prompt, c.tools, false);
    spent += (withP.cost ?? 0) + (withoutP.cost ?? 0);

    // The model does not always issue the command it was handed. A single
    // non-denial is ambiguous between "the gate failed" and "the gate was never
    // reached", so it gets one retry before anything is concluded.
    let retried = false;
    if ((c.expect === "deny" || c.expect === "escalate") && withP.ok && !withP.denied) {
      const second = run(dir, c.prompt, c.tools, true);
      spent += second.cost ?? 0;
      retried = true;
      if (second.ok && second.denied) withP = second;
    }

    if (!withP.ok || !withoutP.ok) {
      failures++;
      console.log(`FAIL  ${c.name}\n        a run did not complete: ${withP.error ?? withoutP.error}`);
      continue;
    }

    const matched = c.refusedMatches ? withP.commands.filter((cmd) => c.refusedMatches.test(cmd)) : withP.commands;
    if (withP.denied && c.refusedMatches && matched.length === 0) {
      inconclusive++;
      console.log(`????  ${c.name}`);
      console.log(`        only other commands were refused: ${withP.commands.join(" | ").slice(0, 90)}`);
      continue;
    }

    const gateRefused = c.refusedMatches ? matched.length > 0 : withP.denied;
    const controlRefused = c.refusedMatches
      ? withoutP.commands.some((cmd) => c.refusedMatches.test(cmd))
      : withoutP.denied;

    // Both arms refusing means something outside bancada also refuses this
    // command — observed intermittently, and confirmed by running the control
    // in a bare repository where it goes through. Attribution is impossible in
    // that state, and calling it a failure would blame the gate for a refusal
    // that is not its.
    if (c.expect !== "allow" && gateRefused && controlRefused) {
      inconclusive++;
      console.log(`????  ${c.name}`);
      console.log("        refused with and without the plugin, so this run cannot attribute it");
      continue;
    }

    let pass;
    let detail;
    if (c.expect === "allow") {
      pass = !gateRefused;
      detail = gateRefused ? "refused something it should have let through" : "allowed, as it should be";
    } else {
      pass = gateRefused;
      detail = gateRefused
        ? c.expect === "escalate"
          ? "escalated rather than passing silently, and only with the plugin"
          : "denied with the plugin, allowed without it"
        : "not refused with the plugin loaded";
    }

    if (!pass) failures++;
    console.log(`${pass ? "ok  " : "FAIL"}  ${c.name}`);
    console.log(
      `        ${detail}${retried ? " (took a second attempt; the model did not issue it the first time)" : ""}`,
    );
    if (matched.length > 0) console.log(`        refused: ${matched[0].replace(/\s+/g, " ").slice(0, 78)}`);
  } finally {
    if (KEEP) console.log(`        sandbox kept at ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

const conclusive = CASES.length - inconclusive;
console.log(`\n${conclusive - failures} of ${conclusive} conclusive case(s) behaved as expected.`);
if (inconclusive > 0) {
  console.log(`${inconclusive} case(s) inconclusive: the model never issued the command under test.`);
}
console.log(`Cost of this verification: $${spent.toFixed(4)}`);

// A last guard against the failure this script already caused once.
if (existsSync("src/lib/probe.mjs")) {
  console.error("\nA sandbox file was written into this repository. That should be impossible; investigate.");
  process.exit(1);
}

process.exit(failures > 0 ? 1 : 0);
