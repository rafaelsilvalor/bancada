/**
 * The test/code pair: keeping the agent that writes the test out of the code,
 * and the agent that writes the code out of the test.
 *
 * The discipline is old and the reason is not about agents at all. Whoever
 * writes the test and the code together writes a test that passes, because the
 * two are shaped to each other as they are written. Splitting the roles means
 * the test is a statement about behaviour that the implementation then has to
 * satisfy, rather than a description of what the implementation happens to do.
 *
 * A `CLAUDE.md` can ask for this. It cannot enforce it, because the moment the
 * code agent finds the test inconvenient the cheapest repair is to edit the
 * test, and nothing is watching. This gate watches.
 *
 * **It only applies to a named role.** The main thread has no `agent_type`, and
 * a session with no roles is not doing pair work — refusing the owner's own
 * edits because a setting is on would be enforcing a discipline nobody entered.
 * The verified behaviour of the field is recorded in the check that reads it.
 */

import { compileGlobs, normalisePath } from "./glob.mjs";

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Judge a write by who is making it.
 *
 * Returns `{ decision, rule, reason }`.
 *
 * The two refusals are not symmetric in how they read. The code agent editing a
 * test is the failure this exists to stop, and it says so. The test agent
 * editing code is the milder one — usually a fixture in the wrong place — and
 * its reason says where the line is rather than accusing anyone of anything.
 */
export function checkPair(agentType, relPath, settings) {
  const agent = norm(agentType);
  if (agent === "") {
    return { decision: "allow", rule: "pair-no-role", reason: null };
  }

  const testAgent = norm(settings?.testAgent ?? "test");
  const codeAgent = norm(settings?.codeAgent ?? "code");
  if (agent !== testAgent && agent !== codeAgent) {
    return { decision: "allow", rule: "pair-other-role", reason: null };
  }

  const path = normalisePath(relPath);
  const isTest = compileGlobs(settings?.testGlobs ?? [])(path);

  if (agent === codeAgent && isTest) {
    return {
      decision: "deny",
      rule: "pair-code-writes-test",
      reason: [
        `${path} is a test, and this turn is running as the "${settings?.codeAgent}" role,`,
        `which does not write tests in this project.`,
        "",
        "Make the code satisfy the test as written. If the test is wrong, say so and",
        `hand it back to the "${settings?.testAgent}" role — a test edited by the code`,
        "that has to pass it stops being evidence.",
      ].join("\n"),
    };
  }

  if (agent === testAgent && !isTest) {
    return {
      decision: "deny",
      rule: "pair-test-writes-code",
      reason: [
        `${path} is not a test, and this turn is running as the "${settings?.testAgent}" role.`,
        "",
        `Files matching ${(settings?.testGlobs ?? []).join(", ") || "the configured test globs"} are yours;`,
        `the rest belongs to the "${settings?.codeAgent}" role.`,
      ].join("\n"),
    };
  }

  return { decision: "allow", rule: "pair-ok", reason: null };
}
