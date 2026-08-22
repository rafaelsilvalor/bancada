/**
 * Fails when bancada's own prose cites a rule by identifier.
 *
 * A rule identifier means what the document that defined it says it means. A
 * citation like "R14" carried into another repository is a false citation
 * however true it was at the origin. bancada is installed into repositories it
 * knows nothing about, so it cites concepts by name and never by number.
 *
 * This is a hygiene check on the product's own text, not a gate for consumers.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", ".bancada", "dist"]);

// Shapes seen in the wild: R14, A3, E7, C11, D5, O9, G-R11, M-R13, G-CAT-4.
// Anchored on a word boundary so version strings and hashes do not match.
const RULE_ID = /(?<![\w-])(?:[A-Z]{1,3}-)?(?:R|A|E|C|D|O|CAT-)\d{1,3}(?![\w-])/g;

// Text that legitimately looks like an identifier.
const ALLOWED = [
  /\bE\d+\b(?=\s*(?:tokens|ms))/, // scientific-ish notation in measurements
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

const findings = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return; // code blocks may legitimately show a consumer's IDs
    for (const match of line.matchAll(RULE_ID)) {
      if (ALLOWED.some((re) => re.test(match[0]))) continue;
      findings.push({ file: rel, line: i + 1, id: match[0], text: line.trim() });
    }
  });
}

if (findings.length === 0) {
  console.log("ok — no inherited rule identifiers in prose");
  process.exit(0);
}

console.error(`Found ${findings.length} rule-identifier citation(s) in prose.`);
console.error("Cite the concept by name instead; a number means nothing to a consumer.\n");
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  "${f.id}"  ${f.text.slice(0, 90)}`);
}
process.exit(1);
