/**
 * Generate `schema/bancada.config.schema.json` from the config SPEC.
 *
 * The schema is what an editor autocompletes against; the SPEC is what the
 * gates actually enforce. Writing both by hand guarantees they drift, and the
 * drift is invisible until someone's editor says a setting is fine and the
 * validator says it is not.
 *
 * Run with `--check` in CI to fail when the committed file is stale.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { SPEC } from "../plugins/bancada/lib/config.mjs";

const OUT = "schema/bancada.config.schema.json";

const isLeaf = (node) => node !== null && typeof node === "object" && typeof node.type === "string";

const LAYER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "match", "mayImport"],
  properties: {
    name: { type: "string", minLength: 1, description: "Layer name, referenced by other layers' mayImport." },
    match: { type: "string", minLength: 1, description: "Glob selecting the files in this layer." },
    mayImport: {
      type: "array",
      items: { type: "string" },
      description: "Names of layers this one is allowed to import from. An empty list means it imports from no layer.",
    },
  },
};

function leafSchema(node) {
  switch (node.type) {
    case "boolean":
      return { type: "boolean", default: node.default };
    case "number":
      return { type: "number", default: node.default };
    case "string":
      return { type: "string", default: node.default };
    case "string[]":
      return { type: "array", items: { type: "string" }, default: node.default };
    case "enum":
      return { enum: node.values, default: node.default };
    case "layer[]":
      return { type: "array", items: LAYER_SCHEMA, default: node.default };
    default:
      return {};
  }
}

function build(spec) {
  const properties = {};
  for (const [key, node] of Object.entries(spec)) {
    properties[key] = isLeaf(node) ? leafSchema(node) : build(node);
  }
  return { type: "object", additionalProperties: false, properties };
}

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "bancada configuration",
  description:
    "Per-project policy for the bancada gates. Every setting is optional; anything absent uses the default shown. Generated from the SPEC in plugins/bancada/lib/config.mjs — edit that, then run scripts/gen-schema.mjs.",
  ...build(SPEC),
};
// `$schema` is accepted at the top level of a config file, so the schema must allow it.
schema.properties.$schema = { type: "string" };

const text = JSON.stringify(schema, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    console.error(`${OUT} is missing. Run: node scripts/gen-schema.mjs`);
    process.exit(1);
  }
  if (current !== text) {
    console.error(`${OUT} is stale. Run: node scripts/gen-schema.mjs`);
    process.exit(1);
  }
  console.log(`ok — ${OUT} matches the SPEC`);
  process.exit(0);
}

writeFileSync(OUT, text);
console.log(`wrote ${OUT}`);
