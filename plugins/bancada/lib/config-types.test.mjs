import { test } from "node:test";
import assert from "node:assert/strict";
import { typeError } from "./config-types.mjs";

// The scalar kinds moved here from config.mjs; one case each pins that the move
// carried the behaviour. The full journeys through validate() stay in
// config.test.mjs, where the SPEC is what is under test.

test("scalars accept their kind and name the path when refusing", () => {
  assert.equal(typeError("boolean", true, "x"), null);
  assert.match(typeError("boolean", "yes", "gates.a.enabled"), /gates\.a\.enabled: expected a boolean, got string/);
  assert.equal(typeError("number", 7, "x"), null);
  assert.match(typeError("number", NaN, "x"), /expected a number/);
  assert.equal(typeError("string", "hi", "x"), null);
  assert.match(typeError("string", 7, "x"), /expected a string, got number/);
  assert.equal(typeError("enum", "en", "x", ["en", "pt-BR"]), null);
  assert.match(typeError("enum", "de", "x", ["en", "pt-BR"]), /expected one of en, pt-BR/);
});

test("a string array refuses a non-array and a non-string entry", () => {
  assert.equal(typeError("string[]", ["a", "b"], "x"), null);
  assert.match(typeError("string[]", "a", "x"), /expected an array of strings, got string/);
  assert.match(typeError("string[]", ["a", 1], "x"), /every entry must be a string/);
});

test("an unknown kind is accepted, so a leaf added to the SPEC cannot brick old configs", () => {
  assert.equal(typeError("hologram", "anything", "x"), null);
});

// --- layer[]: moved, not changed ---

test("a layer needs a name, a match and a mayImport list", () => {
  assert.equal(typeError("layer[]", [{ name: "lib", match: "src/**", mayImport: [] }], "l"), null);
  assert.match(typeError("layer[]", "nope", "l"), /expected an array of layers/);
  assert.match(typeError("layer[]", [{ match: "src/**", mayImport: [] }], "l"), /l\[0\]\.name/);
  assert.match(typeError("layer[]", [{ name: "lib", mayImport: [] }], "l"), /l\[0\]\.match/);
  assert.match(typeError("layer[]", [{ name: "lib", match: "src/**" }], "l"), /l\[0\]\.mayImport/);
  assert.match(typeError("layer[]", [{ name: "lib", match: "s", mayImport: [], aliases: [1] }], "l"), /l\[0\]\.aliases/);
});

// --- suite[]: a test elsewhere, declared as covering a set of modules ---

test("a well-formed suite validates", () => {
  const suites = [{ test: "lib/checks.test.mjs", covers: ["lib/checks/*.mjs"] }];
  assert.equal(typeError("suite[]", suites, "s"), null);
});

test("a suite must name its test file and at least one covers glob", () => {
  assert.match(typeError("suite[]", "nope", "s"), /expected an array of suites, got string/);
  assert.match(typeError("suite[]", ["nope"], "s"), /s\[0\]: expected an object/);
  assert.match(typeError("suite[]", [{ covers: ["a/**"] }], "s"), /s\[0\]\.test: expected the path/);
  assert.match(typeError("suite[]", [{ test: "", covers: ["a/**"] }], "s"), /s\[0\]\.test/);
  assert.match(typeError("suite[]", [{ test: "t.mjs" }], "s"), /s\[0\]\.covers: expected a non-empty array/);
  assert.match(typeError("suite[]", [{ test: "t.mjs", covers: [] }], "s"), /s\[0\]\.covers/, "an empty covers guards nothing");
  assert.match(typeError("suite[]", [{ test: "t.mjs", covers: [""] }], "s"), /s\[0\]\.covers/);
});

// --- exception[]: dated and reasoned, or refused ---

test("a well-formed exception validates", () => {
  const e = [{ path: "scripts/gen.mjs", reason: "measurement script, exercised by CI", date: "2026-08-25" }];
  assert.equal(typeError("exception[]", e, "x"), null);
});

test("an exception without a reason or a date is refused, because it is the decision that is required", () => {
  assert.match(typeError("exception[]", "nope", "x"), /expected an array of exceptions/);
  assert.match(typeError("exception[]", [null], "x"), /x\[0\]: expected an object/);
  assert.match(typeError("exception[]", [{ reason: "r", date: "2026-08-25" }], "x"), /x\[0\]\.path/);
  assert.match(typeError("exception[]", [{ path: "a.mjs", date: "2026-08-25" }], "x"), /x\[0\]\.reason.*not a decision/);
  assert.match(typeError("exception[]", [{ path: "a.mjs", reason: "", date: "2026-08-25" }], "x"), /x\[0\]\.reason/);
  assert.match(typeError("exception[]", [{ path: "a.mjs", reason: "r" }], "x"), /x\[0\]\.date.*YYYY-MM-DD/);
  assert.match(typeError("exception[]", [{ path: "a.mjs", reason: "r", date: "yesterday" }], "x"), /x\[0\]\.date/);
  assert.match(typeError("exception[]", [{ path: "a.mjs", reason: "r", date: "25-08-2026" }], "x"), /x\[0\]\.date/);
});
