/**
 * The hook contract: how a gate reads its input and states its verdict.
 *
 * Claude Code gives a hook three channels, and they do not mean the same thing:
 *
 *   exit 0, no output   the gate has no objection; normal permission flow continues
 *   exit 2 + stderr     the gate refuses; stderr is the reason and reaches the model
 *   exit 0 + stdout     a structured decision, for verdicts exit codes cannot express
 *
 * Two rules hold everywhere in this file.
 *
 * A gate that cannot decide must not block. If reading the config throws, or a
 * child process dies, the answer is `abstain`, not `deny`. A harness whose own
 * breakage stops the user's work is worse than no harness, and it teaches people
 * to disable it, which costs every gate at once.
 *
 * Nothing here throws. Every path ends in an exit code.
 */

import { readFileSync } from "node:fs";

export const EXIT_ALLOW = 0;
export const EXIT_DENY = 2;

/** Parse a hook payload. Malformed or empty input yields `{}`, never an exception. */
export function parseHookInput(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read the payload from stdin.
 *
 * A hook with no stdin, or with stdin closed, gets `{}` and carries on. That is
 * the difference between a gate that abstains and a gate that crashes the turn.
 */
export function readHookInput() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }
  return parseHookInput(raw);
}

/** The event name from a payload, defaulting to `PreToolUse`. */
export function eventOf(input) {
  const name = input?.hook_event_name;
  return typeof name === "string" && name !== "" ? name : "PreToolUse";
}

/** The effort level for the turn, from the payload or the environment. */
export function effortOf(input, env = process.env) {
  return input?.effort?.level ?? env.CLAUDE_EFFORT ?? null;
}

// --- verdict builders: pure, so a test can assert the shape without a process ---

/** Structured "ask the owner" verdict. Carries the event it belongs to. */
export function buildAsk(reason, event = "PreToolUse") {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      permissionDecision: "ask",
      permissionDecisionReason: String(reason),
    },
  };
}

/**
 * Structured "do not end the turn" verdict, for `Stop` and `SubagentStop`.
 * Those events have no exit-2 form; the block has to travel as JSON.
 */
export function buildBlockStop(reason) {
  return { decision: "block", reason: String(reason) };
}

/** A message shown to the person, carrying no verdict. */
export function buildNote(message) {
  return { systemMessage: String(message) };
}

// --- emitters: each one ends the process ---

function emit(payload, code, out = process.stdout) {
  try {
    out.write(JSON.stringify(payload));
  } catch {
    // A verdict that cannot be serialised must not become a crash. Abstaining
    // is the safe direction: the tool call proceeds under normal permissions.
  }
  process.exit(code);
}

/** No objection. */
export function allow() {
  process.exit(EXIT_ALLOW);
}

/**
 * Refuse the tool call. `reason` goes to the model, so write it as an
 * instruction the model can act on, not as a log line.
 */
export function deny(reason, err = process.stderr) {
  try {
    err.write(String(reason));
  } catch {
    /* stderr is the last channel there is; there is nowhere left to report */
  }
  process.exit(EXIT_DENY);
}

/** Hand the decision to the person. */
export function ask(reason, event = "PreToolUse") {
  emit(buildAsk(reason, event), EXIT_ALLOW);
}

/** Refuse to let the turn end. */
export function blockStop(reason) {
  emit(buildBlockStop(reason), EXIT_ALLOW);
}

/** Say something without deciding anything. */
export function note(message) {
  emit(buildNote(message), EXIT_ALLOW);
}

/**
 * The gate could not run. Report why, then get out of the way.
 *
 * This is deliberately not `deny`. A configuration error, a missing binary or
 * an unreadable file is bancada's problem, and making it the user's problem
 * turns every bancada bug into a work stoppage.
 */
export function abstain(reason, err = process.stderr) {
  try {
    err.write("bancada abstained: " + String(reason) + "\n");
  } catch {
    /* nothing left to do */
  }
  process.exit(EXIT_ALLOW);
}

/**
 * Run a gate body, abstaining on any thrown error.
 *
 * Every hook entry point should be wrapped in this. It is the single place that
 * guarantees a bug in one gate cannot block a tool call.
 */
export async function runGate(body) {
  try {
    await body();
  } catch (e) {
    abstain(e?.stack || e?.message || String(e));
  }
  // A body that returns without emitting has no objection.
  allow();
}
