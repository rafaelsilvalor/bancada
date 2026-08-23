/**
 * The record of what the gates did, so the harness can be judged instead of
 * believed.
 *
 * Four rules hold here, and three of them are scar tissue from a previous
 * harness rather than taste.
 *
 * **Emission never changes a verdict.** Nothing in this file throws, on any
 * path. A gate that refuses a commit because its metrics writer hit a full disk
 * is worse than a gate with no metrics: it fails in a way nobody can explain,
 * and it teaches people to switch the whole thing off.
 *
 * **The content is never written, only a digest of it.** A commit message can
 * carry anything. The stream needs to recognise the same input twice, which a
 * truncated hash does, and it needs nothing else.
 *
 * **An absent input hashes to the empty string, not to the digest of "".** If
 * every input-less event shared one digest, they would look like the same
 * recurring input — corrupting the exact measurement the stream exists to make.
 *
 * **A record carries every check that ran, not one per check.** One dispatcher
 * means one writer and one line per tool call, so the reader never has to
 * reassemble a decision from several rows that may or may not all be there.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const STREAM_FILE = "gates.jsonl";

/**
 * Keys in a fixed order, so a stream stays diffable and greppable.
 *
 * Exported because the order is a contract now, not an implementation detail:
 * bancada-flow appends to the same stream without importing this module, and a
 * test in that plugin pins its copy of this list against this one.
 */
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

/**
 * Truncated digest of an input.
 *
 * Returns "" for anything absent or empty. Two different events with no input
 * must not collide on a shared digest and read as one input seen twice.
 */
export function hashInput(value) {
  if (value === undefined || value === null || value === "") return "";
  try {
    return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
  } catch {
    return "";
  }
}

/** Build a record. Pure, so the shape can be asserted without touching a disk. */
export function buildRecord({ input, verdict, event, startedAt, now, env = process.env }) {
  const command = input?.tool_input?.command;
  const record = {
    ts: new Date(now).toISOString(),
    session: input?.session_id ?? "",
    event,
    tool: input?.tool_name ?? "",
    agent: input?.agent_type ?? undefined,
    decision: verdict?.decision ?? "allow",
    check: verdict?.check ?? "none",
    rule: verdict?.rule ?? undefined,
    inputKind: typeof command === "string" && command !== "" ? "command" : "none",
    inputHash: hashInput(command),
    durationMs: typeof startedAt === "number" ? Math.round(now - startedAt) : undefined,
    effort: input?.effort?.level ?? env.CLAUDE_EFFORT ?? undefined,
    checks: (verdict?.verdicts ?? []).map((v) => ({
      name: v.check,
      ...(v.rule && v.rule !== v.check ? { rule: v.rule } : {}),
      decision: v.decision,
      ...(v.error ? { error: v.error } : {}),
    })),
  };

  // Drop absent optional fields rather than writing nulls: a key that is not
  // there is honest about not being known, where `"agent": ""` looks like a
  // measurement that came back blank.
  const ordered = {};
  for (const key of RECORD_KEYS) {
    if (record[key] !== undefined) ordered[key] = record[key];
  }
  return ordered;
}

/** Absolute path of the stream for a project. */
export function streamPath(projectDir, config) {
  return join(projectDir, config?.telemetry?.dir ?? ".bancada/telemetry", STREAM_FILE);
}

/**
 * Append one record. Returns true when it was written, false otherwise.
 *
 * The return value exists for the tests. No caller should branch on it: there
 * is nothing useful to do about a failed write in the middle of a tool call,
 * which is the whole point.
 */
export function emit(projectDir, config, record) {
  try {
    if (!config?.telemetry?.enabled) return false;
    const file = streamPath(projectDir, config);
    mkdirSync(join(file, ".."), { recursive: true });
    // One write of one line. Short appends do not interleave in practice, and
    // the reader counts damaged lines rather than trusting that they cannot
    // happen.
    appendFileSync(file, JSON.stringify(record) + "\n");
    return true;
  } catch {
    return false;
  }
}

/**
 * Record the outcome of a dispatch. Never throws, whatever it is handed.
 *
 * This is the only function a hook should call.
 */
export function record({ projectDir, config, input, verdict, event, startedAt, now = Date.now() }) {
  try {
    return emit(projectDir, config, buildRecord({ input, verdict, event, startedAt, now }));
  } catch {
    return false;
  }
}
