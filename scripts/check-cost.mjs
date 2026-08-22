/**
 * Guard against cost growing by accident, without inventing a ceiling.
 *
 * This replaces an earlier script that enforced "the core must stay under 1500
 * lines". That number was invented. It was proposed as something to ratify
 * later, was never ratified, and in the meantime a script enforced it and
 * reports quoted it as a percentage — which made a guess look like a
 * measurement. That is precisely the failure this project exists to catch, so
 * it does not get to live in this project's own CI.
 *
 * Two things had to change.
 *
 * The old check measured one bag of lines. There are two: code that loads on
 * every matching tool call, and code that loads only when a human runs the CLI.
 * They are paid by different people at different times and cannot share a
 * budget.
 *
 * And lines were the wrong unit anyway. Hook code costs no context — it runs in
 * its own process and returns only a verdict — and its latency is dominated by
 * starting node, not by its own size.
 *
 * So there is no absolute ceiling here. There is a committed baseline and a
 * tolerance. Growth inside the tolerance is silent; growth past it fails until
 * someone runs `--update` and commits the new baseline, which makes every
 * increase a decision somebody made on purpose.
 *
 * Latency is measured and reported but never enforced: CI runners vary enough
 * that a millisecond threshold would fail for reasons that have nothing to do
 * with this code.
 *
 *   node scripts/check-cost.mjs            measure, compare, fail past tolerance
 *   node scripts/check-cost.mjs --update   record the current numbers as the baseline
 *   node scripts/check-cost.mjs --latency  also measure latency (slow; not run in CI)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const BASELINE = "cost-baseline.json";

/** How much a number may grow before it needs a decision. */
const TOLERANCE = 1.25;

/** Entry points, by the cost they belong to. */
const ENTRY = {
  hot: ["plugins/bancada/hooks/commit-guard.mjs"],
  cli: ["plugins/bancada/bin/bancada.mjs"],
};

const lineCount = (f) => readFileSync(f, "utf8").split(/\r?\n/).length;

/** Everything an entry point pulls in through relative imports. */
function closure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const m of readFileSync(entry, "utf8").matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const resolved = join(dirname(entry), m[1]).split("\\").join("/");
    if (existsSync(resolved)) closure(resolved, seen);
  }
  return seen;
}

function measure() {
  const hot = new Set();
  for (const e of ENTRY.hot) for (const f of closure(e)) hot.add(f);

  const cli = new Set();
  for (const e of ENTRY.cli) for (const f of closure(e)) if (!hot.has(f)) cli.add(f);

  const sum = (set) => [...set].reduce((n, f) => n + lineCount(f), 0);
  return {
    hotPathLines: sum(hot),
    cliLines: sum(cli),
    hotPathFiles: [...hot].sort(),
    cliFiles: [...cli].sort(),
  };
}

// --- latency: reported, never enforced ---

function medianMs(argv, input, runs = 11) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    spawnSync(process.execPath, argv, { input, encoding: "utf8" });
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

function measureLatency() {
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    cwd: process.cwd(),
    tool_input: { command: 'git commit -m "feat: measure the cost"' },
  });
  const floor = medianMs(["-e", "0"], "");
  const gate = medianMs([ENTRY.hot[0]], payload);
  return { floorMs: Math.round(floor), gateMs: Math.round(gate), ownShareMs: Math.round(gate - floor) };
}

// --- report ---

const args = process.argv.slice(2);
const current = measure();

if (args.includes("--latency")) {
  current.latency = measureLatency();
}

if (args.includes("--update")) {
  writeFileSync(BASELINE, JSON.stringify({ ...current, tolerance: TOLERANCE }, null, 2) + "\n");
  console.log(`wrote ${BASELINE}`);
  console.log(`  hot path: ${current.hotPathLines} lines across ${current.hotPathFiles.length} files`);
  console.log(`  cli only: ${current.cliLines} lines across ${current.cliFiles.length} files`);
  process.exit(0);
}

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch {
  console.error(`${BASELINE} is missing. Record it with: node scripts/check-cost.mjs --update`);
  process.exit(1);
}

const rows = [
  ["hot path (every tool call)", current.hotPathLines, baseline.hotPathLines],
  ["cli only (on demand)", current.cliLines, baseline.cliLines],
];

let failed = false;
console.log("Cost against the recorded baseline\n");
for (const [label, now, was] of rows) {
  const limit = Math.ceil(was * TOLERANCE);
  const over = now > limit;
  if (over) failed = true;
  const delta = now - was;
  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  console.log(
    `  ${over ? "OVER" : "ok  "} ${label.padEnd(28)} ${String(now).padStart(5)} lines  (baseline ${was}, ${sign}, limit ${limit})`,
  );
}

if (current.latency) {
  const l = current.latency;
  console.log(
    `\n  info  latency                      ${l.gateMs} ms total, of which ${l.ownShareMs} ms is bancada;` +
      ` ${l.floorMs} ms is node starting up.`,
  );
  console.log("        Reported, not enforced: CI runners vary too much for a millisecond threshold to mean anything.");
}

if (failed) {
  console.error(
    "\nSomething grew past its tolerance. If the growth is intended, run" +
      "\n  node scripts/check-cost.mjs --update" +
      "\nand commit the new baseline, so the increase is a decision in the history" +
      "\nrather than a drift nobody noticed.",
  );
  process.exit(1);
}

console.log("\nNo unplanned growth.");
