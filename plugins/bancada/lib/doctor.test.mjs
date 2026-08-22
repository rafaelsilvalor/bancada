import { test } from "node:test";
import assert from "node:assert/strict";
import { runDoctor } from "./doctor.mjs";
import { defaults, merge } from "./config.mjs";
import { languages, missingKeys, t } from "./messages.mjs";

/** A loader that returns a config built from an override, with no filesystem. */
function loader(override = {}, { errors = [], warnings = [], source = "file" } = {}) {
  return () => ({
    config: merge(defaults(), override),
    source,
    file: "/proj/bancada.config.json",
    errors,
    warnings,
  });
}

const filesOf = (files, source = "git", truncated = false) => () => ({ files, source, truncated });

const SAMPLE = [
  "src/domain/order.ts",
  "src/domain/order.test.ts",
  "src/app/checkout.ts",
  "docs/readme.md",
  "scripts/build.sh",
];

test("a clean project reports no problems", () => {
  const r = runDoctor({
    loadConfig: loader({ source: { include: ["src/**/*.ts"] } }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.summary.errors, 0);
  assert.deepEqual(r.summary.emptySettings, []);
});

test("a glob that matches nothing is named, not passed over in silence", () => {
  const r = runDoctor({
    loadConfig: loader({ source: { include: ["packages/**/*.ts"] } }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  assert.deepEqual(r.summary.emptySettings, ["source.include"]);
  assert.match(r.lines.join("\n"), /no matches\s+source\.include\s+— this setting guards nothing/);
});

test("an empty glob is reported but does not fail the command", () => {
  const r = runDoctor({
    loadConfig: loader({ source: { include: ["nowhere/**"] } }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  assert.equal(r.exitCode, 0, "a project mid-setup should still be able to read the advice");
  assert.equal(r.summary.emptySettings.length, 1);
});

test("a config error fails the command", () => {
  const r = runDoctor({
    loadConfig: loader({}, { errors: ["gates.commit.maxSubject: expected a number, got string"] }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  assert.equal(r.exitCode, 1);
  assert.match(r.lines.join("\n"), /Errors/);
  assert.match(r.lines.join("\n"), /maxSubject/);
});

test("warnings are shown without failing", () => {
  const r = runDoctor({
    loadConfig: loader({}, { warnings: ["gates.green: enabled with no commands, so it will never run"] }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  assert.equal(r.exitCode, 0);
  assert.match(r.lines.join("\n"), /Warnings/);
  assert.match(r.lines.join("\n"), /never run/);
});

test("the gate list reports on and off separately", () => {
  const r = runDoctor({
    loadConfig: loader({ gates: { structure: { enabled: true } } }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  assert.deepEqual(r.summary.gatesOn.sort(), ["commit", "secrets", "structure"]);
  assert.match(r.lines.join("\n"), /off\s+green/);
});

test("a project with every gate off is told so plainly", () => {
  const r = runDoctor({
    loadConfig: loader({ gates: { commit: { enabled: false }, secrets: { enabled: false } } }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  assert.deepEqual(r.summary.gatesOn, []);
  assert.match(r.lines.join("\n"), /installed but guarding nothing/);
});

test("directories no source glob reaches are listed as blind spots", () => {
  const r = runDoctor({
    loadConfig: loader({ source: { include: ["src/**/*.ts"] } }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  assert.ok(r.summary.blindSpots.includes("docs"));
  assert.ok(r.summary.blindSpots.includes("scripts"));
  assert.ok(!r.summary.blindSpots.includes("src"));
});

test("no source globs means no blind-spot section, since nothing claims coverage", () => {
  const r = runDoctor({ loadConfig: loader({}), listFiles: filesOf(SAMPLE), env: {} });
  assert.deepEqual(r.summary.blindSpots, []);
  assert.ok(!r.lines.join("\n").includes("Blind spots"));
});

test("a walk fallback and a truncated list are both disclosed", () => {
  const r = runDoctor({
    loadConfig: loader({}),
    listFiles: filesOf(SAMPLE, "walk", true),
    env: {},
  });
  const text = r.lines.join("\n");
  assert.match(text, /not a git repository/);
  assert.match(text, /lower bound/);
  assert.equal(r.summary.fileSource, "walk");
});

test("the session effort is reported, and its absence is reported as unknown", () => {
  const withEffort = runDoctor({ loadConfig: loader({}), listFiles: filesOf([]), env: { CLAUDE_EFFORT: "xhigh" } });
  assert.match(withEffort.lines.join("\n"), /session effort: xhigh/);

  const without = runDoctor({ loadConfig: loader({}), listFiles: filesOf([]), env: {} });
  assert.match(without.lines.join("\n"), /session effort: unknown/);
});

test("a missing config file is stated as such rather than looking like a loaded one", () => {
  const r = runDoctor({ loadConfig: loader({}, { source: "defaults" }), listFiles: filesOf([]), env: {} });
  assert.match(r.lines.join("\n"), /none found .* running on defaults/);
});

// --- language ---

test("output follows the configured language", () => {
  const r = runDoctor({
    loadConfig: loader({ language: "pt-BR", source: { include: ["nowhere/**"] } }),
    listFiles: filesOf(SAMPLE),
    env: {},
  });
  const text = r.lines.join("\n");
  assert.match(text, /nenhum match/);
  assert.match(text, /esse ajuste não guarda nada/);
  assert.equal(r.summary.language, "pt-BR");
});

test("every catalog carries every English key", () => {
  for (const lang of languages()) {
    assert.deepEqual(missingKeys(lang), [], `catalog "${lang}" is missing keys`);
  }
});

test("an unknown language falls back to English instead of blanking the output", () => {
  assert.equal(t("klingon", "doctor.ok"), t("en", "doctor.ok"));
});

test("an unknown key renders as the key, so a gap is visible rather than blank", () => {
  assert.equal(t("en", "doctor.nope.missing"), "doctor.nope.missing");
});
