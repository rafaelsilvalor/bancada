/**
 * Settings that are individually valid and jointly say nothing.
 *
 * The validator in `config.mjs` is derived from the SPEC: it knows a type, so it
 * can tell a boolean from a string and an unknown key from a known one. It
 * cannot tell that `green` is enabled with no commands to run, because both
 * fields are the right type and the contradiction is between them.
 *
 * That second kind of check is hand-written policy, it grows one entry per gate,
 * and it is what this file is. Every entry answers the same question: is this
 * gate switched on and guarding nothing? A gate in that state is the worst state
 * available — it costs the same, reports the same, and catches nothing — and it
 * is invisible unless something says so out loud.
 */

import { FAMILIES } from "./secrets.mjs";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Warnings about combinations of settings, given the raw config as written. */
export function contradictions(raw) {
  const warnings = [];
  const g = raw?.gates;
  if (!isPlainObject(raw)) return warnings;

  if (isPlainObject(g?.green) && g.green.enabled === true && (g.green.commands ?? []).length === 0) {
    warnings.push("gates.green: enabled with no commands, so it will never run");
  }

  if (isPlainObject(g?.secrets)) {
    // A family name nobody recognises contributes no patterns, so the gate goes
    // on running with fewer of them and nothing says so. A typo here is exactly
    // the silent coverage gap this project exists to catch.
    if (Array.isArray(g.secrets.builtin)) {
      const unknown = g.secrets.builtin.filter((n) => !(n in FAMILIES));
      if (unknown.length > 0) {
        warnings.push(
          `gates.secrets.builtin: no such pattern family: ${unknown.join(", ")} ` +
            `(known: ${Object.keys(FAMILIES).join(", ")})`,
        );
      }
      if (g.secrets.enabled !== false && g.secrets.builtin.length === 0 && (g.secrets.custom ?? []).length === 0) {
        warnings.push("gates.secrets: enabled with no pattern families and no custom patterns, so it will never fire");
      }
    }
  }

  if (isPlainObject(g?.size)) {
    if (typeof g.size.testCeiling === "number" && typeof g.size.maxFileLines === "number") {
      if (g.size.testCeiling < g.size.maxFileLines) {
        warnings.push("gates.size: testCeiling is below maxFileLines, so tests are held to a stricter limit than code");
      }
    }
    // The size gate only judges files `source.include` claims. With nothing
    // claimed it matches nothing, which looks exactly like a project whose files
    // are all short enough.
    if (g.size.enabled === true && (raw.source?.include ?? []).length === 0) {
      warnings.push("gates.size: enabled with no source.include, so it has no files to measure");
    }
  }

  if (isPlainObject(g?.colocated) && g.colocated.enabled === true) {
    // Same reading as the size gate: an empty include is "the project said
    // nothing", so the gate applies to nothing and looks exactly like a project
    // whose every module is tested.
    if ((raw.source?.include ?? []).length === 0) {
      warnings.push("gates.colocated: enabled with no source.include, so it has no files to check");
    }
    // Only when both are *written* empty: an absent patterns falls back to the
    // default, which covers.
    if (Array.isArray(g.colocated.patterns) && g.colocated.patterns.length === 0 && (g.colocated.suites ?? []).length === 0) {
      warnings.push("gates.colocated: no patterns and no suites, so no module can ever count as tested");
    }
  }

  // Owned by bancada-flow, checked here because this is where the file is read.
  if (isPlainObject(raw.flow) && raw.flow.enabled === true) {
    if ((raw.flow.scope ?? []).length === 0) {
      warnings.push("flow: enabled with an empty scope, so no Pause will ever fire");
    }
    const known = ["brief", "tests", "evidence"];
    const unknown = (raw.flow.pauses ?? []).filter((p) => !known.includes(p));
    if (unknown.length > 0) {
      warnings.push(`flow.pauses: no such Pause: ${unknown.join(", ")} (known: ${known.join(", ")})`);
    }
    // Pause 2 is the only one that needs a role on the payload to fire at all.
    if ((raw.flow.pauses ?? []).includes("tests") && raw.pair?.enabled !== true) {
      warnings.push(
        "flow.pauses includes tests, which needs the test/code roles; enable pair so the same roles are enforced both ways",
      );
    }
  }

  if (isPlainObject(g?.structure) && g.structure.enabled === true) {
    const noLayers = (g.structure.layers ?? []).length === 0;
    const noAdapter = typeof g.structure.adapterCommand !== "string" || g.structure.adapterCommand === "";
    if (noLayers && noAdapter) {
      warnings.push("gates.structure: enabled with neither layers nor an adapter command, so it will never run");
    }
  }

  return warnings;
}
