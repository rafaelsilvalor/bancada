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

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig as realLoadConfig } from "./config.mjs";
import { listProjectFiles as realListFiles } from "./files.mjs";
import { checkLayering } from "./structure.mjs";

const SOURCE_LIKE = /\.(m|c)?(j|t)sx?$|\.py$|\.go$/;

/** How long an external analyser may take before the sweep gives up on it. */
const ADAPTER_TIMEOUT_MS = 120000;

/**
 * Run the project's own architecture checker and translate its verdict.
 *
 * bancada does not reimplement dependency-cruiser, import-linter or depguard.
 * A project that already runs one has already encoded its rules there, and
 * asking it to write them twice is asking for the two copies to disagree.
 *
 * This is in the sweep rather than in the write gate on purpose: a whole-project
 * analyser takes seconds, and seconds on every edit is a tax nobody would keep
 * paying.
 *
 * A command that cannot be run at all is reported and does not fail the sweep.
 * A missing binary is a setup problem, not a layering violation, and conflating
 * them would make the exit code mean two different things.
 */
export function runAdapter(command, projectDir, { spawn = spawnSync } = {}) {
  if (typeof command !== "string" || command.trim() === "") return null;

  let result;
  try {
    result = spawn(command, {
      cwd: projectDir,
      shell: true,
      encoding: "utf8",
      timeout: ADAPTER_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    return { ran: false, reason: String(e?.message ?? e) };
  }

  if (result.error) return { ran: false, reason: String(result.error.message ?? result.error) };
  if (result.signal) return { ran: false, reason: `killed by ${result.signal} after ${ADAPTER_TIMEOUT_MS} ms` };

  // The command runs through a shell, so a missing binary does not surface as
  // `result.error` — the shell itself starts fine and exits with a
  // command-not-found code. Without this, an uninstalled checker would be
  // reported as a layering violation, which is exactly the conflation the
  // "could not run" branch exists to prevent.
  const NOT_FOUND = new Set([126, 127, 9009]);
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (NOT_FOUND.has(result.status) || /not found|not recognized|No such file or directory/i.test(stderr)) {
    return {
      ran: false,
      reason: `the command could not be found (exit ${result.status})${stderr.trim() ? `: ${stderr.trim().split(/\r?\n/)[0]}` : ""}`,
    };
  }

  const output = [result.stdout, result.stderr]
    .filter((s) => typeof s === "string" && s.trim() !== "")
    .join("\n");
  return { ran: true, ok: result.status === 0, status: result.status, output: output.trim() };
}

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
    const r = checkLayering(rel, text, layers, projectDir);
    if (r.rule === "structure-outside" || r.rule === "structure-unconfigured") continue;
    checked++;
    unknown += r.unknown;
    if (r.decision === "deny") results.push({ file: rel, ...r });
  }

  const adapter = runAdapter(config.gates.structure.adapterCommand, projectDir);

  const lines = ["bancada check", ""];
  lines.push(
    `${checked} file(s) in a declared layer, from ${fileSource === "git" ? "git ls-files" : "a directory walk"}.`,
  );
  lines.push(`${unknown} import(s) could not be attributed to a layer and were not judged.`);
  lines.push("");

  const adapterLines = [];
  let adapterFailed = false;
  if (adapter && !adapter.ran) {
    adapterLines.push(`The configured adapter could not be run: ${adapter.reason}`);
    adapterLines.push("A checker that will not start is a setup problem, not a violation,");
    adapterLines.push("so it is reported here and does not decide the exit code.");
  } else if (adapter && !adapter.ok) {
    adapterFailed = true;
    adapterLines.push(`The project's own checker reported a problem (exit ${adapter.status}):`);
    adapterLines.push("");
    for (const l of adapter.output.split(/\r?\n/).slice(0, 40)) adapterLines.push(`  ${l}`);
  } else if (adapter) {
    adapterLines.push("The project's own checker reported no problem.");
  }

  if (results.length === 0 && !adapterFailed) {
    if (adapterLines.length > 0) lines.push(...adapterLines, "");
    lines.push("No layering violation.");
    return {
      lines,
      exitCode: 0,
      summary: { configured: true, checked, unknown, violations: 0, adapter: adapter ?? null },
    };
  }

  const total = results.reduce((n, r) => n + r.violations.length, 0);
  if (total > 0) {
    lines.push(`${total} violation(s) in ${results.length} file(s)`);
    lines.push("");
    for (const r of results) {
      lines.push(`  ${r.file}`);
      for (const v of r.violations) lines.push(`      ${v.spec}   "${v.from}" → "${v.to}"`);
    }
    lines.push("");
  }
  if (adapterLines.length > 0) lines.push(...adapterLines, "");
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
      adapter: adapter ?? null,
      files: results.map((r) => ({ file: r.file, violations: r.violations })),
    },
  };
}
