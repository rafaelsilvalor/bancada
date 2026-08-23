#!/usr/bin/env node
/**
 * The bancada CLI.
 *
 * Kept thin on purpose: every subcommand delegates to a module in `lib/` that
 * takes its dependencies as arguments, so the behaviour is tested without
 * spawning a process. What lives here is the dispatch and the exit codes.
 *
 * The arguments are read in `lib/args.mjs` rather than here, because `doctor`,
 * `yield` and `check` all take `--dir` and three readers is how one of them ends
 * up disagreeing with the other two about what it was handed.
 */

import { parseArgs } from "../lib/args.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import { runYield } from "../lib/yield-cli.mjs";
import { runSweep } from "../lib/sweep.mjs";

const VERSION = "0.1.0";

const USAGE = `bancada ${VERSION}

Usage:
  bancada doctor [--dir <path>] [--json] [--skills]
                                           report what is configured and what guards nothing
  bancada yield  [--dir <path>] [--json]   report what the gates actually did
  bancada check  [--dir <path>] [--json]   sweep the whole project against the layering
  bancada version                          print the version
  bancada help                             print this

Not implemented yet (see the phase table in README.md):
  bancada rules     write .claude/rules/bancada.md into the project
  bancada init      interview a project into a starting config
`;

/**
 * Refuse an invocation.
 *
 * One emitter, so an unknown flag and an unknown command cannot end up with
 * different exit codes or different output. `lib/args.mjs` decides what is
 * wrong and whether the usage would help; this only prints it.
 */
function refuse({ error, showUsage }) {
  process.stderr.write(`bancada: ${error}\n` + (showUsage ? `\n${USAGE}` : ""));
  return 2;
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) return refuse(parsed);
  const args = parsed.args;

  switch (args.command) {
    case "doctor": {
      const report = runDoctor({ projectDir: args.dir, sections: args.sections });
      if (args.json) {
        process.stdout.write(JSON.stringify(report.summary, null, 2) + "\n");
      } else {
        process.stdout.write(report.lines.join("\n") + "\n");
      }
      return report.exitCode;
    }

    case "yield": {
      const report = runYield({ projectDir: args.dir });
      if (args.json) {
        process.stdout.write(JSON.stringify(report.summary, null, 2) + "\n");
      } else {
        process.stdout.write(report.lines.join("\n") + "\n");
      }
      return report.exitCode;
    }

    case "check": {
      const report = runSweep({ projectDir: args.dir });
      if (args.json) {
        process.stdout.write(JSON.stringify(report.summary, null, 2) + "\n");
      } else {
        process.stdout.write(report.lines.join("\n") + "\n");
      }
      return report.exitCode;
    }

    case "version":
      process.stdout.write(VERSION + "\n");
      return 0;

    case "help":
      process.stdout.write(USAGE);
      return 0;

    // A command named in the usage text but not built yet exits non-zero and
    // says so. Printing nothing and exiting 0 would read as success.
    case "rules":
    case "init":
      process.stderr.write(`bancada ${args.command}: not implemented yet in ${VERSION}\n`);
      return 2;
  }

  // Reachable only if `COMMANDS` in lib/args.mjs names a command this switch
  // does not handle. Falling off the end instead would return undefined, which
  // `process.exit` reads as success: a command that silently does nothing.
  process.stderr.write(`bancada: "${args.command}" is declared but not wired\n`);
  return 70;
}

process.exit(main(process.argv.slice(2)));
