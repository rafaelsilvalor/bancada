/**
 * The commit gate: reading a `git commit` off a shell command and judging its
 * subject line.
 *
 * Two things this deliberately does not do.
 *
 * It does not carry a vocabulary of approved verbs. A list of allowed words is
 * house style, and house style does not survive being installed into somebody
 * else's repository. What generalises is morphology: "adding" and "added" are
 * not imperative in any codebase. Projects that want a word list get
 * `denyVerbs`, which is theirs to fill.
 *
 * It does not pretend to inspect what it cannot see. `git commit -F file`,
 * `git commit` with no message, and `--amend --no-edit` all put the subject
 * somewhere this gate has no access to. Those return `unreadable`, and the
 * caller decides — a guess here would be a verdict about text nobody read.
 *
 * What it does owe the caller is WHICH of the three it hit and what to type
 * instead. An `ask` that only says "cannot read the subject" costs the owner a
 * decision and teaches nobody, so the same one arrives again tomorrow; the
 * remedy in `UNREADABLE` is the shortest correct edit of the command they
 * already wrote.
 */

/** Tools whose input is a shell command line. */
export const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

/** Conventional Commits: `type(scope)!: subject`. */
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?: (?<subject>.+)$/;

export const DEFAULT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

/**
 * Words ending in -ed or -ing that are perfectly good imperatives.
 * Without these the morphology rule refuses `feat: bring the parser inline`.
 */
const IMPERATIVE_EXCEPTIONS = new Set([
  // -ing
  "bring", "cling", "fling", "ping", "ring", "sing", "sling", "spring",
  "sting", "string", "swing", "wing", "wring", "thing",
  // -ed
  "embed", "exceed", "feed", "heed", "need", "proceed", "seed", "shed",
  "shred", "speed", "spread", "succeed", "wed",
]);

const isShellTool = (name) => SHELL_TOOLS.has(name);
export { isShellTool };

// Git's own options may sit between `git` and `commit`. Some take a separate
// argument (`git -C /repo commit`, common in scripts and worktrees), so a
// pattern that only allows valueless flags misses them.
const GIT_GLOBAL_WITH_VALUE = String.raw`(?:-[cC]|--git-dir|--work-tree|--namespace|--exec-path|--config-env)(?:=\S+|\s+\S+)`;
const GIT_GLOBAL_FLAG = String.raw`--?[^\s]+`;
const COMMIT_RE = new RegExp(
  String.raw`(^|[;&|]|\n)\s*(?:[A-Za-z0-9_]+=\S*\s+)*git\s+(?:(?:${GIT_GLOBAL_WITH_VALUE}|${GIT_GLOBAL_FLAG})\s+)*commit\b`,
);

/** True when the command line runs `git commit` rather than merely mentioning it. */
export function isCommitCommand(command) {
  if (typeof command !== "string") return false;
  return COMMIT_RE.test(command);
}

/**
 * True when the command carries a flag that puts the message out of reach.
 *
 * `-F path` reads the message from disk and `--no-edit` reuses the message of
 * an existing commit. In both cases the subject exists, but not in the command
 * line, and a gate that judged it anyway would be judging text nobody read.
 *
 * `-F -` is the exception: it reads stdin, and when stdin is a heredoc written
 * into the same command line, the message is right there. That is why the
 * heredoc is extracted before this runs.
 */
function uninspectableForm(command) {
  if (/(?:^|\s)(?:-F|--file)(?:=|\s+)(?!-(?:\s|$))\S/.test(command)) return "file";
  if (/(?:^|\s)--no-edit(?:\s|$)/.test(command)) return "reused";
  return null;
}

/**
 * What each unreadable form is, and the command that would be readable.
 *
 * Naming the form is the whole point. "bancada cannot read this commit's
 * subject" tells the owner a gate fired; it does not tell them which flag did
 * it or what to type instead, so the same `ask` arrives again next time. The
 * remedy is the shortest correct edit of the command they already wrote.
 */
const UNREADABLE = {
  file: {
    why: "-F/--file points at a file this gate cannot open",
    fix: `git commit -m "<subject>" -m "<body>"`,
  },
  reused: {
    why: "--no-edit reuses the message of a commit that already exists",
    fix: `git commit --amend -m "<subject>" -m "<body>"`,
  },
  editor: {
    why: "there is no inline message, so git would open an editor",
    fix: `git commit -m "<subject>"`,
  },
};

/**
 * Pull the commit subject out of a shell command.
 *
 * Returns `{ kind, subject, message }` where `kind` is `"inline"` when the text
 * was read, `"unreadable"` when the message exists somewhere this gate cannot
 * see, or `"none"` when the command is not a commit at all.
 *
 * `subject` is the first line; `message` is everything, because trailers live
 * in the body and a gate that only reads the subject cannot see them.
 */
export function extractSubject(command) {
  if (!isCommitCommand(command)) return { kind: "none", subject: null, message: null };

  // Heredocs first: `git commit -F - <<'EOF'` carries its message in the
  // command line even though it names a file flag.
  const heredoc = command.match(/<<-?\s*['"]?(\w+)['"]?\r?\n([\s\S]*?)\r?\n\1/);
  if (heredoc) return inline(heredoc[2]);

  // PowerShell here-string: @' ... '@ or @" ... "@
  const hereString = command.match(/@(['"])\r?\n([\s\S]*?)\r?\n\1@/);
  if (hereString) return inline(hereString[2]);

  const form = uninspectableForm(command);
  if (form) {
    return { kind: "unreadable", subject: null, message: null, form, why: UNREADABLE[form].why };
  }

  // Every -m, not just the first. `git commit -m subject -m body` is an
  // ordinary form, and git joins the parts into one message with blank lines
  // between them. Reading only the first would leave anything in the later
  // parts unexamined — a trailer in a second -m would pass a denyTrailers rule
  // that exists precisely to catch it.
  const parts = [];
  for (const m of command.matchAll(/(?:-m|--message)(?:=|\s+)(?:(['"])([\s\S]*?)\1|(\S+))/g)) {
    parts.push(m[2] ?? m[3]);
  }
  if (parts.length > 0) return inline(parts.join("\n\n"), firstLine(parts[0]));

  // A commit with no -m opens an editor; the subject does not exist yet.
  return { kind: "unreadable", subject: null, message: null, form: "editor", why: UNREADABLE.editor.why };
}

const firstLine = (s) => String(s).split(/\r?\n/)[0].trim();
const inline = (text, subject) => ({
  kind: "inline",
  subject: subject ?? firstLine(text),
  message: String(text),
});

/** Split a Conventional Commits subject, or return null when it does not match. */
export function parseConventional(subject) {
  const m = CONVENTIONAL.exec(subject);
  if (!m) return null;
  return {
    type: m.groups.type,
    scope: m.groups.scope ?? null,
    breaking: Boolean(m.groups.breaking),
    subject: m.groups.subject,
  };
}

/** Whether the first word reads as an imperative. */
export function isImperative(text) {
  const word = String(text).trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return { ok: true, word: null };
  if (IMPERATIVE_EXCEPTIONS.has(word)) return { ok: true, word };
  if (word.endsWith("ing")) return { ok: false, word, form: "gerund" };
  if (word.endsWith("ed")) return { ok: false, word, form: "past tense" };
  return { ok: true, word };
}

/**
 * Judge a commit subject against the project's settings.
 *
 * Returns `{ decision, check, reason }`. `decision` is `allow`, `deny` or
 * `ask`. `ask` is used where the gate has an opinion but not certainty — an
 * unreadable message is the owner's call, not the gate's.
 */
export function decideSubject(extraction, settings) {
  const {
    conventional = true,
    maxSubject = 72,
    requireImperative = true,
    denyVerbs = [],
    denyTrailers = [],
    types = DEFAULT_TYPES,
  } = settings ?? {};

  if (extraction.kind === "none") {
    return { decision: "allow", check: "commit-none", reason: null };
  }

  if (extraction.kind === "unreadable") {
    const remedy = UNREADABLE[extraction.form] ?? UNREADABLE.editor;
    return {
      decision: "ask",
      check: "commit-unreadable",
      reason:
        `bancada did not check this commit's subject: ${extraction.why}. ` +
        `Re-run with the message inline and this becomes an ordinary check: ${remedy.fix}. ` +
        `Or confirm, if you know the message follows the project's convention.`,
    };
  }

  const raw = extraction.subject ?? "";
  if (raw === "") {
    return { decision: "deny", check: "commit-empty", reason: "The commit subject is empty." };
  }

  let body = raw;
  if (conventional) {
    const parsed = parseConventional(raw);
    if (!parsed) {
      return {
        decision: "deny",
        check: "commit-conventional",
        reason:
          `Commit subject does not follow Conventional Commits: "${raw}"\n` +
          `Expected "<type>: <subject>", for example "fix: handle an empty payload".\n` +
          `Types configured for this project: ${types.join(", ")}.`,
      };
    }
    if (!types.includes(parsed.type)) {
      return {
        decision: "deny",
        check: "commit-type",
        reason:
          `Commit type "${parsed.type}" is not one this project uses.\n` +
          `Configured types: ${types.join(", ")}.`,
      };
    }
    body = parsed.subject;
  }

  if (raw.length > maxSubject) {
    return {
      decision: "deny",
      check: "commit-length",
      reason:
        `Commit subject is ${raw.length} characters; this project's limit is ${maxSubject}.\n` +
        `Move the detail into the body, which has no limit.`,
    };
  }

  if (requireImperative) {
    const verdict = isImperative(body);
    if (!verdict.ok) {
      return {
        decision: "deny",
        check: "commit-imperative",
        reason:
          `Commit subject starts with "${verdict.word}", a ${verdict.form}. ` +
          `Write the subject as an instruction: "add", not "added" or "adding".`,
      };
    }
  }

  const denied = denyVerbs.map((v) => v.toLowerCase());
  const firstWord = body.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
  if (firstWord && denied.includes(firstWord)) {
    return {
      decision: "deny",
      check: "commit-verb",
      reason: `This project's configuration denies commit subjects starting with "${firstWord}".`,
    };
  }

  const trailer = findDeniedTrailer(extraction.message ?? raw, denyTrailers);
  if (trailer) {
    return {
      decision: "deny",
      check: "commit-trailer",
      reason:
        `This commit message contains a trailer this project does not allow:\n` +
        `  ${trailer.line}\n` +
        `It matched the configured pattern "${trailer.pattern}". Remove the line and commit again.`,
    };
  }

  return { decision: "allow", check: "commit-ok", reason: null };
}

/**
 * Find the first line of a message matching one of the denied trailer patterns.
 *
 * Patterns are matched case-insensitively against whole lines. This is where a
 * project removes attribution it does not want in its history — an assistant's
 * `Co-Authored-By`, a bot's `Signed-off-by`, a generator's advertisement.
 *
 * Worth being clear about the guarantee: this reads the command line, so it is
 * exact for an inline `-m` message and blind to one that comes from a file or
 * an editor, which return `unreadable` above. A project that wants the property
 * to hold unconditionally should pair this with a git `commit-msg` hook, which
 * sees every commit however it was made. This gate catches it earlier, in the
 * turn, where the model can still fix it.
 */
export function findDeniedTrailer(message, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return null;
  const lines = String(message).split(/\r?\n/);
  for (const pattern of patterns) {
    let re;
    try {
      re = new RegExp(pattern, "i");
    } catch {
      continue; // an unusable pattern is skipped, never a crash mid-commit
    }
    for (const line of lines) {
      if (re.test(line)) return { line: line.trim(), pattern };
    }
  }
  return null;
}
