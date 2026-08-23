/**
 * The entry points, spawned the way the host spawns them.
 *
 * Everything under `lib/` tests judgement: a payload goes into a check, a
 * verdict comes out. Nothing tested the three lines that carry that verdict to
 * Claude Code — and those lines are where a gate stops refusing without a
 * single test going red. Four mutations, each of which passed every one of the
 * nine checks the CI ran before this file existed:
 *
 *   deleting `if (verdict.decision === "deny") deny(...)`
 *   deleting `if (verdict.decision === "deny") blockStop(...)`
 *   pointing `bin/bancada.mjs` at a lib module that is not there
 *   pointing `hooks.json` at a script that is not there
 *
 * The last one is why the command under test is read out of `hooks.json` rather
 * than written here. `claude plugin validate --strict` validates the plugin
 * manifest; it does not open `hooks/hooks.json`, and it does not check that the
 * script a hook names exists. Deriving the command from the file the host reads
 * makes that hole a test failure instead of a silent pass.
 *
 * `Stop` gets its own case for the reason `stop.mjs` exists at all: the event
 * has no exit-2 form, so a refusal travels as JSON on stdout with exit 0. A
 * `Stop` hook that exited 2 would look like a working gate from inside the
 * process and do nothing at all from outside it.
 *
 * The sandbox is not optional. These are real spawns, so they write real
 * telemetry, and a run against this repository would put synthetic tool calls
 * into the stream `bancada yield` reports on — the same mistake
 * `check-cost.mjs` records having made. Telemetry is left switched on inside the
 * sandbox on purpose: the record is written before the verdict is emitted, so a
 * throw on that path would take the refusal with it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../lib/args.mjs";

// `fileURLToPath` rather than the URL's `pathname`, which keeps the leading
// slash before a Windows drive letter and leaves any space percent-encoded.
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(PLUGIN_ROOT, "bin", "bancada.mjs");

/**
 * The command the host would run for an event, out of the plugin's own manifest.
 *
 * `${CLAUDE_PLUGIN_ROOT}` is substituted here the way Claude Code substitutes
 * it, so a hook whose path is wrong fails on the assertion below rather than
 * three tests later with a confusing spawn error.
 */
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
    timeout: hooks[0].timeout ?? null,
  };
}

/** A repository with the gates configured and nothing worth losing. */
function sandbox(config, seed) {
  const dir = mkdtempSync(join(tmpdir(), "bancada-wiring-"));
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "bancada wiring test");
  git("config", "user.email", "wiring@example.invalid");
  mkdirSync(join(dir, "src", "lib"), { recursive: true });
  mkdirSync(join(dir, "src", "hooks"), { recursive: true });
  writeFileSync(join(dir, "src", "lib", "seed.mjs"), "export const seed = 1;\n");
  writeFileSync(join(dir, "src", "hooks", "entry.mjs"), 'import { seed } from "../lib/seed.mjs";\n');
  writeFileSync(join(dir, "bancada.config.json"), JSON.stringify(config, null, 2) + "\n");
  if (seed) seed(dir);
  git("add", "-A");
  git("commit", "-q", "-m", "chore: seed the sandbox");
  return dir;
}

/** Fire an event at the declared hook and read back what the host would read. */
function fire(event, dir, payload) {
  const hook = declaredHook(event);
  const r = spawnSync(hook.command, hook.args, {
    input: JSON.stringify({ cwd: dir, hook_event_name: event, ...payload }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  if (r.error) throw new Error(`the declared ${event} hook could not be spawned: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Every record the sandbox's stream collected, oldest first. */
function records(dir) {
  const streamDir = join(dir, ".bancada", "telemetry");
  if (!existsSync(streamDir)) return [];
  return readdirSync(streamDir)
    .flatMap((f) => readFileSync(join(streamDir, f), "utf8").split(/\r?\n/))
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

const CONFIG = {
  source: { include: ["src/**"] },
  gates: {
    commit: { enabled: true, conventional: true, maxSubject: 72 },
    structure: {
      enabled: true,
      layers: [
        { name: "lib", match: "src/lib/**", mayImport: [] },
        { name: "hooks", match: "src/hooks/**", mayImport: ["lib"] },
      ],
    },
  },
};

const GREEN_CONFIG = {
  ...CONFIG,
  gates: { ...CONFIG.gates, green: { enabled: true, commands: ["node boundary.mjs"] } },
};

/**
 * A boundary whose colour the sandbox decides.
 *
 * In a file rather than as `node -e "..."`, because the boundary runs its
 * commands through a shell and the quoting that survives `cmd.exe` is not the
 * quoting that survives `sh`. A bare `node boundary.mjs` needs neither.
 */
const seedBoundary = (green) => (dir) =>
  writeFileSync(
    join(dir, "boundary.mjs"),
    green ? "process.exit(0);\n" : 'process.stderr.write("the build is red\\n");\nprocess.exit(1);\n',
  );

// --- the manifest the host reads ---

test("every hook hooks.json declares points at a script that exists", () => {
  for (const event of ["PreToolUse", "Stop"]) {
    const hook = declaredHook(event);
    assert.equal(hook.command, "node", `${event} should be run by node`);
    assert.equal(hook.args.length, 1, `${event} should be handed exactly one script`);
    assert.ok(existsSync(hook.args[0]), `${event} points at a script that does not exist: ${hook.args[0]}`);
    assert.ok(hook.timeout > 0, `${event} should declare a timeout`);
  }
});

test("the PreToolUse matcher covers every tool the gates read", () => {
  const { matcher } = declaredHook("PreToolUse");
  assert.ok(matcher, "the PreToolUse entry should declare a matcher");
  const re = new RegExp(matcher);
  // The two tool families the checks in `lib/checks/pre-tool-use.mjs` accept: a
  // shell tool carries a command line, a write tool carries a path and content.
  // A tool dropped from this string is a gate that silently stops seeing it,
  // which no unit test can notice because the checks are called directly.
  for (const tool of ["Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    assert.ok(re.test(tool), `the matcher does not cover ${tool}`);
  }
});

test("the Stop entry declares no matcher, because Stop has no tool to match", () => {
  assert.equal(declaredHook("Stop").matcher, null);
});

// --- PreToolUse: deny travels as exit 2 with the reason on stderr ---

test("a refused commit exits 2 with the reason on stderr and nothing on stdout", () => {
  const dir = sandbox(CONFIG);
  const r = fire("PreToolUse", dir, {
    tool_name: "Bash",
    tool_input: { command: 'git commit -m "adding a thing"' },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Conventional Commits/);
  assert.equal(r.stdout, "", "a denial carries no structured verdict; exit 2 and stderr are the whole contract");
});

test("a layer-crossing write is refused, so the write path reaches the structure gate", () => {
  const dir = sandbox(CONFIG);
  const r = fire("PreToolUse", dir, {
    tool_name: "Write",
    // Absolute, which is what Write actually sends. A gate that only understood
    // project-relative paths passed every unit test and refused nothing here.
    tool_input: {
      file_path: join(dir, "src", "lib", "probe.mjs"),
      content: 'import { entry } from "../hooks/entry.mjs";\n',
    },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /"lib" layer/);
});

test("an acceptable commit exits 0 and says nothing on either stream", () => {
  const dir = sandbox(CONFIG);
  const r = fire("PreToolUse", dir, {
    tool_name: "Bash",
    tool_input: { command: 'git commit -m "feat: add a thing"' },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

// --- PreToolUse: ask travels as exit 0 with JSON on stdout ---

test("a message the gate cannot read escalates on stdout rather than passing in silence", () => {
  const dir = sandbox(CONFIG);
  const r = fire("PreToolUse", dir, {
    tool_name: "Bash",
    tool_input: { command: "git commit -F message.txt" },
  });
  // Exit 0 with a body. The /hooks panel describes exit 0 as "stdout/stderr not
  // shown", which left it unclear whether this verdict is read at all; a real
  // session says it is, and this pins the shape that session saw.
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /cannot read/);
});

// --- Stop: block travels as exit 0 with JSON on stdout, never as exit 2 ---

test("a red boundary blocks the stop with JSON on stdout, not with an exit code", () => {
  const dir = sandbox(GREEN_CONFIG, seedBoundary(false));
  const r = fire("Stop", dir, { session_id: "wiring-red" });
  assert.equal(r.status, 0, "Stop has no exit-2 form; a refusal that used one would be discarded");
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /green boundary failed/);
});

test("a green boundary lets the stop through", () => {
  const dir = sandbox(GREEN_CONFIG, seedBoundary(true));
  const r = fire("Stop", dir, { session_id: "wiring-green" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

// --- the telemetry write happens in the real process, before the verdict ---

test("a refusal reaches the stream, and the record names the check that produced it", () => {
  const dir = sandbox(CONFIG);
  fire("PreToolUse", dir, { tool_name: "Bash", tool_input: { command: 'git commit -m "adding a thing"' } });
  const [record, ...rest] = records(dir);
  assert.equal(rest.length, 0, "one tool call should write exactly one record");
  assert.equal(record.decision, "deny");
  assert.equal(record.check, "commit");
  assert.equal(record.event, "PreToolUse");
  assert.equal(record.tool, "Bash");
  // Hash inputs, never content: the command must not be recoverable from the stream.
  assert.ok(!JSON.stringify(record).includes("adding a thing"));
});

// --- the CLI: a fourth entry point, and the only one a person invokes ---

test("the CLI prints the version its own manifest ships", () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  const r = spawnSync(process.execPath, [CLI, "version"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), manifest.version);
});

test("an unknown command exits non-zero and prints the usage", () => {
  const r = spawnSync(process.execPath, [CLI, "nonsense"], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown command/);
  assert.match(r.stderr, /bancada doctor/);
});

/**
 * The same refusal for a flag, spawned rather than parsed.
 *
 * `lib/args.test.mjs` asserts what the reader decides. What no unit test can see
 * is whether the decision reaches the caller: before this, an unknown flag was
 * pushed onto a list nothing read, and the command went on to print a confident
 * report about the current working directory with exit 0. The exit code is
 * compared against the unknown-command one rather than written here, so the two
 * cannot drift apart.
 */
test("an unknown flag is refused exactly the way an unknown command is", () => {
  const command = spawnSync(process.execPath, [CLI, "nonsense"], { encoding: "utf8" });
  const flag = spawnSync(process.execPath, [CLI, "doctor", "--project", "."], { encoding: "utf8" });
  assert.equal(flag.status, command.status, "an unknown flag and an unknown command share an exit code");
  assert.match(flag.stderr, /unknown flag "--project"/);
  assert.match(flag.stderr, /bancada doctor/, "the usage is printed, as it is for an unknown command");
  assert.equal(flag.stdout, "", "no report is printed for an invocation that was not understood");
});

test("a flag missing its value is refused instead of falling back to the working directory", () => {
  const r = spawnSync(process.execPath, [CLI, "doctor", "--dir"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs a value/);
  assert.equal(r.stdout, "");
});

test("--dir naming something that is not a directory is refused, not reported on", () => {
  const dir = sandbox(CONFIG);
  const missing = spawnSync(process.execPath, [CLI, "doctor", "--dir", join(dir, "nope")], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such directory/);
  assert.equal(missing.stdout, "", "reporting on defaults here is how doctor answered about a directory that is not there");

  const file = spawnSync(process.execPath, [CLI, "doctor", "--dir", join(dir, "bancada.config.json")], {
    encoding: "utf8",
  });
  assert.equal(file.status, 2);
  assert.match(file.stderr, /not a directory/);
});

/**
 * Every command the spec declares is one the CLI dispatches.
 *
 * `lib/args.mjs` now decides which commands exist, so a command added there and
 * not wired here would fall past the switch. It exits 70 and says "not wired"
 * rather than returning undefined, which `process.exit` would read as success —
 * and this is what makes that backstop a test failure instead of a silent pass.
 */
test("every command lib/args.mjs declares is wired in the CLI", () => {
  const dir = sandbox(CONFIG);
  for (const command of Object.keys(COMMANDS)) {
    const r = spawnSync(process.execPath, [CLI, command, "--dir", dir], { encoding: "utf8" });
    assert.doesNotMatch(r.stderr, /is declared but not wired/, `${command} is declared and never dispatched`);
    assert.notEqual(r.status, 70, `${command} fell past the switch`);
  }
});

test("bancada check exits 1 on a violation and 0 without one, which is what CI reads", () => {
  const clean = sandbox(CONFIG);
  const dirty = sandbox(CONFIG, (dir) =>
    writeFileSync(join(dir, "src", "lib", "bad.mjs"), 'import { entry } from "../hooks/entry.mjs";\n'),
  );
  const run = (dir) => spawnSync(process.execPath, [CLI, "check", "--dir", dir], { encoding: "utf8" });

  const ok = run(clean);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /No layering violation/);

  const bad = run(dirty);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /1 violation\(s\) in 1 file\(s\)/);
  assert.match(bad.stdout, /src[/\\]lib[/\\]bad\.mjs/);
});

test("doctor reads the project's own config and names a setting that guards nothing", () => {
  const dir = sandbox(CONFIG);
  const r = spawnSync(process.execPath, [CLI, "doctor", "--dir", dir, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  // "file", not "defaults": a doctor reporting on defaults it invented instead
  // of the config in front of it is the failure this command exists to prevent.
  assert.equal(report.configSource, "file");
  assert.deepEqual(report.gatesOn, ["commit", "secrets", "structure"]);
  assert.deepEqual(report.emptySettings, ["pair.testGlobs"]);
  assert.equal(report.fileSource, "git");
});
