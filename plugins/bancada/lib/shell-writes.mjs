/**
 * The files a shell command writes, read off the command line.
 *
 * Three write gates — layering, size and the test/code pair — accepted only the
 * write tools, so the same violation was refused through `Write` and allowed
 * through `cat > file <<'EOF'`. Measured before this module existed, six paired
 * payloads through the real entry point: 5 of 6 refused by the write route and
 * allowed by the shell route. Only the secret gate saw both, because it was the
 * only one reading a command line.
 *
 * The precedent for reading a heredoc is already in this repository.
 * `commit-message.mjs` extracts one for `git commit -F -`, because a message in
 * a heredoc is on the command line even though the flag names a file. This is
 * that mechanism pointed at three more gates.
 *
 * **Found by pattern, not by parsing** — the same bargain `lib/imports.mjs`
 * makes, and for the same reason. There is no shell parser here and there will
 * not be one: word splitting, expansion, subshells and `eval` mean the only
 * complete answer is running the command, which is the thing a `PreToolUse` gate
 * exists to happen before. So a shape that is not recognised produces no target
 * rather than a wrong one, and a shape that would produce a *wrong* path is
 * dropped in preference to naming the wrong file.
 *
 * Every target says whether its text is readable, because the two facts lead to
 * different verdicts. Text in hand is judged exactly as a write tool's would be.
 * Text that cannot be known is a coverage gap, and the gates record it under a
 * rule of its own so `bancada yield` counts how often they could not look.
 *
 * ## What this cannot see, stated rather than discovered
 *
 * - A path built from a variable or a command substitution — `> "$out"`,
 *   `> $(mktemp)`. The path is not in the text, so there is nothing to name.
 * - A program that writes files of its own accord: `npm run build`, `make`,
 *   `git checkout`, a formatter, a code generator, `find -exec`.
 * - The text a transform produces. `sed -i`, `perl -i` and a redirect fed by
 *   another program name their file and not its contents.
 * - A heredoc whose delimiter is unquoted *and* whose body contains `$`, a
 *   backtick or a backslash. The shell would expand those, so the body on the
 *   command line is not what lands in the file.
 * - More than one file per in-place edit or copy: only the last argument is
 *   read, so `sed -i 's/a/b/' one.mjs two.mjs` names `two.mjs` alone.
 * - A path containing whitespace, quoted or not. Allowing one would mean
 *   trusting a tokenizer that has no shell behind it, and the failure would be a
 *   verdict about a filename that was really two.
 * - `2>` and `1>`: an explicit file descriptor is skipped, so a command
 *   redirecting stdout by number writes unseen. A `>` inside quotes is read as
 *   a redirect, which is the one direction this errs the other way.
 * - PowerShell's cmdlets unless the path is the first argument or follows
 *   `-Path`. `Set-Content -Encoding utf8 -Path f` is missed rather than guessed
 *   at, because the alternative was reading `utf8` as a filename.
 */

/** How the file changes: the whole contents, an append, or not knowable. */
const REPLACE = "replace";
const APPEND = "append";
const UNKNOWN = "unknown";

/** A pathological command line must not turn into unbounded work. */
const MAX_TARGETS = 20;

/**
 * A heredoc opener with its body.
 *
 * Group 1 is whatever preceded `<<` on that line and group 5 is whatever
 * followed the delimiter, because the redirect can be on either side:
 * `cat > f <<'EOF'` and `cat <<'EOF' > f` are both ordinary. The quote in group
 * 3 is backreferenced so `<<'EOF"` is not read as a quoted delimiter, and the
 * body is optional so an empty heredoc still names its file.
 */
const HEREDOC =
  /([^\r\n]*)<<(-?)[ \t]*(['"]?)([A-Za-z_]\w*)\3([^\r\n]*)(?:\r?\n([\s\S]*?))?\r?\n[ \t]*\4[ \t]*(?=\r?\n|$)/g;

/** PowerShell's here-string: `@'` … `'@`, or `@"` … `"@`. */
const HERE_STRING = /@(['"])\r?\n([\s\S]*?)\r?\n\1@/g;

/**
 * A redirect and its target.
 *
 * `(?<!\d)` drops `2>` and `1>`: an explicit descriptor is a shape this does
 * not claim to read, and reporting `2> log` as a write to `log` would be a
 * finding about the wrong stream. `(?!&)` drops `>&1`.
 */
const REDIRECT = /(?<!\d)(>>?)[ \t]*(?!&)(?:'([^']*)'|"([^"]*)"|([^\s;|&<>()]+))/g;

/** `tee f`, `tee -a f`, and the same through a pipe. */
const TEE = /\btee\b[ \t]+((?:-[\w-]+[ \t]+)*)(?:'([^']*)'|"([^"]*)"|([^\s;|&<>()]+))/g;

/**
 * PowerShell's file-writing cmdlets.
 *
 * The path has to be the first argument or follow `-Path`. Letting the pattern
 * skip over other flags made it read `-Encoding utf8` as a write to `utf8`,
 * which is worse than not seeing the command at all.
 */
const CMDLET =
  /\b(Set-Content|Add-Content|Out-File)\b(?:[ \t]+-(?:Path|FilePath|LiteralPath))?[ \t]+(?:'([^']*)'|"([^"]*)"|([^\s;|&<>()-][^\s;|&<>()]*))/gi;

/** In-place editors: the file is named, the resulting text is not. */
const IN_PLACE = /\b(?:sed|perl|ruby)\b[^\r\n;|&]*?\s-[\w-]*i[\w-]*\b([^\r\n]*)/g;

/** A copy or a move: the destination is the last word. */
const COPY = /\b(?:cp|mv)\b([^\r\n]*)/g;

/** The word a quoted-or-bare capture triple settled on. */
const word = (m, i) => m[i] ?? m[i + 1] ?? m[i + 2] ?? null;

/**
 * Is this a path a gate could judge?
 *
 * A path carrying `$`, a backtick or a glob is not a path, it is a pattern that
 * becomes one at run time. `/dev/null` and `NUL` are the shell's bin.
 */
function usablePath(p) {
  if (typeof p !== "string" || p === "") return false;
  if (/[$`*?]/.test(p)) return false;
  if (/\s/.test(p)) return false;
  if (/^(?:\/dev\/(?:null|stdout|stderr)|NUL|CON)$/i.test(p)) return false;
  return !p.endsWith("/") && !p.endsWith("\\");
}

/**
 * A command's arguments, quotes removed, stopping at a separator.
 *
 * Splitting on whitespace was wrong, and wrong in the worst direction.
 * `sed -i '1i import x from "../hooks/y.mjs";' src/lib/a.mjs` carries a `;`
 * inside its script, so a pattern that stopped at the first `;` left
 * `../hooks/y.mjs` as the last word and the gate judged **the wrong file** —
 * measured, and it came back `structure-outside` where the truth was
 * `structure-unreadable`. Quote state is tracked here for that one reason: a
 * separator inside quotes is text, and naming the wrong file is worse than
 * naming none.
 */
function argumentsOf(fragment) {
  const args = [];
  let current = "";
  let quote = "";
  let started = false;
  for (const ch of String(fragment ?? "")) {
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (";|&<>".includes(ch)) break;
    if (ch === " " || ch === "\t") {
      if (started) args.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) args.push(current);
  return args;
}

/** The last argument of a command's argument list, when it is not a flag. */
function lastArgument(fragment) {
  const args = argumentsOf(fragment);
  const last = args[args.length - 1];
  return { count: args.length, last: last && !last.startsWith("-") ? last : null };
}

/** Every file-naming shape in a fragment, in the order they appear. */
function* namedFiles(fragment) {
  const text = String(fragment);
  for (const m of text.matchAll(REDIRECT)) {
    yield { path: word(m, 2), mode: m[1] === ">>" ? APPEND : REPLACE, form: "redirect" };
  }
  for (const m of text.matchAll(TEE)) {
    yield { path: word(m, 2), mode: /(?:^|\s)-\w*a/.test(m[1] ?? "") ? APPEND : REPLACE, form: "tee" };
  }
  for (const m of text.matchAll(CMDLET)) {
    yield {
      path: word(m, 2),
      mode: m[1].toLowerCase() === "add-content" ? APPEND : REPLACE,
      form: "cmdlet",
    };
  }
}

/**
 * Where a text-carrying shape's text is going.
 *
 * The last one wins, which is what the shell does for stdout, and it covers the
 * PowerShell idiom of piping a here-string into `Set-Content`.
 */
function destination(fragment) {
  let found = null;
  for (const target of namedFiles(fragment)) {
    if (usablePath(target.path)) found = target;
  }
  return found;
}

/**
 * Whether a heredoc body reaches the file unchanged.
 *
 * A quoted delimiter tells the shell to leave the body alone, which is what
 * makes it readable. An unquoted one expands `$var`, a backtick and a
 * backslash; with none of those present the body is still literal, and with any
 * of them the text on the command line is not the text that lands.
 */
const literalBody = (quote, body) => quote !== "" || !/[$`\\]/.test(body);

/** A heredoc or here-string body, terminated the way a file would be. */
const bodyText = (body) => (body === "" || body === undefined ? "" : body + "\n");

/**
 * Every file this command line writes, as far as the patterns above can tell.
 *
 * Returns `[{ path, text, mode, form }]`, where `text` is null when the
 * resulting contents cannot be known. The list is empty for a command that
 * writes nothing recognisable, which is not the same as a command that writes
 * nothing.
 */
export function shellWrites(command) {
  if (typeof command !== "string" || command === "") return [];
  const out = [];
  const seen = new Set();
  let rest = command;

  const add = (path, text, mode, form) => {
    if (out.length >= MAX_TARGETS) return;
    if (!usablePath(path)) return;
    // One target per path. Text-carrying shapes are consumed first, so a
    // heredoc is never overwritten by the bare redirect it was attached to.
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, text, mode, form });
  };

  /** Consume a text-carrying shape, and blank its span so it is not re-read. */
  const takeBodies = (pattern, form, textOf, fragmentOf) => {
    const spans = [];
    for (const m of rest.matchAll(pattern)) {
      const target = destination(fragmentOf(m));
      if (target) add(target.path, textOf(m), target.mode, form);
      spans.push([m.index, m.index + m[0].length]);
    }
    for (const [from, to] of spans.reverse()) {
      rest = rest.slice(0, from) + " ".repeat(to - from) + rest.slice(to);
    }
  };

  takeBodies(
    HEREDOC,
    "heredoc",
    (m) => (literalBody(m[3] ?? "", m[6] ?? "") ? bodyText(m[6]) : null),
    (m) => `${m[1]} ${m[5]}`,
  );
  // A here-string's destination can be anywhere in the command, because the
  // PowerShell form pipes it onward rather than redirecting on the same words.
  takeBodies(
    HERE_STRING,
    "here-string",
    (m) => bodyText(m[2]),
    () => rest,
  );

  // What is left names files without saying what goes in them.
  for (const target of namedFiles(rest)) add(target.path, null, target.mode, target.form);
  for (const m of rest.matchAll(IN_PLACE)) {
    const { last } = lastArgument(m[1]);
    if (last) add(last, null, UNKNOWN, "in-place edit");
  }
  for (const m of rest.matchAll(COPY)) {
    const { count, last } = lastArgument(m[1]);
    if (count >= 2 && last) add(last, null, REPLACE, "copy");
  }

  return out;
}
