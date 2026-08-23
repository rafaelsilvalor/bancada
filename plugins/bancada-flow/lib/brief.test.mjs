import { test } from "node:test";
import assert from "node:assert/strict";
import { briefIsSatisfied, briefTemplate, criteriaOf, parseBrief, REQUIRED_SECTIONS, validateBrief } from "./brief.mjs";

const NL = String.fromCharCode(10);
const doc = (...lines) => lines.join(NL);

const GOOD = doc(
  "# Refuse a commit whose subject is not imperative",
  "",
  "## Problem",
  "Subjects arrive as gerunds and nobody notices until the log is unreadable.",
  "",
  "## Done when",
  "- [ ] a gerund subject is refused before git runs",
  "- [ ] the refusal names the word it objected to",
  "",
  "## Not doing",
  "- a vocabulary of approved verbs",
  "",
  "## How it will be checked",
  "node --test on the commit-message suite, plus one real session.",
);

// --- the shape ---

test("a well-formed brief has no errors", () => {
  const r = validateBrief(GOOD);
  assert.deepEqual(r.errors, []);
  assert.equal(r.title, "Refuse a commit whose subject is not imperative");
  assert.equal(r.criteria.length, 2);
});

test("every required section is required", () => {
  for (const name of REQUIRED_SECTIONS) {
    const without = GOOD.split(NL)
      .join(NL)
      .replace(`## ${name}`, `## Something Else (${name})`);
    const r = validateBrief(without);
    assert.ok(
      r.errors.some((e) => e.includes(`missing section: ## ${name}`)),
      `${name} was not required`,
    );
  }
});

test("a section that is present but empty is an error, not a pass", () => {
  const r = validateBrief(GOOD.replace("Subjects arrive as gerunds and nobody notices until the log is unreadable.", ""));
  assert.ok(r.errors.some((e) => /## Problem is empty/.test(e)));
});

test("an empty brief says so once rather than four times", () => {
  const r = validateBrief("");
  assert.deepEqual(r.errors, ["the brief is empty"]);
});

test("a missing title is an error", () => {
  const r = validateBrief(GOOD.split(NL).slice(1).join(NL));
  assert.ok(r.errors.some((e) => /no title/.test(e)));
});

test("headings are matched however they are capitalised", () => {
  const r = validateBrief(GOOD.replace("## Done when", "## DONE WHEN"));
  assert.deepEqual(r.errors, []);
});

test("criteria have to be checkboxes, because Pause 3 reads the ticks", () => {
  const r = validateBrief(GOOD.replace(/- \[ \] /g, "- "));
  assert.ok(r.errors.some((e) => /no criteria/.test(e)));
});

// --- what is warned about rather than refused ---

test("a section the format does not know about is kept and mentioned", () => {
  const r = validateBrief(GOOD + NL + NL + "## Background" + NL + "Some history.");
  assert.deepEqual(r.errors, [], "an extra section is not a refusal");
  assert.ok(r.warnings.some((w) => /## Background is not part of the format/.test(w)));
});

test("prose where a list was expected is a warning, not a refusal", () => {
  const r = validateBrief(GOOD.replace("- a vocabulary of approved verbs", "We will not build a verb list."));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /## Not doing reads as prose/.test(w)));
});

// --- whether the work is finished ---

const TICKED = doc(
  "# A thing",
  "",
  "## Problem",
  "It is broken.",
  "",
  "## Done when",
  "- [x] the parser refuses an empty payload",
  "      node --test parser.test.mjs — 12 of 12",
  "",
  "## Not doing",
  "- anything else",
  "",
  "## How it will be checked",
  "node --test",
);

test("all criteria ticked and evidenced is satisfied", () => {
  const r = briefIsSatisfied(TICKED);
  assert.equal(r.satisfied, true);
  assert.deepEqual(r.open, []);
  assert.deepEqual(r.unevidenced, []);
});

test("an open criterion is not satisfied, and is named", () => {
  const r = briefIsSatisfied(GOOD);
  assert.equal(r.satisfied, false);
  assert.equal(r.open.length, 2);
  assert.match(r.open[0].text, /gerund subject is refused/);
});

test("a tick with nothing under it is the assertion without the evidence", () => {
  // The rule the whole project rests on, made mechanical.
  const r = briefIsSatisfied(TICKED.replace("      node --test parser.test.mjs — 12 of 12", ""));
  assert.equal(r.satisfied, false);
  assert.equal(r.unevidenced.length, 1);
});

test("evidence is what is indented beneath the criterion, and nothing else", () => {
  const s = parseBrief(
    doc("## Done when", "- [x] one", "      the proof of one", "- [x] two", "not indented, so not evidence"),
  ).sections.get("done when");
  const c = criteriaOf(s);
  assert.deepEqual(c[0].evidence, ["the proof of one"]);
  assert.deepEqual(c[1].evidence, [], "the unindented line belongs to nobody");
});

test("a brief with no criteria at all is not satisfied by vacuous truth", () => {
  const r = briefIsSatisfied(doc("# A thing", "## Done when", "nothing here"));
  assert.equal(r.satisfied, false);
});

// --- the template the skill starts from ---

test("the template is a valid brief once, and only once, it is filled in", () => {
  const t = briefTemplate("Do the thing");
  assert.deepEqual(validateBrief(t).errors, [], "the shape is right out of the box");
  assert.equal(briefIsSatisfied(t).satisfied, false, "and nothing in it is claimed to be done");
});
