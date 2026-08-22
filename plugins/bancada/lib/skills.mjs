/**
 * Metering the skill listing, which has a ceiling nobody sees until it bites.
 *
 * Claude Code loads a listing of skill names and descriptions into every
 * session so the model knows what is available. That listing has a budget of
 * about 1% of the model's context window. When it overflows, descriptions are
 * dropped starting with the skills you invoke least — the skill still exists
 * and still runs when you type its name, but the model stops knowing when to
 * reach for it on its own.
 *
 * The failure mode is perverse: the first description to be dropped belongs to
 * the newest, least-used skill, which is exactly the one that most needs the
 * model to discover it. Nothing announces this. A project can add skills for
 * months and watch the earlier ones quietly stop triggering.
 *
 * Two numbers therefore matter, and both are measured here rather than assumed:
 * what each entry costs, and what the whole listing costs against the budget.
 *
 * A skill with `disable-model-invocation` costs nothing at all — it is invisible
 * to the model until invoked by name — which makes it the strongest lever a
 * project has, and the meter says so.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Per-entry cap: description and when_to_use together are truncated here. */
export const ENTRY_CAP = 1536;

/** Share of the model's context window the listing may occupy. */
export const DEFAULT_BUDGET_FRACTION = 0.01;

/**
 * Context window sizes, for turning the fraction into a character count.
 *
 * The budget scales with the model, so a listing calibrated on a 1M-token model
 * can overflow on a 200K one. That is worth saying out loud rather than
 * hard-coding one number and letting it be wrong half the time.
 */
export const CONTEXT_WINDOWS = {
  opus: 1_000_000,
  sonnet: 1_000_000,
  fable: 1_000_000,
  haiku: 200_000,
};

/** Rough characters per token. Used only to turn a token budget into characters. */
const CHARS_PER_TOKEN = 4;

/**
 * Parse the leading YAML frontmatter of a skill file.
 *
 * Deliberately small: only top-level scalars and the handful of keys the meter
 * needs. A full YAML parser would be a dependency, and this reads files it did
 * not write, so it must never throw on something it does not understand.
 */
export function parseFrontmatter(text) {
  const source = String(text ?? "");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === "") continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "true" || value === "yes" || value === "on" || value === "1") out[kv[1]] = true;
    else if (value === "false" || value === "no" || value === "off" || value === "0") out[kv[1]] = false;
    else out[kv[1]] = value;
  }
  return out;
}

/** What one skill contributes to the listing. */
export function entryCost(front, fallbackName) {
  const name = front.name ?? fallbackName;
  const hidden = front["disable-model-invocation"] === true;
  const text = [front.description ?? "", front.when_to_use ?? ""].filter(Boolean).join(" ");
  const raw = text.length;
  return {
    name,
    hidden,
    // A hidden skill is not in the listing at all, so it costs nothing there.
    chars: hidden ? 0 : Math.min(raw, ENTRY_CAP) + String(name).length,
    rawChars: raw,
    truncated: !hidden && raw > ENTRY_CAP,
    described: Boolean(front.description),
  };
}

/** Find `<dir>/<name>/SKILL.md` under a skills directory. */
export function findSkills(dir, { read = readFileSync, list = readdirSync, stat = statSync } = {}) {
  let entries;
  try {
    entries = list(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of entries) {
    const file = join(dir, name, "SKILL.md");
    try {
      if (!stat(join(dir, name)).isDirectory()) continue;
      found.push({ name, file, front: parseFrontmatter(read(file, "utf8")) });
    } catch {
      // Not a skill directory, or unreadable. Neither is a finding here.
    }
  }
  return found;
}

/**
 * Measure a set of skills against the budget.
 *
 * `model` selects the context window; an unknown one falls back to the smallest
 * known window, because guessing large would under-report the risk and this
 * report exists to warn.
 */
export function measureListing(skills, { model = "opus", fraction = DEFAULT_BUDGET_FRACTION } = {}) {
  const window = CONTEXT_WINDOWS[model] ?? Math.min(...Object.values(CONTEXT_WINDOWS));
  const budgetChars = Math.round(window * fraction * CHARS_PER_TOKEN);

  const entries = skills
    .map((s) => entryCost(s.front, s.name))
    .sort((a, b) => b.chars - a.chars);

  const used = entries.reduce((n, e) => n + e.chars, 0);

  return {
    model,
    window,
    budgetChars,
    used,
    pct: budgetChars === 0 ? 0 : Math.round((used / budgetChars) * 100),
    over: used > budgetChars,
    entries,
    hidden: entries.filter((e) => e.hidden).length,
    truncated: entries.filter((e) => e.truncated).map((e) => e.name),
    undescribed: entries.filter((e) => !e.described && !e.hidden).map((e) => e.name),
  };
}
