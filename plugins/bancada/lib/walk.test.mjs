import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_WALK_FILES, walkFiles } from "./walk.mjs";

/** A real tree, because what this module does is read a real filesystem. */
const tree = (spec) => {
  const root = mkdtempSync(join(tmpdir(), "bancada-walk-"));
  for (const [rel, body] of Object.entries(spec)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
};

test("files come back relative to the root, with forward slashes", () => {
  const root = tree({ "a.ts": "", "src/deep/b.ts": "" });
  try {
    assert.deepEqual(walkFiles(root).files.sort(), ["a.ts", "src/deep/b.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated directories are skipped, bancada's own output included", () => {
  // `.bancada/` holds the telemetry stream and the boundary's own state file.
  // Walking into it would let the instrument read its own output as a reading.
  const root = tree({
    "src/a.ts": "",
    "node_modules/dep/index.js": "",
    "dist/a.js": "",
    ".git/HEAD": "",
    ".bancada/green-state.json": "",
  });
  try {
    assert.deepEqual(walkFiles(root).files, ["src/a.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreadable directory is skipped rather than losing the whole answer", () => {
  const readdir = (dir, opts) => {
    if (String(dir).endsWith("locked")) throw new Error("EACCES");
    if (String(dir) === "/root") {
      return [
        { name: "locked", isDirectory: () => true, isFile: () => false },
        { name: "a.ts", isDirectory: () => false, isFile: () => true },
      ];
    }
    return [];
  };
  const r = walkFiles("/root", { readdir });
  assert.deepEqual(r.files, ["a.ts"]);
  assert.equal(r.truncated, false);
});

test("a walk that hits its ceiling says so", () => {
  // A truncated list makes a glob look like it matches nothing. A caller that
  // cannot tell that from a clean answer draws a wrong conclusion from both.
  const readdir = () => Array.from({ length: MAX_WALK_FILES + 10 }, (_, i) => ({
    name: `f${i}.ts`,
    isDirectory: () => false,
    isFile: () => true,
  }));
  const r = walkFiles("/root", { readdir });
  assert.equal(r.truncated, true);
});

test("an empty tree is an empty list, not a truncated one", () => {
  const root = tree({});
  try {
    assert.deepEqual(walkFiles(root), { files: [], truncated: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
