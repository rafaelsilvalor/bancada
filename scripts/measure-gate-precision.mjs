/**
 * Before a gate ships: what does it block that deserved to pass?
 *
 * A gate is usually argued from the failure rate of the thing it targets —
 * "heredocs break 8.2% of the time, so ban heredocs". That number decides
 * nothing. What decides is the gate's precision: of everything it would deny,
 * how much was actually broken. The two diverged by an order of magnitude the
 * first time this was run, and the gate that looked obvious was dropped.
 *
 * The corpus is the session transcripts under `~/.claude/projects`, which
 * record every tool call and its result. Pairing a `tool_use` with its
 * `tool_result` gives an outcome per call, and a candidate gate is replayed as
 * a predicate over the same calls. Bad means the call errored or its output
 * named a shell/parse failure — a LOUD failure. Silent corruption that reported
 * success is invisible here, in both directions, and no run of this can settle
 * a gate whose whole claim is about false greens.
 *
 * First run, 2026-08-27, 374 sessions since 2026-07-30:
 *
 *   heredoc-shapes     53 caught / 507 denied =  10.5%   base rate 7.2%
 *   heredoc-backslash  40 caught / 354 denied =  11.3%
 *   write-validator     1 caught over 4 weeks — 16 of 29 syntax errors were
 *                       shell-written, where a Write|Edit hook is blind
 *
 * None shipped. `heredoc-shapes` cost 8.6 good blocks per catch, and no
 * narrower signal beat the base rate by enough to gate on.
 *
 * The corpus includes the session running this, which is still being written:
 * two runs a minute apart differ by a handful of calls. That moves the totals,
 * never the verdict, but it is why re-running does not reproduce to the digit.
 *
 *   node scripts/measure-gate-precision.mjs
 *   node scripts/measure-gate-precision.mjs --gate heredoc-shapes
 *   node scripts/measure-gate-precision.mjs --corpus /path/to/projects
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const DEFAULT_CORPUS = join(homedir(), ".claude", "projects");
const DEFAULT_SINCE = "2026-07-30";
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const CODE_FILE = /\.(mjs|cjs|js|json)$/i;

const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
const TO_FILE = /\b(cat|tee)\b[^\n<]*>[^\n<]*<<-?\s*['"]?[A-Za-z_]/;
const INTERPRETER = /\b(python[0-9.]*|node|perl|ruby|php)\b[^\n<]*<<-?\s*['"]?[A-Za-z_]/;

/** A loud failure: the call errored, or its output named a shell/parse fault. */
const LOUD = /(unexpected EOF|syntax error|unexpected end of file|unterminated|parse error|SyntaxError|Unexpected token|not valid JSON|Expecting value|command not found)/i;
/** A refusal is the human declining, not the command breaking. */
const REFUSED = /doesn't want to proceed|tool use was rejected/i;
/** A thrown parse failure starts its own line; assertion dumps embed it. */
const THROWN = /^\s*SyntaxError: /m;
// The last two are the node:test fail/pass marks. Without them a failing test's
// dump, which quotes the thrown error, is counted as a thrown error itself.
const TEST_NOISE = /AssertionError|not ok \d|# fail|✖|✔/;
const NAMED_FILE = /(?:file:\/\/\/)?([A-Za-z]:[\\/][^\s:]+?\.(?:mjs|cjs|js|json))(?::\d+)?/g;

function bodyOf(command) {
  return command.split("\n").slice(1).join("\n");
}

/**
 * Gates declare the population they act on, because precision is only
 * meaningful against the calls the gate would actually see.
 */
const GATES = [
  {
    name: "heredoc-shapes",
    population: "shell",
    why: "deny `cat > f <<EOF` and `python - <<PY`, allow `git commit -F - <<MSG`",
    applies: (call) => HEREDOC.test(call.command),
    flags: (call) => TO_FILE.test(call.command) || INTERPRETER.test(call.command),
  },
  {
    name: "heredoc-backslash",
    population: "shell",
    why: "deny a heredoc whose body carries a backslash",
    applies: (call) => HEREDOC.test(call.command),
    flags: (call) => bodyOf(call.command).includes("\\"),
  },
  {
    name: "heredoc-unquoted",
    population: "shell",
    why: "deny `<<EOF`, which interpolates $ and backslashes, allow `<<'EOF'`",
    applies: (call) => HEREDOC.test(call.command),
    flags: (call) => (call.command.match(HEREDOC) || [])[1] === "",
  },
  {
    name: "heredoc-any",
    population: "shell",
    why: "deny every heredoc, the shape the usage report proposed",
    applies: () => true,
    flags: (call) => HEREDOC.test(call.command),
  },
];

function readCorpus(corpusDir, since) {
  const sessions = [];
  for (const dir of readdirSync(corpusDir)) {
    const full = join(corpusDir, dir);
    let entries;
    try {
      if (!statSync(full).isDirectory()) continue;
      entries = readdirSync(full);
    } catch (error) {
      process.stderr.write(`skipped ${dir}: ${error.code}\n`);
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith(".jsonl")) continue;
      let text;
      try {
        text = readFileSync(join(full, file), "utf8");
      } catch (error) {
        process.stderr.write(`skipped ${file}: ${error.code}\n`);
        continue;
      }
      sessions.push({ project: dir, records: parseSession(text, since) });
    }
  }
  return sessions;
}

function parseSession(text, since) {
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // a partially flushed line; the next one is still readable
    }
    const day = (rec.timestamp || "").slice(0, 10);
    if (day && day < since) continue;
    const content = rec.message?.content;
    if (Array.isArray(content)) records.push(content);
  }
  return records;
}

/** One pass per session: shell calls paired with outcomes, plus write history. */
function collect(sessions) {
  const shellCalls = [];
  const syntaxErrors = [];

  for (const { records } of sessions) {
    const pending = new Map();
    const lastWrite = new Map();
    let step = 0;

    for (const content of records) {
      step++;
      for (const block of content) {
        if (!block || typeof block !== "object") continue;

        if (block.type === "tool_use") {
          const input = block.input || {};
          if (SHELL_TOOLS.has(block.name)) {
            pending.set(block.id, { command: input.command || "" });
            noteShellWrites(input.command || "", lastWrite, step);
          } else if (WRITE_TOOLS.has(block.name) && CODE_FILE.test(input.file_path || "")) {
            lastWrite.set(basename(input.file_path).toLowerCase(), { step, how: "tool" });
          }
          continue;
        }
        if (block.type !== "tool_result") continue;

        const text = resultText(block.content);
        const call = pending.get(block.tool_use_id);
        if (call) {
          pending.delete(block.tool_use_id);
          const refused = REFUSED.test(text);
          shellCalls.push({
            command: call.command,
            refused,
            bad: !refused && (Boolean(block.is_error) || LOUD.test(text)),
          });
        }
        if (THROWN.test(text) && !TEST_NOISE.test(text)) {
          syntaxErrors.push(attribute(text, lastWrite));
        }
      }
    }
  }
  return { shellCalls, syntaxErrors };
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => b?.text || "").join("\n");
  return "";
}

/** Shell redirections and interpreter heredocs both rewrite files behind a hook. */
function noteShellWrites(command, lastWrite, step) {
  for (const m of command.matchAll(/(?:>>?|\bsed\b[^\n]*-i)[^\n]*?([\w.-]+\.(?:mjs|cjs|js|json))/g)) {
    lastWrite.set(m[1].toLowerCase(), { step, how: "shell" });
  }
  if (!HEREDOC.test(command)) return;
  for (const m of command.matchAll(/["']([\w./\\-]+\.(?:mjs|cjs|js|json))["']/g)) {
    lastWrite.set(basename(m[1]).toLowerCase(), { step, how: "shell" });
  }
}

function attribute(text, lastWrite) {
  NAMED_FILE.lastIndex = 0;
  for (const m of text.matchAll(NAMED_FILE)) {
    const write = lastWrite.get(basename(m[1]).toLowerCase());
    if (write) return write.how;
  }
  return "unwritten";
}

function scoreShellGate(gate, calls) {
  const seen = calls.filter((c) => gate.applies(c) && !c.refused);
  let caught = 0;
  let falseBlocks = 0;
  let missed = 0;
  for (const call of seen) {
    const flagged = gate.flags(call);
    if (flagged && call.bad) caught++;
    else if (flagged) falseBlocks++;
    else if (call.bad) missed++;
  }
  const denied = caught + falseBlocks;
  const bad = caught + missed;
  return {
    name: gate.name,
    why: gate.why,
    population: seen.length,
    denied,
    caught,
    falseBlocks,
    missed,
    precision: denied ? (100 * caught) / denied : 0,
    baseRate: seen.length ? (100 * bad) / seen.length : 0,
  };
}

function pad(value, width) {
  return String(value).padStart(width);
}

function report(rows, syntaxErrors) {
  process.stdout.write("gate".padEnd(20) + pad("seen", 7) + pad("denied", 8) + pad("caught", 8) + pad("wrongly", 9) + pad("precision", 11) + pad("base", 8) + "\n");
  for (const r of rows) {
    process.stdout.write(
      r.name.padEnd(20) +
        pad(r.population, 7) +
        pad(r.denied, 8) +
        pad(r.caught, 8) +
        pad(r.falseBlocks, 9) +
        pad(r.precision.toFixed(1) + "%", 11) +
        pad(r.baseRate.toFixed(1) + "%", 8) +
        "\n"
    );
  }
  process.stdout.write("\nA gate pays only if precision clears the base rate by enough to justify\nthe blocks in the 'wrongly' column. Each one of those is correct work denied.\n");

  const counts = { tool: 0, shell: 0, unwritten: 0 };
  for (const how of syntaxErrors) counts[how]++;
  process.stdout.write("\nwrite-validator (a PostToolUse check on Write|Edit of .mjs/.json)\n");
  process.stdout.write(`  thrown SyntaxErrors        ${syntaxErrors.length}\n`);
  process.stdout.write(`  last write was Write|Edit  ${counts.tool}   <- the only ones it catches\n`);
  process.stdout.write(`  last write was the shell   ${counts.shell}   <- blind by construction\n`);
  process.stdout.write(`  file never written here    ${counts.unwritten}\n`);
}

function parseArgs(argv) {
  const args = { corpus: DEFAULT_CORPUS, since: DEFAULT_SINCE, gate: null };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in args)) throw new Error(`unknown flag: ${argv[i]}`);
    args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const sessions = readCorpus(args.corpus, args.since);
const { shellCalls, syntaxErrors } = collect(sessions);

process.stdout.write(`corpus ${args.corpus}\n`);
process.stdout.write(`${sessions.length} sessions, ${shellCalls.length} shell calls since ${args.since}\n\n`);

const chosen = args.gate ? GATES.filter((g) => g.name === args.gate) : GATES;
if (chosen.length === 0) throw new Error(`no such gate: ${args.gate}`);
report(chosen.map((g) => scoreShellGate(g, shellCalls)), syntaxErrors);
