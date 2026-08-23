/**
 * The three Pauses.
 *
 * There are three because there are four roles, and a Pause is a handover. The
 * planner hands a brief to the test role, the test role hands a failing test to
 * the code role, and the code role hands finished work back. Each handover is a
 * point where the work changes hands and nobody has looked at it yet, which is
 * the cheapest moment to look and the last cheap one.
 *
 *   1  brief     nothing in scope is written until a brief exists and validates
 *   2  tests     the code role does not write code until a test exists
 *   3  evidence  a commit against an unsatisfied brief asks before it lands
 *
 * **They are ordered, and the first refusal wins.** bancada's own dispatcher
 * reports every refusal at once, on the argument that handing back one problem
 * at a time turns one refusal into a sequence of them. That argument does not
 * hold here: Pause 2 has nothing to say if there is no brief, and Pause 3 reads
 * a document Pause 1 is still refusing to let you skip. Reporting all three
 * would be reporting two consequences of the first.
 *
 * **Pause 3 asks; it does not refuse.** An unsatisfied brief at commit time
 * usually means an intermediate commit, which is ordinary and correct. It
 * sometimes means somebody is about to call unfinished work finished. The gate
 * cannot tell those apart, and a gate that cannot tell escalates rather than
 * guessing — the same rule the commit gate follows for a message it cannot read.
 *
 * **The evidence for any of this being worth its friction is conviction, not
 * measurement.** That is why the plugin ships disabled, and why every Pause
 * writes a telemetry record: `bancada yield` is where the claim gets tested.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { briefIsSatisfied, validateBrief } from "./brief.mjs";
import { pauseEnabled } from "./config.mjs";
import { compileGlobs, normalisePath } from "./glob.mjs";
import { toProjectRelative } from "./paths.mjs";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

/**
 * Whether a command runs `git commit`.
 *
 * A simplification of the detector in bancada's commit gate, which this plugin
 * cannot import. It does not handle git's global options that take a separate
 * argument, so it can miss `git -C /repo commit`. Missing one means no question
 * is asked, which is the direction that costs least: Pause 3 escalates rather
 * than refuses, so a miss loses a prompt, not a guarantee.
 */
export function isCommit(command) {
  return typeof command === "string" && /(^|[;&|]|\n)\s*git\s+(?:-\S+\s+)*commit\b/.test(command);
}

/**
 * The branch a brief belongs to, or null when it cannot be named.
 *
 * Read out of `.git/HEAD` rather than asked of `git rev-parse`. The obvious
 * version spawned git, and spawning git on Windows measured at 49 ms — paid on
 * every matching tool call, to learn something that is one line in a file whose
 * format has not changed in twenty years. A linked worktree keeps `.git` as a
 * file naming the real directory, which is handled here because this repository
 * is one and the first version returned null in it.
 */
export function currentBranch(projectDir, { readFile = readFileSync } = {}) {
  const gitDirOf = (dir) => {
    const dot = join(dir, ".git");
    try {
      const asFile = readFile(dot, "utf8");
      const m = /^gitdir:\s*(.+)$/m.exec(asFile);
      if (!m) return null;
      const target = m[1].trim();
      return target.match(/^([a-zA-Z]:)?[/\\]/) ? target : join(dir, target);
    } catch {
      // Not a file, so either a directory (the ordinary case) or absent.
      return dot;
    }
  };

  const gitDir = gitDirOf(projectDir);
  if (gitDir === null) return null;
  let head;
  try {
    head = readFile(join(gitDir, "HEAD"), "utf8");
  } catch {
    return null;
  }
  const ref = /^ref:\s*refs\/heads\/(.+)$/m.exec(head);
  // No `ref:` line is a detached checkout: there is no branch, so there is no
  // brief to find, and inventing one would attach the work to a name that will
  // not exist tomorrow.
  return ref ? ref[1].trim() : null;
}

/** Where this branch's brief lives. Slashes become dashes; the path stays flat. */
export function briefPathFor(briefDir, branch) {
  return normalisePath(join(briefDir || "docs/briefs/", `${String(branch).replace(/[/\\]/g, "-")}.md`));
}

const readBrief = (projectDir, path, readFile) => {
  try {
    return readFile(join(projectDir, path), "utf8");
  } catch {
    return null;
  }
};

const allow = (rule) => ({ decision: "allow", rule, reason: null });

/** Files this working tree has changed, for asking whether a test was written. */
export function changedFiles(projectDir, { spawn = spawnSync } = {}) {
  let r;
  try {
    r = spawn("git", ["-C", projectDir, "status", "--porcelain=v1", "-uall"], { encoding: "utf8" });
  } catch {
    return null;
  }
  if (r?.status !== 0 || typeof r.stdout !== "string") return null;
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const p = l.slice(3);
      const arrow = p.indexOf(" -> ");
      return normalisePath(arrow === -1 ? p : p.slice(arrow + 4)).replace(/^"|"$/g, "");
    });
}

// --- Pause 1: the brief ---

export function pauseBrief(target, config, io) {
  const { flow } = config;
  if (!compileGlobs(flow.scope ?? [])(target)) return allow("pause-brief-out-of-scope");
  // The brief itself has to be writable, or the only way to satisfy the Pause is
  // blocked by the Pause.
  if (target.startsWith(normalisePath(flow.briefDir))) return allow("pause-brief-authoring");

  const branch = io.branch();
  if (branch === null) {
    return {
      decision: "ask",
      rule: "pause-brief-unbranched",
      reason:
        "bancada-flow could not name the current branch, so it cannot tell which brief " +
        "this work belongs to. Confirm the work is briefed, or check out a branch.",
    };
  }

  const path = briefPathFor(flow.briefDir, branch);
  const text = io.readBrief(path);
  if (text === null) {
    return {
      decision: "deny",
      rule: "pause-brief-missing",
      reason: [
        `Pause 1: nothing in scope is written until this branch has a brief.`,
        "",
        `Expected: ${path}`,
        "",
        "Write it with /bancada-flow:brief, or by hand: a title, ## Problem,",
        "## Done when as checkboxes, ## Not doing, and ## How it will be checked.",
        "The brief itself is always writable; this Pause never blocks its own remedy.",
      ].join("\n"),
    };
  }

  const { errors } = validateBrief(text);
  if (errors.length > 0) {
    return {
      decision: "deny",
      rule: "pause-brief-invalid",
      reason: [`Pause 1: ${path} does not yet read as a brief.`, "", ...errors.map((e) => `  ${e}`)].join("\n"),
    };
  }

  return allow("pause-brief-ok");
}

// --- Pause 2: a test before the code ---

export function pauseTests(target, agentType, config, io) {
  const { flow, pair } = config;
  if (!compileGlobs(flow.scope ?? [])(target)) return allow("pause-tests-out-of-scope");

  const isTestFile = compileGlobs(pair.testGlobs ?? [])(target);
  if (isTestFile) return allow("pause-tests-writing-a-test");

  // The only Pause that needs a role, because it is the only one whose question
  // — is it the code role's turn yet — has no answer without one. A session that
  // entered no role is not doing this handover.
  const agent = String(agentType ?? "").trim().toLowerCase();
  if (agent !== String(pair.codeAgent ?? "").trim().toLowerCase()) return allow("pause-tests-no-role");

  const changed = io.changedFiles();
  if (changed === null) return allow("pause-tests-unknown");

  const match = compileGlobs(pair.testGlobs ?? []);
  if (changed.some(match)) return allow("pause-tests-ok");

  return {
    decision: "deny",
    rule: "pause-tests-missing",
    reason: [
      `Pause 2: the "${pair.codeAgent}" role does not open ${target} before a test exists.`,
      "",
      "Nothing matching this project's test globs has changed on this branch, so",
      "there is no statement of the intended behaviour for the code to satisfy.",
      `Hand back to the "${pair.testAgent}" role, or write the test first.`,
      "",
      "A test written after the code it describes is shaped to the code. That is",
      "the failure this handover exists to prevent, and it is invisible afterwards.",
    ].join("\n"),
  };
}

// --- Pause 3: the evidence ---

export function pauseEvidence(command, config, io) {
  if (!isCommit(command)) return allow("pause-evidence-not-a-commit");

  const branch = io.branch();
  if (branch === null) return allow("pause-evidence-unbranched");

  const path = briefPathFor(config.flow.briefDir, branch);
  const text = io.readBrief(path);
  // No brief is Pause 1's business, not this one's. Two Pauses refusing the same
  // absence would report one problem twice.
  if (text === null) return allow("pause-evidence-no-brief");

  const { satisfied, open, unevidenced, criteria } = briefIsSatisfied(text);
  if (satisfied) return allow("pause-evidence-ok");

  const lines = [
    `Pause 3: ${path} does not yet say this work is done.`,
    "",
    `${criteria.length - open.length} of ${criteria.length} criteria are ticked.`,
  ];
  if (open.length > 0) {
    lines.push("", "Still open:", ...open.map((c) => `  - ${c.text}`));
  }
  if (unevidenced.length > 0) {
    lines.push(
      "",
      "Ticked with nothing underneath, which is the claim without the evidence:",
      ...unevidenced.map((c) => `  - ${c.text}`),
      "",
      "Put the command and its result on an indented line beneath each one.",
    );
  }
  lines.push(
    "",
    "If this is an intermediate commit, that is ordinary — confirm and carry on.",
    "If it is not, the brief is the thing to fix before the commit is.",
  );

  return { decision: "ask", rule: "pause-evidence-open", reason: lines.join("\n") };
}

// --- the fold ---

/**
 * Run whichever Pauses apply, and return the first that has something to say.
 *
 * First-refusal rather than every-refusal, because these are stages: the later
 * ones read artifacts the earlier ones are still insisting on.
 */
export function checkPauses(input, config, deps = {}) {
  const projectDir = deps.projectDir ?? process.cwd();
  const io = {
    branch: deps.branch ?? (() => currentBranch(projectDir, deps)),
    readBrief: deps.readBrief ?? ((p) => readBrief(projectDir, p, deps.readFile ?? readFileSync)),
    changedFiles: deps.changedFiles ?? (() => changedFiles(projectDir, deps)),
  };

  const tool = input?.tool_name;
  const verdicts = [];

  if (WRITE_TOOLS.has(tool) && typeof input?.tool_input?.file_path === "string") {
    // Write and Edit hand over an absolute path; the scope globs are written
    // relative to the project. Skipping this reconciliation is how a gate reads
    // every write as out of scope and reports success — see paths.mjs.
    const target = deps.target ?? toProjectRelative(input.tool_input.file_path, projectDir);
    if (pauseEnabled(config, "brief")) verdicts.push(pauseBrief(target, config, io));
    if (pauseEnabled(config, "tests")) verdicts.push(pauseTests(target, input.agent_type, config, io));
  }
  if (SHELL_TOOLS.has(tool) && pauseEnabled(config, "evidence")) {
    verdicts.push(pauseEvidence(input.tool_input?.command, config, io));
  }

  // The speaking verdict decides; every verdict is kept for the record. Without
  // that, a run where all three Pauses allowed would report only the first, and
  // the report could never answer how often Pause 2 looked — which is half of
  // asking whether a Pause is worth its friction.
  const speaking = verdicts.find((v) => v.decision !== "allow");
  return { ...(speaking ?? verdicts[0] ?? allow("pause-none")), verdicts };
}
