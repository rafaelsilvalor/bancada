import { test } from "node:test";
import assert from "node:assert/strict";
import { countLines, introducedText, isWrite, resultingText, targetResult, writeTargets } from "./writes.mjs";

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

/**
 * A replacement is text, not a pattern.
 *
 * `String.replace` reads a dollar-sign sequence in a replacement string as a
 * reference to the match, so the computed file was not the file the edit writes
 * — and the size gate judged the computed one. Found by being refused: an edit
 * to `writes.mjs` whose replacement carried the everything-before-the-match
 * sequence was reported as 545 lines for a file that would have been 157, in
 * this repository, by this gate, on a legitimate change. The `replace_all`
 * branch was already literal, which is why one branch of one function was wrong
 * while every test passed.
 */
test("a dollar sequence in the replacement is text, not a reference to the match", () => {
  const D = String.fromCharCode(36);
  const four = src("a", "b", "c", "d");
  for (const sequence of [D + "&", D + String.fromCharCode(96), D + "'", D + "1", D + D]) {
    const out = resultingText({ old_string: "c", new_string: sequence }, four);
    assert.equal(out, src("a", "b", sequence, "d"), `replacement ${sequence}`);
    assert.equal(countLines(out), 4, `${sequence} changed the line count`);
  }
});

test("the two replacement branches agree, which is what the asymmetry hid", () => {
  const D = String.fromCharCode(36);
  const edit = { old_string: "c", new_string: D + String.fromCharCode(96) + "x" };
  assert.equal(
    resultingText(edit, src("a", "b", "c")),
    resultingText({ ...edit, replace_all: true }, src("a", "b", "c")),
  );
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

// --- every file a tool call writes, whichever route it takes ---

test("a write tool yields one readable target, carrying its own tool input", () => {
  const targets = writeTargets({ tool_name: "Write", tool_input: { file_path: "a.mjs", content: "x" } });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].path, "a.mjs");
  assert.equal(targets[0].text, "x");
  assert.equal(targets[0].mode, "replace");
  assert.equal(targets[0].form, "Write");
});

test("an edit is mode edit, so the size gate applies it rather than counting it", () => {
  const targets = writeTargets({
    tool_name: "Edit",
    tool_input: { file_path: "a.mjs", old_string: "a", new_string: "b" },
  });
  assert.equal(targets[0].mode, "edit");
});

test("a shell command yields whatever its command line names", () => {
  const command = ["cat > src/lib/a.mjs <<'EOF'", "export const a = 1;", "EOF"].join(NL);
  const targets = writeTargets({ tool_name: "Bash", tool_input: { command } });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].path, "src/lib/a.mjs");
  assert.equal(targets[0].text, "export const a = 1;" + NL);
});

test("a tool call that writes nothing bancada can name yields no target", () => {
  assert.deepEqual(writeTargets({ tool_name: "Read", tool_input: { file_path: "a.mjs" } }), []);
  assert.deepEqual(writeTargets({ tool_name: "Bash", tool_input: { command: "npm test" } }), []);
  assert.deepEqual(writeTargets({ tool_name: "Bash", tool_input: {} }), []);
  assert.deepEqual(writeTargets(null), []);
});

// --- what the file ends up containing, per route ---

test("a shell replace is the whole file and a shell append is added to it", () => {
  assert.equal(targetResult({ text: "new", mode: "replace" }, "old"), "new");
  assert.equal(targetResult({ text: "new", mode: "append" }, "old" + NL), "old" + NL + "new");
});

test("an append to a file that is not there yet is the whole file", () => {
  assert.equal(targetResult({ text: "new", mode: "append" }, null), "new");
});

test("an unreadable target has no result, and unknown never reads as empty", () => {
  assert.equal(targetResult({ text: null, mode: "replace" }, "old"), null);
  assert.equal(targetResult({ text: "x", mode: "unknown" }, "old"), null);
});

test("a write-tool target defers to the four input shapes it already knew", () => {
  const target = writeTargets({
    tool_name: "Edit",
    tool_input: { file_path: "a.mjs", old_string: "a", new_string: "b" },
  })[0];
  assert.equal(targetResult(target, "a c"), "b c");
});
