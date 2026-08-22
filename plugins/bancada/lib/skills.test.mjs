import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_WINDOWS,
  ENTRY_CAP,
  entryCost,
  findSkills,
  measureListing,
  parseFrontmatter,
} from "./skills.mjs";

const NL = String.fromCharCode(10);
const doc = (...lines) => lines.join(NL);
const front = (...lines) => doc("---", ...lines, "---", "", "body");

const skill = (name, f) => ({ name, front: f });

// --- frontmatter ---

test("scalar keys are read", () => {
  const f = parseFrontmatter(front("name: probe", "description: Research a topic"));
  assert.equal(f.name, "probe");
  assert.equal(f.description, "Research a topic");
});

test("quotes are stripped from a quoted value", () => {
  const f = parseFrontmatter(front('description: "Quoted, with a comma"', "name: 'single'"));
  assert.equal(f.description, "Quoted, with a comma");
  assert.equal(f.name, "single");
});

test("boolean spellings Claude Code accepts are all recognised", () => {
  for (const yes of ["true", "yes", "on", "1"]) {
    assert.equal(parseFrontmatter(front(`disable-model-invocation: ${yes}`))["disable-model-invocation"], true, yes);
  }
  for (const no of ["false", "no", "off", "0"]) {
    assert.equal(parseFrontmatter(front(`disable-model-invocation: ${no}`))["disable-model-invocation"], false, no);
  }
});

test("a file with no frontmatter yields an empty object rather than throwing", () => {
  for (const text of ["", "just a body", "--- not really", null, undefined]) {
    assert.deepEqual(parseFrontmatter(text), {});
  }
});

test("keys after the closing marker are not read", () => {
  const f = parseFrontmatter(doc("---", "name: a", "---", "", "description: this is body text"));
  assert.equal(f.name, "a");
  assert.equal(f.description, undefined);
});

// --- what an entry costs ---

test("an entry costs its description plus its name", () => {
  const e = entryCost({ name: "probe", description: "abcde" }, "probe");
  assert.equal(e.chars, 5 + "probe".length);
  assert.equal(e.hidden, false);
});

test("when_to_use counts toward the same entry", () => {
  const e = entryCost({ name: "x", description: "aaa", when_to_use: "bbb" }, "x");
  assert.equal(e.rawChars, 7, "description, a space, and when_to_use");
});

test("an entry over the cap is charged the cap and flagged as truncated", () => {
  const e = entryCost({ name: "x", description: "a".repeat(ENTRY_CAP + 500) }, "x");
  assert.equal(e.truncated, true);
  assert.equal(e.chars, ENTRY_CAP + 1);
  assert.equal(e.rawChars, ENTRY_CAP + 500);
});

test("a hidden skill costs nothing, which is the strongest lever there is", () => {
  const e = entryCost({ name: "deploy", description: "a".repeat(2000), "disable-model-invocation": true }, "deploy");
  assert.equal(e.hidden, true);
  assert.equal(e.chars, 0);
  assert.equal(e.truncated, false, "it is not in the listing, so it cannot be truncated in it");
});

test("a skill with no description is noted, since the model has nothing to match on", () => {
  assert.equal(entryCost({ name: "x" }, "x").described, false);
  assert.equal(entryCost({ name: "x", description: "y" }, "x").described, true);
});

test("the directory name is used when frontmatter omits the name", () => {
  assert.equal(entryCost({ description: "d" }, "from-dir").name, "from-dir");
});

// --- the listing against the budget ---

test("usage is reported against the model's own window, not a fixed number", () => {
  const skills = [skill("a", { description: "x".repeat(1000) })];
  const onOpus = measureListing(skills, { model: "opus" });
  const onHaiku = measureListing(skills, { model: "haiku" });

  assert.equal(onOpus.window, CONTEXT_WINDOWS.opus);
  assert.equal(onHaiku.window, CONTEXT_WINDOWS.haiku);
  assert.ok(onHaiku.pct > onOpus.pct, "the same listing is a bigger share of a smaller window");
});

test("an unknown model falls back to the smallest window rather than the largest", () => {
  // Guessing large would under-report the risk, and this report exists to warn.
  const m = measureListing([skill("a", { description: "x" })], { model: "something-new" });
  assert.equal(m.window, Math.min(...Object.values(CONTEXT_WINDOWS)));
});

test("a listing over budget says so", () => {
  const many = Array.from({ length: 20 }, (_, i) => skill(`s${i}`, { description: "x".repeat(ENTRY_CAP) }));
  const m = measureListing(many, { model: "haiku" });
  assert.equal(m.over, true);
  assert.ok(m.pct > 100);
});

test("a small listing is well under budget", () => {
  const m = measureListing([skill("a", { description: "short" })], { model: "opus" });
  assert.equal(m.over, false);
  assert.ok(m.pct < 5);
});

test("entries are ordered by cost, so the biggest contributor is first", () => {
  const m = measureListing([
    skill("small", { description: "x" }),
    skill("big", { description: "x".repeat(500) }),
    skill("medium", { description: "x".repeat(100) }),
  ]);
  assert.deepEqual(
    m.entries.map((e) => e.name),
    ["big", "medium", "small"],
  );
});

test("hidden skills are counted but add nothing to the total", () => {
  const withHidden = measureListing([
    skill("visible", { description: "x".repeat(100) }),
    skill("hidden", { description: "x".repeat(9000), "disable-model-invocation": true }),
  ]);
  const withoutHidden = measureListing([skill("visible", { description: "x".repeat(100) })]);
  assert.equal(withHidden.hidden, 1);
  assert.equal(withHidden.used, withoutHidden.used);
});

test("truncated and undescribed entries are named", () => {
  const m = measureListing([
    skill("toolong", { description: "x".repeat(ENTRY_CAP + 1) }),
    skill("nodesc", {}),
    skill("fine", { description: "ok" }),
  ]);
  assert.deepEqual(m.truncated, ["toolong"]);
  assert.deepEqual(m.undescribed, ["nodesc"]);
});

test("a hidden skill without a description is not reported as a problem", () => {
  const m = measureListing([skill("manual", { "disable-model-invocation": true })]);
  assert.deepEqual(m.undescribed, [], "nothing needs to match it; only you invoke it");
});

// --- discovery ---

test("skills are found as <dir>/<name>/SKILL.md", () => {
  const files = {
    "skills/probe/SKILL.md": front("description: research"),
    "skills/deploy/SKILL.md": front("description: ship it", "disable-model-invocation: true"),
  };
  const found = findSkills("skills", {
    list: () => ["probe", "deploy", "not-a-skill"],
    stat: () => ({ isDirectory: () => true }),
    read: (p) => {
      const key = String(p).replace(/\\/g, "/");
      if (key in files) return files[key];
      throw new Error("ENOENT");
    },
  });
  assert.deepEqual(found.map((f) => f.name).sort(), ["deploy", "probe"]);
  assert.equal(found.find((f) => f.name === "deploy").front["disable-model-invocation"], true);
});

test("a missing skills directory yields nothing rather than an error", () => {
  assert.deepEqual(
    findSkills("nowhere", {
      list: () => {
        throw new Error("ENOENT");
      },
    }),
    [],
  );
});
