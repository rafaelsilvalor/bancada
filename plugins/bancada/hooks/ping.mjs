/**
 * Phase 1 plumbing probe. Not a gate.
 *
 * It exists to answer one question with evidence instead of assumption: does a
 * plugin-supplied hook actually fire, does `${CLAUDE_PLUGIN_ROOT}` resolve, and
 * does the exec form (`command` + `args`) spawn node on this platform?
 *
 * It never blocks. It reports what it saw and exits 0. Delete it once a real
 * gate covers the same path.
 */
import { readFileSync } from "node:fs";

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const input = readStdin();
const seen = [
  `event=${input.hook_event_name ?? "?"}`,
  `tool=${input.tool_name ?? "?"}`,
  `cwd=${input.cwd ? "set" : "unset"}`,
  `effort=${process.env.CLAUDE_EFFORT ?? input.effort?.level ?? "?"}`,
  `pluginRoot=${process.env.CLAUDE_PLUGIN_ROOT ? "set" : "unset"}`,
  `projectDir=${process.env.CLAUDE_PROJECT_DIR ? "set" : "unset"}`,
].join(" ");

process.stdout.write(
  JSON.stringify({
    systemMessage: `bancada ping — hook fired. ${seen}`,
  }),
);
process.exit(0);
