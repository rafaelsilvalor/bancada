/**
 * Every branch of the argument reader, including the ones that used to be
 * unreachable because there was no branch at all.
 *
 * The reader is pure apart from one stat, so `dirState` is injected: these
 * assertions are about what the parser decides, not about what is on this
 * machine's disk. The end-to-end half — that a refusal actually reaches exit 2
 * with the usage on stderr — is in `hooks/wiring.test.mjs`, next to the
 * unknown-command case it has to stay consistent with.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, parseArgs } from "./args.mjs";

const CWD = "/cwd";
const dirs = { "/project": "dir", "/project/file.mjs": "other" };
const dirState = (p) => dirs[p] ?? "missing";
const parse = (argv) => parseArgs(argv, { cwd: CWD, dirState });

// --- the flags that work ---

test("a command with no flags runs against the working directory", () => {
  const { args, error } = parse(["doctor"]);
  assert.equal(error, undefined);
  assert.deepEqual(args, { command: "doctor", dir: CWD, json: false, sections: [] });
});

test("no arguments at all is the help command, not an error", () => {
  assert.equal(parse([]).args.command, "help");
});

test("--dir, --json and --skills are read onto the fields the commands take", () => {
  const { args } = parse(["doctor", "--dir", "/project", "--json", "--skills"]);
  assert.deepEqual(args, { command: "doctor", dir: "/project", json: true, sections: ["skills"] });
});

test("-C is the same flag as --dir, and is checked the same way", () => {
  assert.equal(parse(["check", "-C", "/project"]).args.dir, "/project");
  assert.match(parse(["check", "-C", "/nowhere"]).error, /no such directory/);
});

test("--help is honoured wherever it appears, including after a command", () => {
  assert.equal(parse(["doctor", "--help"]).args.command, "help");
  assert.equal(parse(["-h"]).args.command, "help");
  assert.equal(parse(["--help"]).args.command, "help");
});

test("--version is accepted where a command belongs", () => {
  assert.equal(parse(["--version"]).args.command, "version");
});

// --- the flags that do not ---

test("an unknown flag is named and refused", () => {
  const { args, error, showUsage } = parse(["doctor", "--dirr", "/project"]);
  assert.equal(args, undefined, "nothing runnable comes back from a refusal");
  assert.equal(error, 'unknown flag "--dirr"');
  assert.equal(showUsage, true);
});

test("a flag another command takes is refused by name, not silently dropped", () => {
  // `--skills` is real, and means nothing to `yield`. Accepting it there would
  // print a report missing the section the caller asked for, and say nothing.
  assert.equal(parse(["yield", "--skills"]).error, 'flag "--skills" does not apply to "yield"');
  assert.equal(parse(["yield", "--json"]).args.json, true, "--json does apply to yield");
});

test("a flag that needs a value and reaches the end of the line is an error", () => {
  const { error, showUsage } = parse(["doctor", "--dir"]);
  assert.equal(error, 'flag "--dir" needs a value: --dir <path>');
  assert.equal(showUsage, true);
});

test("a flag whose value is another flag is a forgotten value, not a path", () => {
  // `--dir --json` used to set the project directory to the string "--json".
  assert.match(parse(["doctor", "--dir", "--json"]).error, /needs a value/);
  assert.match(parse(["doctor", "--dir", "-C", "/project"]).error, /needs a value/);
});

test("a bare argument where a flag belongs is refused rather than ignored", () => {
  assert.equal(parse(["doctor", "/project"]).error, 'unexpected argument "/project"');
});

// --- what --dir points at ---

test("--dir naming nothing on disk is refused instead of reported on", () => {
  const { error, showUsage } = parse(["doctor", "--dir", "/nowhere"]);
  assert.equal(error, '--dir "/nowhere": no such directory');
  // The usage text cannot help with a wrong path, so it is not printed. The
  // exit code is the same one an unknown flag gets; only the noise differs.
  assert.equal(showUsage, false);
});

test("--dir naming a file says so, rather than walking a directory that is not one", () => {
  assert.equal(parse(["doctor", "--dir", "/project/file.mjs"]).error, '--dir "/project/file.mjs": not a directory');
});

test("the working directory is not stat'd when --dir was never given", () => {
  const seen = [];
  const r = parseArgs(["doctor"], { cwd: "/gone", dirState: (p) => (seen.push(p), "missing") });
  assert.deepEqual(seen, [], "an absent flag has no path to validate");
  assert.equal(r.args.dir, "/gone");
});

// --- the unknown-command path, which this has to stay consistent with ---

test("an unknown command is refused by the same reader, with the same shape", () => {
  const command = parse(["nonsense"]);
  const flag = parse(["doctor", "--nonsense"]);
  assert.equal(command.error, 'unknown command "nonsense"');
  assert.equal(command.showUsage, flag.showUsage, "both are usage mistakes; both print the usage");
  assert.equal(command.args, undefined);
});

test("a command spelling is reported as typed, not as normalised", () => {
  // `--help` normalises to `help`; something that only looks like a flag must
  // still be quoted back the way the caller wrote it.
  assert.equal(parse(["--halp"]).error, 'unknown command "--halp"');
});

// --- the spec cannot declare a flag nothing implements ---

test("every flag a command declares is a flag the reader can apply", () => {
  for (const [command, flags] of Object.entries(COMMANDS)) {
    for (const flag of flags) {
      const r = parse([command, flag]);
      assert.ok(
        r.error === undefined || !/^unknown flag/.test(r.error),
        `${command} declares ${flag}, which the reader does not know`,
      );
    }
  }
});

test("every command in the usage text is a command the spec declares", () => {
  // The usage is what a refusal prints, so a command listed there and missing
  // here would be advice that earns the reader another refusal.
  for (const command of ["doctor", "yield", "check", "version", "help", "rules", "init"]) {
    assert.ok(command in COMMANDS, `${command} is offered in the usage but not declared`);
  }
});
