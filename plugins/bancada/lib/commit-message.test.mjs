import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TYPES,
  decideSubject,
  extractSubject,
  findDeniedTrailer,
  isCommitCommand,
  isImperative,
  isShellTool,
  parseConventional,
} from "./commit-message.mjs";

const decide = (command, settings) => decideSubject(extractSubject(command), settings);

// --- recognising a commit ---

test("a git commit is recognised in the shapes people actually type", () => {
  for (const c of [
    'git commit -m "feat: add a thing"',
    "  git   commit  -m 'fix: x'",
    'git add -A && git commit -m "fix: x"',
    'cd /repo; git commit -m "fix: x"',
    'git -C /some/repo commit -m "fix: x"',
    'GIT_AUTHOR_NAME=x git commit -m "fix: x"',
    'git commit --amend -m "fix: x"',
  ]) {
    assert.equal(isCommitCommand(c), true, c);
  }
});

test("merely mentioning a commit is not committing", () => {
  for (const c of [
    "git log --oneline",
    'echo "run git commit later"',
    "git commitmsg",
    "npm run commit",
    "git show HEAD",
  ]) {
    assert.equal(isCommitCommand(c), false, c);
  }
});

test("only shell tools carry a command line", () => {
  assert.equal(isShellTool("Bash"), true);
  assert.equal(isShellTool("PowerShell"), true);
  assert.equal(isShellTool("Write"), false);
  assert.equal(isShellTool("Edit"), false);
});

// --- extracting the subject ---

test("an inline message is read from every quoting form", () => {
  const cases = [
    ['git commit -m "feat: add a thing"', "feat: add a thing"],
    ["git commit -m 'feat: add a thing'", "feat: add a thing"],
    ['git commit --message="feat: add a thing"', "feat: add a thing"],
    ["git commit -m feat:add", "feat:add"],
  ];
  for (const [command, expected] of cases) {
    const r = extractSubject(command);
    assert.equal(r.kind, "inline", command);
    assert.equal(r.subject, expected, command);
  }
});

test("only the first line of a multi-line message is the subject", () => {
  const command = 'git commit -m "feat: add a thing\n\nA body that says more."';
  assert.equal(extractSubject(command).subject, "feat: add a thing");
});

test("a POSIX heredoc message is read", () => {
  const command = "git commit -F - <<'EOF'\nfeat: add a thing\n\nbody here\nEOF";
  const r = extractSubject(command);
  assert.equal(r.kind, "inline");
  assert.equal(r.subject, "feat: add a thing");
  assert.match(r.message, /body here/, "the whole message is captured, not only the subject");
});

test("a PowerShell here-string message is read", () => {
  const command = "git commit -m @'\nfeat: add a thing\n\nbody here\n'@";
  const r = extractSubject(command);
  assert.equal(r.kind, "inline");
  assert.equal(r.subject, "feat: add a thing");
  assert.match(r.message, /body here/);
});

test("a message the gate cannot see is reported as unreadable, never guessed", () => {
  for (const command of [
    "git commit -F message.txt",
    "git commit --file=message.txt",
    "git commit --amend --no-edit",
    "git commit",
    "git commit -a",
  ]) {
    assert.equal(extractSubject(command).kind, "unreadable", command);
  }
});

test("a non-commit command extracts nothing", () => {
  assert.deepEqual(extractSubject("git status"), { kind: "none", subject: null, message: null });
});

// --- conventional commits ---

test("a conventional subject parses into its parts", () => {
  assert.deepEqual(parseConventional("feat(parser)!: add a thing"), {
    type: "feat",
    scope: "parser",
    breaking: true,
    subject: "add a thing",
  });
  assert.deepEqual(parseConventional("fix: handle empty input"), {
    type: "fix",
    scope: null,
    breaking: false,
    subject: "handle empty input",
  });
});

test("a subject without the type prefix does not parse", () => {
  for (const s of ["add a thing", "feat add a thing", "feat:no space", "Feat: capitalised"]) {
    assert.equal(parseConventional(s), null, s);
  }
});

// --- imperative morphology, not a vocabulary ---

test("gerunds and past tense are refused", () => {
  assert.deepEqual(isImperative("adding a thing"), { ok: false, word: "adding", form: "gerund" });
  assert.deepEqual(isImperative("added a thing"), { ok: false, word: "added", form: "past tense" });
  assert.equal(isImperative("fixed the parser").ok, false);
});

test("imperatives that merely end in -ed or -ing are not refused", () => {
  for (const word of ["bring", "string", "ping", "embed", "seed", "feed", "spread", "proceed", "shed", "speed"]) {
    assert.equal(isImperative(`${word} the value`).ok, true, word);
  }
});

test("ordinary imperatives pass", () => {
  for (const word of ["add", "remove", "handle", "rename", "document", "teach"]) {
    assert.equal(isImperative(`${word} the value`).ok, true, word);
  }
});

test("an empty subject is not judged for mood", () => {
  assert.equal(isImperative("").ok, true);
  assert.equal(isImperative("   ").ok, true);
});

// --- the verdict ---

test("a well-formed subject is allowed", () => {
  const v = decide('git commit -m "feat: add the commit gate"');
  assert.equal(v.decision, "allow");
  assert.equal(v.check, "commit-ok");
});

test("a non-commit command produces no opinion at all", () => {
  const v = decide("git status");
  assert.equal(v.decision, "allow");
  assert.equal(v.check, "commit-none");
  assert.equal(v.reason, null);
});

test("an unreadable message asks the owner rather than deciding for them", () => {
  const v = decide("git commit -F message.txt");
  assert.equal(v.decision, "ask");
  assert.equal(v.check, "commit-unreadable");
  assert.match(v.reason, /cannot read this commit's subject/);
});

test("a subject that is not conventional is denied, and the reason says what to write", () => {
  const v = decide('git commit -m "made the thing work"');
  assert.equal(v.decision, "deny");
  assert.equal(v.check, "commit-conventional");
  assert.match(v.reason, /Expected "<type>: <subject>"/);
  assert.match(v.reason, /feat/);
});

test("an unknown type is denied and the configured types are listed", () => {
  const v = decide('git commit -m "wibble: add a thing"');
  assert.equal(v.check, "commit-type");
  assert.match(v.reason, new RegExp(DEFAULT_TYPES[0]));
});

test("a subject over the limit is denied with both numbers", () => {
  const long = "feat: " + "x".repeat(100);
  const v = decide(`git commit -m "${long}"`, { maxSubject: 72 });
  assert.equal(v.check, "commit-length");
  assert.match(v.reason, /106 characters/);
  assert.match(v.reason, /limit is 72/);
});

test("the length limit is configurable", () => {
  const subject = "feat: " + "x".repeat(60);
  assert.equal(decide(`git commit -m "${subject}"`, { maxSubject: 40 }).decision, "deny");
  assert.equal(decide(`git commit -m "${subject}"`, { maxSubject: 200 }).decision, "allow");
});

test("a non-imperative subject is denied after the type prefix is stripped", () => {
  const v = decide('git commit -m "feat: adding the commit gate"');
  assert.equal(v.check, "commit-imperative");
  assert.match(v.reason, /"adding", a gerund/);
});

test("an empty subject is denied", () => {
  const v = decide('git commit -m ""');
  assert.equal(v.check, "commit-empty");
});

// --- every check can be switched off, because policy belongs to the project ---

test("conventional commits can be turned off", () => {
  const v = decide('git commit -m "just some words"', { conventional: false });
  assert.equal(v.decision, "allow");
});

test("the imperative rule can be turned off", () => {
  const v = decide('git commit -m "feat: adding a thing"', { requireImperative: false });
  assert.equal(v.decision, "allow");
});

test("with conventional off, the imperative rule reads the whole subject", () => {
  const v = decide('git commit -m "adding a thing"', { conventional: false });
  assert.equal(v.check, "commit-imperative");
});

test("a project can deny its own verbs on top of the morphology rule", () => {
  const settings = { denyVerbs: ["update", "misc"] };
  assert.equal(decide('git commit -m "chore: update stuff"', settings).check, "commit-verb");
  assert.equal(decide('git commit -m "chore: rename stuff"', settings).decision, "allow");
});

test("a project can define its own type list", () => {
  const settings = { types: ["feat", "fix"] };
  assert.equal(decide('git commit -m "chore: tidy up"', settings).check, "commit-type");
  assert.equal(decide('git commit -m "fix: tidy up"', settings).decision, "allow");
});

test("checks are applied in a fixed order: shape, then length, then mood", () => {
  // A long, non-conventional, past-tense subject reports the shape problem
  // first, because fixing the shape is what the other two depend on.
  const v = decide(`git commit -m "${"added ".repeat(20)}"`);
  assert.equal(v.check, "commit-conventional");
});

// --- denied trailers: keeping attribution nobody asked for out of the history ---

test("no denied trailers configured means nothing is checked", () => {
  const command = 'git commit -m "feat: x' + String.fromCharCode(10, 10) + 'Co-Authored-By: Claude <noreply@anthropic.com>"';
  assert.equal(decide(command).decision, "allow");
});

test("a configured trailer pattern denies the commit and quotes the offending line", () => {
  const command = 'git commit -m "feat: x' + String.fromCharCode(10, 10) + 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"';
  const v = decide(command, { denyTrailers: ["^Co-Authored-By:.*Claude"] });
  assert.equal(v.decision, "deny");
  assert.equal(v.check, "commit-trailer");
  assert.match(v.reason, /Co-Authored-By: Claude Opus 5/);
  assert.match(v.reason, /Remove the line and commit again/);
});

test("trailer matching is case-insensitive, because git accepts either casing", () => {
  const command = 'git commit -m "feat: x' + String.fromCharCode(10, 10) + 'co-authored-by: Claude <a@b.c>"';
  assert.equal(decide(command, { denyTrailers: ["^Co-Authored-By:.*Claude"] }).check, "commit-trailer");
});

test("a trailer is found in the body, not only the subject", () => {
  const nl = String.fromCharCode(10);
  const command = `git commit -m "feat: a perfectly good subject${nl}${nl}Some body text.${nl}${nl}Co-Authored-By: Claude <a@b.c>"`;
  assert.equal(decide(command, { denyTrailers: ["^Co-Authored-By:.*Claude"] }).check, "commit-trailer");
});

test("a message without the trailer passes the same configuration", () => {
  const nl = String.fromCharCode(10);
  const command = `git commit -m "feat: a subject${nl}${nl}A body with no attribution."`;
  assert.equal(decide(command, { denyTrailers: ["^Co-Authored-By:.*Claude"] }).decision, "allow");
});

test("several patterns can be configured and the first match is reported", () => {
  const nl = String.fromCharCode(10);
  const command = `git commit -m "feat: x${nl}${nl}Generated with some tool"`;
  const v = decide(command, { denyTrailers: ["^Co-Authored-By:.*Claude", "Generated with"] });
  assert.equal(v.check, "commit-trailer");
  assert.match(v.reason, /Generated with some tool/);
});

test("an unusable pattern is skipped rather than crashing mid-commit", () => {
  const nl = String.fromCharCode(10);
  const command = `git commit -m "feat: x${nl}${nl}Co-Authored-By: Claude <a@b.c>"`;
  const v = decide(command, { denyTrailers: ["([unclosed", "^Co-Authored-By:.*Claude"] });
  assert.equal(v.check, "commit-trailer", "the valid pattern still applies");
});

test("findDeniedTrailer returns null for an empty or absent pattern list", () => {
  assert.equal(findDeniedTrailer("anything", []), null);
  assert.equal(findDeniedTrailer("anything", undefined), null);
});

test("a message the gate cannot read is not silently treated as trailer-free", () => {
  const v = decide("git commit -F message.txt", { denyTrailers: ["^Co-Authored-By:.*Claude"] });
  assert.equal(v.decision, "ask", "unreadable escalates rather than passing");
});
