/**
 * The layering rule: which layer a file belongs to, and what it may reach for.
 *
 * The check runs when a file is written, not when it is committed and not in
 * CI. That placement is the whole point. A fitness function that runs after the
 * pull request is open teaches the agent nothing, because the agent is gone by
 * then; refusing the edit puts the reason in front of the model in the turn
 * that produced it.
 *
 * Two things this deliberately will not do.
 *
 * It will not guess. An import it cannot attribute to a layer is not a
 * violation, it is an unknown, and unknowns are silent. A layering gate that
 * cries wolf gets switched off, and then it guards nothing at all.
 *
 * It will not enforce a layering nobody declared. With no layers configured the
 * check does not apply, rather than inventing a convention from directory names.
 */

import { compileGlob, normalisePath } from "./glob.mjs";
import { extractImports, isRelative, resolveRelative } from "./imports.mjs";

/**
 * Make a path project-relative, since layer globs are written that way.
 *
 * Write and Edit hand the gate an absolute `file_path`. A glob of
 * `src/domain/**` never matches `/home/me/proj/src/domain/order.ts`, so the
 * gate attributed nothing, found no violation, and reported success — a
 * configured gate enforcing nothing, which is the exact failure this project
 * exists to catch. The unit tests all passed relative paths and proved the
 * logic while missing the integration; an end-to-end run caught it.
 */
export function toProjectRelative(filePath, projectDir) {
  const p = normalisePath(filePath);
  if (!projectDir) return p;
  const root = normalisePath(projectDir).replace(/\/+$/, "");
  if (root === "") return p;
  // Compare case-insensitively: Windows hands back a drive letter whose case
  // does not always match what the session was started with.
  if (p.toLowerCase().startsWith(root.toLowerCase() + "/")) return p.slice(root.length + 1);
  return p;
}

/** Compile the configured layers once per run. */
export function compileLayers(layers) {
  return (layers ?? []).map((layer) => ({
    name: layer.name,
    match: layer.match,
    mayImport: new Set(layer.mayImport ?? []),
    test: compileGlob(layer.match),
    aliases: (layer.aliases ?? []).map((a) => ({ prefix: a, test: compileGlob(a + "**") })),
  }));
}

/**
 * The layer a path belongs to, or null.
 *
 * First match wins, so ordering in the config is meaningful: put the narrower
 * layer first when two globs overlap.
 */
export function layerOf(path, compiled) {
  const p = normalisePath(path);
  for (const layer of compiled) {
    if (layer.test(p)) return layer;
    if (layer.test(p.replace(/\.[cm]?[jt]sx?$/, ""))) return layer;
  }
  return null;
}

/**
 * Attribute one import to a layer.
 *
 * A relative specifier is resolved against the importing file, which is the
 * reliable case. A bare specifier is matched against the layer globs directly,
 * which catches path-style aliases such as `src/domain/order`, and against any
 * `aliases` a layer declares. Anything else returns null and is not judged.
 */
export function targetLayer(fromFile, spec, compiled) {
  if (isRelative(spec)) {
    return layerOf(resolveRelative(fromFile, spec), compiled);
  }
  const direct = layerOf(spec, compiled);
  if (direct) return direct;
  for (const layer of compiled) {
    if (layer.aliases.some((a) => spec === a.prefix || spec.startsWith(a.prefix))) return layer;
  }
  return null;
}

/**
 * Judge a file's imports against the declared layering.
 *
 * Returns `{ decision, rule, reason, violations, unknown }`. `unknown` counts
 * the specifiers that could not be attributed, so `doctor` can report how much
 * of a file the gate is actually seeing rather than implying it saw all of it.
 */
export function checkLayering(filePath, source, layers, projectDir) {
  const rel = toProjectRelative(filePath, projectDir);
  const compiled = compileLayers(layers);
  if (compiled.length === 0) {
    return { decision: "allow", rule: "structure-unconfigured", reason: null, violations: [], unknown: 0 };
  }

  const from = layerOf(rel, compiled);
  if (!from) {
    return { decision: "allow", rule: "structure-outside", reason: null, violations: [], unknown: 0 };
  }

  const violations = [];
  let unknown = 0;

  for (const spec of extractImports(source)) {
    const to = targetLayer(rel, spec, compiled);
    if (!to) {
      unknown++;
      continue;
    }
    if (to.name === from.name) continue;
    if (from.mayImport.has(to.name)) continue;
    violations.push({ spec, from: from.name, to: to.name });
  }

  if (violations.length === 0) {
    return { decision: "allow", rule: "structure-ok", reason: null, violations: [], unknown };
  }

  const allowed = [...from.mayImport];
  const lines = [
    `${rel} is in the "${from.name}" layer, which may import from ` +
      (allowed.length > 0 ? allowed.map((a) => `"${a}"`).join(", ") : "no other layer") +
      ".",
    "",
    ...violations.map((v) => `  ${v.spec}  →  "${v.to}"`),
    "",
    "Move the dependency behind an interface the allowed layer owns, or change",
    "the layering on purpose in bancada.config.json and say why in an ADR.",
  ];

  return {
    decision: "deny",
    rule: "structure-layer",
    reason: lines.join("\n"),
    violations,
    unknown,
  };
}
