/**
 * `bancada doctor` — what is configured, what is on, and what guards nothing.
 *
 * The question it exists to answer is not "is my JSON valid". It is the one a
 * previous harness got wrong for months: *is any of this actually running over
 * my code?* A glob that matches no file is not a warning about style; it is a
 * gate that has silently stopped existing. So the report leads with coverage,
 * counted, and names the settings that came back empty.
 *
 * Pure enough to test: every dependency is injected.
 */

import { compileGlobs, normalisePath } from "./glob.mjs";
import { colocationReport } from "./colocated.mjs";
import { globSettings, loadConfig as realLoadConfig } from "./config.mjs";
import { listProjectFiles as realListFiles, uncoveredDirs } from "./files.mjs";
import { FOREIGN_CHECKS } from "./checks/index.mjs";
import { t } from "./messages.mjs";
import { reportSkills as realReportSkills } from "./skills-report.mjs";

/**
 * The gates in report order, with the path to their `enabled` flag.
 *
 * The tail is the gates configured here and enforced by a different plugin. The
 * label names which, so a project that switched one on without installing that
 * plugin can see why nothing is happening — and the list comes from the same
 * declaration `bancada yield` reads, so the two reports cannot end up disagreeing
 * about which gates they can see.
 */
const GATES = [
  ["commit", (c) => c.gates.commit.enabled],
  ["secrets", (c) => c.gates.secrets.enabled],
  ["size", (c) => c.gates.size.enabled],
  ["green", (c) => c.gates.green.enabled],
  ["structure", (c) => c.gates.structure.enabled],
  ["colocated", (c) => c.gates.colocated.enabled],
  ["pair", (c) => c.pair.enabled],
  ...FOREIGN_CHECKS.map((c) => [`${c.name} (${c.plugin})`, c.enabled]),
];

/**
 * Build the report.
 *
 * Returns `{ lines, exitCode, summary }`. Exit is non-zero only for a config
 * error — an empty glob is reported loudly but is not a failed command, because
 * a project mid-setup should be able to run `doctor` and read the advice.
 */
export function runDoctor({
  projectDir = ".",
  env = process.env,
  loadConfig = realLoadConfig,
  listFiles = realListFiles,
  reportSkills = realReportSkills,
  sections = [],
} = {}) {
  const { config, source, file, errors, warnings } = loadConfig(projectDir);
  const lang = config.language;
  const say = (key, params) => t(lang, key, params);

  const lines = [say("doctor.title"), ""];

  lines.push(source === "file" ? say("doctor.config.file", { file }) : say("doctor.config.defaults", { file }));
  lines.push(say("doctor.session", { effort: env.CLAUDE_EFFORT ?? null }));
  lines.push("");

  if (errors.length > 0) {
    lines.push(say("doctor.errors"));
    for (const e of errors) lines.push(`  ${e}`);
    lines.push("");
  }
  if (warnings.length > 0) {
    lines.push(say("doctor.warnings"));
    for (const w of warnings) lines.push(`  ${w}`);
    lines.push("");
  }

  // --- gates ---
  lines.push(say("doctor.gates"));
  let anyOn = false;
  for (const [name, isOn] of GATES) {
    const on = Boolean(isOn(config));
    if (on) anyOn = true;
    lines.push(`  ${on ? say("doctor.gate.on", { name }) : say("doctor.gate.off", { name })}`);
  }
  if (!anyOn) lines.push(`  ${say("doctor.nogates")}`);
  lines.push("");

  // --- which routes the write gates actually reach ---
  //
  // `on structure` was the whole of what this report said, and it was measured
  // meaning less than it looks: before the shell route was read, 5 of 6 paired
  // payloads were refused through a write tool and allowed through
  // `cat > file <<'EOF'`. The gates read both routes now, and one gap is left —
  // text a command line does not carry. A report that leaves that implied is the
  // failure this command exists to prevent, so it is a section rather than a
  // footnote, and it is printed only when a gate it describes is on.
  const writeGates = config.gates.size.enabled || config.gates.structure.enabled || config.pair.enabled;
  if (writeGates) {
    lines.push(say("doctor.routes"));
    lines.push(`  ${say("doctor.routes.judged")}`);
    if (config.gates.size.enabled || config.gates.structure.enabled) {
      lines.push(`  ${say("doctor.routes.unseen")}`);
      lines.push(`  ${say("doctor.routes.counted")}`);
    }
    if (config.pair.enabled) lines.push(`  ${say("doctor.routes.pair")}`);
    lines.push("");
  }

  // --- coverage ---
  const { files, source: fileSource, truncated } = listFiles(projectDir);
  const normalised = files.map(normalisePath);

  lines.push(say("doctor.globs"));
  lines.push(`  ${say("doctor.files.source", { source: fileSource, count: normalised.length })}`);
  if (truncated) lines.push(`  ${say("doctor.files.truncated")}`);

  // Only an `include` that matches nothing is a finding, and only when nothing
  // else in the setting is guarding. An `exclude` with no matches is the healthy
  // case, and flagging it would teach people to skim the one report that has to
  // be worth reading.
  //
  // A structure layer is the case where "matches no file" and "guards nothing"
  // come apart. `targetLayer` attributes a bare specifier through a layer's
  // `aliases`, so "only adapters may require('photoshop')" is written as a layer
  // whose `match` is deliberately unmatchable — the import target is not a file
  // in the repository. That layer guards; calling it dead was a false alarm.
  //
  // It gets its own line rather than being folded into the covered count: a
  // `0 file(s)` row reads as a glob somebody should go fix, which is the same
  // false alarm in quieter type. A layer with no aliases and no matches really
  // does guard nothing and still warns, so the commitment keeps its teeth.
  const emptySettings = [];
  for (const { setting, globs, kind, aliases = 0 } of globSettings(config)) {
    const match = compileGlobs(globs);
    const count = normalised.filter(match).length;
    if (count === 0 && aliases > 0) {
      lines.push(`  ${say("doctor.glob.aliases", { setting, aliases })}`);
    } else if (count === 0 && kind === "include") {
      emptySettings.push(setting);
      lines.push(`  ${say("doctor.glob.empty", { setting })}`);
    } else {
      lines.push(`  ${say("doctor.glob.matches", { setting, count })}`);
    }
  }
  lines.push("");

  // --- blind spots: directories no source glob reaches ---
  const blindSpots = [];
  if (config.source.include.length > 0) {
    const covered = compileGlobs(config.source.include);
    blindSpots.push(...uncoveredDirs(normalised, covered).slice(0, 10));
    if (blindSpots.length > 0) {
      lines.push(say("doctor.blindspots"));
      for (const b of blindSpots) lines.push(`  ${say("doctor.blindspot", b)}`);
      lines.push("");
    }
  }

  // --- test colocation: the gap a missing test leaves ---
  //
  // Printed whenever the project has said what its source is, gate on or off,
  // because the section is a coverage fact and not a verdict — the same footing
  // as the blind spots above. This is the count that motivated the gate: in one
  // consumer repository, 13 of 30 documented traps were guarded by no test at
  // all, and every other report here said nothing about it. The list is capped;
  // the count never is, and `--json` carries every path.
  let colocated = null;
  if (config.source.include.length > 0) {
    const MAX_LISTED = 20;
    const report = colocationReport({
      files: normalised,
      source: config.source,
      settings: config.gates.colocated,
      testGlobs: config.pair.testGlobs,
    });
    lines.push(say("doctor.colocated.title"));
    lines.push(
      `  ${say("doctor.colocated.coverage", { tested: report.tested, total: report.total, excepted: report.excepted, missing: report.missing.length })}`,
    );
    if (!config.gates.colocated.enabled) lines.push(`  ${say("doctor.colocated.off")}`);
    for (const m of report.missing.slice(0, MAX_LISTED)) {
      lines.push(`  ${say("doctor.colocated.missing", { file: m.file, candidate: m.candidates.join(" or ") })}`);
    }
    if (report.missing.length > MAX_LISTED) {
      lines.push(`  ${say("doctor.colocated.more", { n: report.missing.length - MAX_LISTED })}`);
    }
    for (const t of report.suites.dead) lines.push(`  ${say("doctor.colocated.deadSuite", { test: t })}`);
    for (const p of report.exceptions.stale) lines.push(`  ${say("doctor.colocated.stale", { path: p })}`);
    for (const p of report.exceptions.unneeded) lines.push(`  ${say("doctor.colocated.unneeded", { path: p })}`);
    lines.push("");
    colocated = {
      total: report.total,
      tested: report.tested,
      excepted: report.excepted,
      missing: report.missing.map((m) => m.file),
      deadSuites: report.suites.dead,
      staleExceptions: report.exceptions.stale,
      unneededExceptions: report.exceptions.unneeded,
    };
  }

  // The skill-listing budget is its own question and is not everyone's problem,
  // so it is opt-in rather than always printed.
  let skills = null;
  if (sections.includes("skills")) {
    skills = reportSkills({ projectDir, lang });
    lines.push(...skills.lines, "");
  }

  // A missing test is a coverage fact the section above already states; a dead
  // suite or a lingering exception is configuration that stopped meaning what
  // it says, which is a problem in the same class as an empty glob.
  const colocatedFindings =
    (colocated?.deadSuites.length ?? 0) + (colocated?.staleExceptions.length ?? 0) + (colocated?.unneededExceptions.length ?? 0);
  if (errors.length === 0 && warnings.length === 0 && emptySettings.length === 0 && colocatedFindings === 0) {
    lines.push(say("doctor.ok"));
  }

  return {
    lines,
    exitCode: errors.length > 0 ? 1 : 0,
    summary: {
      configSource: source,
      language: lang,
      gatesOn: GATES.filter(([, isOn]) => Boolean(isOn(config))).map(([name]) => name),
      errors: errors.length,
      warnings: warnings.length,
      emptySettings,
      blindSpots: blindSpots.map((b) => b.dir),
      colocated,
      fileCount: normalised.length,
      fileSource,
      skills: skills?.summary ?? null,
    },
  };
}
