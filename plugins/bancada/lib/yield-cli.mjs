/**
 * `bancada yield` — read the stream and report what the gates did.
 *
 * Separated from `yield.mjs` so the aggregation stays free of file access and
 * can be tested against literal records rather than a fixture on disk.
 */

import { readFileSync } from "node:fs";
import { loadConfig as realLoadConfig } from "./config.mjs";
import { streamPath } from "./telemetry.mjs";
import { aggregate, formatReport, parseStream } from "./yield.mjs";
import { CHECKS } from "./checks/index.mjs";

export function runYield({
  projectDir = ".",
  loadConfig = realLoadConfig,
  readFile = readFileSync,
  knownChecks = CHECKS.map((c) => c.name),
} = {}) {
  const { config } = loadConfig(projectDir);
  const file = streamPath(projectDir, config);

  if (!config.telemetry.enabled) {
    return {
      lines: [
        "bancada yield",
        "",
        "Telemetry is disabled for this project (telemetry.enabled is false),",
        "so there is nothing to report and no way to tell whether the gates",
        "are earning what they cost.",
      ],
      exitCode: 0,
      summary: { enabled: false },
    };
  }

  let raw;
  try {
    raw = readFile(file, "utf8");
  } catch {
    return {
      lines: [
        "bancada yield",
        "",
        `No stream at ${file}.`,
        "",
        "The file appears the first time a gate reports. If gates are enabled",
        "and you have run tool calls, its absence is itself a finding: check",
        "`bancada doctor` and confirm the hook is registered with /hooks.",
      ],
      exitCode: 0,
      summary: { enabled: true, stream: false },
    };
  }

  const { records, damaged } = parseStream(raw);
  const agg = aggregate(records, knownChecks);

  return {
    lines: formatReport(agg, { damaged }),
    exitCode: 0,
    summary: { enabled: true, stream: true, damaged, ...agg },
  };
}
