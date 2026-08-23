/**
 * What this plugin reads out of the project's `bancada.config.json`.
 *
 * One config file, two plugins reading it. The knobs are declared in bancada's
 * `SPEC`, so there is one validator, one generated schema and one `doctor`
 * report; this file is only the reader.
 *
 * **Why the defaults appear twice.** A plugin cannot import from another
 * plugin's directory without assuming where the host put it. A marketplace
 * install happens to keep them as siblings, which was checked, but building on
 * an install layout nobody documented is the kind of assumption this project
 * exists to avoid. So the small handful of values bancada-flow needs are written
 * here as well — and `pinned.test.mjs` imports both sides and fails the moment
 * they disagree. The duplication is not prevented; it is detected, which is the
 * same trade this project makes everywhere else.
 *
 * `pair` is read as well as `flow`, and that is deliberate. Which files are
 * tests, and what the two roles are called, are already declared once for the
 * pair gate. A second declaration under `flow` would be a second answer to the
 * same question, and the two would disagree.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILENAME = "bancada.config.json";

/** Mirrors `SPEC.flow` in bancada's config module. */
export const FLOW_DEFAULTS = {
  enabled: false,
  briefDir: "docs/briefs/",
  scope: [],
  pauses: ["brief", "tests", "evidence"],
};

/** Mirrors `SPEC.pair` in bancada's config module. */
export const PAIR_DEFAULTS = {
  enabled: false,
  testAgent: "test",
  codeAgent: "code",
  testGlobs: ["**/*.test.*", "**/*.spec.*"],
};

/** Mirrors `SPEC.telemetry`. A project that switched the stream off means it. */
export const TELEMETRY_DEFAULTS = {
  enabled: true,
  dir: ".bancada/telemetry",
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Overlay whatever the file supplies of the right type; ignore the rest. */
function overlay(defaults, raw) {
  const out = structuredClone(defaults);
  if (!isPlainObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in out)) continue;
    if (Array.isArray(out[key]) !== Array.isArray(value)) continue;
    if (typeof out[key] !== typeof value) continue;
    out[key] = structuredClone(value);
  }
  return out;
}

/**
 * Read the project's config.
 *
 * A missing or malformed file yields the defaults, which have `flow.enabled`
 * false, so the failure mode is that this plugin does nothing. Reporting the
 * problem is bancada's job — it validates the same file and `doctor` prints
 * what it found. Two plugins both complaining about one typo would be worse
 * than one.
 */
export function loadFlowConfig(projectDir, { readFile = readFileSync } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(readFile(join(projectDir ?? ".", CONFIG_FILENAME), "utf8"));
  } catch {
    parsed = null;
  }
  return {
    flow: overlay(FLOW_DEFAULTS, parsed?.flow),
    pair: overlay(PAIR_DEFAULTS, parsed?.pair),
    telemetry: overlay(TELEMETRY_DEFAULTS, parsed?.telemetry),
  };
}

/** Whether a named Pause is switched on. */
export const pauseEnabled = (config, name) =>
  config.flow.enabled === true && (config.flow.pauses ?? []).includes(name);
