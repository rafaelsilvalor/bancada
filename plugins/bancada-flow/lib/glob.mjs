/**
 * A small glob matcher, written rather than depended on.
 *
 * Node has `path.matchesGlob`, but it is experimental, and an experimental
 * warning is printed to stderr. A hook communicates a refusal through stderr
 * and exit 2, so anything else arriving on that channel is noise in the one
 * place noise is most expensive. A hundred lines of our own is the cheaper trade.
 *
 * Supported: `*` (not crossing `/`), `**` (crossing `/`), `?`, `{a,b}`,
 * `[abc]` and `[!abc]`. Paths are compared with forward slashes; `normalisePath`
 * converts Windows separators before matching.
 *
 * Copied from the bancada plugin rather than imported from it. A plugin cannot
 * reach into another plugin's directory without assuming where the host put it,
 * and an install layout nobody documented is not something to build on.
 * `pinned.test.mjs` runs both copies over the same table and fails on any
 * disagreement, so the duplication is detected rather than trusted.
 */

const SPECIAL = /[.+^$()|\\]/g;

/** Expand `{a,b}` groups into separate patterns. Nested groups are expanded too. */
export function expandBraces(pattern) {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];

  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [pattern]; // unbalanced: treat as literal

  const head = pattern.slice(0, open);
  const tail = pattern.slice(close + 1);
  const body = pattern.slice(open + 1, close);

  const options = [];
  let current = "";
  let nest = 0;
  for (const ch of body) {
    if (ch === "{") nest++;
    if (ch === "}") nest--;
    if (ch === "," && nest === 0) {
      options.push(current);
      current = "";
    } else current += ch;
  }
  options.push(current);

  return options.flatMap((opt) => expandBraces(head + opt + tail));
}

/** Compile one brace-free glob to an anchored RegExp. */
function compileOne(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` consumes zero or more path segments; a bare `**` matches the rest.
        if (pattern[i + 2] === "/") {
          out += "(?:[^/]*/)*";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }

    if (ch === "?") {
      out += "[^/]";
      continue;
    }

    if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        out += "\\["; // unterminated class: literal, matches nothing useful
        continue;
      }
      let body = pattern.slice(i + 1, end);
      const negated = body.startsWith("!") || body.startsWith("^");
      if (negated) body = body.slice(1);
      out += "[" + (negated ? "^" : "") + body.replace(/\\/g, "\\\\") + "]";
      i = end;
      continue;
    }

    out += ch.replace(SPECIAL, "\\$&");
  }
  return new RegExp("^" + out + "$");
}

/** Compile a glob (braces allowed) into a predicate over forward-slash paths. */
export function compileGlob(pattern) {
  const regexes = expandBraces(pattern).map(compileOne);
  return (path) => regexes.some((re) => re.test(path));
}

/** Compile a list of globs into one predicate. An empty list matches nothing. */
export function compileGlobs(patterns) {
  const tests = (patterns ?? []).map(compileGlob);
  return (path) => tests.some((t) => t(path));
}

/** Normalise a path for matching: forward slashes, no leading `./`. */
export function normalisePath(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

/** True when `path` matches any pattern in `patterns`. */
export function matchesAny(path, patterns) {
  return compileGlobs(patterns)(normalisePath(path));
}
