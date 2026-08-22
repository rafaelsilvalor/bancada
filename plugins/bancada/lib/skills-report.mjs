/**
 * `bancada doctor --skills` — what the skill listing costs, and what is at risk.
 *
 * Separated from the measurement so the arithmetic can be tested against
 * literal skills rather than a directory on disk.
 */

import { join } from "node:path";
import { findSkills as realFindSkills, measureListing } from "./skills.mjs";
import { t } from "./messages.mjs";

/** Where a project's own skills live, relative to its root. */
export const PROJECT_SKILL_DIRS = [".claude/skills"];

export function reportSkills({
  projectDir = ".",
  lang = "en",
  model = process.env.BANCADA_MODEL || "opus",
  findSkills = realFindSkills,
  extraDirs = [],
} = {}) {
  const say = (key, params) => t(lang, key, params);

  const skills = [];
  for (const dir of [...PROJECT_SKILL_DIRS.map((d) => join(projectDir, d)), ...extraDirs]) {
    skills.push(...findSkills(dir));
  }

  const lines = [say("skills.title")];
  if (skills.length === 0) {
    lines.push(`  ${say("skills.none")}`);
    return { lines, summary: { count: 0 } };
  }

  const m = measureListing(skills, { model });

  lines.push(`  ${say("skills.usage", { used: m.used, budget: m.budgetChars, pct: m.pct, model: m.model })}`);
  lines.push(`  ${say("skills.assumption")}`);
  if (m.over) lines.push(`  ${say("skills.over")}`);
  lines.push("");

  for (const e of m.entries) {
    const note = e.hidden ? "  (model-invisible)" : e.truncated ? "  (truncated)" : !e.described ? "  (no description)" : "";
    lines.push(`  ${say("skills.entry", { name: e.name, chars: e.chars, note })}`);
  }
  lines.push("");

  if (m.hidden > 0) lines.push(`  ${say("skills.hidden", { n: m.hidden })}`);
  if (m.truncated.length > 0) lines.push(`  ${say("skills.truncated", { names: m.truncated.join(", ") })}`);
  if (m.undescribed.length > 0) lines.push(`  ${say("skills.undescribed", { names: m.undescribed.join(", ") })}`);
  if (m.over || m.truncated.length > 0) lines.push(`  ${say("skills.lever")}`);

  return { lines, summary: { count: skills.length, ...m, entries: undefined } };
}
