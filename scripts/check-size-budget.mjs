/**
 * Fails when the bancada core grows past its declared size budget.
 *
 * A harness that costs more than it delivers is the failure mode this project
 * was built to avoid, and it arrives by accretion, never by decision. The
 * budget makes growth a choice someone has to make out loud: raise the number
 * in this file, in a commit, with a reason.
 *
 * Tests are excluded. Test volume is a good thing to grow.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BUDGETS = [
  { name: "bancada core", dir: "plugins/bancada", max: 1500 },
  { name: "bancada-context", dir: "plugins/bancada-context", max: 400 },
  { name: "bancada-flow", dir: "plugins/bancada-flow", max: 900 },
];

const COUNTED = /\.(mjs|js)$/;
const EXCLUDED = /\.test\.mjs$/;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a plugin that has no code yet is not a failure
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (COUNTED.test(name) && !EXCLUDED.test(name)) out.push(full);
  }
  return out;
}

let failed = false;
for (const budget of BUDGETS) {
  const files = walk(budget.dir);
  let total = 0;
  const perFile = [];
  for (const file of files) {
    const n = readFileSync(file, "utf8").split(/\r?\n/).length;
    total += n;
    perFile.push({ file: relative(process.cwd(), file).split(sep).join("/"), n });
  }
  const pct = budget.max === 0 ? 0 : Math.round((total / budget.max) * 100);
  const verdict = total > budget.max ? "OVER" : "ok";
  console.log(`${verdict.padEnd(4)} ${budget.name}: ${total}/${budget.max} lines (${pct}%)`);
  if (total > budget.max) {
    failed = true;
    perFile.sort((a, b) => b.n - a.n);
    for (const f of perFile.slice(0, 5)) console.log(`       ${String(f.n).padStart(5)}  ${f.file}`);
  }
}

if (failed) {
  console.error("\nOver budget. Either cut, or raise the number in scripts/check-size-budget.mjs with a reason.");
  process.exit(1);
}
process.exit(0);
