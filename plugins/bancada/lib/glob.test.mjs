import { test } from "node:test";
import assert from "node:assert/strict";
import { compileGlob, expandBraces, matchesAny, normalisePath } from "./glob.mjs";

const BACKSLASH = String.fromCharCode(92);
const winPath = ["src", "a", "b.ts"].join(BACKSLASH);

test("star does not cross a path separator", () => {
  const m = compileGlob("src/*.ts");
  assert.equal(m("src/index.ts"), true);
  assert.equal(m("src/deep/index.ts"), false);
});

test("globstar crosses separators and also matches zero segments", () => {
  const m = compileGlob("src/**/*.ts");
  assert.equal(m("src/index.ts"), true, "zero intermediate segments");
  assert.equal(m("src/a/index.ts"), true);
  assert.equal(m("src/a/b/c/index.ts"), true);
  assert.equal(m("lib/index.ts"), false);
});

test("trailing globstar matches everything below the prefix", () => {
  const m = compileGlob("docs/**");
  assert.equal(m("docs/a.md"), true);
  assert.equal(m("docs/a/b/c.md"), true);
  assert.equal(m("other/a.md"), false);
});

test("question mark matches exactly one non-separator character", () => {
  const m = compileGlob("a?.ts");
  assert.equal(m("ab.ts"), true);
  assert.equal(m("a.ts"), false);
  assert.equal(m("a/b.ts"), false);
});

test("brace groups expand, including nested ones", () => {
  assert.deepEqual(expandBraces("a.{ts,js}"), ["a.ts", "a.js"]);
  assert.deepEqual(expandBraces("{x,y}/{a,b}.ts"), ["x/a.ts", "x/b.ts", "y/a.ts", "y/b.ts"]);
  assert.deepEqual(expandBraces("a.{ts,{mts,cts}}"), ["a.ts", "a.mts", "a.cts"]);
});

test("an unbalanced brace is treated as a literal rather than throwing", () => {
  assert.deepEqual(expandBraces("a.{ts"), ["a.{ts"]);
  assert.equal(compileGlob("a.{ts")("a.{ts"), true);
});

test("character classes match and negate", () => {
  assert.equal(compileGlob("a[bc].ts")("ab.ts"), true);
  assert.equal(compileGlob("a[bc].ts")("ad.ts"), false);
  assert.equal(compileGlob("a[!bc].ts")("ad.ts"), true);
  assert.equal(compileGlob("a[!bc].ts")("ab.ts"), false);
});

test("regex metacharacters in a pattern are literal", () => {
  const m = compileGlob("src/a.b+c(1).ts");
  assert.equal(m("src/a.b+c(1).ts"), true);
  assert.equal(m("src/axbxcx1x.ts"), false, "a dot must not behave as any-char");
});

test("a dot in a pattern does not match an arbitrary character", () => {
  assert.equal(compileGlob("*.ts")("axts"), false);
  assert.equal(compileGlob("*.ts")("a.ts"), true);
});

test("an empty pattern list matches nothing", () => {
  assert.equal(matchesAny("anything.ts", []), false);
  assert.equal(matchesAny("anything.ts", undefined), false);
});

test("windows separators and a leading ./ are normalised before matching", () => {
  assert.equal(normalisePath(winPath), "src/a/b.ts");
  assert.equal(normalisePath("./src/a.ts"), "src/a.ts");
  assert.equal(matchesAny(winPath, ["src/**/*.ts"]), true);
  assert.equal(matchesAny("./src/a.ts", ["src/*.ts"]), true);
});

test("matchesAny is true when any one pattern matches", () => {
  assert.equal(matchesAny("lib/a.js", ["src/**/*.ts", "lib/**/*.js"]), true);
  assert.equal(matchesAny("bin/a.sh", ["src/**/*.ts", "lib/**/*.js"]), false);
});
