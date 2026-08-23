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
 * Each case runs twice, with the plugin and without, in a sandbox of its own per
 * arm. Without the control arm a denial only proves that *something* refused;
 * with it, "refused with the plugin and allowed without" is attributable. A
 * sandbox per arm rather than per case, so nothing one arm did to the working
 * tree can be mistaken for the other arm's verdict.
 *
 * Two kinds of case. Most are refusals, read off `permission_denials` in the
 * session's JSON result. The green boundary is not a refusal — it runs on
 * `Stop`, where there is no permission to deny — so it is read off a side effect
 * the boundary command leaves behind in the sandbox.
 *
 * The cases themselves, and the throwaway repository they run in, are in
 * `verify-cases.mjs`.
 *
 * This costs real API usage and is not part of `npm test`.
 *
 *   node scripts/verify-hooks.mjs [--model haiku] [--keep] [--only <substring>]
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CASES, makeSandbox, SANDBOX_ARTEFACTS } from "./verify-cases.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const MODEL = flag("--model", "haiku");
const ONLY = flag("--only", null);
const KEEP = argv.includes("--keep");

/**
 * A copy of a plugin with `defaultEnabled` removed, and why that is necessary.
 *
 * bancada-flow ships `defaultEnabled: false` on purpose, which the CLI documents
 * as "starts disabled when the user has no explicit setting for it". Loading it
 * with `--plugin-dir` therefore loads it and leaves it off, and no
 * `enabledPlugins` key reaches a plugin that came from a directory rather than a
 * marketplace — three key shapes were tried, in `--settings` and in
 * `.claude/settings.local.json`, and the hook stayed silent in all five runs.
 *
 * So this case verifies a copy that differs from the shipped plugin in exactly
 * one manifest field, whose only effect is whether the host switches it on. That
 * is a real caveat and the report prints it. The alternative was no end-to-end
 * evidence at all for the plugin that has the least of it.
 */
const enabledCopies = [];
function enabledCopy(name) {
  const dir = mkdtempSync(join(tmpdir(), `bancada-enabled-${name}-`));
  cpSync(resolve("plugins", name), dir, { recursive: true });
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  const parsed = JSON.parse(readFileSync(manifest, "utf8"));
  delete parsed.defaultEnabled;
  writeFileSync(manifest, JSON.stringify(parsed, null, 2) + "\n");
  enabledCopies.push(dir);
  return dir;
}

/** A case loads bancada unless it names the plugins it needs. */
const pluginArgs = (c) =>
  (c.plugins ?? ["bancada"]).flatMap((p) => [
    "--plugin-dir",
    (c.forceEnable ?? []).includes(p) ? enabledCopy(p) : resolve("plugins", p),
  ]);

function run(dir, c, withPlugin) {
  const args = [
    "-p",
    c.prompt,
    "--model",
    MODEL,
    "--output-format",
    "json",
    "--allowedTools",
    c.tools,
    ...(c.extraArgs ?? []),
    ...(withPlugin ? pluginArgs(c) : []),
  ];
  const r = spawnSync("claude", args, { cwd: dir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 });
  try {
    const o = JSON.parse(r.stdout);
    const denials = o.permission_denials ?? [];
    return {
      ok: true,
      denied: denials.length > 0,
      // Every denial, not the first: the model may attempt several commands and
      // the one under test is not always the one it tried first.
      commands: denials.map((d) => String(d.tool_input?.command ?? d.tool_input?.file_path ?? "")),
      turns: o.num_turns ?? 0,
      cost: o.total_cost_usd ?? 0,
    };
  } catch {
    return { ok: false, error: (r.stderr || r.stdout || "no output").slice(0, 200), cost: 0 };
  }
}

/** One arm, in its own sandbox. */
function attempt(c, withPlugin) {
  const dir = makeSandbox(c.config, c.seed);
  try {
    const result = run(dir, c, withPlugin);
    result.evidence = c.evidence ? c.evidence(dir) : null;
    return result;
  } finally {
    if (KEEP) console.log(`        sandbox kept at ${dir}`);
    else rmSync(dir, { recursive: true, force: true });
  }
}

let spent = 0;
let failures = 0;
let inconclusive = 0;

const selected = CASES.filter((c) => ONLY === null || c.name.includes(ONLY));

console.log(`Hook verification — ${MODEL}, each case with and without the plugin`);
console.log("Running in a throwaway repository; nothing here touches this one.\n");

for (const c of selected) {
  let withP = attempt(c, true);
  const withoutP = attempt(c, false);
  spent += (withP.cost ?? 0) + (withoutP.cost ?? 0);

  // The model does not always issue the command it was handed. A single
  // non-result is ambiguous between "the gate failed" and "the gate was never
  // reached", so it gets one retry before anything is concluded.
  const fired = (r) => (c.expect === "block" ? r.evidence >= (c.minEvidence ?? 1) : r.denied);
  let retried = false;
  if (c.expect !== "allow" && withP.ok && !fired(withP)) {
    const second = attempt(c, true);
    spent += second.cost ?? 0;
    retried = true;
    if (second.ok && fired(second)) withP = second;
  }
  const again = retried ? " (took a second attempt; the model did not issue it the first time)" : "";

  if (!withP.ok || !withoutP.ok) {
    failures++;
    console.log(`FAIL  ${c.name}\n        a run did not complete: ${withP.error ?? withoutP.error}`);
    continue;
  }

  // --- the Stop-event case, read off a side effect rather than a denial ---
  if (c.expect === "block") {
    const pass = fired(withP) && withoutP.evidence === 0;
    if (!pass) failures++;
    console.log(`${pass ? "ok  " : "FAIL"}  ${c.name}`);
    console.log(
      `        the boundary ran ${withP.evidence} time(s) with the plugin and ${withoutP.evidence} without` +
        `${pass && c.evidenceMeans ? ` — ${c.evidenceMeans}` : ""}${again}`,
    );
    console.log(`        turns: ${withP.turns} with the plugin, ${withoutP.turns} without (reported, not enforced)`);
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
  // command — observed intermittently, and confirmed by running the control in a
  // bare repository where it goes through. Attribution is impossible in that
  // state, and calling it a failure would blame the gate for a refusal that is
  // not its.
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
  console.log(`        ${detail}${again}`);
  if (matched.length > 0) console.log(`        refused: ${matched[0].replace(/\s+/g, " ").slice(0, 78)}`);
}

const conclusive = selected.length - inconclusive;
console.log(`\n${conclusive - failures} of ${conclusive} conclusive case(s) behaved as expected.`);
if (inconclusive > 0) {
  console.log(`${inconclusive} case(s) inconclusive: the model never issued the command under test.`);
}
console.log(`Cost of this verification: $${spent.toFixed(4)}`);

for (const d of enabledCopies) rmSync(d, { recursive: true, force: true });

// A last guard against the failure this script already caused once.
const leaked = SANDBOX_ARTEFACTS.filter(existsSync);
if (leaked.length > 0) {
  console.error(`\nSandbox file(s) were written into this repository: ${leaked.join(", ")}`);
  console.error("That should be impossible; investigate before trusting anything above.");
  process.exit(1);
}

process.exit(failures > 0 ? 1 : 0);
