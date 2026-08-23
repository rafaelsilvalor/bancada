/**
 * Does a violation written by shell meet the same gate a write tool meets?
 *
 * Every case is a pair: one intent, expressed twice. The write-tool arm is the
 * control, because it is the route every end-to-end verification in the
 * CHANGELOG used; the shell arm is the one under test. A row where the two
 * disagree is a gate that can be walked around by changing how the file is
 * written, which is the opposite of what the README claims for gating at the
 * hook.
 *
 * The first run of this said 5 of 6, and that number is why
 * `lib/shell-writes.mjs` exists. It is kept as a script rather than folded into
 * the test suite because the pairing is the point: a unit test asserts one
 * verdict, and what needed measuring was whether two routes produce the same
 * one. The hook contract lives in Claude Code, so when a payload shape moves,
 * this is what says whether the equivalence still holds.
 *
 * The real entry point is spawned, in a throwaway git repository. A run against
 * bancada's own checkout would put synthetic tool calls into the stream
 * `bancada yield` reports on — the mistake `check-cost.mjs` records having made.
 *
 *   node scripts/measure-shell-writes.mjs
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join("plugins", "bancada", "hooks", "pre-tool-use.mjs");
const CLI = join("plugins", "bancada", "bin", "bancada.mjs");
const NL = String.fromCharCode(10);

/**
 * Every gate under test switched on, in the shapes bancada uses on itself: a
 * layer that may import nothing, a 300-line ceiling, the pair split.
 */
const CONFIG = {
  source: { include: ["src/**"] },
  gates: {
    commit: { enabled: true, conventional: true, maxSubject: 72 },
    secrets: { enabled: true },
    size: { enabled: true, maxFileLines: 300, testCeiling: 600 },
    structure: {
      enabled: true,
      layers: [
        { name: "lib", match: "src/lib/**", mayImport: [] },
        { name: "hooks", match: "src/hooks/**", mayImport: ["lib"] },
      ],
    },
  },
  pair: { enabled: true },
};

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "bancada-shell-"));
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "bancada measurement");
  git("config", "user.email", "measure@example.invalid");
  mkdirSync(join(dir, "src", "lib"), { recursive: true });
  mkdirSync(join(dir, "src", "hooks"), { recursive: true });
  writeFileSync(join(dir, "src", "lib", "seed.mjs"), "export const seed = 1;" + NL);
  writeFileSync(join(dir, "src", "hooks", "entry.mjs"), 'import { seed } from "../lib/seed.mjs";' + NL);
  writeFileSync(join(dir, "bancada.config.json"), JSON.stringify(CONFIG, null, 2) + NL);
  git("add", "-A");
  git("commit", "-q", "-m", "chore: seed the sandbox");
  return dir;
}

/** Fire a payload at the real hook and read the verdict the way the host does. */
function fire(dir, payload) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: dir, hook_event_name: "PreToolUse", ...payload }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  if (r.error) throw new Error(`the hook could not be spawned: ${r.error.message}`);
  if (r.status === 2) return "deny";
  const stdout = (r.stdout ?? "").trim();
  if (stdout === "") return "allow";
  try {
    return JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? "allow";
  } catch {
    return "unparsable";
  }
}

/** The rule the stream recorded for one gate on the most recent tool call. */
function lastRule(dir, gate) {
  let lines = [];
  try {
    lines = readFileSync(join(dir, ".bancada", "telemetry", "gates.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
  } catch {
    return "no record";
  }
  const record = JSON.parse(lines[lines.length - 1]);
  return (record.checks ?? []).find((c) => c.name === gate)?.rule ?? "did not apply";
}

// --- the fixtures the pairs share ---

const CROSSING = 'import { entry } from "../hooks/entry.mjs";' + NL;
const OVERSIZE = Array.from({ length: 400 }, (_, i) => `export const n${i} = ${i};`).join(NL) + NL;
// Assembled from parts so this file never holds a matching literal. The secret
// gate scans what it is handed, and `secrets.test.mjs` scans its own source for
// exactly this reason.
const AWSKEY = "AKIA" + "ZXCVBNMASDFGHJKL";

/** `cat > path <<'EOF' … EOF`, the shape a shell-only session reaches for. */
const heredoc = (path, text) => [`cat > ${path} <<'EOF'`, text + "EOF"].join(NL);
const shell = (command) => ({ tool_name: "Bash", tool_input: { command } });
const edit = (file_path, old_string, new_string) => ({
  tool_name: "Edit",
  tool_input: { file_path, old_string, new_string },
});
const SEED = "export const seed = 1;";

const CASES = [
  {
    gate: "structure",
    intent: "a lib file gains an import from hooks",
    write: { tool_name: "Write", tool_input: { file_path: "src/lib/probe.mjs", content: CROSSING } },
    shell: shell(heredoc("src/lib/probe.mjs", CROSSING)),
  },
  {
    gate: "structure",
    intent: "the same import, appended by a redirect",
    write: edit("src/lib/seed.mjs", SEED, CROSSING + SEED),
    shell: shell(`printf '%s' '${CROSSING.trim()}' >> src/lib/seed.mjs`),
  },
  {
    gate: "structure",
    intent: "the same import, inserted by sed",
    write: edit("src/lib/seed.mjs", SEED, CROSSING + SEED),
    shell: shell(`sed -i '1i ${CROSSING.trim()}' src/lib/seed.mjs`),
  },
  {
    gate: "size",
    intent: "a 400-line file against a 300-line ceiling",
    write: { tool_name: "Write", tool_input: { file_path: "src/lib/big.mjs", content: OVERSIZE } },
    shell: shell(heredoc("src/lib/big.mjs", OVERSIZE)),
  },
  {
    gate: "pair",
    intent: "the code role writing a test file",
    agent_type: "code",
    write: { tool_name: "Write", tool_input: { file_path: "src/lib/thing.test.mjs", content: "// a test" + NL } },
    shell: shell(heredoc("src/lib/thing.test.mjs", "// a test" + NL)),
  },
  {
    gate: "secrets",
    intent: "a credential in a file (the control: this gate always read both)",
    write: {
      tool_name: "Write",
      tool_input: { file_path: "src/lib/conf.mjs", content: `export const id = "${AWSKEY}";` + NL },
    },
    shell: shell(heredoc("src/lib/conf.mjs", `export const id = "${AWSKEY}";` + NL)),
  },
];

// --- run ---

const dir = sandbox();
const rows = CASES.map((c) => {
  const role = c.agent_type ? { agent_type: c.agent_type } : {};
  // The write arm gets an absolute path, which is what Write and Edit send. A
  // gate that only understood a relative one passed every unit test and
  // attributed nothing, twice in this project's history.
  const write = structuredClone(c.write);
  write.tool_input.file_path = join(dir, write.tool_input.file_path);
  return {
    gate: c.gate,
    intent: c.intent,
    write: fire(dir, { ...write, ...role }),
    shell: fire(dir, { ...c.shell, ...role }),
    rule: lastRule(dir, c.gate),
  };
});

const w = (s, n) => String(s).padEnd(n);
console.log("Same violation, two routes, through the real PreToolUse entry point." + NL);
console.log(`${w("gate", 10)}${w("write tool", 12)}${w("shell", 8)}${w("recorded rule, shell arm", 26)}intent`);
for (const r of rows) console.log(`${w(r.gate, 10)}${w(r.write, 12)}${w(r.shell, 8)}${w(r.rule, 26)}${r.intent}`);

const diverged = rows.filter((r) => r.write === "deny" && r.shell !== "deny");
console.log(
  NL + `${diverged.length} of ${rows.length} case(s) refused by the write route and not by the shell route.`,
);
if (diverged.length > 0) {
  console.log("Each one should be a shape lib/shell-writes.mjs says it cannot read, and should carry a rule");
  console.log("naming the gap rather than a rule that reads like a clean pass.");
}

// The sweep behind the layering gate, which is the only one of the three with a
// net under it. The file is created directly rather than by running the command:
// what is under test is whether the sweep sees the result, not whether a shell
// can write one.
writeFileSync(join(dir, "src", "lib", "probe.mjs"), CROSSING);
const check = spawnSync(process.execPath, [CLI, "check", "--dir", dir], { encoding: "utf8" });
console.log(NL + "$ bancada check --dir <sandbox>   # once the shell write has landed");
console.log(`exit=${check.status}`);
console.log((check.stdout ?? "").trim());
console.log(NL + "There is no equivalent sweep for gates.size, and none is possible for pair.");
