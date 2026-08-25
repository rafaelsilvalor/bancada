import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjectFiles, uncoveredDirs } from "./files.mjs";

// --- who answered, and what happens when git cannot ---

test("git's answer is preferred and labelled as git's", () => {
  const r = listProjectFiles(".", { git: () => ["a.mjs", "b.mjs"], walk: () => ({ files: [], truncated: false }) });
  assert.deepEqual(r, { files: ["a.mjs", "b.mjs"], source: "git", truncated: false });
});

test("outside a repository the walk answers, and a truncated walk says so", () => {
  const r = listProjectFiles(".", { git: () => null, walk: () => ({ files: ["a.mjs"], truncated: true }) });
  assert.equal(r.source, "walk");
  assert.equal(r.truncated, true, "a truncated list makes a glob look like it matches nothing");
});

// --- the real git path, in a throwaway repository ---
//
// The injected fakes above cannot see the one behaviour that matters most to
// the colocation gate: `ls-files --cached` keeps listing a file deleted from
// the working tree until the deletion is staged, so a test removed with `rm`
// would keep counting as coverage until the next commit. Only a real repository
// exercises the subtraction.

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "bancada-files-"));
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.mjs"), "export const a = 1;\n");
  writeFileSync(join(dir, "src", "a.test.mjs"), "export const t = 1;\n");
  git("add", "-A");
  return dir;
}

test("a file deleted from the working tree stops being listed before the deletion is staged", () => {
  const dir = repo();
  try {
    const before = listProjectFiles(dir);
    assert.equal(before.source, "git");
    assert.ok(before.files.includes("src/a.test.mjs"));

    unlinkSync(join(dir, "src", "a.test.mjs"));
    const after = listProjectFiles(dir);
    assert.ok(!after.files.includes("src/a.test.mjs"), "an unstaged rm must not keep counting as coverage");
    assert.ok(after.files.includes("src/a.mjs"), "the module itself is still there");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an untracked file is listed, so a test written this turn already counts", () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, "src", "fresh.mjs"), "export const f = 1;\n");
    assert.ok(listProjectFiles(dir).files.includes("src/fresh.mjs"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- blind spots ---

test("uncoveredDirs names only the top-level directories no glob reaches, largest first", () => {
  const files = ["src/a.mjs", "docs/x.md", "docs/y.md", "scripts/z.sh", "README.md"];
  const covered = (f) => f.startsWith("src/");
  assert.deepEqual(uncoveredDirs(files, covered), [
    { dir: "docs", files: 2 },
    { dir: "scripts", files: 1 },
    { dir: ".", files: 1 },
  ]);
});

test("a directory with one covered file is not a blind spot", () => {
  const files = ["src/a.mjs", "src/b.md"];
  assert.deepEqual(uncoveredDirs(files, (f) => f === "src/a.mjs"), []);
});
