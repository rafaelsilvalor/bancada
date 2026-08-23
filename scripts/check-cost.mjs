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
 * The old check measured one bag of lines. There are three, one per entry point:
 * code that loads on every matching tool call, code that loads once when a turn
 * ends, and code that loads only when a human runs the CLI. They are paid at
 * different times and cannot share a budget. The third bucket was added when the
 * green boundary arrived and the baseline filed it under "on demand", which was
 * wrong by a factor of however many turns a session has.
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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const BASELINE = "cost-baseline.json";

/** How much a number may grow before it needs a decision. */
const TOLERANCE = 1.25;

/**
 * Entry points, by when their cost is paid. Order matters: a file is counted
 * against the first bucket that reaches it, so shared code lands in the one that
 * pays most often.
 */
const ENTRY = {
  hot: ["plugins/bancada/hooks/pre-tool-use.mjs"],
  stop: ["plugins/bancada/hooks/stop.mjs"],
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
  const claimed = new Set();
  const buckets = {};
  for (const [bucket, entries] of Object.entries(ENTRY)) {
    const own = new Set();
    for (const e of entries) {
      for (const f of closure(e)) {
        if (claimed.has(f)) continue;
        own.add(f);
      }
    }
    for (const f of own) claimed.add(f);
    buckets[bucket] = own;
  }

  const sum = (set) => [...set].reduce((n, f) => n + lineCount(f), 0);
  return {
    hotPathLines: sum(buckets.hot),
    stopLines: sum(buckets.stop),
    cliLines: sum(buckets.cli),
    hotPathFiles: [...buckets.hot].sort(),
    stopFiles: [...buckets.stop].sort(),
    cliFiles: [...buckets.cli].sort(),
  };
}

// --- latency: reported, never enforced ---

function medianMs(argv, input, env, runs = 11) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    spawnSync(process.execPath, argv, { input, env, encoding: "utf8" });
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/**
 * Time the hot path, pointed at a copy of this project's config in a throwaway
 * directory.
 *
 * Not for isolation's sake — the gate does its real work, telemetry write
 * included, which is the point of measuring it. It is so the eleven synthetic
 * tool calls this fires land somewhere disposable. Run against the project
 * itself they went into the project's own stream, where `bancada yield` counted
 * them as real, and a measurement that corrupts the record it is measuring is
 * the failure this whole repository is about.
 */
function measureLatency() {
  const dir = mkdtempSync(join(tmpdir(), "bancada-latency-"));
  try {
    if (existsSync("bancada.config.json")) {
      writeFileSync(join(dir, "bancada.config.json"), readFileSync("bancada.config.json", "utf8"));
    }
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: dir,
      tool_input: { command: 'git commit -m "feat: measure the cost"' },
    });
    const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
    const floor = medianMs(["-e", "0"], "", env);
    const gate = medianMs([ENTRY.hot[0]], payload, env);
    return { floorMs: Math.round(floor), gateMs: Math.round(gate), ownShareMs: Math.round(gate - floor) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  console.log(`  turn end: ${current.stopLines} lines across ${current.stopFiles.length} files`);
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
  ["turn end (every Stop)", current.stopLines, baseline.stopLines],
  ["cli only (on demand)", current.cliLines, baseline.cliLines],
];

let failed = false;
console.log("Cost against the recorded baseline\n");
for (const [label, now, was] of rows) {
  // A bucket the baseline predates has no number to compare against, and
  // treating a missing baseline as zero would read as infinite growth or as a
  // pass depending on the arithmetic. It is neither; it needs recording.
  if (typeof was !== "number") {
    failed = true;
    console.log(`  NEW  ${label.padEnd(28)} ${String(now).padStart(5)} lines  (no baseline recorded)`);
    continue;
  }
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
