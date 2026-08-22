import { test } from "node:test";
import assert from "node:assert/strict";
import { reportSkills } from "./skills-report.mjs";

const NL = String.fromCharCode(10);
const finder = (skills) => () => skills;
const skill = (name, front) => ({ name, front });

test("a project with no skills says so instead of printing an empty table", () => {
  const r = reportSkills({ findSkills: finder([]) });
  assert.equal(r.summary.count, 0);
  assert.match(r.lines.join(NL), /No skills found/);
});

test("the report states the model it assumed, since the budget scales with it", () => {
  const r = reportSkills({ findSkills: finder([skill("a", { description: "x" })]), model: "haiku" });
  const text = r.lines.join(NL);
  assert.match(text, /haiku-sized window/);
  assert.match(text, /shrinks on a smaller model/);
});

test("going over budget is named, along with what gets dropped first", () => {
  const many = Array.from({ length: 40 }, (_, i) => skill("s" + i, { description: "x".repeat(1500) }));
  const r = reportSkills({ findSkills: finder(many), model: "haiku" });
  const text = r.lines.join(NL);
  assert.equal(r.summary.over, true);
  assert.match(text, /skills you invoke least/);
  assert.match(text, /disable-model-invocation/);
});

test("a model-invisible skill is shown at zero cost, not hidden from the report", () => {
  const r = reportSkills({
    findSkills: finder([skill("deploy", { description: "x".repeat(900), "disable-model-invocation": true })]),
  });
  const text = r.lines.join(NL);
  assert.match(text, /0\s+deploy\s+\(model-invisible\)/);
  assert.equal(r.summary.used, 0);
});

test("the report follows the configured language", () => {
  const r = reportSkills({ findSkills: finder([skill("a", { description: "x" })]), lang: "pt-BR" });
  assert.match(r.lines.join(NL), /Orçamento da listagem de skills/);
});
