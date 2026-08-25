import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults, merge } from "./config.mjs";
import { CHECKS, PRE_TOOL_USE_CHECKS, STOP_CHECKS } from "./checks/index.mjs";
import { dispatch } from "./dispatch.mjs";
import { secretsCheck } from "./checks/secrets.mjs";
import { sizeCheck } from "./checks/size.mjs";
import { pairCheck } from "./checks/pair.mjs";
import { structureCheck } from "./checks/structure.mjs";
import { greenCheck } from "./checks/green.mjs";
import { colocatedCheck } from "./checks/colocated.mjs";

const NL = String.fromCharCode(10);
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join(NL);
const AWS = "AKIA" + "JQ3XN7ZP4LMTKW2D";

const config = (over) => merge(defaults(), over ?? {});
const write = (file_path, content) => ({ tool_name: "Write", tool_input: { file_path, content } });

// --- the registries ---

test("each registry holds only checks for its own event", () => {
  assert.ok(PRE_TOOL_USE_CHECKS.every((c) => c.event === "PreToolUse"));
  assert.ok(STOP_CHECKS.every((c) => c.event === "Stop"));
  assert.equal(CHECKS.length, PRE_TOOL_USE_CHECKS.length + STOP_CHECKS.length);
});

test("no two checks share a name, because the report keys on it", () => {
  const names = CHECKS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
});

test("the tool-call registry carries no Stop check", () => {
  // The behavioural half of keeping the green boundary out of the hot path. The
  // other half — that its module is not even loaded there — is held by the
  // committed hotPathFiles list in cost-baseline.json.
  assert.equal(
    PRE_TOOL_USE_CHECKS.some((c) => c.name === "green"),
    false,
  );
});

test("every check declares the four things the dispatcher calls", () => {
  for (const c of CHECKS) {
    assert.equal(typeof c.name, "string", `${c.name}: name`);
    assert.equal(typeof c.event, "string", `${c.name}: event`);
    assert.equal(typeof c.applies, "function", `${c.name}: applies`);
    assert.equal(typeof c.run, "function", `${c.name}: run`);
  }
});

// --- the secret check ---

test("the secret check reads a write and a shell command, and nothing else", () => {
  const c = config();
  assert.equal(secretsCheck.applies(write("src/a.mjs", "x"), c), true);
  assert.equal(secretsCheck.applies({ tool_name: "Bash", tool_input: { command: "echo hi" } }, c), true);
  assert.equal(secretsCheck.applies({ tool_name: "Read", tool_input: { file_path: "a" } }, c), false);
  assert.equal(secretsCheck.applies(write("a", "x"), config({ gates: { secrets: { enabled: false } } })), false);
});

test("a credential in a shell command is refused, naming the command not a file", () => {
  const v = secretsCheck.run({ tool_name: "Bash", tool_input: { command: `export AWS_KEY=${AWS}` } }, config());
  assert.equal(v.decision, "deny");
  assert.equal(v.check, "secrets");
  assert.match(v.reason, /this shell command/);
});

test("a credential in a written file is refused, naming the file", () => {
  const v = secretsCheck.run(write("src/creds.mjs", `export const k = "${AWS}";`), config());
  assert.equal(v.decision, "deny");
  assert.match(v.reason, /src\/creds\.mjs/);
});

// --- the size check ---

const sized = (over) =>
  config(merge({ source: { include: ["src/**"] }, gates: { size: { enabled: true } } }, over ?? {}));

test("the size check applies only to writes, and only when it is on", () => {
  const on = sized();
  assert.equal(sizeCheck.applies(write("src/a.mjs", ""), on), true);
  assert.equal(sizeCheck.applies({ tool_name: "Bash", tool_input: { command: "ls" } }, on), false);
  assert.equal(sizeCheck.applies(write("src/a.mjs", ""), config()), false, "the gate ships off");
});

test("a file outside the project's source globs is not measured", () => {
  const on = sized();
  assert.equal(sizeCheck.applies(write("data/orders.json", ""), on), false);
  assert.equal(sizeCheck.applies(write("src/a.mjs", ""), sized({ source: { exclude: ["src/**"] } })), false);
});

test("with no source.include the size gate has nothing to measure and says nothing", () => {
  // Silently applying to everything would refuse a long fixture; silently
  // applying to nothing is what the config validator warns about.
  const on = config({ gates: { size: { enabled: true } } });
  assert.equal(sizeCheck.applies(write("src/a.mjs", ""), on), false);
});

test("a new file over the ceiling is refused without any file on disk", () => {
  const on = sized({ gates: { size: { maxFileLines: 10 } } });
  const v = sizeCheck.run(write("src/long.mjs", lines(40)), on, {
    readFile: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(v.decision, "deny");
  assert.equal(v.rule, "size-over");
});

test("an edit is judged against what the file will contain, read from disk", () => {
  const on = sized({ gates: { size: { maxFileLines: 10 } } });
  const input = { tool_name: "Edit", tool_input: { file_path: "src/a.mjs", old_string: "x", new_string: lines(40) } };
  const v = sizeCheck.run(input, on, { readFile: () => "x" });
  assert.equal(v.decision, "deny");
});

test("an unreadable file leaves the size check with no verdict rather than a guess", () => {
  const on = sized({ gates: { size: { maxFileLines: 10 } } });
  const input = { tool_name: "Edit", tool_input: { file_path: "src/a.mjs", old_string: "x", new_string: lines(40) } };
  const v = sizeCheck.run(input, on, {
    readFile: () => {
      throw new Error("EACCES");
    },
  });
  assert.equal(v.decision, "allow");
  assert.equal(v.rule, "size-unknown");
});

test("a test file gets the test ceiling through pair.testGlobs", () => {
  const on = sized({ gates: { size: { maxFileLines: 10, testCeiling: 100 } } });
  const v = sizeCheck.run(write("src/a.test.mjs", lines(40)), on, { readFile: () => null });
  assert.equal(v.decision, "allow");
});

// --- the pair check ---

test("the pair check does not apply without a role on the payload", () => {
  const on = config({ pair: { enabled: true } });
  assert.equal(pairCheck.applies(write("a.test.mjs", ""), on), false);
  assert.equal(pairCheck.applies({ ...write("a.test.mjs", ""), agent_type: "code" }, on), true);
  assert.equal(pairCheck.applies({ ...write("a.test.mjs", ""), agent_type: "code" }, config()), false);
});

test("the code role writing a test is refused through the check", () => {
  const on = config({ pair: { enabled: true } });
  const v = pairCheck.run({ ...write("src/a.test.mjs", ""), agent_type: "code" }, on);
  assert.equal(v.decision, "deny");
  assert.equal(v.check, "pair");
  assert.equal(v.rule, "pair-code-writes-test");
});

// --- the green check ---

test("the green check needs both the flag and at least one command", () => {
  assert.equal(greenCheck.applies({}, config()), false);
  assert.equal(greenCheck.applies({}, config({ gates: { green: { enabled: true } } })), false);
  assert.equal(
    greenCheck.applies({}, config({ gates: { green: { enabled: true, commands: ["npm test"] } } })),
    true,
  );
});

// --- the colocated check ---

/** A project whose colocation gate is on, plus injectable git and file-list answers. */
const colocatedOn = (over) =>
  config(merge({ source: { include: ["src/**"] }, gates: { colocated: { enabled: true } } }, over ?? {}));
const deps = (changed, files) => ({ changed, listFiles: () => ({ files, source: "git", truncated: false }) });

test("the colocated check needs both the flag and a source.include", () => {
  assert.equal(colocatedCheck.applies({}, config()), false, "the gate ships off");
  assert.equal(colocatedCheck.applies({}, config({ gates: { colocated: { enabled: true } } })), false);
  assert.equal(colocatedCheck.applies({}, colocatedOn()), true);
});

test("a changed module with no test blocks the stop, naming the test it expected", () => {
  const v = colocatedCheck.run({}, colocatedOn(), deps(["src/order.mjs"], ["src/order.mjs"]));
  assert.equal(v.decision, "deny");
  assert.equal(v.rule, "colocated-missing");
  assert.match(v.reason, /src\/order\.mjs — expected src\/order\.test\.mjs/);
});

test("the same change with the test in place is allowed", () => {
  const v = colocatedCheck.run({}, colocatedOn(), deps(["src/order.mjs"], ["src/order.mjs", "src/order.test.mjs"]));
  assert.equal(v.decision, "allow");
  assert.equal(v.rule, "colocated-ok");
});

test("an uncovered module the turn did not touch is doctor's business, not the stop's", () => {
  const v = colocatedCheck.run({}, colocatedOn(), deps(["src/other.mjs"], [
    "src/other.mjs",
    "src/other.test.mjs",
    "src/legacy.mjs",
  ]));
  assert.equal(v.decision, "allow", "blocking for the whole backlog is how a gate gets switched off");
});

test("deleting a test blocks the stop even though the module itself never changed", () => {
  const v = colocatedCheck.run({}, colocatedOn(), deps(["src/order.test.mjs"], ["src/order.mjs"]));
  assert.equal(v.decision, "deny");
  assert.match(v.reason, /src\/order\.mjs/);
});

test("a declared suite and a dated exception both let the stop through", () => {
  const bySuite = colocatedCheck.run(
    {},
    colocatedOn({ gates: { colocated: { suites: [{ test: "src/all.test.mjs", covers: ["src/*.mjs"] }] } } }),
    deps(["src/order.mjs"], ["src/order.mjs", "src/all.test.mjs"]),
  );
  assert.equal(bySuite.decision, "allow");

  const byException = colocatedCheck.run(
    {},
    colocatedOn({
      gates: { colocated: { exceptions: [{ path: "src/order.mjs", reason: "adopting", date: "2026-08-25" }] } },
    }),
    deps(["src/order.mjs"], ["src/order.mjs"]),
  );
  assert.equal(byException.decision, "allow");
});

test("where git cannot say what changed, the boundary does not run and says so", () => {
  const v = colocatedCheck.run({}, colocatedOn(), { changed: null });
  assert.equal(v.decision, "allow");
  assert.equal(v.rule, "colocated-unlisted");
  assert.match(v.note, /doctor/, "the gap stays visible somewhere");
});

test("a turn that changed nothing has nothing to answer for", () => {
  const v = colocatedCheck.run({}, colocatedOn(), deps([], ["src/legacy.mjs"]));
  assert.equal(v.decision, "allow");
  assert.equal(v.rule, "colocated-unchanged");
});

// --- through the dispatcher ---

test("two gates refusing one write report both problems at once", async () => {
  const c = sized({ gates: { size: { maxFileLines: 5 } } });
  const input = write("src/creds.mjs", `const k = "${AWS}";` + NL + lines(40));
  const r = await dispatch(input, c, PRE_TOOL_USE_CHECKS, "PreToolUse");
  assert.equal(r.decision, "deny");
  assert.equal(r.check, "secrets+size");
});

test("a clean write passes every gate that looked at it", async () => {
  const c = sized();
  const r = await dispatch(write("src/a.mjs", "export const a = 1;"), c, PRE_TOOL_USE_CHECKS, "PreToolUse");
  assert.equal(r.decision, "allow");
  assert.deepEqual(
    r.verdicts.map((v) => v.check),
    ["secrets", "size"],
    "the commit and layering gates did not apply and left no verdict",
  );
});

// --- the shell route, which three of these gates used to be blind to ---
//
// Measured before any of this existed, six paired payloads through the real
// entry point: 5 of 6 were refused by the write route and allowed by the shell
// route, because `applies` accepted only a write tool. The pairs below are the
// unit-level half of that; `hooks/wiring.test.mjs` spawns the entry point.

const shell = (command) => ({ tool_name: "Bash", tool_input: { command } });
const heredoc = (path, ...body) => shell([`cat > ${path} <<'EOF'`, ...body, "EOF"].join(NL));
const layered = (over) =>
  config(
    merge(
      {
        source: { include: ["src/**"] },
        gates: {
          structure: {
            enabled: true,
            layers: [
              { name: "lib", match: "src/lib/**", mayImport: [] },
              { name: "hooks", match: "src/hooks/**", mayImport: ["lib"] },
            ],
          },
        },
      },
      over ?? {},
    ),
  );

test("the three write gates apply to a shell command that writes, and not to one that does not", () => {
  const c = layered({ gates: { size: { enabled: true } }, pair: { enabled: true } });
  const writes = heredoc("src/lib/a.mjs", "x");
  const roled = { ...writes, agent_type: "code" };
  assert.equal(structureCheck.applies(writes, c), true);
  assert.equal(sizeCheck.applies(writes, c), true);
  assert.equal(pairCheck.applies(roled, c), true);
  for (const check of [structureCheck, sizeCheck]) {
    assert.equal(check.applies(shell("npm test"), c), false, `${check.name} on a command that writes nothing`);
  }
});

test("a layer crossing written by heredoc is refused, as the same content through Write is", () => {
  const c = layered();
  const source = 'import { entry } from "../hooks/entry.mjs";';
  const byTool = structureCheck.run(write("src/lib/a.mjs", source), c);
  const byShell = structureCheck.run(heredoc("src/lib/a.mjs", source), c);
  assert.equal(byTool.decision, "deny");
  assert.equal(byShell.decision, "deny");
  assert.equal(byShell.rule, "structure-layer");
  assert.equal(byShell.reason, byTool.reason, "the same violation earns the same reason by either route");
});

test("a shell write the gate cannot read is a recorded gap, not a silent pass", () => {
  const c = layered();
  const v = structureCheck.run(shell("sed -i '1i import x' src/lib/a.mjs"), c);
  assert.equal(v.decision, "allow");
  assert.equal(v.rule, "structure-unreadable", "so bancada yield can count how often the gate could not look");
});

test("an unreadable write no layer claims is outside, not a gap worth counting", () => {
  const c = layered();
  const v = structureCheck.run(shell("sed -i '1i x' docs/readme.md"), c);
  assert.equal(v.rule, "structure-outside");
});

test("a heredoc past the ceiling is refused, and an append is judged against the file", () => {
  const c = layered({ gates: { size: { enabled: true, maxFileLines: 10 } } });
  const fresh = sizeCheck.run(heredoc("src/lib/big.mjs", lines(40)), c, {
    readFile: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(fresh.decision, "deny");
  assert.equal(fresh.rule, "size-over");

  const appended = sizeCheck.run(shell(["cat >> src/lib/big.mjs <<'EOF'", lines(6), "EOF"].join(NL)), c, {
    readFile: () => lines(6),
  });
  assert.equal(appended.decision, "deny", "6 lines added to 6 is over a ceiling of 10");
});

test("one command writing two files reports only the file that broke a rule", () => {
  const c = layered({ gates: { size: { enabled: true, maxFileLines: 10 } } });
  const command = [
    "cat > src/lib/ok.mjs <<'EOF'",
    "export const a = 1;",
    "EOF",
    "cat > src/lib/big.mjs <<'EOF'",
    lines(40),
    "EOF",
  ].join(NL);
  const v = sizeCheck.run(shell(command), c, { readFile: () => null });
  assert.equal(v.decision, "deny");
  assert.equal(v.check, "size", "one check's name, not one per file it judged");
  assert.match(v.reason, /src\/lib\/big\.mjs/);
  assert.doesNotMatch(v.reason, /src\/lib\/ok\.mjs/);
});

test("a shell write outside source.include is measured by nothing, not measured as unknown", () => {
  const c = layered({ gates: { size: { enabled: true, maxFileLines: 10 } } });
  const v = sizeCheck.run(shell("sed -i '1i x' docs/readme.md"), c, { readFile: () => lines(40) });
  assert.equal(v.decision, "allow");
  assert.equal(v.rule, undefined, "no verdict at all: this file is not the size gate's business");
});

test("the pair gate needs no text, so even an unreadable shell write is judged", () => {
  const c = config({ pair: { enabled: true } });
  const v = pairCheck.run({ ...shell("sed -i '1i x' src/a.test.mjs"), agent_type: "code" }, c);
  assert.equal(v.decision, "deny");
  assert.equal(v.rule, "pair-code-writes-test");
});

test("a heredoc that breaks two rules at once reports both", async () => {
  const c = layered({ gates: { size: { enabled: true, maxFileLines: 5 } } });
  const command = [
    "cat > src/lib/a.mjs <<'EOF'",
    'import { entry } from "../hooks/entry.mjs";',
    lines(40),
    "EOF",
  ].join(NL);
  const r = await dispatch(shell(command), c, PRE_TOOL_USE_CHECKS, "PreToolUse");
  assert.equal(r.decision, "deny");
  assert.equal(r.check, "size+structure");
});
