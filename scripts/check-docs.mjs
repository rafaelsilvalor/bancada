/**
 * Check what the repository says about itself against what the code does.
 *
 * Two claims live outside the code and can drift from it silently: the example
 * configs people copy, and the version the CLI prints.
 *
 * An example config is documentation that people copy without reading, so it
 * fails in the worst way available: a knob renamed in the SPEC turns every
 * example that sets it into an unknown key, the setting is silently ignored,
 * and the gate the reader thinks they switched on is not running. That is the
 * failure this whole project exists to catch, so it does not get to live in this
 * project's own examples.
 *
 * What this can check is the mechanical half — the config parses, every key is
 * one bancada knows, no type is wrong, and no gate is switched on with nothing
 * to guard. What it cannot check is whether a glob still matches anything in a
 * repository it has never seen. Only `bancada doctor`, run where someone works,
 * answers that, which is why every example records the counts it was measured
 * against and says which repository produced them.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../plugins/bancada/lib/config.mjs";

const DIR = "examples";
const INDEX = join(DIR, "README.md");

const problems = [];
const note = (where, what) => problems.push(`${where}: ${what}`);

let index = "";
try {
  index = readFileSync(INDEX, "utf8");
} catch {
  note(INDEX, "missing, so the examples have no index");
}

const examples = readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

if (examples.length === 0) note(DIR, "no example configs, but the README layout promises them");

for (const name of examples) {
  const configFile = join(DIR, name, "bancada.config.json");
  const readme = join(DIR, name, "README.md");

  let raw;
  try {
    raw = readFileSync(configFile, "utf8");
  } catch {
    note(configFile, "missing");
    continue;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    note(configFile, `not valid JSON (${e.message})`);
    continue;
  }

  const { errors, warnings } = validate(parsed);
  for (const e of errors) note(configFile, e);
  // A warning here is not advice, it is a defect in a file people copy: an
  // unknown key means the example sets something bancada no longer reads.
  for (const w of warnings) note(configFile, w);

  try {
    readFileSync(readme, "utf8");
  } catch {
    note(readme, "missing, so this example is a config to copy blind");
  }

  if (index !== "" && !index.includes(`${name}/`)) {
    note(INDEX, `does not list the ${name} example, so nobody will find it`);
  }
}

// --- the version the CLI prints is the version the manifest ships ---
//
// `bancada version` is what someone quotes in a bug report, and it is a string
// in a different file from the manifest that decides which release they
// actually have. A release that bumps one and not the other is a report nobody
// can act on.

const MANIFEST = "plugins/bancada/.claude-plugin/plugin.json";
const CLI = "plugins/bancada/bin/bancada.mjs";

try {
  const shipped = JSON.parse(readFileSync(MANIFEST, "utf8")).version;
  const printed = readFileSync(CLI, "utf8").match(/^const VERSION = "([^"]+)";$/m)?.[1];
  if (printed === undefined) {
    note(CLI, "no VERSION constant found, so nothing can be compared against the manifest");
  } else if (printed !== shipped) {
    note(CLI, `prints version ${printed}, but ${MANIFEST} ships ${shipped}`);
  }
} catch (e) {
  note(MANIFEST, `could not be read (${e.message})`);
}

if (problems.length === 0) {
  console.log(`ok — ${examples.length} example config(s) valid against the SPEC, CLI version matches the manifest`);
  process.exit(0);
}

console.error(`Found ${problems.length} problem(s).`);
console.error("An example that no longer validates is a config someone will copy anyway.\n");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
