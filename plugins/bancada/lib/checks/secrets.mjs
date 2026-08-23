/**
 * The secret check, as a dispatcher entry.
 *
 * It looks at two kinds of tool call, because a credential arrives by two
 * routes. A write puts it in a file. A shell command puts it in the shell —
 * `export TOKEN=…`, a curl with an `Authorization` header, an `echo` into
 * `.env` — and that text is on the command line where the gate can read it.
 *
 * Nothing else is looked at. A credential typed into a tool bancada does not
 * match is invisible, which is stated here rather than left to be discovered.
 */

import { checkSecrets } from "../secrets.mjs";
import { isShellTool } from "../commit-message.mjs";
import { introducedText, isWrite } from "../writes.mjs";
import { relativeTarget } from "./where.mjs";

export const secretsCheck = {
  name: "secrets",
  event: "PreToolUse",

  applies(input, config) {
    if (!config.gates.secrets.enabled) return false;
    if (isWrite(input)) return true;
    return isShellTool(input.tool_name) && typeof input.tool_input?.command === "string";
  },

  run(input, config) {
    const write = isWrite(input);
    const text = write ? introducedText(input.tool_input) : input.tool_input.command;
    const where = write ? relativeTarget(input) : "this shell command";
    const result = checkSecrets(text, where, config.gates.secrets);
    return {
      decision: result.decision,
      check: secretsCheck.name,
      rule: result.rule,
      reason: result.reason,
    };
  },
};
