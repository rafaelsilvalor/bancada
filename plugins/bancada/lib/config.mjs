/**
 * Configuration: one schema that produces both the defaults and the validator.
 *
 * The failure this design exists to prevent is specific and was observed in
 * practice. A previous harness compiled its policy into its mechanism — the
 * source glob, the layer names, the size ceilings and the secret patterns were
 * all constants in the checker. The result was not a wrong answer; it was no
 * answer: outside one directory, no check ran at all, silently, for months.
 *
 * So two rules hold here.
 *
 * Every knob lives in `SPEC`, and both `defaults()` and `validate()` are derived
 * from it. A default and its validation cannot drift apart if neither is written
 * twice.
 *
 * A glob that matches nothing is reported, never treated as satisfied. Coverage
 * that quietly evaporates is the expensive failure; a noisy one is cheap.
 *
 * Config is read from `bancada.config.json` in the project, not from plugin
 * settings: since Claude Code v2.1.207, `pluginConfigs` is deliberately not read
 * from a project's `.claude/settings.json`, so a repository cannot feed values
 * into a plugin's hooks. Per-project policy therefore has to be a file the gate
 * reads itself.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contradictions } from "./config-warnings.mjs";
import { DEFAULT_FAMILIES } from "./secrets.mjs";

export const CONFIG_FILENAME = "bancada.config.json";

/**
 * The whole knob surface. A leaf is `{ type, default, values? }`; anything else
 * is a group. Adding a knob anywhere else is a bug, and the tests say so.
 */
export const SPEC = {
  language: { type: "enum", values: ["en", "pt-BR"], default: "en" },

  source: {
    include: { type: "string[]", default: [] },
    exclude: { type: "string[]", default: ["**/node_modules/**", "**/dist/**"] },
  },

  gates: {
    commit: {
      enabled: { type: "boolean", default: true },
      conventional: { type: "boolean", default: true },
      maxSubject: { type: "number", default: 72 },
      requireImperative: { type: "boolean", default: true },
      denyVerbs: { type: "string[]", default: [] },
      // Regular expressions matched case-insensitively against whole lines of
      // the message. This is how a project keeps attribution it did not ask for
      // out of its history — an assistant's Co-Authored-By, a tool's
      // advertisement footer. Empty by default: whose name belongs in a commit
      // is the project's call, not bancada's.
      denyTrailers: { type: "string[]", default: [] },
    },
    green: {
      enabled: { type: "boolean", default: false },
      commands: { type: "string[]", default: [] },
      watch: { type: "string[]", default: [] },
      // The budget for the whole boundary, not for each command. The hook's own
      // timeout in hooks.json is the hard bound above it; a value larger than
      // that one is capped by the host rather than by bancada.
      timeoutMs: { type: "number", default: 300000 },
      // How many times in a row the boundary may block one turn from ending.
      // Zero defers to Claude Code, which overrides a hook after eight
      // consecutive blocks — a real number that already exists, rather than a
      // second one invented here. A project whose suite is too expensive to run
      // eight times sets its own.
      maxBlocks: { type: "number", default: 0 },
    },
    secrets: {
      enabled: { type: "boolean", default: true },
      // The only gate that is on by default, so the families that are on by
      // default are the prefix-anchored ones. `generic` matches ordinary code
      // shapes, is the most useful and the noisiest, and is opted into.
      builtin: { type: "string[]", default: [...DEFAULT_FAMILIES] },
      custom: { type: "string[]", default: [] },
    },
    size: {
      enabled: { type: "boolean", default: false },
      maxFileLines: { type: "number", default: 400 },
      // Tests are long because they enumerate cases. One ceiling for both would
      // be an argument for writing fewer of them.
      testCeiling: { type: "number", default: 800 },
    },
    structure: {
      enabled: { type: "boolean", default: false },
      layers: { type: "layer[]", default: [] },
      adapterCommand: { type: "string", default: "" },
      adrDir: { type: "string", default: "docs/decisions/" },
    },
  },

  pair: {
    enabled: { type: "boolean", default: false },
    testAgent: { type: "string", default: "test" },
    codeAgent: { type: "string", default: "code" },
    testGlobs: { type: "string[]", default: ["**/*.test.*", "**/*.spec.*"] },
  },

  // Read by the bancada-flow plugin, declared here so that one config file has
  // one validator, one generated schema and one place `doctor` looks. bancada
  // itself never acts on these; without that plugin installed they do nothing.
  // Leaving them out would make the whole group an unknown key, and `doctor`
  // would report a correctly configured project as a misconfigured one.
  flow: {
    enabled: { type: "boolean", default: false },
    briefDir: { type: "string", default: "docs/briefs/" },
    // Which files require a brief. Empty means none, the same reading
    // `source.include` gets: a process gate that quietly applied to everything
    // would be discovered by being in the way.
    scope: { type: "string[]", default: [] },
    pauses: { type: "string[]", default: ["brief", "tests", "evidence"] },
  },

  telemetry: {
    enabled: { type: "boolean", default: true },
    dir: { type: "string", default: ".bancada/telemetry" },
  },
};

const isLeaf = (node) => node !== null && typeof node === "object" && typeof node.type === "string";
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Build the full default config from SPEC. */
export function defaults(spec = SPEC) {
  const out = {};
  for (const [key, node] of Object.entries(spec)) {
    out[key] = isLeaf(node) ? structuredClone(node.default) : defaults(node);
  }
  return out;
}

function typeError(kind, value, path, values) {
  const got = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  switch (kind) {
    case "enum":
      return values.includes(value) ? null : `${path}: expected one of ${values.join(", ")}, got ${JSON.stringify(value)}`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path}: expected a boolean, got ${got}`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path}: expected a number, got ${got}`;
    case "string":
      return typeof value === "string" ? null : `${path}: expected a string, got ${got}`;
    case "string[]":
      if (!Array.isArray(value)) return `${path}: expected an array of strings, got ${got}`;
      return value.every((v) => typeof v === "string") ? null : `${path}: every entry must be a string`;
    case "layer[]": {
      if (!Array.isArray(value)) return `${path}: expected an array of layers, got ${got}`;
      for (const [i, layer] of value.entries()) {
        if (!isPlainObject(layer)) return `${path}[${i}]: expected an object`;
        if (typeof layer.name !== "string" || layer.name === "") return `${path}[${i}].name: expected a non-empty string`;
        if (typeof layer.match !== "string" || layer.match === "") return `${path}[${i}].match: expected a glob string`;
        if (!Array.isArray(layer.mayImport) || !layer.mayImport.every((n) => typeof n === "string")) {
          return `${path}[${i}].mayImport: expected an array of layer names`;
        }
        if (layer.aliases !== undefined) {
          if (!Array.isArray(layer.aliases) || !layer.aliases.every((a) => typeof a === "string")) {
            return `${path}[${i}].aliases: expected an array of specifier prefixes`;
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Check a raw config against SPEC.
 *
 * Returns `{ errors, warnings }`. An unknown key is a warning, not an error: a
 * config written for a newer bancada should still run on an older one rather
 * than refuse to start. A wrong type is an error, because guessing what the
 * author meant is how a gate ends up enforcing something nobody asked for.
 */
export function validate(raw, spec = SPEC, path = "") {
  const errors = [];
  const warnings = [];
  if (raw === undefined) return { errors, warnings };
  if (!isPlainObject(raw)) {
    errors.push(`${path || "config"}: expected an object`);
    return { errors, warnings };
  }

  for (const [key, value] of Object.entries(raw)) {
    const here = path ? `${path}.${key}` : key;
    if (key === "$schema" && path === "") continue;

    const node = spec[key];
    if (node === undefined) {
      warnings.push(`${here}: unknown setting, ignored`);
      continue;
    }
    if (isLeaf(node)) {
      const err = typeError(node.type, value, here, node.values);
      if (err) errors.push(err);
    } else {
      const nested = validate(value, node, here);
      errors.push(...nested.errors);
      warnings.push(...nested.warnings);
    }
  }

  // Cross-field checks: a knob that contradicts another is worth saying out loud.
  // They are hand-written policy rather than anything the SPEC implies, and they
  // grow one entry per gate, so they live next door in config-warnings.mjs.
  if (path === "") warnings.push(...contradictions(raw));

  return { errors, warnings };
}

/** Deep-merge a validated user config over the defaults. Arrays replace, never concatenate. */
export function merge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key === "$schema") continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? merge(out[key], value) : structuredClone(value);
  }
  return out;
}

/**
 * Load the project's config.
 *
 * A missing file is not an error: bancada runs on defaults so that installing it
 * costs nothing on day one. A malformed file *is* an error, and it is reported
 * rather than silently replaced by defaults, because a config that is being
 * ignored looks exactly like a config that is working.
 */
export function loadConfig(projectDir, { readFile = readFileSync } = {}) {
  const file = join(projectDir ?? ".", CONFIG_FILENAME);
  const base = defaults();

  let raw;
  try {
    raw = readFile(file, "utf8");
  } catch {
    return { config: base, source: "defaults", file, errors: [], warnings: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      config: base,
      source: "defaults",
      file,
      errors: [`${CONFIG_FILENAME}: not valid JSON (${e.message}); running on defaults`],
      warnings: [],
    };
  }

  const { errors, warnings } = validate(parsed);
  // Even with errors, merge what is valid: a partially wrong config should still
  // apply the parts that are right, with the problems reported alongside.
  return { config: merge(base, parsed), source: "file", file, errors, warnings };
}

/**
 * Every glob the loaded config depends on, with the setting that owns it and
 * whether it asserts coverage or subtracts from it.
 *
 * The distinction is load-bearing for the coverage report. An `include` that
 * matches no file is a gate that has quietly stopped existing, and must be
 * shouted about. An `exclude` that matches no file is the normal, healthy case
 * — `node_modules` is absent from a clean checkout — and flagging it would put
 * a false positive in the one report people need to trust.
 */
export function globSettings(config) {
  const out = [
    { setting: "source.include", globs: config.source.include, kind: "include" },
    { setting: "source.exclude", globs: config.source.exclude, kind: "exclude" },
    { setting: "gates.green.watch", globs: config.gates.green.watch, kind: "include" },
    { setting: "pair.testGlobs", globs: config.pair.testGlobs, kind: "include" },
  ];
  for (const [i, layer] of (config.gates.structure.layers ?? []).entries()) {
    out.push({
      setting: `gates.structure.layers[${i}].match`,
      globs: [layer.match],
      kind: "include",
    });
  }
  return out.filter((e) => Array.isArray(e.globs) && e.globs.length > 0);
}
