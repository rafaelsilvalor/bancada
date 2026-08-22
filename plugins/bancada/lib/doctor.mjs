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
import { globSettings, loadConfig as realLoadConfig } from "./config.mjs";
import { listProjectFiles as realListFiles, uncoveredDirs } from "./files.mjs";
import { t } from "./messages.mjs";
import { reportSkills as realReportSkills } from "./skills-report.mjs";

/** The gates in report order, with the path to their `enabled` flag. */
const GATES = [
  ["commit", (c) => c.gates.commit.enabled],
  ["secrets", (c) => c.gates.secrets.enabled],
  ["size", (c) => c.gates.size.enabled],
  ["green", (c) => c.gates.green.enabled],
  ["structure", (c) => c.gates.structure.enabled],
  ["pair", (c) => c.pair.enabled],
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

  // --- coverage ---
  const { files, source: fileSource, truncated } = listFiles(projectDir);
  const normalised = files.map(normalisePath);

  lines.push(say("doctor.globs"));
  lines.push(`  ${say("doctor.files.source", { source: fileSource, count: normalised.length })}`);
  if (truncated) lines.push(`  ${say("doctor.files.truncated")}`);

  // Only an `include` that matches nothing is a finding. An `exclude` with no
  // matches is the healthy case, and flagging it would teach people to skim
  // the one report that has to be worth reading.
  const emptySettings = [];
  for (const { setting, globs, kind } of globSettings(config)) {
    const match = compileGlobs(globs);
    const count = normalised.filter(match).length;
    if (count === 0 && kind === "include") {
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

  // The skill-listing budget is its own question and is not everyone's problem,
  // so it is opt-in rather than always printed.
  let skills = null;
  if (sections.includes("skills")) {
    skills = reportSkills({ projectDir, lang });
    lines.push(...skills.lines, "");
  }

  if (errors.length === 0 && warnings.length === 0 && emptySettings.length === 0) {
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
      fileCount: normalised.length,
      fileSource,
      skills: skills?.summary ?? null,
    },
  };
}
