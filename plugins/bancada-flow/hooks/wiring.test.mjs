/**
 * bancada-flow's entry point, spawned the way the host spawns it.
 *
 * This plugin had the least evidence of the three and the least coverage of its
 * wiring: `lib/pauses.mjs` is unit-tested, and the only thing that ever ran
 * `hooks/pre-tool-use.mjs` as a process was the paid sweep, at about $1.00 a
 * run. Two mutations to that file passed every one of the nine checks the CI ran
 * before this file existed — the import path pointed at a module that is not
 * there, and the branch that emits the refusal deleted.
 *
 * The plugin also has no `runGate`: it cannot import bancada's hook contract, so
 * it implements the exit codes and the JSON shape itself
 * (docs/decisions/0002-flow-ships-its-own-dispatcher.md). A second
 * implementation of a contract is exactly the thing to test against the contract
 * rather than against itself, so the assertions here are the same ones made of
 * bancada's own entry point.
 *
 * The disabled case is not a formality. The plugin ships `defaultEnabled: false`
 * and `flow.enabled` defaults to false, so the state a consumer is in by default
 * is "loaded and silent". A Pause that fired anyway would refuse writes in
 * projects that opted into nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The command the host would run, out of this plugin's own manifest. */
function declaredHook(event) {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"));
  const entries = manifest.hooks?.[event] ?? [];
  assert.equal(entries.length, 1, `hooks.json should declare exactly one ${event} entry`);
  const hooks = entries[0].hooks ?? [];
  assert.equal(hooks.length, 1, `the ${event} entry should declare exactly one hook`);
  const expand = (s) => String(s).split("${CLAUDE_PLUGIN_ROOT}").join(PLUGIN_ROOT);
  return {
    command: expand(hooks[0].command),
    args: (hooks[0].args ?? []).map(expand),
    matcher: entries[0].matcher ?? null,
  };
}

const BRIEF = [
  "# Add a thing to the library",
  "",
  "## Problem",
  "Callers work around the missing thing by hand.",
  "",
  "## Done when",
  "- [ ] the thing exists in src/lib",
  "",
  "## Not doing",
  "- the other thing",
  "",
  "## How it will be checked",
  "node --test",
  "",
].join("\n");

/**
 * A repository on `main`, so `docs/briefs/main.md` is the brief under test.
 *
 * The branch is read out of `.git/HEAD` rather than from `git rev-parse`, which
 * is the optimisation decision 0002 records; a sandbox with no repository would
 * exercise a different branch of that reader than the one consumers hit.
 */
function sandbox(config, { brief = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "flow-wiring-"));
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "bancada-flow wiring test");
  git("config", "user.email", "wiring@example.invalid");
  mkdirSync(join(dir, "src", "lib"), { recursive: true });
  writeFileSync(join(dir, "src", "lib", "seed.mjs"), "export const seed = 1;\n");
  if (brief) {
    mkdirSync(join(dir, "docs", "briefs"), { recursive: true });
    writeFileSync(join(dir, "docs", "briefs", "main.md"), BRIEF);
  }
  writeFileSync(join(dir, "bancada.config.json"), JSON.stringify(config, null, 2) + "\n");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: seed the sandbox");
  return dir;
}

/** A write into the scope the Pauses guard. */
function fireWrite(dir, name = "unbriefed.mjs") {
  const hook = declaredHook("PreToolUse");
  const r = spawnSync(hook.command, hook.args, {
    input: JSON.stringify({
      cwd: dir,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(dir, "src", "lib", name), content: "export const a = 1;\n" },
    }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  if (r.error) throw new Error(`the declared hook could not be spawned: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function records(dir) {
  const streamDir = join(dir, ".bancada", "telemetry");
  if (!existsSync(streamDir)) return [];
  return readdirSync(streamDir)
    .flatMap((f) => readFileSync(join(streamDir, f), "utf8").split(/\r?\n/))
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

/** What a consumer gets by doing nothing: the plugin present, the Pauses off. */
const DEFAULTS = { source: { include: ["src/**"] } };
const ENABLED = { ...DEFAULTS, flow: { enabled: true, scope: ["src/**"], pauses: ["brief"] } };

// --- the manifest the host reads ---

test("hooks.json points at a script that exists, and matches the write tools", () => {
  const hook = declaredHook("PreToolUse");
  assert.equal(hook.command, "node");
  assert.equal(hook.args.length, 1);
  assert.ok(existsSync(hook.args[0]), `points at a script that does not exist: ${hook.args[0]}`);
  const re = new RegExp(hook.matcher);
  // A Pause guards writes and commits, so the matcher has to carry both
  // families. Dropping one leaves the Pause enabled and never consulted.
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"]) {
    assert.ok(re.test(tool), `the matcher does not cover ${tool}`);
  }
});

// --- the state a consumer is in by default ---

test("with flow left at its default the hook allows and says nothing to the host", () => {
  const dir = sandbox(DEFAULTS);
  const r = fireWrite(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("a call no Pause looked at is still recorded, and says so", () => {
  const dir = sandbox(DEFAULTS);
  fireWrite(dir);
  const [record] = records(dir);
  // `pause-none` rather than no record at all. The stream is what answers "did
  // this Pause ever look", so silence and a switched-off Pause have to be
  // distinguishable in it — which costs one append per matching tool call to a
  // project that enabled the plugin and then switched the Pauses off.
  assert.equal(record.decision, "allow");
  assert.equal(record.rule, "pause-none");
  assert.deepEqual(record.checks, [{ name: "flow", rule: "pause-none", decision: "allow" }]);
});

// --- Pause 1, refusing and then not ---

test("a write with no brief exits 2 with the reason on stderr", () => {
  const dir = sandbox(ENABLED);
  const r = fireWrite(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Pause 1/);
  // The remedy has to name the file the Pause is waiting for, or the refusal is
  // a wall rather than an instruction.
  assert.match(r.stderr, /docs[/\\]briefs[/\\]main\.md/);
  assert.equal(r.stdout, "");
});

test("the same write goes through once the branch has a brief", () => {
  const dir = sandbox(ENABLED, { brief: true });
  const r = fireWrite(dir, "briefed.mjs");
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
});

test("the brief itself is writable while Pause 1 is refusing everything else", () => {
  const dir = sandbox(ENABLED);
  const hook = declaredHook("PreToolUse");
  const r = spawnSync(hook.command, hook.args, {
    input: JSON.stringify({
      cwd: dir,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(dir, "docs", "briefs", "main.md"), content: BRIEF },
    }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(r.status, 0, "a Pause that blocked its own remedy would be unescapable");
});

// --- the second writer on the shared stream ---

test("a Pause's refusal reaches the shared stream under the gate name yield reads", () => {
  const dir = sandbox(ENABLED);
  fireWrite(dir);
  const [record, ...rest] = records(dir);
  assert.equal(rest.length, 0);
  assert.equal(record.decision, "deny");
  // `flow`, not `pauses` or `bancada-flow`: this string is one of the six things
  // pinned across the plugin boundary, and `bancada yield` looks it up by name.
  assert.equal(record.check, "flow");
  assert.equal(record.rule, "pause-brief-missing");
  assert.equal(record.event, "PreToolUse");
  assert.equal(record.tool, "Write");
});

// --- abstaining rather than blocking ---

test("a payload the hook cannot parse allows rather than refusing", () => {
  const dir = sandbox(ENABLED);
  const hook = declaredHook("PreToolUse");
  for (const input of ["", "not json", "{oops", "null", "[1,2]"]) {
    const r = spawnSync(hook.command, hook.args, {
      input,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    assert.equal(r.status, 0, `input ${JSON.stringify(input)} should not block a tool call`);
  }
});
