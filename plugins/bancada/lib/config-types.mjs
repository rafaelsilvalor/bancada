/**
 * Type validation for one SPEC leaf.
 *
 * Out of `config.mjs` for room, not for principle: that file holds the SPEC and
 * everything derived from it, and it sits close to this repository's own
 * 300-line ceiling. The structured types live here because they are the part
 * that grows — every gate that needs a shape richer than a string list adds a
 * case — while the SPEC itself should stay readable as a table of knobs.
 *
 * A validator returns `null` for a value it accepts and a message naming the
 * full path for one it does not. Guessing what the author meant is how a gate
 * ends up enforcing something nobody asked for, so a wrong type is never
 * repaired into a right one.
 */

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const kindOf = (value) => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);

function layerError(value, path) {
  if (!Array.isArray(value)) return `${path}: expected an array of layers, got ${kindOf(value)}`;
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

function suiteError(value, path) {
  if (!Array.isArray(value)) return `${path}: expected an array of suites, got ${kindOf(value)}`;
  for (const [i, suite] of value.entries()) {
    if (!isPlainObject(suite)) return `${path}[${i}]: expected an object`;
    if (typeof suite.test !== "string" || suite.test === "") {
      return `${path}[${i}].test: expected the path of the test file that does the covering`;
    }
    if (
      !Array.isArray(suite.covers) ||
      suite.covers.length === 0 ||
      !suite.covers.every((g) => typeof g === "string" && g !== "")
    ) {
      return `${path}[${i}].covers: expected a non-empty array of globs naming what the suite covers`;
    }
  }
  return null;
}

function exceptionError(value, path) {
  if (!Array.isArray(value)) return `${path}: expected an array of exceptions, got ${kindOf(value)}`;
  for (const [i, e] of value.entries()) {
    if (!isPlainObject(e)) return `${path}[${i}]: expected an object`;
    if (typeof e.path !== "string" || e.path === "") return `${path}[${i}].path: expected a file path`;
    // The reason and the date are required on purpose. An exception is a
    // decision someone made; one that cannot say why or when is a gap wearing a
    // decision's clothes, and the adoption story rests on the list shrinking.
    if (typeof e.reason !== "string" || e.reason === "") {
      return `${path}[${i}].reason: expected a reason — an undefended exception is a gap, not a decision`;
    }
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      return `${path}[${i}].date: expected the date the exception was accepted, as YYYY-MM-DD`;
    }
  }
  return null;
}

/** Check one value against a SPEC leaf's declared type. Null means accepted. */
export function typeError(kind, value, path, values) {
  switch (kind) {
    case "enum":
      return values.includes(value) ? null : `${path}: expected one of ${values.join(", ")}, got ${JSON.stringify(value)}`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path}: expected a boolean, got ${kindOf(value)}`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path}: expected a number, got ${kindOf(value)}`;
    case "string":
      return typeof value === "string" ? null : `${path}: expected a string, got ${kindOf(value)}`;
    case "string[]":
      if (!Array.isArray(value)) return `${path}: expected an array of strings, got ${kindOf(value)}`;
      return value.every((v) => typeof v === "string") ? null : `${path}: every entry must be a string`;
    case "layer[]":
      return layerError(value, path);
    case "suite[]":
      return suiteError(value, path);
    case "exception[]":
      return exceptionError(value, path);
    default:
      return null;
  }
}
