import { test } from "node:test";
import assert from "node:assert/strict";
import { briefPathFor, checkPauses, currentBranch, isCommit, pauseBrief, pauseEvidence, pauseTests } from "./pauses.mjs";
import { FLOW_DEFAULTS, PAIR_DEFAULTS, loadFlowConfig } from "./config.mjs";

const NL = String.fromCharCode(10);
const doc = (...lines) => lines.join(NL);

const BRIEF = doc(
  "# Add the thing",
  "",
  "## Problem",
  "The thing is missing.",
  "",
  "## Done when",
  "- [ ] the thing exists",
  "",
  "## Not doing",
  "- the other thing",
  "",
  "## How it will be checked",
  "node --test",
);

const DONE = BRIEF.replace("- [ ] the thing exists", doc("- [x] the thing exists", "      node --test — 3 of 3"));

const config = (over = {}) => ({
  flow: { ...FLOW_DEFAULTS, enabled: true, scope: ["src/**"], ...(over.flow ?? {}) },
  pair: { ...PAIR_DEFAULTS, enabled: true, ...(over.pair ?? {}) },
});

const io = ({ branch = "feat-thing", brief = BRIEF, changed = [] } = {}) => ({
  branch: () => branch,
  readBrief: () => brief,
  changedFiles: () => changed,
});

// --- finding the branch without spawning git ---

const SEP = String.fromCharCode(92);
const files = (table) => ({
  readFile: (p) => {
    const key = String(p).split(SEP).join("/");
    if (!(key in table)) throw new Error(`ENOENT ${key}`);
    return table[key];
  },
});

test("an ordinary checkout reads its branch out of .git/HEAD", () => {
  const io = files({ "proj/.git/HEAD": "ref: refs/heads/feat/add-thing" + NL });
  assert.equal(currentBranch("proj", io), "feat/add-thing");
});

test("a linked worktree keeps .git as a file naming the real directory", () => {
  // This repository is one, and the version that spawned git hid the fact that
  // the file form existed at all.
  const io = files({
    "proj/.git": "gitdir: /main/.git/worktrees/wt" + NL,
    "/main/.git/worktrees/wt/HEAD": "ref: refs/heads/wt-branch" + NL,
  });
  assert.equal(currentBranch("proj", io), "wt-branch");
});

test("a detached HEAD has no branch, so it has no brief", () => {
  const io = files({ "proj/.git/HEAD": "9f2c4a7e1b8d3056af91c2e4d7b05a3f00000000" + NL });
  assert.equal(currentBranch("proj", io), null);
});

test("somewhere that is not a repository is null rather than an exception", () => {
  assert.equal(currentBranch("proj", files({})), null);
});

// --- where a brief lives ---

test("a brief is named after its branch, flattened", () => {
  assert.equal(briefPathFor("docs/briefs/", "feat/add-thing"), "docs/briefs/feat-add-thing.md");
  assert.equal(briefPathFor("docs/briefs/", "main"), "docs/briefs/main.md");
});

// --- Pause 1 ---

test("nothing in scope is written before the brief exists", () => {
  const r = pauseBrief("src/a.ts", config(), io({ brief: null }));
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "pause-brief-missing");
  assert.match(r.reason, /docs\/briefs\/feat-thing\.md/);
});

test("the Pause never blocks its own remedy", () => {
  // Refusing the brief until the brief exists would be unsatisfiable.
  const r = pauseBrief("docs/briefs/feat-thing.md", config({ flow: { scope: ["**"] } }), io({ brief: null }));
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "pause-brief-authoring");
});

test("a file outside the declared scope is not this plugin's business", () => {
  const r = pauseBrief("README.md", config(), io({ brief: null }));
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "pause-brief-out-of-scope");
});

test("an empty scope means nothing is in scope, rather than everything", () => {
  const r = pauseBrief("src/a.ts", config({ flow: { scope: [] } }), io({ brief: null }));
  assert.equal(r.decision, "allow");
});

test("a brief that does not validate is refused with the reasons", () => {
  const r = pauseBrief("src/a.ts", config(), io({ brief: "# Just a title" }));
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "pause-brief-invalid");
  assert.match(r.reason, /missing section: ## Problem/);
});

test("a valid brief lets the write through", () => {
  assert.equal(pauseBrief("src/a.ts", config(), io()).rule, "pause-brief-ok");
});

test("with no branch the Pause asks rather than deciding", () => {
  const r = pauseBrief("src/a.ts", config(), io({ branch: null }));
  assert.equal(r.decision, "ask");
  assert.match(r.reason, /could not name the current branch/);
});

// --- Pause 2 ---

test("the code role does not open a source file before a test exists", () => {
  const r = pauseTests("src/a.ts", "code", config(), io({ changed: ["src/a.ts"] }));
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "pause-tests-missing");
  assert.match(r.reason, /shaped to the code/);
});

test("a changed test file satisfies the handover", () => {
  const r = pauseTests("src/a.ts", "code", config(), io({ changed: ["src/a.test.ts"] }));
  assert.equal(r.rule, "pause-tests-ok");
});

test("writing the test itself is never the thing this Pause stops", () => {
  assert.equal(pauseTests("src/a.test.ts", "code", config(), io({ changed: [] })).rule, "pause-tests-writing-a-test");
});

test("without a role the handover has no meaning and does not fire", () => {
  // The only Pause that needs one, which is why the roles ship with the plugin.
  for (const agent of [undefined, "", "planner", "Explore"]) {
    assert.equal(pauseTests("src/a.ts", agent, config(), io({ changed: [] })).rule, "pause-tests-no-role");
  }
});

test("when git cannot say what changed, the Pause abstains rather than refusing", () => {
  const r = pauseTests("src/a.ts", "code", config(), io({ changed: null }));
  assert.equal(r.decision, "allow");
  assert.equal(r.rule, "pause-tests-unknown");
});

test("the roles are the project's names for them", () => {
  const c = config({ pair: { codeAgent: "implementer" } });
  assert.equal(pauseTests("src/a.ts", "implementer", c, io({ changed: [] })).decision, "deny");
  assert.equal(pauseTests("src/a.ts", "code", c, io({ changed: [] })).rule, "pause-tests-no-role");
});

// --- Pause 3 ---

test("a git commit is recognised, and other commands are not", () => {
  assert.equal(isCommit('git commit -m "feat: a thing"'), true);
  assert.equal(isCommit("git status --short"), false);
  assert.equal(isCommit("echo git commit"), false);
  assert.equal(isCommit("npm test && git commit -am x"), true);
});

test("committing against an unsatisfied brief asks rather than refusing", () => {
  // An intermediate commit is ordinary and correct; the gate cannot tell it from
  // calling unfinished work finished, so it escalates instead of guessing.
  const r = pauseEvidence('git commit -m "wip"', config(), io());
  assert.equal(r.decision, "ask");
  assert.equal(r.rule, "pause-evidence-open");
  assert.match(r.reason, /0 of 1 criteria are ticked/);
  assert.match(r.reason, /the thing exists/);
});

test("a tick with nothing beneath it is named as the claim without the evidence", () => {
  const r = pauseEvidence('git commit -m "x"', config(), io({ brief: BRIEF.replace("- [ ]", "- [x]") }));
  assert.equal(r.decision, "ask");
  assert.match(r.reason, /Ticked with nothing underneath/);
});

test("a satisfied brief lets the commit through", () => {
  assert.equal(pauseEvidence('git commit -m "x"', config(), io({ brief: DONE })).rule, "pause-evidence-ok");
});

test("a missing brief is Pause 1's problem, not reported twice here", () => {
  assert.equal(pauseEvidence('git commit -m "x"', config(), io({ brief: null })).rule, "pause-evidence-no-brief");
});

// --- which Pause speaks ---

test("only the first Pause with something to say reports", () => {
  // Pause 2 has nothing useful to add while Pause 1 is still refusing to let the
  // work start; reporting both would report one problem and its consequence.
  const input = { tool_name: "Write", agent_type: "code", tool_input: { file_path: "src/a.ts" } };
  const r = checkPauses(input, config(), { branch: () => "b", readBrief: () => null, changedFiles: () => [] });
  assert.equal(r.rule, "pause-brief-missing");
});

test("a Pause switched off in the config does not run", () => {
  const input = { tool_name: "Write", agent_type: "code", tool_input: { file_path: "src/a.ts" } };
  const c = config({ flow: { pauses: ["tests"] } });
  const r = checkPauses(input, c, { branch: () => "b", readBrief: () => null, changedFiles: () => [] });
  assert.equal(r.rule, "pause-tests-missing", "Pause 1 was not asked");
});

test("with the plugin configured off, nothing fires at all", () => {
  const input = { tool_name: "Write", tool_input: { file_path: "src/a.ts" } };
  const c = { flow: { ...FLOW_DEFAULTS, scope: ["src/**"] }, pair: PAIR_DEFAULTS };
  assert.equal(checkPauses(input, c, { branch: () => "b", readBrief: () => null }).rule, "pause-none");
});

test("an absolute path is reconciled against the project root before matching", () => {
  // bancada's layering gate shipped this bug once and bancada-flow shipped it
  // again: Write hands over an absolute path, `src/**` matches nothing, every
  // write reads as out of scope, and the Pause reports success while enforcing
  // nothing. Both times every unit test passed, because every unit test passed a
  // relative path. This is that test.
  const input = { tool_name: "Write", tool_input: { file_path: "/home/me/proj/src/a.ts", content: "x" } };
  const r = checkPauses(input, config(), {
    projectDir: "/home/me/proj",
    branch: () => "b",
    readBrief: () => null,
    changedFiles: () => [],
  });
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "pause-brief-missing");
});

test("a path outside the project root is left alone rather than mangled", () => {
  const input = { tool_name: "Write", tool_input: { file_path: "/elsewhere/src/a.ts", content: "x" } };
  const r = checkPauses(input, config(), {
    projectDir: "/home/me/proj",
    branch: () => "b",
    readBrief: () => null,
    changedFiles: () => [],
  });
  assert.equal(r.rule, "pause-brief-out-of-scope");
});

test("a tool that is neither a write nor a shell command is not judged", () => {
  const r = checkPauses({ tool_name: "Read", tool_input: { file_path: "src/a.ts" } }, config(), {});
  assert.equal(r.rule, "pause-none");
});

// --- reading the config ---

test("a missing config file leaves the plugin switched off", () => {
  const c = loadFlowConfig("/nowhere", {
    readFile: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(c.flow.enabled, false);
  assert.deepEqual(c.pair.testGlobs, PAIR_DEFAULTS.testGlobs);
});

test("a value of the wrong type is ignored rather than adopted", () => {
  // bancada validates the same file and reports the problem; two plugins
  // complaining about one typo would be worse than one.
  const c = loadFlowConfig(".", { readFile: () => JSON.stringify({ flow: { enabled: "yes", scope: ["src/**"] } }) });
  assert.equal(c.flow.enabled, false);
  assert.deepEqual(c.flow.scope, ["src/**"]);
});
