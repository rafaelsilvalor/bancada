import { test } from "node:test";
import assert from "node:assert/strict";
import { extractImports, isRelative, resolveRelative } from "./imports.mjs";
import { checkLayering, compileLayers, layerOf, targetLayer } from "./structure.mjs";

const LAYERS = [
  { name: "domain", match: "src/domain/**", mayImport: [] },
  { name: "app", match: "src/app/**", mayImport: ["domain"] },
  { name: "adapter", match: "src/adapter/**", mayImport: ["domain", "app"] },
];

const NL = String.fromCharCode(10);
const src = (...lines) => lines.join(NL);

// --- finding imports ---

test("javascript and typescript import forms are found", () => {
  const found = extractImports(
    src(
      'import { a } from "./a.js";',
      'import b from "../b";',
      'import * as c from "pkg-c";',
      'export { d } from "./d.js";',
      'const e = require("./e");',
      'const f = await import("./f");',
    ),
  );
  for (const spec of ["./a.js", "../b", "pkg-c", "./d.js", "./e", "./f"]) {
    assert.ok(found.includes(spec), `missing ${spec}`);
  }
});

test("python import forms are found", () => {
  const found = extractImports(src("import os", "from app.domain import Order", "import app.adapter.jira"));
  assert.ok(found.includes("os"));
  assert.ok(found.includes("app.domain"));
  assert.ok(found.includes("app.adapter.jira"));
});

test("a commented-out import is not counted", () => {
  const found = extractImports(
    src('// import { bad } from "../adapter/jira";', "/*", 'import { alsoBad } from "./x";', "*/", '# import evil'),
  );
  assert.deepEqual(found, []);
});

test("duplicates collapse and order is first-seen", () => {
  const found = extractImports(src('import a from "./a";', 'import b from "./b";', 'const a2 = require("./a");'));
  assert.deepEqual(found, ["./a", "./b"]);
});

test("an empty or non-string source yields nothing rather than throwing", () => {
  for (const s of ["", null, undefined, 42]) assert.deepEqual(extractImports(s), []);
});

// --- resolving ---

test("a relative specifier is recognised; a bare one is not", () => {
  assert.equal(isRelative("./a"), true);
  assert.equal(isRelative("../a"), true);
  assert.equal(isRelative("pkg"), false);
  assert.equal(isRelative("src/domain/a"), false);
});

test("a relative specifier resolves against the importing file's directory", () => {
  assert.equal(resolveRelative("src/app/checkout.ts", "./cart"), "src/app/cart");
  assert.equal(resolveRelative("src/app/checkout.ts", "../domain/order"), "src/domain/order");
  assert.equal(resolveRelative("src/app/deep/a.ts", "../../domain/order.js"), "src/domain/order");
});

test("the extension is dropped, so one glob covers every spelling", () => {
  assert.equal(resolveRelative("src/app/a.ts", "./b.ts"), "src/app/b");
  assert.equal(resolveRelative("src/app/a.ts", "./b.mjs"), "src/app/b");
  assert.equal(resolveRelative("src/app/a.ts", "./b"), "src/app/b");
});

// --- layer attribution ---

test("a file is attributed to the first layer whose glob matches", () => {
  const c = compileLayers(LAYERS);
  assert.equal(layerOf("src/domain/order.ts", c).name, "domain");
  assert.equal(layerOf("src/adapter/jira.ts", c).name, "adapter");
  assert.equal(layerOf("scripts/build.mjs", c), null);
});

test("a bare specifier shaped like a path is attributed", () => {
  const c = compileLayers(LAYERS);
  assert.equal(targetLayer("src/app/a.ts", "src/domain/order", c).name, "domain");
});

test("a package specifier is not attributed and is not a violation", () => {
  const c = compileLayers(LAYERS);
  assert.equal(targetLayer("src/app/a.ts", "node:fs", c), null);
  assert.equal(targetLayer("src/app/a.ts", "express", c), null);
});

test("a layer can declare aliases for how the codebase spells it", () => {
  const c = compileLayers([{ name: "domain", match: "src/domain/**", mayImport: [], aliases: ["@domain/"] }]);
  assert.equal(targetLayer("src/app/a.ts", "@domain/order", c).name, "domain");
});

// --- the verdict ---

test("an import that crosses into a forbidden layer is refused", () => {
  const r = checkLayering("src/domain/order.ts", 'import { jira } from "../adapter/jira.js";', LAYERS);
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "structure-layer");
  assert.equal(r.violations.length, 1);
  assert.deepEqual(r.violations[0], { spec: "../adapter/jira.js", from: "domain", to: "adapter" });
});

test("the refusal names the layer, what it may import, and every offending line", () => {
  const r = checkLayering(
    "src/domain/order.ts",
    src('import { jira } from "../adapter/jira.js";', 'import { pay } from "../app/checkout.js";'),
    LAYERS,
  );
  assert.match(r.reason, /"domain" layer, which may import from no other layer/);
  assert.match(r.reason, /\.\.\/adapter\/jira\.js\s+→\s+"adapter"/);
  assert.match(r.reason, /\.\.\/app\/checkout\.js\s+→\s+"app"/);
  assert.equal(r.violations.length, 2, "both are reported, not just the first");
});

test("an allowed direction passes", () => {
  const r = checkLayering("src/app/checkout.ts", 'import { Order } from "../domain/order.js";', LAYERS);
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "structure-ok");
});

test("importing within the same layer is always allowed", () => {
  const r = checkLayering("src/domain/order.ts", 'import { Money } from "./money.js";', LAYERS);
  assert.equal(r.decision, "allow");
});

test("a file outside every layer is not judged", () => {
  const r = checkLayering("scripts/build.mjs", 'import { jira } from "../src/adapter/jira.js";', LAYERS);
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "structure-outside");
});

test("with no layers configured the check does not apply", () => {
  const r = checkLayering("src/domain/order.ts", 'import { jira } from "../adapter/jira.js";', []);
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "structure-unconfigured");
});

// --- the promise not to guess ---

test("an import it cannot attribute is counted as unknown, never as a violation", () => {
  const r = checkLayering(
    "src/domain/order.ts",
    src('import fs from "node:fs";', 'import express from "express";', 'import { z } from "zod";'),
    LAYERS,
  );
  assert.equal(r.decision, "allow");
  assert.equal(r.unknown, 3, "the gate reports how much of the file it could not see");
});

test("unknowns are reported alongside a real violation, so coverage is visible", () => {
  const r = checkLayering(
    "src/domain/order.ts",
    src('import fs from "node:fs";', 'import { jira } from "../adapter/jira.js";'),
    LAYERS,
  );
  assert.equal(r.decision, "deny");
  assert.equal(r.unknown, 1);
});

test("a transitive hop is not inferred; only what the file itself imports is judged", () => {
  // domain -> app is forbidden, and app -> adapter is allowed, but this file
  // imports only app. Inferring the hop would be a claim the gate cannot back.
  const r = checkLayering("src/adapter/jira.ts", 'import { checkout } from "../app/checkout.js";', LAYERS);
  assert.equal(r.decision, "allow");
});

test("a javascript default import does not register its local binding as a module", () => {
  // Regression. A loose Python `import (\w+)` pattern also matches
  // `import fs from "node:fs"` and captures `fs`, inventing a dependency that
  // is not there. False violations are the failure that gets a layering gate
  // switched off, so this one is pinned.
  const found = extractImports(
    src('import fs from "node:fs";', 'import order from "../domain/order.js";', 'import x from "./x";'),
  );
  assert.deepEqual(found.sort(), ["../domain/order.js", "./x", "node:fs"]);
  assert.equal(found.includes("fs"), false, "the binding name is not a module");
  assert.equal(found.includes("order"), false);
});

test("python and javascript import lines coexist without contaminating each other", () => {
  const found = extractImports(src("import os", 'import path from "node:path";', "from app.domain import Order"));
  assert.ok(found.includes("os"), "python bare import still works");
  assert.ok(found.includes("node:path"));
  assert.ok(found.includes("app.domain"));
  assert.equal(found.includes("path"), false, "the js binding is not a module");
});

test("python multi-import and aliasing are read", () => {
  const found = extractImports(src("import os, sys", "import numpy as np"));
  assert.ok(found.includes("os"));
  assert.ok(found.includes("numpy"));
});

// --- the bug an end-to-end run found that every unit test had missed ---

test("an absolute file path is reconciled against the project root before matching", () => {
  // Write and Edit hand the gate an absolute path. Every test above passes a
  // relative one, which proved the logic and hid the fact that the gate
  // attributed nothing in a real session — a configured gate enforcing nothing.
  const abs = "/home/me/proj/src/domain/order.ts";
  const r = checkLayering(abs, 'import { jira } from "../adapter/jira.js";', LAYERS, "/home/me/proj");
  assert.equal(r.decision, "deny");
  assert.equal(r.violations[0].from, "domain");
});

test("the refusal names the path relative to the project, not the absolute one", () => {
  const r = checkLayering(
    "/home/me/proj/src/domain/order.ts",
    'import { jira } from "../adapter/jira.js";',
    LAYERS,
    "/home/me/proj",
  );
  assert.match(r.reason, /^src\/domain\/order\.ts is in the "domain" layer/);
  assert.doesNotMatch(r.reason, /home\/me\/proj/);
});

test("a windows absolute path is reconciled too, whatever the drive-letter case", () => {
  const BS = String.fromCharCode(92);
  const abs = ["D:", "Projects", "proj", "src", "domain", "order.ts"].join(BS);
  const r = checkLayering(abs, 'import { x } from "../adapter/y.js";', LAYERS, "d:/Projects/proj");
  assert.equal(r.decision, "deny", "the drive letter case must not decide whether a gate runs");
});

test("a path outside the project root is left alone rather than mangled", () => {
  const r = checkLayering("/elsewhere/src/domain/a.ts", 'import x from "../adapter/y.js";', LAYERS, "/home/me/proj");
  assert.equal(r.rule, "structure-outside");
});

test("with no project root given, a relative path still works", () => {
  const r = checkLayering("src/domain/order.ts", 'import { jira } from "../adapter/jira.js";', LAYERS);
  assert.equal(r.decision, "deny");
});
