/**
 * One reader for the CLI's arguments.
 *
 * `doctor`, `yield` and `check` all take `--dir`, and the loop that read it
 * ended every branch it did not recognise by pushing the token onto a list
 * nothing ever looked at. So an invented flag and a typo both ran the command
 * against the current working directory and printed a full report — a config
 * source, a file count, a gate list, exit 0 — about a project the caller had
 * never named. The wrong answer was indistinguishable from the right one, in the
 * one command the README tells people to run first. The CHANGELOG entry for this
 * has the four invocations and their numbers, before and after.
 *
 * So the spec below is data, and it is the only copy. A command declares which
 * flags it takes; a flag carries both its spelling and its effect, so a flag
 * cannot be accepted here and then quietly dropped by whatever reads the result.
 * Anything the spec does not name is refused by the path that already refused an
 * unknown command, with the same exit code and the same usage.
 *
 * The refusals are English rather than `messages.mjs` keys, because `language`
 * lives in a config this has not read: the config is found by resolving `--dir`,
 * and `--dir` is the argument under suspicion. The unknown-command message that
 * was already here is English for the same reason.
 */

import { statSync } from "node:fs";

/**
 * Every flag the CLI understands, with what it does.
 *
 * `value` is the placeholder shown when the flag is given none; a flag without
 * one is a switch.
 */
const FLAGS = [
  { names: ["--dir", "-C"], value: "<path>", isDir: true, apply: (a, v) => (a.dir = v) },
  { names: ["--json"], apply: (a) => (a.json = true) },
  { names: ["--skills"], apply: (a) => a.sections.push("skills") },
  { names: ["--help", "-h"], apply: (a) => (a.command = "help") },
];

const BY_NAME = new Map(FLAGS.flatMap((f) => f.names.map((n) => [n, f])));

/** Flags accepted on every command, because they answer without running it. */
const UNIVERSAL = ["--help", "-h"];

/**
 * The commands, each with the flags it accepts.
 *
 * `rules` and `init` are named in the usage and not built yet. They declare
 * `--dir` so that `bancada rules --dir x` answers "not implemented yet" — the
 * useful answer — instead of complaining about a flag it will accept. Neither
 * produces a report, so neither can be wrong about one.
 */
export const COMMANDS = {
  doctor: ["--dir", "-C", "--json", "--skills"],
  yield: ["--dir", "-C", "--json"],
  check: ["--dir", "-C", "--json"],
  rules: ["--dir", "-C"],
  init: ["--dir", "-C"],
  version: [],
  help: [],
};

/**
 * Spellings accepted where a command belongs.
 *
 * `--version` was already read there. `--help` was not, and exited 2 with
 * `unknown command "--help"` — the one place the CLI refused something it
 * plainly understood.
 */
const COMMAND_ALIASES = { "--help": "help", "-h": "help", "--version": "version" };

/** What a path is, as far as `--dir` is concerned. */
function realDirState(path) {
  try {
    return statSync(path).isDirectory() ? "dir" : "other";
  } catch {
    return "missing";
  }
}

const refuse = (error, showUsage = true) => ({ error, showUsage });

/**
 * Read an invocation.
 *
 * Returns `{ args }` for something runnable, or `{ error, showUsage }` for
 * something the caller should refuse. A value rather than a throw, because the
 * caller's job is to print it and choose an exit code, and because every branch
 * below is then something a test can assert on without spawning a process.
 *
 * `showUsage` is false only where the usage text would not help: a path that is
 * not a directory is a wrong value, not a mistyped invocation.
 */
export function parseArgs(argv, { cwd = process.cwd(), dirState = realDirState } = {}) {
  const raw = argv[0] ?? "help";
  const command = COMMAND_ALIASES[raw] ?? raw;
  const accepted = COMMANDS[command];
  if (accepted === undefined) return refuse(`unknown command "${raw}"`);

  const allowed = new Set([...accepted, ...UNIVERSAL]);
  const args = { command, dir: cwd, json: false, sections: [] };
  let dirGiven = false;

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    const flag = BY_NAME.get(token);

    if (flag === undefined) {
      return refuse(
        token.startsWith("-") ? `unknown flag "${token}"` : `unexpected argument "${token}"`,
      );
    }
    if (!allowed.has(token)) return refuse(`flag "${token}" does not apply to "${command}"`);

    if (flag.value === undefined) {
      flag.apply(args);
      continue;
    }

    // A known flag where a value belongs is a value the caller forgot, not a
    // path. `--dir --json` used to set the project directory to "--json".
    const next = argv[i + 1];
    if (next === undefined || BY_NAME.has(next)) {
      return refuse(`flag "${token}" needs a value: ${token} ${flag.value}`);
    }
    i++;
    flag.apply(args, next);
    if (flag.isDir) dirGiven = true;
  }

  // A `--dir` that names nothing is the same defect as a dropped flag: the
  // config lookup misses, `loadConfig` falls back to its defaults, and the
  // command reports on those instead of saying it was handed a path that is not
  // there.
  if (dirGiven) {
    const state = dirState(args.dir);
    if (state === "missing") return refuse(`--dir "${args.dir}": no such directory`, false);
    if (state !== "dir") return refuse(`--dir "${args.dir}": not a directory`, false);
  }

  return { args };
}
