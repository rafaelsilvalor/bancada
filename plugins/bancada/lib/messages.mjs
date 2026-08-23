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
    "doctor.routes": () => "Write routes",
    "doctor.routes.judged": () => "judged  a write tool, and a shell command carrying its own text (a heredoc, a here-string)",
    "doctor.routes.unseen": () =>
      "unseen  text a command line does not carry: sed -i, a redirect fed by another program, a build step",
    "doctor.routes.counted": () =>
      "        those are recorded as structure-unreadable and size-unknown, so bancada yield says how often",
    "doctor.routes.pair": () => "pair    judges every recognised route: its verdict needs the path, not the text",
    "doctor.globs": () => "Glob coverage",
    "doctor.glob.matches": ({ setting, count }) => `${count} file(s)  ${setting}`,
    "doctor.glob.empty": ({ setting }) => `no matches  ${setting}  — this setting guards nothing`,
    "doctor.glob.aliases": ({ setting, aliases }) =>
      `no file matches  ${setting}  — guarding ${aliases} bare specifier(s) by alias`,
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
    "skills.title": () => "Skill listing budget",
    "skills.none": () => "No skills found in this project.",
    "skills.usage": ({ used, budget, pct, model }) =>
      `${used} of about ${budget} characters (${pct}%) against a ${model}-sized window.`,
    "skills.assumption": () =>
      "The budget is ~1% of the model's context window, so it shrinks on a smaller model. This assumes the model named above.",
    "skills.over": () =>
      "Over budget. Claude Code drops descriptions starting with the skills you invoke least, so the newest skill stops triggering first and nothing announces it.",
    "skills.entry": ({ name, chars, note }) => `${String(chars).padStart(6)}  ${name}${note}`,
    "skills.hidden": ({ n }) => `${n} skill(s) are model-invisible and cost nothing in the listing.`,
    "skills.truncated": ({ names }) => `Already truncated at the per-entry cap: ${names}`,
    "skills.undescribed": ({ names }) => `No description, so the model cannot match them: ${names}`,
    "skills.lever": () =>
      "The strongest lever is disable-model-invocation on skills only you invoke: those leave the listing entirely.",
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
    "doctor.routes": () => "Rotas de escrita",
    "doctor.routes.judged": () =>
      "julgada  ferramenta de escrita, e comando de shell que carrega o próprio texto (heredoc, here-string)",
    "doctor.routes.unseen": () =>
      "cega     texto que a linha de comando não carrega: sed -i, redirecionamento vindo de outro programa, build",
    "doctor.routes.counted": () =>
      "         esses ficam como structure-unreadable e size-unknown, então o bancada yield diz quantas vezes",
    "doctor.routes.pair": () => "pair     julga toda rota reconhecida: o veredito precisa do caminho, não do texto",
    "doctor.globs": () => "Cobertura dos globs",
    "doctor.glob.matches": ({ setting, count }) => `${count} arquivo(s)  ${setting}`,
    "doctor.glob.empty": ({ setting }) => `nenhum match  ${setting}  — esse ajuste não guarda nada`,
    "doctor.glob.aliases": ({ setting, aliases }) =>
      `nenhum arquivo casa  ${setting}  — guardando ${aliases} especificador(es) por alias`,
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
    "skills.title": () => "Orçamento da listagem de skills",
    "skills.none": () => "Nenhuma skill encontrada neste projeto.",
    "skills.usage": ({ used, budget, pct, model }) =>
      `${used} de cerca de ${budget} caracteres (${pct}%) para uma janela do tamanho de ${model}.`,
    "skills.assumption": () =>
      "O orçamento é ~1% da janela do modelo, então encolhe em modelo menor. Isto assume o modelo nomeado acima.",
    "skills.over": () =>
      "Acima do orçamento. O Claude Code descarta descrições começando pelas skills menos invocadas, então a mais nova para de disparar primeiro e nada avisa.",
    "skills.entry": ({ name, chars, note }) => `${String(chars).padStart(6)}  ${name}${note}`,
    "skills.hidden": ({ n }) => `${n} skill(s) são invisíveis ao modelo e não custam nada na listagem.`,
    "skills.truncated": ({ names }) => `Já truncadas no teto por entrada: ${names}`,
    "skills.undescribed": ({ names }) => `Sem descrição, então o modelo não tem como casar: ${names}`,
    "skills.lever": () =>
      "A alavanca mais forte é disable-model-invocation nas skills que só você invoca: essas saem da listagem inteira.",
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
