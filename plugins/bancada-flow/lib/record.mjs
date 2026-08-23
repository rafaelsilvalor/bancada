/**
 * Writing a Pause's verdict into bancada's telemetry stream.
 *
 * The integration is through the file format, not through an import. bancada
 * publishes the shape of a record and `bancada yield` reads it; a second plugin
 * appending records in that shape needs no access to the first plugin's code,
 * only agreement about the format. `pinned.test.mjs` holds the two sides
 * together by importing bancada's key list and this writer's and failing when
 * they diverge.
 *
 * Everything the telemetry module promises holds here too, for the same reasons.
 * Nothing throws, on any path: a Pause that refused a write because its metrics
 * file was unwritable would be the worst kind of gate, one that fails in a way
 * nobody can explain. Content is never written, only a truncated digest.
 *
 * This is the plugin with the weakest evidence behind it, which makes the stream
 * matter more here than anywhere else. A Pause is friction by design, and the
 * only honest way to find out whether it is worth what it costs is to count what
 * it caught.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** Must match bancada's `RECORD_KEYS`, in the same order. */
export const RECORD_KEYS = [
  "ts",
  "session",
  "event",
  "tool",
  "agent",
  "decision",
  "check",
  "rule",
  "inputKind",
  "inputHash",
  "durationMs",
  "effort",
  "checks",
];

/** Must match bancada's telemetry defaults. */
export const DEFAULT_TELEMETRY_DIR = ".bancada/telemetry";
export const STREAM_FILE = "gates.jsonl";

/**
 * The gate name this plugin writes, for the whole plugin, with the Pause in
 * `rule`. The report then reads "flow applied 40 times, and here is which Pause
 * spoke", which is the question worth asking of a process nobody has proved yet.
 *
 * Exported because it is the name `bancada yield` looks for when it reports a
 * gate that should have fired and did not. bancada declares its own copy in
 * `lib/checks/index.mjs`; `pinned.test.mjs` fails if the two ever differ, which
 * is the same trade as the other things duplicated across this boundary.
 */
export const CHECK_NAME = "flow";

/** Truncated digest of an input; "" for anything absent, never the hash of "". */
export function hashInput(value) {
  if (value === undefined || value === null || value === "") return "";
  try {
    return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
  } catch {
    return "";
  }
}

/** Build a record for one Pause verdict. Pure. */
export function buildRecord({ input, verdict, startedAt, now, env = process.env }) {
  const command = input?.tool_input?.command;
  const record = {
    ts: new Date(now).toISOString(),
    session: input?.session_id ?? "",
    event: "PreToolUse",
    tool: input?.tool_name ?? "",
    agent: input?.agent_type ?? undefined,
    decision: verdict?.decision ?? "allow",
    check: CHECK_NAME,
    rule: verdict?.rule ?? undefined,
    inputKind: typeof command === "string" && command !== "" ? "command" : "none",
    inputHash: hashInput(command),
    durationMs: typeof startedAt === "number" ? Math.round(now - startedAt) : undefined,
    effort: input?.effort?.level ?? env.CLAUDE_EFFORT ?? undefined,
    // Every Pause that looked, not only the one that spoke. A report that saw
    // just the speaker could count refusals and never the denominator they came
    // out of, which for a process nobody has measured is the half that matters.
    checks: (verdict?.verdicts?.length ? verdict.verdicts : [verdict ?? {}]).map((v) => ({
      name: CHECK_NAME,
      ...(v.rule ? { rule: v.rule } : {}),
      decision: v.decision ?? "allow",
    })),
  };

  const ordered = {};
  for (const key of RECORD_KEYS) {
    if (record[key] !== undefined) ordered[key] = record[key];
  }
  return ordered;
}

/** Append one record. Never throws; the return value exists for the tests. */
export function record({ projectDir, telemetryDir, input, verdict, startedAt, now = Date.now() }) {
  try {
    const file = join(projectDir ?? ".", telemetryDir || DEFAULT_TELEMETRY_DIR, STREAM_FILE);
    mkdirSync(join(file, ".."), { recursive: true });
    appendFileSync(file, JSON.stringify(buildRecord({ input, verdict, startedAt, now })) + "\n");
    return true;
  } catch {
    return false;
  }
}
