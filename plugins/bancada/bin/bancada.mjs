#!/usr/bin/env node
/**
 * The bancada CLI.
 *
 * Kept thin on purpose: every subcommand delegates to a module in `lib/` that
 * takes its dependencies as arguments, so the behaviour is tested without
 * spawning a process. What lives here is argument parsing and exit codes.
 */

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

function parseArgs(argv) {
  const args = { command: argv[0] ?? "help", dir: process.cwd(), json: false, sections: [], unknown: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" || a === "-C") args.dir = argv[++i] ?? args.dir;
    else if (a === "--json") args.json = true;
    else if (a === "--skills") args.sections.push("skills");
    else if (a === "--help" || a === "-h") args.command = "help";
    else args.unknown.push(a);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);

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
    case "--version":
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

    default:
      process.stderr.write(`bancada: unknown command "${args.command}"\n\n${USAGE}`);
      return 2;
  }
}

process.exit(main(process.argv.slice(2)));
