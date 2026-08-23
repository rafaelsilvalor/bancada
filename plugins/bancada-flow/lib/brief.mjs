/**
 * The brief: the one artifact all three Pauses read.
 *
 * A Pause that asks "has this been reviewed?" cannot be enforced, because the
 * answer lives in somebody's head. A Pause that asks "does this file exist, and
 * does it say these four things?" can. The brief is what turns the process in
 * this plugin from an instruction into a gate, and the format is deliberately
 * small enough that writing one is cheaper than arguing about it.
 *
 * Four sections, each of which exists to stop a specific failure.
 *
 * **Problem** — the agent that starts from a solution builds the solution. This
 * section is the only place the work is described without one, and a brief whose
 * problem section restates the title is a brief nobody thought about.
 *
 * **Done when** — checkable criteria, as checkboxes, because Pause 3 reads the
 * ticks. "Done" that is not written down before the work is whatever the work
 * turned out to be.
 *
 * **Not doing** — the scope that was considered and declined. Without it, scope
 * creep is indistinguishable from thoroughness, and both look like progress.
 *
 * **How it will be checked** — the command or observation that produces the
 * evidence. Written before the work, so the standard is not chosen afterwards by
 * whoever needs it to pass.
 *
 * A ticked criterion must carry its evidence on an indented line beneath it.
 * That rule is mechanical on purpose: this project's whole claim is that the
 * evidence precedes the assertion, and a tick with nothing under it is the
 * assertion on its own.
 */

/** The sections a brief must have, in the order the template writes them. */
export const REQUIRED_SECTIONS = ["Problem", "Done when", "Not doing", "How it will be checked"];

const HEADING = /^##\s+(.+?)\s*$/;
const TITLE = /^#\s+(.+?)\s*$/;
const CRITERION = /^\s*-\s+\[( |x|X)\]\s*(.*)$/;

/**
 * Split a brief into its title and sections.
 *
 * Headings are matched on their text, case-insensitively, so a brief written
 * with different capitalisation is not rejected over it. Anything the format
 * does not know about is kept: a project that adds a "Background" section should
 * not have it deleted by a validator that did not ask for it.
 */
export function parseBrief(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const sections = new Map();
  let title = null;
  let current = null;

  for (const [i, line] of lines.entries()) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = { name: heading[1], key: heading[1].toLowerCase(), line: i + 1, body: [] };
      sections.set(current.key, current);
      continue;
    }
    if (title === null) {
      const t = TITLE.exec(line);
      if (t) {
        title = t[1];
        continue;
      }
    }
    if (current) current.body.push({ text: line, line: i + 1 });
  }

  return { title, sections };
}

/** The checkbox criteria in a section, with whether each is ticked and what backs it. */
export function criteriaOf(section) {
  if (!section) return [];
  const out = [];
  for (const [i, entry] of section.body.entries()) {
    const m = CRITERION.exec(entry.text);
    if (!m) continue;
    // Evidence is whatever is indented beneath the criterion, up to the next
    // criterion or the next blank-line-plus-unindented run. Indentation is the
    // whole rule, so that what counts as evidence is not a matter of taste.
    const evidence = [];
    for (const later of section.body.slice(i + 1)) {
      if (CRITERION.test(later.text)) break;
      if (later.text.trim() === "") continue;
      if (!/^\s+\S/.test(later.text)) break;
      evidence.push(later.text.trim());
    }
    out.push({
      ticked: m[1].toLowerCase() === "x",
      text: m[2].trim(),
      line: entry.line,
      evidence,
    });
  }
  return out;
}

const isEmpty = (section) => !section || section.body.every((b) => b.text.trim() === "");

/**
 * Check a brief against the format.
 *
 * Returns `{ errors, warnings, criteria, title }`. The split follows the config
 * validator's: an error is something the format cannot work without, a warning
 * is something that is probably a mistake but might not be. A Pause refuses on
 * errors and reports warnings without refusing, because a gate that blocks on
 * taste gets switched off over taste.
 */
export function validateBrief(text) {
  const errors = [];
  const warnings = [];
  const { title, sections } = parseBrief(text);

  if (String(text ?? "").trim() === "") {
    return { errors: ["the brief is empty"], warnings, criteria: [], title: null };
  }
  if (!title) errors.push("no title: the first line should be `# ` and a one-line statement of the work");

  for (const name of REQUIRED_SECTIONS) {
    const section = sections.get(name.toLowerCase());
    if (!section) {
      errors.push(`missing section: ## ${name}`);
      continue;
    }
    if (isEmpty(section)) errors.push(`## ${name} is empty (line ${section.line})`);
  }

  const criteria = criteriaOf(sections.get("done when"));
  if (sections.has("done when") && criteria.length === 0) {
    errors.push("## Done when has no criteria: write them as `- [ ] ...` so a Pause can read the ticks");
  }
  for (const c of criteria) {
    if (c.text === "") errors.push(`empty criterion at line ${c.line}`);
  }

  // A brief that declines nothing has usually not been thought about, but it can
  // legitimately be true, so this is not a refusal.
  const notDoing = sections.get("not doing");
  if (notDoing && !isEmpty(notDoing) && !notDoing.body.some((b) => /^\s*[-*]\s+\S/.test(b.text))) {
    warnings.push("## Not doing reads as prose; a list is easier to check against later");
  }

  for (const key of sections.keys()) {
    if (!REQUIRED_SECTIONS.some((n) => n.toLowerCase() === key)) {
      warnings.push(`## ${sections.get(key).name} is not part of the format and is ignored by the Pauses`);
    }
  }

  return { errors, warnings, criteria, title };
}

/**
 * Whether the brief's own criteria say the work is finished.
 *
 * Separate from `validateBrief` because the two answer different questions at
 * different moments. Pause 1 asks whether the brief is well formed, which is
 * true before any work has happened. Pause 3 asks whether it is satisfied, which
 * is only ever true at the end.
 */
export function briefIsSatisfied(text) {
  const criteria = criteriaOf(parseBrief(text).sections.get("done when"));
  const open = criteria.filter((c) => !c.ticked);
  const unevidenced = criteria.filter((c) => c.ticked && c.evidence.length === 0);
  return { satisfied: open.length === 0 && unevidenced.length === 0 && criteria.length > 0, criteria, open, unevidenced };
}

/** The starting brief this plugin's skill writes. */
export function briefTemplate(title = "<one line: the work, not the solution>") {
  return [
    `# ${title}`,
    "",
    "## Problem",
    "",
    "<what is wrong now, and for whom. No solution in this section.>",
    "",
    "## Done when",
    "",
    "- [ ] <something a second person could check without asking you>",
    "",
    "## Not doing",
    "",
    "- <considered and declined, so scope creep is visible when it happens>",
    "",
    "## How it will be checked",
    "",
    "<the command, or the observation, that produces the evidence>",
    "",
  ].join("\n");
}
