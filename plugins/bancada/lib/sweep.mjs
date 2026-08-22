/**
 * `bancada check` — sweep the whole project against the declared layering.
 *
 * The gate refuses a violation as it is written, which is the right moment for
 * code being written now. It says nothing about code that was already there
 * when bancada was installed, and a project adopting a layering rule needs that
 * number before it can decide whether the rule is aspirational or true.
 *
 * This is also where a slow external checker belongs. Running
 * `dependency-cruiser` on every keystroke-level edit would add seconds to each
 * one; running it here, on demand and at commit time, costs it once.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig as realLoadConfig } from "./config.mjs";
import { listProjectFiles as realListFiles } from "./files.mjs";
import { checkLayering } from "./structure.mjs";

const SOURCE_LIKE = /\.(m|c)?(j|t)sx?$|\.py$|\.go$/;

/**
 * Check every source file against the layering.
 *
 * Returns `{ lines, exitCode, summary }`. Exit is non-zero when a violation
 * exists, because this one is meant to be runnable in CI where a layering rule
 * that nothing enforces is just a comment.
 */
export function runSweep({
  projectDir = ".",
  loadConfig = realLoadConfig,
  listFiles = realListFiles,
  readFile = readFileSync,
} = {}) {
  const { config } = loadConfig(projectDir);
  const layers = config.gates.structure.layers ?? [];

  if (!config.gates.structure.enabled || layers.length === 0) {
    return {
      lines: [
        "bancada check",
        "",
        "No layering is configured, so there is nothing to check.",
        "",
        "Declare layers under gates.structure in bancada.config.json, or run",
        "/bancada:structure to work them out from the code that exists.",
      ],
      exitCode: 0,
      summary: { configured: false },
    };
  }

  const { files, source: fileSource } = listFiles(projectDir);
  const results = [];
  let checked = 0;
  let unknown = 0;

  for (const rel of files) {
    if (!SOURCE_LIKE.test(rel)) continue;
    let text;
    try {
      text = readFile(join(projectDir, rel), "utf8");
    } catch {
      continue; // a file that vanished between listing and reading is not a finding
    }
    const r = checkLayering(rel, text, layers);
    if (r.rule === "structure-outside" || r.rule === "structure-unconfigured") continue;
    checked++;
    unknown += r.unknown;
    if (r.decision === "deny") results.push({ file: rel, ...r });
  }

  const lines = ["bancada check", ""];
  lines.push(
    `${checked} file(s) in a declared layer, from ${fileSource === "git" ? "git ls-files" : "a directory walk"}.`,
  );
  lines.push(`${unknown} import(s) could not be attributed to a layer and were not judged.`);
  lines.push("");

  if (results.length === 0) {
    lines.push("No layering violation.");
    return { lines, exitCode: 0, summary: { configured: true, checked, unknown, violations: 0 } };
  }

  const total = results.reduce((n, r) => n + r.violations.length, 0);
  lines.push(`${total} violation(s) in ${results.length} file(s)`);
  lines.push("");
  for (const r of results) {
    lines.push(`  ${r.file}`);
    for (const v of r.violations) lines.push(`      ${v.spec}   "${v.from}" → "${v.to}"`);
  }
  lines.push("");
  lines.push("A rule nothing enforces is a comment. Either fix these, or change the");
  lines.push("layering on purpose and record why.");

  return {
    lines,
    exitCode: 1,
    summary: {
      configured: true,
      checked,
      unknown,
      violations: total,
      files: results.map((r) => ({ file: r.file, violations: r.violations })),
    },
  };
}
