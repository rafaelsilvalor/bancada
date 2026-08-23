import { test } from "node:test";
import assert from "node:assert/strict";
import { countLines, introducedText, isWrite, resultingText } from "./writes.mjs";

const NL = String.fromCharCode(10);
const src = (...lines) => lines.join(NL);

// --- which tool call is a write ---

test("a write tool with a file path is a write; anything else is not", () => {
  assert.equal(isWrite({ tool_name: "Write", tool_input: { file_path: "a.ts" } }), true);
  assert.equal(isWrite({ tool_name: "Edit", tool_input: { file_path: "a.ts" } }), true);
  assert.equal(isWrite({ tool_name: "Bash", tool_input: { file_path: "a.ts" } }), false);
  assert.equal(isWrite({ tool_name: "Write", tool_input: {} }), false);
  assert.equal(isWrite({ tool_name: "Write", tool_input: { file_path: "" } }), false);
  assert.equal(isWrite(null), false);
});

// --- the text being introduced ---

test("the introduced text is read from whichever field the tool uses", () => {
  assert.equal(introducedText({ content: "a" }), "a");
  assert.equal(introducedText({ new_string: "b" }), "b");
  assert.equal(introducedText({ new_source: "c" }), "c");
  assert.equal(introducedText({ edits: [{ new_string: "d" }, { new_string: "e" }] }), src("d", "e"));
  assert.equal(introducedText({}), "");
  assert.equal(introducedText(null), "");
});

// --- what the file will contain ---

test("a Write is the whole file, with or without anything there before", () => {
  assert.equal(resultingText({ content: "new" }, "old"), "new");
  assert.equal(resultingText({ content: "new" }, null), "new");
});

test("an edit is applied rather than approximated", () => {
  const current = src("a", "b", "c");
  assert.equal(resultingText({ old_string: "b", new_string: src("x", "y") }, current), src("a", "x", "y", "c"));
});

test("replace_all replaces every occurrence, which arithmetic on line counts would miss", () => {
  const current = src("x", "x", "x");
  assert.equal(resultingText({ old_string: "x", new_string: "y", replace_all: true }, current), src("y", "y", "y"));
  assert.equal(resultingText({ old_string: "x", new_string: "y" }, current), src("y", "x", "x"));
});

test("several edits compose in order", () => {
  const current = src("a", "b");
  const r = resultingText({ edits: [{ old_string: "a", new_string: "1" }, { old_string: "b", new_string: "2" }] }, current);
  assert.equal(r, src("1", "2"));
});

test("an edit with nothing to edit against is unknown, not empty", () => {
  // Null has to stay distinguishable from "" — a caller that read it as an
  // empty file would decide the file is zero lines long and allow anything.
  assert.equal(resultingText({ old_string: "a", new_string: "b" }, null), null);
  assert.equal(resultingText({}, "current"), null);
  assert.equal(resultingText(null, "current"), null);
});

test("an empty old_string does not splice the replacement in everywhere", () => {
  assert.equal(resultingText({ old_string: "", new_string: "x" }, "abc"), "abc");
});

// --- counting ---

test("a trailing newline terminates the last line rather than starting one", () => {
  assert.equal(countLines("a" + NL + "b"), 2);
  assert.equal(countLines("a" + NL + "b" + NL), 2);
  assert.equal(countLines("a"), 1);
  assert.equal(countLines(""), 0);
  assert.equal(countLines(null), 0);
});

test("carriage returns do not double the count", () => {
  const CR = String.fromCharCode(13);
  assert.equal(countLines("a" + CR + NL + "b" + CR + NL), 2);
});
