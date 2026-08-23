/**
 * What a write tool is doing, in the one place four checks can agree on it.
 *
 * The tools that write a file do not agree on the shape of their input: `Write`
 * carries `content`, `Edit` carries `old_string` and `new_string`, `MultiEdit`
 * carries a list of those, and `NotebookEdit` carries `new_source`. Four checks
 * now need the answer to "which file, and what text", and four private copies of
 * this mapping would drift the day a fifth tool appears.
 *
 * Two different questions live here, and they are not interchangeable.
 *
 * `introducedText` is the text this turn is *adding*. That is what the layering
 * and secret checks judge, because judging the whole file would refuse an edit
 * for lines nobody in this turn wrote.
 *
 * `resultingText` is what the file will *contain* afterwards, which needs the
 * current contents and is only meaningful for a check about the file as a whole.
 * It returns null when the answer cannot be known, and a caller that gets null
 * must abstain rather than guess.
 *
 * A write tool is not the only way a file gets written. `writeTargets` is the
 * answer to "which files does this tool call write", across both routes — see
 * `shell-writes.mjs` for what a command line gives up and what it does not.
 */

import { isShellTool } from "./commit-message.mjs";
import { shellWrites } from "./shell-writes.mjs";

/** Tools whose input describes a file being written. */
export const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** True when this tool call writes a file bancada can name. */
export function isWrite(input) {
  if (!WRITE_TOOLS.has(input?.tool_name)) return false;
  const path = input?.tool_input?.file_path;
  return typeof path === "string" && path !== "";
}

/**
 * Every file this tool call writes, whichever route it takes.
 *
 * Returns `[{ path, text, mode, form, toolInput? }]`. A write tool yields
 * exactly one target and always a readable one. A shell command yields however
 * many the patterns in `shell-writes.mjs` can find, and `text` is null on any
 * whose contents cannot be known from the command line.
 *
 * The three write gates read this instead of `isWrite`, which is what closes the
 * hole measured before it existed: the same layering violation was refused
 * through `Write` and allowed through `cat > file <<'EOF'`. `isWrite` stays, for
 * the questions that really are about a write tool.
 */
export function writeTargets(input) {
  if (isWrite(input)) {
    const toolInput = input.tool_input;
    return [
      {
        path: toolInput.file_path,
        text: introducedText(toolInput),
        mode: typeof toolInput.content === "string" ? "replace" : "edit",
        form: input.tool_name,
        toolInput,
      },
    ];
  }
  if (isShellTool(input?.tool_name) && typeof input?.tool_input?.command === "string") {
    return shellWrites(input.tool_input.command);
  }
  return [];
}

/**
 * What the file will contain once this target lands, or null when unknown.
 *
 * The write-tool route defers to `resultingText`, which knows the four input
 * shapes. The shell route already carries its text, so all that is left is
 * whether it replaces the file or is added to it — and an append with no
 * previous contents is the whole file, because the file does not exist yet.
 */
export function targetResult(target, current) {
  if (target?.toolInput) return resultingText(target.toolInput, current);
  if (typeof target?.text !== "string") return null;
  if (target.mode === "replace") return target.text;
  if (target.mode === "append") return typeof current === "string" ? current + target.text : target.text;
  return null;
}

/** The text a write tool is introducing, whatever shape the tool uses for it. */
export function introducedText(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  if (typeof toolInput.content === "string") return toolInput.content;
  if (typeof toolInput.new_string === "string") return toolInput.new_string;
  if (typeof toolInput.new_source === "string") return toolInput.new_source;
  if (Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .map((e) => (typeof e?.new_string === "string" ? e.new_string : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * What the file will contain once this tool call lands, or null when that
 * cannot be worked out.
 *
 * `Write` replaces the file, so its `content` is the answer outright. An edit is
 * applied to `current` rather than guessed at by arithmetic on line counts:
 * `replace_all` and a multi-line replacement both make the arithmetic wrong, and
 * applying the replacement is shorter than getting the arithmetic right.
 *
 * Null means "not known". A caller that treats null as zero would refuse or
 * approve on the strength of a number it invented.
 */
export function resultingText(toolInput, current) {
  if (!toolInput || typeof toolInput !== "object") return null;
  if (typeof toolInput.content === "string") return toolInput.content;

  // Every edit form below needs the file that is being edited.
  if (typeof current !== "string") return null;

  // The replacement goes in through a function, not as a string.
  // `String.replace` reads a dollar-sign sequence in a *replacement string* as a
  // pattern — the matched text, everything before it, everything after it, a
  // capture group — so a `new_string` carrying one produces a file the edit would
  // never have written, and the ceiling is then applied to that. Measured on this
  // module: an edit whose replacement carried the everything-before-the-match
  // sequence was refused as 545 lines when the file would have been 157. A false
  // refusal, in the hot path, on ordinary code — and it goes the other way too,
  // since a sequence can shrink the computed file below a ceiling the real one
  // breaks.
  //
  // The `replace_all` branch was already literal, because `Array.join`
  // interprets nothing. That asymmetry is what made this look right for as long
  // as it did: the branch with the harder arithmetic was the correct one.
  const apply = (text, edit) => {
    if (typeof edit?.old_string !== "string" || typeof edit?.new_string !== "string") return text;
    if (edit.old_string === "") return text;
    return edit.replace_all
      ? text.split(edit.old_string).join(edit.new_string)
      : text.replace(edit.old_string, () => edit.new_string);
  };

  if (Array.isArray(toolInput.edits)) {
    return toolInput.edits.reduce(apply, current);
  }
  if (typeof toolInput.old_string === "string") {
    return apply(current, toolInput);
  }
  return null;
}

/**
 * Lines in a chunk of text.
 *
 * A trailing newline terminates the last line rather than starting an empty
 * one, which is what `wc -l` counts and what an editor shows.
 */
export function countLines(text) {
  if (typeof text !== "string" || text === "") return 0;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split(/\r?\n/).length;
}
