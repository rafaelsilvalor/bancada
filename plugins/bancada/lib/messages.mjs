/**
 * What bancada says, in the language the project asked for.
 *
 * The product is written in English — code, comments, docs, commits. What the
 * product *emits* is a different audience: the person reading a refusal at the
 * moment they are refused. That text follows the `language` setting.
 *
 * A missing key falls back to English rather than throwing or printing a blank.
 * A gate that cannot phrase its reason should still state it.
 */

export const FALLBACK = "en";

const CATALOG = {
  en: {
    "doctor.title": () => "bancada doctor",
    "doctor.config.defaults": ({ file }) => `config: none found at ${file} — running on defaults`,
    "doctor.config.file": ({ file }) => `config: ${file}`,
    "doctor.errors": () => "Errors",
    "doctor.warnings": () => "Warnings",
    "doctor.gates": () => "Gates",
    "doctor.gate.on": ({ name }) => `on   ${name}`,
    "doctor.gate.off": ({ name }) => `off  ${name}`,
    "doctor.globs": () => "Glob coverage",
    "doctor.glob.matches": ({ setting, count }) => `${count} file(s)  ${setting}`,
    "doctor.glob.empty": ({ setting }) => `no matches  ${setting}  — this setting guards nothing`,
    "doctor.files.source": ({ source, count }) =>
      source === "git"
        ? `${count} file(s) from git ls-files`
        : `${count} file(s) from a directory walk (not a git repository)`,
    "doctor.files.truncated": () => "file list was truncated; glob counts below are a lower bound",
    "doctor.blindspots": () => "Blind spots",
    "doctor.blindspot": ({ dir, files }) => `${dir}/ — ${files} file(s), matched by no source glob`,
    "doctor.session": ({ effort }) => `session effort: ${effort ?? "unknown"}`,
    "doctor.ok": () => "No problems found.",
    "doctor.nogates": () => "No gates are enabled. bancada is installed but guarding nothing.",
  },

  "pt-BR": {
    "doctor.title": () => "bancada doctor",
    "doctor.config.defaults": ({ file }) => `config: nada encontrado em ${file} — rodando nos padrões`,
    "doctor.config.file": ({ file }) => `config: ${file}`,
    "doctor.errors": () => "Erros",
    "doctor.warnings": () => "Avisos",
    "doctor.gates": () => "Gates",
    "doctor.gate.on": ({ name }) => `on   ${name}`,
    "doctor.gate.off": ({ name }) => `off  ${name}`,
    "doctor.globs": () => "Cobertura dos globs",
    "doctor.glob.matches": ({ setting, count }) => `${count} arquivo(s)  ${setting}`,
    "doctor.glob.empty": ({ setting }) => `nenhum match  ${setting}  — esse ajuste não guarda nada`,
    "doctor.files.source": ({ source, count }) =>
      source === "git"
        ? `${count} arquivo(s) via git ls-files`
        : `${count} arquivo(s) por varredura de diretório (não é repositório git)`,
    "doctor.files.truncated": () => "a lista de arquivos foi truncada; as contagens abaixo são piso, não total",
    "doctor.blindspots": () => "Zonas cegas",
    "doctor.blindspot": ({ dir, files }) => `${dir}/ — ${files} arquivo(s), fora de todo glob de source`,
    "doctor.session": ({ effort }) => `effort da sessão: ${effort ?? "desconhecido"}`,
    "doctor.ok": () => "Nenhum problema encontrado.",
    "doctor.nogates": () => "Nenhum gate habilitado. A bancada está instalada e não guarda nada.",
  },
};

/** Languages with a catalog. */
export function languages() {
  return Object.keys(CATALOG);
}

/**
 * Render a message.
 *
 * Falls back to English for an unknown language, and to the key itself for an
 * unknown key — a visible `doctor.some.key` in the output is a bug report,
 * where a blank line is a mystery.
 */
export function t(lang, key, params = {}) {
  const table = CATALOG[lang] ?? CATALOG[FALLBACK];
  const render = table[key] ?? CATALOG[FALLBACK][key];
  if (!render) return key;
  try {
    return render(params);
  } catch {
    return key;
  }
}

/** Keys present in English but missing from another catalog. Used by the tests. */
export function missingKeys(lang) {
  const table = CATALOG[lang];
  if (!table) return Object.keys(CATALOG[FALLBACK]);
  return Object.keys(CATALOG[FALLBACK]).filter((k) => !(k in table));
}
