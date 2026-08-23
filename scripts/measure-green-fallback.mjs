/**
 * What the green boundary's fallback costs when there is no git to ask.
 *
 * Outside a git repository the boundary cannot read `git status`, so it walks the
 * tree and hashes it to answer the one question a re-check needs: is this the
 * same tree as last time? That is slower than reading one subprocess's output,
 * and the number belongs somewhere reproducible rather than in a comment
 * somebody wrote once. `lib/green.mjs` quotes this table; this is what produced
 * it.
 *
 * Synthetic trees of 2 KB files, fifty to a directory, which is roughly what a
 * source tree looks like to a walk. Real trees vary; the shape of the curve is
 * the point, and the ceiling row is the worst case bancada allows itself.
 *
 *   node scripts/measure-green-fallback.mjs [--runs 7]
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint } from "../plugins/bancada/lib/green-state.mjs";
import { MAX_WALK_FILES, walkFiles } from "../plugins/bancada/lib/walk.mjs";

const argv = process.argv.slice(2);
const RUNS = Number(argv.includes("--runs") ? argv[argv.indexOf("--runs") + 1] : 7);
const SIZES = [200, 1000, 5000, MAX_WALK_FILES];

const root = join(tmpdir(), "bancada-green-fallback");

function build(dir, n) {
  for (let i = 0; i < n; i++) {
    const sub = join(dir, `d${Math.floor(i / 50)}`);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `f${i}.ts`), "x".repeat(2000) + i);
  }
}

function medianMs(fn) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

rmSync(root, { recursive: true, force: true });
try {
  console.log(`Green boundary fallback, median of ${RUNS}\n`);
  console.log("files    walk ms   fingerprint ms   total ms");
  for (const n of SIZES) {
    const dir = join(root, String(n));
    build(dir, n);
    let files = [];
    const walk = medianMs(() => {
      files = walkFiles(dir).files;
    });
    const hash = medianMs(() => fingerprint(dir, files));
    console.log(
      String(n).padStart(5) +
        String(Math.round(walk)).padStart(11) +
        String(Math.round(hash)).padStart(17) +
        String(Math.round(walk + hash)).padStart(11),
    );
  }
  console.log(`\n${MAX_WALK_FILES} is the walk's ceiling, so the last row is the worst case, not a limit found by trying.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
