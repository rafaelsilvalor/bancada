import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint, readState, statePath, writeState } from "./green-state.mjs";

/** A throwaway project directory with the named files in it. */
function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bancada-state-"));
  for (const [rel, content] of Object.entries(files)) {
    const parts = rel.split("/");
    if (parts.length > 1) mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const within = (files, body) => {
  const dir = project(files);
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// --- the fingerprint ---

test("the same files with the same contents digest the same", () => {
  within({ "a.ts": "one", "b.ts": "two" }, (dir) => {
    assert.equal(fingerprint(dir, ["a.ts", "b.ts"]), fingerprint(dir, ["a.ts", "b.ts"]));
  });
});

test("the order the files arrive in does not change the digest", () => {
  within({ "a.ts": "one", "b.ts": "two" }, (dir) => {
    assert.equal(fingerprint(dir, ["a.ts", "b.ts"]), fingerprint(dir, ["b.ts", "a.ts"]));
  });
});

test("an edit changes the digest, which is the whole point", () => {
  within({ "a.ts": "one" }, (dir) => {
    const before = fingerprint(dir, ["a.ts"]);
    writeFileSync(join(dir, "a.ts"), "one edited");
    assert.notEqual(fingerprint(dir, ["a.ts"]), before);
  });
});

test("an edit that keeps the length is still seen, because contents are hashed", () => {
  // A timestamp-and-size comparison would miss this, and missing it means
  // skipping the check — the unsafe direction.
  within({ "a.ts": "aaa" }, (dir) => {
    const before = fingerprint(dir, ["a.ts"]);
    writeFileSync(join(dir, "a.ts"), "bbb");
    assert.notEqual(fingerprint(dir, ["a.ts"]), before);
  });
});

test("a file appearing or vanishing changes the digest", () => {
  within({ "a.ts": "one" }, (dir) => {
    const one = fingerprint(dir, ["a.ts"]);
    assert.notEqual(fingerprint(dir, ["a.ts", "b.ts"]), one, "a new path counts");
    assert.notEqual(fingerprint(dir, []), one);
  });
});

test("an unreadable path does not hash the same as an empty file", () => {
  within({ "empty.ts": "" }, (dir) => {
    assert.notEqual(fingerprint(dir, ["missing.ts"]), fingerprint(dir, ["empty.ts"]));
  });
});

test("an unknown file list is null, and null is not a digest", () => {
  within({}, (dir) => {
    assert.equal(fingerprint(dir, null), null);
    assert.equal(fingerprint(dir, undefined), null);
  });
});

// --- the state file ---

test("what was written is what comes back, for the same session", () => {
  within({}, (dir) => {
    assert.equal(writeState(dir, { session: "s1", fingerprint: "abc", blocks: 2 }), true);
    assert.deepEqual(readState(dir, "s1"), { session: "s1", fingerprint: "abc", blocks: 2 });
  });
});

test("state belonging to another session is discarded, not adopted", () => {
  // Two sessions in one checkout would otherwise read each other's fingerprints,
  // and trusting a stranger's means skipping a check.
  within({}, (dir) => {
    writeState(dir, { session: "s1", fingerprint: "abc", blocks: 2 });
    assert.equal(readState(dir, "s2"), null);
  });
});

test("no state file is null rather than an exception", () => {
  within({}, (dir) => assert.equal(readState(dir, "s1"), null));
});

test("a damaged state file is null rather than an exception", () => {
  within({ ".bancada/green-state.json": "{ not json" }, (dir) => {
    assert.equal(readState(dir, "s1"), null);
  });
});

test("a write that cannot happen returns false rather than throwing", () => {
  const throwing = () => {
    throw new Error("EACCES");
  };
  assert.equal(writeState("/proj", { session: "s1" }, { write: throwing, mkdir: () => {} }), false);
  assert.equal(writeState("/proj", { session: "s1" }, { mkdir: throwing }), false);
});

test("the state lives beside the telemetry, so one ignore entry covers both", () => {
  assert.match(statePath("/proj").replace(/\\/g, "/"), /\/proj\/\.bancada\/green-state\.json$/);
});
