import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPair } from "./pair.mjs";

const SETTINGS = {
  testAgent: "test",
  codeAgent: "code",
  testGlobs: ["**/*.test.*", "**/*.spec.*"],
};

// --- the two refusals ---

test("the code role may not edit a test", () => {
  const r = checkPair("code", "src/order.test.ts", SETTINGS);
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "pair-code-writes-test");
  assert.match(r.reason, /stops being evidence/);
});

test("the test role may not edit code", () => {
  const r = checkPair("test", "src/order.ts", SETTINGS);
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "pair-test-writes-code");
});

test("each role in its own half is allowed", () => {
  assert.equal(checkPair("code", "src/order.ts", SETTINGS).rule, "pair-ok");
  assert.equal(checkPair("test", "src/order.test.ts", SETTINGS).rule, "pair-ok");
});

// --- who the gate is not for ---

test("a turn with no role is not doing pair work and is left alone", () => {
  for (const agent of [undefined, null, "", "   "]) {
    const r = checkPair(agent, "src/order.test.ts", SETTINGS);
    assert.equal(r.decision, "allow");
    assert.equal(r.rule, "pair-no-role");
  }
});

test("a role that is neither of the two is not judged", () => {
  const r = checkPair("Explore", "src/order.test.ts", SETTINGS);
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "pair-other-role");
});

test("the role name is matched without regard to case or surrounding space", () => {
  assert.equal(checkPair(" Code ", "src/order.test.ts", SETTINGS).decision, "deny");
});

// --- the definition of a test comes from the config, not from bancada ---

test("a project that spells its tests differently is obeyed", () => {
  const settings = { ...SETTINGS, testGlobs: ["tests/**"] };
  assert.equal(checkPair("code", "tests/order.mjs", settings).decision, "deny");
  assert.equal(checkPair("code", "src/order.test.ts", settings).decision, "allow");
});

test("the roles are the project's names for them", () => {
  const settings = { testAgent: "spec-writer", codeAgent: "implementer", testGlobs: ["**/*.test.*"] };
  assert.equal(checkPair("implementer", "a.test.ts", settings).decision, "deny");
  assert.equal(checkPair("code", "a.test.ts", settings).rule, "pair-other-role");
});

test("the refusal names the role that should take it instead", () => {
  const r = checkPair("code", "src/order.test.ts", SETTINGS);
  assert.match(r.reason, /"test" role/);
});

test("a windows-shaped path is matched the same as a posix one", () => {
  const BS = String.fromCharCode(92);
  assert.equal(checkPair("code", ["src", "order.test.ts"].join(BS), SETTINGS).decision, "deny");
});
