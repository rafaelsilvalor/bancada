import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSecrets, DEFAULT_FAMILIES, FAMILIES, isPlaceholder, mask, scan } from "./secrets.mjs";

const NL = String.fromCharCode(10);
const src = (...lines) => lines.join(NL);

/**
 * Every credential-shaped fixture is assembled from parts.
 *
 * This repository has the secret gate on. A literal `AKIA…` in this file would
 * be refused by bancada's own gate the next time anyone edited it, which is a
 * fine demonstration and a terrible way to maintain a test suite.
 */
const AWS = "AKIA" + "JQ3XN7ZP4LMTKW2D";
const GITHUB = "ghp_" + "0123456789abcdefghij0123456789abcdef";
const ANTHROPIC = "sk-ant-" + "api03-" + "a1b2c3d4e5f6g7h8i9j0k1l2m3";
const SLACK = "xoxb-" + "123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx";
const PEM = "-----BEGIN RSA PRIVATE" + " KEY-----";
const JWT = "eyJ" + "hbGciOiJIUzI1NiJ9." + "eyJ" + "zdWIiOiIxMjM0NSJ9." + "QWxsT2ZUaGlzSXNGYWtl";

const all = { builtin: ["provider", "key", "generic"], custom: [] };
const defaults = { builtin: DEFAULT_FAMILIES, custom: [] };

// --- what the default families catch ---

test("a provider-issued key is found by the families that are on by default", () => {
  for (const value of [AWS, GITHUB, ANTHROPIC, SLACK, PEM]) {
    const found = scan(`const k = "${value}";`, defaults);
    assert.equal(found.length, 1, `missed ${value.slice(0, 6)}`);
  }
});

test("ordinary code is not a credential", () => {
  const found = scan(
    src(
      'import { readFileSync } from "node:fs";',
      "const limit = 400;",
      'const url = "https://example.com/api/v1/orders";',
      "export function checkSize(path) { return path.length; }",
    ),
    defaults,
  );
  assert.deepEqual(found, []);
});

test("the noisy family is off by default and works when asked for", () => {
  const text = 'const config = { api_key: "s0m3th1ngL0ngEn0ugh" };';
  assert.deepEqual(scan(text, defaults), [], "generic is not one of the default families");
  assert.equal(scan(text, all).length, 1);
  assert.deepEqual(DEFAULT_FAMILIES, ["provider", "key"]);
});

test("a JSON Web Token belongs to the family a project opts into", () => {
  assert.deepEqual(scan(`const t = "${JWT}";`, defaults), []);
  assert.equal(scan(`const t = "${JWT}";`, all).length, 1);
});

test("credentials embedded in a connection string are found", () => {
  const found = scan('const dsn = "postgres://svc:hunter2hunter2@db.internal:5432/app";', defaults);
  assert.equal(found.length, 1);
});

// --- the promise not to cry wolf ---

test("a value that says it is an example is not a finding", () => {
  // AWS's own documentation key. It appears in more repositories than any real
  // one, and refusing it is how a default-on gate gets switched off.
  assert.deepEqual(scan('const k = "AKIAIOSFODNN7EXAMPLE";', defaults), []);
});

test("a masked or repeated placeholder is not a finding", () => {
  assert.equal(isPlaceholder("ghp_" + "x".repeat(36)), true);
  assert.equal(isPlaceholder("<your-token-here>"), true);
  assert.equal(isPlaceholder("${GITHUB_TOKEN}"), true);
  assert.equal(isPlaceholder("changeme"), true);
  assert.equal(isPlaceholder(AWS), false);
});

test("a stripe test key is not a live key", () => {
  assert.deepEqual(scan('const k = "sk_test_' + "0123456789abcdefghij" + '";', defaults), []);
});

// --- what a refusal says, and what it does not say ---

test("the refusal never repeats the secret back", () => {
  const r = checkSecrets(`const k = "${AWS}";`, "src/config.mjs", defaults);
  assert.equal(r.decision, "deny");
  assert.equal(r.reason.includes(AWS), false, "the reason must not carry the credential");
  assert.match(r.reason, /AKIA\*+ \(20 chars\)/);
  assert.match(r.reason, /src\/config\.mjs/);
});

test("a mask keeps the length and four characters of prefix", () => {
  assert.match(mask("abcdefghijkl"), /^abcd\*{8} \(12 chars\)$/);
  assert.equal(mask("ab"), "** (2 chars)");
});

test("every finding is reported at its line, not just the first", () => {
  const r = checkSecrets(src("const a = 1;", `const k = "${AWS}";`, "const b = 2;", `const g = "${GITHUB}";`), "f.mjs", defaults);
  assert.equal(r.findings.length, 2);
  assert.deepEqual(
    r.findings.map((f) => f.line),
    [2, 4],
  );
});

test("the same credential matched by two patterns is reported once", () => {
  const r = checkSecrets(`const k = "${ANTHROPIC}";`, "f.mjs", defaults);
  assert.equal(r.findings.length, 1);
});

test("the rule names the families that fired, so the report can separate them", () => {
  const r = checkSecrets(src(`const k = "${AWS}";`, PEM), "f.mjs", defaults);
  assert.equal(r.rule, "secrets-key+provider");
});

test("clean text allows under its own rule, which is not the same as not looking", () => {
  const r = checkSecrets("const x = 1;", "f.mjs", defaults);
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "secrets-ok");
  assert.equal(r.reason, null);
});

// --- the project's own patterns ---

test("a custom pattern is applied alongside the built-in families", () => {
  const settings = { builtin: [], custom: ["ACME-[0-9]{8}"] };
  const r = checkSecrets('const k = "ACME-12345678";', "f.mjs", settings);
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "secrets-custom");
});

test("a custom pattern that will not compile is skipped, never a crash mid-write", () => {
  const settings = { builtin: [], custom: ["([unclosed", "ACME-[0-9]{8}"] };
  const r = checkSecrets('const k = "ACME-12345678";', "f.mjs", settings);
  assert.equal(r.decision, "deny", "the usable pattern still ran");
});

test("no families and no custom patterns finds nothing rather than everything", () => {
  assert.deepEqual(scan(`const k = "${AWS}";`, { builtin: [], custom: [] }), []);
});

test("an unknown family name contributes nothing and does not throw", () => {
  assert.deepEqual(scan(`const k = "${AWS}";`, { builtin: ["nonexistent"], custom: [] }), []);
  assert.equal("nonexistent" in FAMILIES, false);
});

test("an empty or absent input is not scanned", () => {
  for (const t of ["", null, undefined, 42]) assert.deepEqual(scan(t, defaults), []);
});

// --- what it does not see, pinned so a change is deliberate ---

test("a bare high-entropy string with no issuer prefix is invisible, by design", () => {
  // Stated in the module and pinned here: under-detecting is the direction this
  // gate errs in. A test that expected a finding would be describing a gate
  // bancada does not ship.
  assert.deepEqual(scan('const k = "9f2c4a7e1b8d3056af91c2e4d7b05a3f";', defaults), []);
});
