import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilingFor, checkSize } from "./size.mjs";

const NL = String.fromCharCode(10);
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join(NL);

const SIZE = { maxFileLines: 10, testCeiling: 20 };
const TESTS = ["**/*.test.*", "**/*.spec.*"];

// --- which ceiling applies ---

test("a test file answers to the test ceiling, a source file to the other one", () => {
  assert.equal(ceilingFor("src/a.ts", SIZE, TESTS).limit, 10);
  assert.equal(ceilingFor("src/a.test.ts", SIZE, TESTS).limit, 20);
  assert.equal(ceilingFor("src/a.spec.mjs", SIZE, TESTS).limit, 20);
});

test("the ceiling names the setting that set it, so a refusal is actionable", () => {
  assert.equal(ceilingFor("src/a.ts", SIZE, TESTS).setting, "gates.size.maxFileLines");
  assert.equal(ceilingFor("src/a.test.ts", SIZE, TESTS).setting, "gates.size.testCeiling");
});

test("with no test globs configured, everything is a source file", () => {
  assert.equal(ceilingFor("src/a.test.ts", SIZE, []).limit, 10);
});

// --- the verdict ---

test("a file at the ceiling passes; one line more does not", () => {
  assert.equal(checkSize("src/a.ts", lines(10), null, SIZE, TESTS).decision, "allow");
  assert.equal(checkSize("src/a.ts", lines(11), null, SIZE, TESTS).decision, "deny");
});

test("the refusal carries both numbers and the setting that produced them", () => {
  const r = checkSize("src/a.ts", lines(30), null, SIZE, TESTS);
  assert.equal(r.rule, "size-over");
  assert.match(r.reason, /src\/a\.ts would be 30 lines/);
  assert.match(r.reason, /ceiling for a source file is 10 \(gates\.size\.maxFileLines\)/);
});

test("a test file is judged as a test file in the refusal too", () => {
  const r = checkSize("src/a.test.ts", lines(30), null, SIZE, TESTS);
  assert.match(r.reason, /ceiling for a test file is 20 \(gates\.size\.testCeiling\)/);
});

// --- the property that keeps the gate from being switched off ---

test("an over-sized file stays editable downward", () => {
  const r = checkSize("src/a.ts", lines(40), lines(50), SIZE, TESTS);
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "size-shrinking");
});

test("shrinking below the ceiling is an ordinary pass, not the shrinking exception", () => {
  assert.equal(checkSize("src/a.ts", lines(5), lines(50), SIZE, TESTS).rule, "size-ok");
});

test("an over-sized file may not grow, even by one line", () => {
  const r = checkSize("src/a.ts", lines(51), lines(50), SIZE, TESTS);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /would be 51 lines \(it has 50 now\)/);
});

test("an edit that leaves an over-sized file exactly as long is allowed", () => {
  assert.equal(checkSize("src/a.ts", lines(50), lines(50), SIZE, TESTS).rule, "size-shrinking");
});

// --- not looking is a different fact from finding nothing ---

test("a resulting text that could not be worked out abstains under its own rule", () => {
  const r = checkSize("src/a.ts", null, "whatever", SIZE, TESTS);
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "size-unknown");
  assert.equal(r.lines, null, "no line count is reported, because none was measured");
});

test("a new file has no previous size and is still judged", () => {
  const r = checkSize("src/new.ts", lines(11), null, SIZE, TESTS);
  assert.equal(r.decision, "deny");
  assert.doesNotMatch(r.reason, /it has/, "there is no previous count to quote");
});

test("the defaults apply when the project set no numbers", () => {
  assert.equal(ceilingFor("src/a.ts", {}, TESTS).limit, 400);
  assert.equal(ceilingFor("src/a.test.ts", {}, TESTS).limit, 800);
});
