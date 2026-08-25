import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_FILENAME,
  defaults,
  globSettings,
  loadConfig,
  merge,
  SPEC,
  validate,
} from "./config.mjs";

/** A fake reader so the loader can be tested without touching a filesystem. */
function reader(contents) {
  return () => {
    if (contents === null) {
      const e = new Error("ENOENT");
      e.code = "ENOENT";
      throw e;
    }
    return contents;
  };
}

// --- defaults come from the schema, not from a second hand-written copy ---

test("defaults mirror the schema shape exactly", () => {
  const d = defaults();
  assert.equal(d.language, "en");
  assert.deepEqual(d.source.include, []);
  assert.equal(d.gates.commit.maxSubject, 72);
  assert.equal(d.gates.commit.enabled, true);
  assert.equal(d.telemetry.dir, ".bancada/telemetry");
});

test("every leaf in the schema declares a type and a default", () => {
  const missing = [];
  (function walk(node, path) {
    for (const [key, child] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (child && typeof child.type === "string") {
        if (!("default" in child)) missing.push(`${here}: no default`);
        if (child.type === "enum" && !Array.isArray(child.values)) missing.push(`${here}: enum without values`);
      } else walk(child, here);
    }
  })(SPEC, "");
  assert.deepEqual(missing, []);
});

test("defaults are a fresh copy each call, so one caller cannot mutate another's", () => {
  const a = defaults();
  a.source.include.push("mutated");
  assert.deepEqual(defaults().source.include, []);
});

// --- gates that could do nothing default to off ---

test("gates needing project-specific input ship disabled", () => {
  const d = defaults();
  assert.equal(d.gates.green.enabled, false, "green has no commands to run by default");
  assert.equal(d.gates.size.enabled, false, "a line ceiling is a house style, not a universal");
  assert.equal(d.gates.structure.enabled, false, "layers cannot be guessed");
  assert.equal(d.pair.enabled, false, "the test/code pair assumes those agent names exist");
});

test("gates that are safe without configuration ship enabled", () => {
  const d = defaults();
  assert.equal(d.gates.commit.enabled, true);
  assert.equal(d.gates.secrets.enabled, true);
});

test("the only default-on scanner runs only its precise families", () => {
  // The family that matches ordinary code shapes is the useful one and the
  // noisy one. On by default it would refuse somebody's fixture on day one,
  // and the fix everyone reaches for first is switching bancada off entirely.
  assert.deepEqual(defaults().gates.secrets.builtin, ["provider", "key"]);
});

// --- validation ---

test("a valid config produces no errors and no warnings", () => {
  const { errors, warnings } = validate({
    language: "pt-BR",
    gates: { commit: { maxSubject: 60 } },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("a wrong type is an error naming the full path", () => {
  const { errors } = validate({ gates: { commit: { maxSubject: "seventy" } } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /gates\.commit\.maxSubject: expected a number, got string/);
});

test("an unknown key is a warning, so a newer config still runs on an older bancada", () => {
  const { errors, warnings } = validate({ gates: { commit: { fromTheFuture: true } } });
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /gates\.commit\.fromTheFuture: unknown setting, ignored/);
});

test("$schema at the top level is neither an error nor a warning", () => {
  const { errors, warnings } = validate({ $schema: "https://example.com/s.json" });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("an enum rejects a value outside its list and names the alternatives", () => {
  const { errors } = validate({ language: "klingon" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /language: expected one of en, pt-BR/);
});

test("a string array rejects a non-string entry", () => {
  assert.match(validate({ source: { include: ["ok", 42] } }).errors[0], /every entry must be a string/);
  assert.match(validate({ source: { include: "notanarray" } }).errors[0], /expected an array of strings, got string/);
});

test("a layer must carry a name, a match glob and a mayImport list", () => {
  const bad = [
    [{ match: "src/**", mayImport: [] }, /layers\[0\]\.name/],
    [{ name: "domain", mayImport: [] }, /layers\[0\]\.match/],
    [{ name: "domain", match: "src/**" }, /layers\[0\]\.mayImport/],
    ["not an object", /layers\[0\]: expected an object/],
  ];
  for (const [layer, pattern] of bad) {
    const { errors } = validate({ gates: { structure: { layers: [layer] } } });
    assert.match(errors[0] ?? "", pattern);
  }
});

test("a well-formed layer validates", () => {
  const { errors } = validate({
    gates: { structure: { layers: [{ name: "domain", match: "src/domain/**", mayImport: [] }] } },
  });
  assert.deepEqual(errors, []);
});

test("a non-object config is an error rather than a crash", () => {
  assert.match(validate([1, 2, 3]).errors[0], /config: expected an object/);
  assert.match(validate("nope").errors[0], /config: expected an object/);
});

// --- the contradiction warnings: a gate that cannot fire should say so ---

test("green enabled with no commands warns instead of pretending to guard", () => {
  const { warnings } = validate({ gates: { green: { enabled: true, commands: [] } } });
  assert.match(warnings.join("\n"), /gates\.green: enabled with no commands/);
});

test("structure enabled with neither layers nor an adapter warns", () => {
  const { warnings } = validate({ gates: { structure: { enabled: true } } });
  assert.match(warnings.join("\n"), /gates\.structure: enabled with neither layers nor an adapter/);
});

test("a misspelled secret family warns rather than quietly scanning for less", () => {
  const { errors, warnings } = validate({ gates: { secrets: { builtin: ["provider", "genericc"] } } });
  assert.deepEqual(errors, [], "the type is right; only the value is unknown");
  assert.match(warnings.join("\n"), /no such pattern family: genericc/);
  assert.match(warnings.join("\n"), /known: provider, key, generic/);
});

test("secrets enabled with nothing to look for warns", () => {
  const { warnings } = validate({ gates: { secrets: { enabled: true, builtin: [], custom: [] } } });
  assert.match(warnings.join("\n"), /gates\.secrets: enabled with no pattern families/);
});

test("a test ceiling below the source ceiling is a contradiction worth saying out loud", () => {
  const { warnings } = validate({ gates: { size: { maxFileLines: 400, testCeiling: 100 } } });
  assert.match(warnings.join("\n"), /testCeiling is below maxFileLines/);
});

test("colocated enabled with no source.include warns, the same reading the size gate gets", () => {
  const { warnings } = validate({ gates: { colocated: { enabled: true } } });
  assert.match(warnings.join("\n"), /gates\.colocated: enabled with no source\.include/);
});

test("colocated with patterns written empty and no suites warns that nothing can ever count as tested", () => {
  const base = { source: { include: ["src/**"] } };
  const emptied = validate({ ...base, gates: { colocated: { enabled: true, patterns: [], suites: [] } } });
  assert.match(emptied.warnings.join("\n"), /no patterns and no suites/);

  const defaulted = validate({ ...base, gates: { colocated: { enabled: true } } });
  assert.deepEqual(defaulted.warnings, [], "an absent patterns falls back to the default, which covers");
});

test("a suite and an exception validate through the SPEC with full paths on refusal", () => {
  const ok = validate({
    gates: {
      colocated: {
        suites: [{ test: "lib/checks.test.mjs", covers: ["lib/checks/*.mjs"] }],
        exceptions: [{ path: "scripts/gen.mjs", reason: "CI utility", date: "2026-08-25" }],
      },
    },
  });
  assert.deepEqual(ok.errors, []);

  const bad = validate({ gates: { colocated: { suites: [{ covers: ["a/**"] }], exceptions: [{ path: "a.mjs" }] } } });
  assert.match(bad.errors.join("\n"), /gates\.colocated\.suites\[0\]\.test/);
  assert.match(bad.errors.join("\n"), /gates\.colocated\.exceptions\[0\]\.reason/);
});

test("structure enabled with only an adapter command does not warn", () => {
  const { warnings } = validate({
    gates: { structure: { enabled: true, adapterCommand: "npx depcruise --output-type err" } },
  });
  assert.deepEqual(warnings, []);
});

// --- merging ---

test("merge overlays scalars and leaves untouched branches alone", () => {
  const merged = merge(defaults(), { gates: { commit: { maxSubject: 50 } } });
  assert.equal(merged.gates.commit.maxSubject, 50);
  assert.equal(merged.gates.commit.conventional, true, "sibling default survives");
  assert.equal(merged.telemetry.enabled, true, "unrelated branch survives");
});

test("an array in the override replaces the default rather than concatenating", () => {
  const merged = merge(defaults(), { source: { exclude: ["only-this/**"] } });
  assert.deepEqual(merged.source.exclude, ["only-this/**"]);
});

test("merge does not mutate the base", () => {
  const base = defaults();
  merge(base, { language: "pt-BR", source: { include: ["src/**"] } });
  assert.equal(base.language, "en");
  assert.deepEqual(base.source.include, []);
});

// --- loading ---

test("a missing config file is not an error; bancada runs on defaults", () => {
  const r = loadConfig("/proj", { readFile: reader(null) });
  assert.equal(r.source, "defaults");
  assert.deepEqual(r.errors, []);
  assert.equal(r.config.gates.commit.maxSubject, 72);
  assert.match(r.file, new RegExp(CONFIG_FILENAME.replace(".", "\\.")));
});

test("malformed JSON is reported, not silently swallowed into defaults", () => {
  const r = loadConfig("/proj", { readFile: reader("{ not json") });
  assert.equal(r.source, "defaults");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /not valid JSON/);
  assert.equal(r.config.gates.commit.maxSubject, 72, "still usable");
});

test("a valid file is merged over the defaults", () => {
  const r = loadConfig("/proj", {
    readFile: reader(JSON.stringify({ language: "pt-BR", gates: { commit: { maxSubject: 50 } } })),
  });
  assert.equal(r.source, "file");
  assert.deepEqual(r.errors, []);
  assert.equal(r.config.language, "pt-BR");
  assert.equal(r.config.gates.commit.maxSubject, 50);
  assert.equal(r.config.gates.secrets.enabled, true);
});

test("a partially wrong config still applies its valid parts, with the problem reported", () => {
  const r = loadConfig("/proj", {
    readFile: reader(JSON.stringify({ language: "pt-BR", gates: { commit: { maxSubject: "fifty" } } })),
  });
  assert.equal(r.config.language, "pt-BR", "the valid half applies");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /maxSubject/);
});

// --- glob accounting, so coverage cannot evaporate quietly ---

test("globSettings lists only the settings that actually carry globs", () => {
  const config = merge(defaults(), { source: { include: ["src/**/*.ts"] } });
  const names = globSettings(config).map((e) => e.setting);
  assert.ok(names.includes("source.include"));
  assert.ok(names.includes("source.exclude"), "exclude has defaults, so it is present");
  assert.ok(!names.includes("gates.green.watch"), "empty by default, so nothing to audit");
});

test("include and exclude are distinguished, because only include can guard nothing", () => {
  const config = merge(defaults(), { source: { include: ["src/**/*.ts"] } });
  const byName = Object.fromEntries(globSettings(config).map((e) => [e.setting, e.kind]));
  assert.equal(byName["source.include"], "include");
  assert.equal(byName["source.exclude"], "exclude");
  assert.equal(byName["pair.testGlobs"], "include");
});

test("each configured layer contributes its own include entry", () => {
  const config = merge(defaults(), {
    gates: {
      structure: {
        layers: [
          { name: "domain", match: "src/domain/**", mayImport: [] },
          { name: "app", match: "src/app/**", mayImport: ["domain"] },
        ],
      },
    },
  });
  const entries = globSettings(config).filter((e) => e.setting.startsWith("gates.structure.layers"));
  assert.deepEqual(
    entries.map((e) => e.setting),
    ["gates.structure.layers[0].match", "gates.structure.layers[1].match"],
  );
  assert.ok(entries.every((e) => e.kind === "include"));
});

test("each declared suite contributes its covers globs as an include entry", () => {
  const config = merge(defaults(), {
    gates: {
      colocated: {
        suites: [
          { test: "lib/checks.test.mjs", covers: ["lib/checks/*.mjs"] },
          { test: "hooks/wiring.test.mjs", covers: ["hooks/*.mjs", "bin/*.mjs"] },
        ],
      },
    },
  });
  const entries = globSettings(config).filter((e) => e.setting.startsWith("gates.colocated.suites"));
  assert.deepEqual(
    entries.map((e) => e.setting),
    ["gates.colocated.suites[0].covers", "gates.colocated.suites[1].covers"],
  );
  assert.ok(entries.every((e) => e.kind === "include"), "a covers matching nothing is a mapping to nothing");
});

test("a layer's alias count rides along, because a layer can guard without matching a file", () => {
  const config = merge(defaults(), {
    gates: {
      structure: {
        layers: [
          { name: "app", match: "src/app/**", mayImport: ["host"] },
          { name: "host", match: "node_modules/@never-matches/**", mayImport: [], aliases: ["photoshop", "uxp"] },
        ],
      },
    },
  });
  const entries = globSettings(config).filter((e) => e.setting.startsWith("gates.structure.layers"));
  assert.deepEqual(
    entries.map((e) => e.aliases),
    [0, 2],
  );
});
