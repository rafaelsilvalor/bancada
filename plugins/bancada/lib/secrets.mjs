/**
 * The secret gate: refusing a credential in the turn that writes it.
 *
 * This is the only gate that is on by default, which changes what a pattern has
 * to earn before it ships. A layering rule a project opted into can afford to be
 * argued with; a default-on refusal that fires on somebody's fixture gets the
 * whole harness switched off, and then every gate is gone at once. So the
 * default families are prefix-anchored — `AKIA`, `ghp_`, `sk-ant-`, a PEM header
 * — where the shape is issued by a provider and does not occur by accident. The
 * family that matches ordinary code shapes (`password = "..."`) is real and
 * useful and is *not* on by default, because it is the one that cries wolf.
 *
 * What this deliberately does not do.
 *
 * It does not read the file on disk. It judges the text this turn introduces, so
 * a credential that was already committed is not re-refused on every edit — that
 * is `git secrets` scanning history, a different job at a different moment.
 *
 * It does not put the match in the refusal. The reason travels to the model and
 * into a transcript, and a gate whose complaint about a leaked key is to quote
 * the key has leaked it a second time. The reason carries the family, the line
 * and a masked prefix, which is enough to find it.
 *
 * What it misses, stated rather than implied: a credential with no issuer prefix
 * and no assignment around it — a bare high-entropy string in a data file — is
 * invisible to every family here. Under-detecting is the direction this gate
 * errs in on purpose.
 */

/**
 * Prefix-anchored provider credentials. Each entry is a name and a pattern that
 * a provider issues in that exact shape.
 */
const PROVIDER = [
  ["an AWS access key id", /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/g],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36}\b/g],
  ["a GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
  ["a GitLab personal access token", /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ["a Slack token", /\bxox[abeoprs]-[A-Za-z0-9-]{10,}\b/g],
  ["a Slack webhook", /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9/+_-]{20,}/g],
  ["a Stripe live key", /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["an Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{24,}\b/g],
  ["an OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ["a npm access token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["a SendGrid API key", /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g],
  ["a Twilio account SID", /\bAC[0-9a-fA-F]{32}\b/g],
  ["a private key in a URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{8,}@[^\s/]+/g],
];

/** Key material pasted in full. The header alone is the finding. */
const KEY = [
  ["a private key block", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
  ["a PGP private key block", /-----BEGIN PGP PRIVATE KEY BLOCK-----/g],
];

/**
 * Shapes that look like a credential without saying who issued it.
 *
 * Opt-in. `token = "..."` is the single most common way a real key gets
 * committed and also the single most common false positive, and which of those
 * a project has more of is not something bancada can know from outside.
 */
const GENERIC = [
  [
    "a credential assigned to a name that says it is one",
    /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|private[_-]?key)\b\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
  ],
  ["a JSON Web Token", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
];

export const FAMILIES = {
  provider: PROVIDER,
  key: KEY,
  generic: GENERIC,
};

/** Families a project gets without asking. */
export const DEFAULT_FAMILIES = ["provider", "key"];

/**
 * Text that announces itself as not a secret.
 *
 * A fixture, a template and a piece of documentation all need something
 * key-shaped in them, and refusing those is how this gate stops being trusted.
 * Anything naming itself an example is skipped — including AWS's own
 * `AKIAIOSFODNN7EXAMPLE`, which appears in more documentation than any real key.
 */
const PLACEHOLDER =
  /example|sample|placeholder|dummy|redacted|changeme|change[_-]?me|your[_-]?|my[_-]?(?:secret|token|key|password)|xxxx|\.\.\.|<[^>]*>|\$\{|%[A-Z_]+%|test[_-]?(?:key|token|secret)|not[_-]?a[_-]?(?:real|secret)/i;

/** True when a match is transparently a stand-in rather than a credential. */
export function isPlaceholder(value) {
  const s = String(value);
  if (PLACEHOLDER.test(s)) return true;
  // One character repeated is a mask, not a key: "aaaaaaaa", "00000000", "********".
  const body = s.replace(/^[A-Za-z_-]+[_-]/, "");
  return body.length > 3 && new Set(body).size <= 2;
}

/**
 * A finding, with enough to locate the line and not enough to leak it.
 *
 * Four characters of prefix identify which key it was to someone who has the
 * key, and identify nothing to anyone who does not.
 */
export function mask(value) {
  const s = String(value);
  if (s.length <= 4) return `${"*".repeat(s.length)} (${s.length} chars)`;
  return `${s.slice(0, 4)}${"*".repeat(Math.min(8, s.length - 4))} (${s.length} chars)`;
}

/** Compile the project's own patterns, skipping any that will not compile. */
export function compileCustom(patterns) {
  const out = [];
  for (const pattern of patterns ?? []) {
    try {
      out.push([`a pattern this project denies (${pattern})`, new RegExp(pattern, "g")]);
    } catch {
      // An unusable pattern is skipped rather than crashing a tool call. It is
      // reported by `bancada doctor`, where there is somebody to read it.
    }
  }
  return out;
}

/** Every enabled family's patterns, plus the project's own. */
export function activePatterns(settings) {
  const names = settings?.builtin ?? DEFAULT_FAMILIES;
  const out = [];
  for (const name of names) {
    for (const entry of FAMILIES[name] ?? []) out.push([name, ...entry]);
  }
  for (const entry of compileCustom(settings?.custom)) out.push(["custom", ...entry]);
  return out;
}

/**
 * Scan text for credentials.
 *
 * Returns a list of `{ family, name, line, masked }`. The same credential found
 * by two patterns is reported once, at the line where it appears.
 */
export function scan(text, settings) {
  if (typeof text !== "string" || text === "") return [];
  const found = new Map();

  // The line is counted from the match offset rather than by searching for the
  // matched text again. Searching would report the wrong line for a value that
  // occurs twice, and no line at all for one that spans a newline.
  const lineAt = (index) => text.slice(0, index).split(/\r?\n/).length;

  for (const [family, name, pattern] of activePatterns(settings)) {
    const re = pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, pattern.flags + "g");
    for (const m of text.matchAll(re)) {
      // A capture group means the pattern matched a context and the group is the
      // credential; with no group, the match is the credential.
      const value = m[1] ?? m[0];
      if (isPlaceholder(value)) continue;
      const key = `${family}:${value}`;
      if (found.has(key)) continue;
      found.set(key, { family, name, line: lineAt(m.index), masked: mask(value) });
    }
  }

  return [...found.values()].sort((a, b) => a.line - b.line);
}

/**
 * Judge the text a tool call is introducing.
 *
 * Returns `{ decision, rule, reason, findings }`. There is no `ask` here: a
 * credential in a diff is not a judgement call, and asking would put the
 * decision in front of the person at the one moment they are least likely to
 * read it.
 */
export function checkSecrets(text, where, settings) {
  const findings = scan(text, settings);
  if (findings.length === 0) {
    return { decision: "allow", rule: "secrets-ok", reason: null, findings: [] };
  }

  const families = [...new Set(findings.map((f) => f.family))].sort();
  const lines = [
    `This would write ${findings.length === 1 ? "a credential" : `${findings.length} credentials`} into ${where}:`,
    "",
    ...findings.map((f) => `  line ${f.line}: ${f.name} — ${f.masked}`),
    "",
    "The value is masked here on purpose; bancada does not repeat a secret back.",
    "Move it into an environment variable or the project's secret store and",
    "reference it by name. If this is a fixture, make it obviously one — a value",
    "containing EXAMPLE or a placeholder is not refused.",
  ];

  return {
    decision: "deny",
    rule: `secrets-${families.join("+")}`,
    reason: lines.join("\n"),
    findings,
  };
}
