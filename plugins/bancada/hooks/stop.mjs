#!/usr/bin/env node
/**
 * The single `Stop` entry point.
 *
 * Same shape as the tool-call dispatcher, with one difference that is the whole
 * reason this file exists separately: `Stop` has no exit-2 form. A refusal here
 * travels as JSON on stdout with exit 0, so the translation from a check's
 * `deny` to the host's `block` happens here and nowhere else. The checks
 * themselves say what they decided and know nothing about which channel carries
 * it, which is what keeps a second host cheap.
 *
 * A check that has no verdict but something to say — a boundary that could not
 * start — travels as a note. Allowing in silence would leave a configured gate
 * that never runs looking exactly like a gate that always passes.
 */

import { runGate, readHookInput, allow, blockStop, note } from "../lib/hook-io.mjs";
import { loadConfig } from "../lib/config.mjs";
import { dispatch } from "../lib/dispatch.mjs";
import { STOP_CHECKS } from "../lib/checks/stop.mjs";
import { record } from "../lib/telemetry.mjs";

await runGate(async () => {
  const startedAt = Date.now();
  const input = readHookInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const { config } = loadConfig(projectDir);
  // Not `eventOf`, which defaults to PreToolUse for an unnamed payload: this
  // entry point is only ever reached on a stop, and a record that says otherwise
  // would put a false event in the stream.
  const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "Stop";

  const verdict = await dispatch(input, config, STOP_CHECKS, "Stop");

  record({ projectDir, config, input, verdict, event, startedAt });

  if (verdict.decision === "deny") blockStop(verdict.reason);

  const notes = verdict.verdicts.map((v) => v.note).filter((n) => typeof n === "string" && n !== "");
  if (notes.length > 0) note(notes.join("\n\n"));

  allow();
});
