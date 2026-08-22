import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch, fold, PRECEDENCE } from "./dispatch.mjs";

const v = (decision, check, reason = null) => ({ decision, check, reason });

/** A check that always applies and returns what it was told to. */
const check = (name, verdict, { event = "PreToolUse", applies = () => true } = {}) => ({
  name,
  event,
  applies,
  run: () => (typeof verdict === "function" ? verdict() : verdict),
});

// --- the fold ---

test("no verdicts is an allow, not an error", () => {
  assert.deepEqual(fold([]), { decision: "allow", check: "none", reason: null, verdicts: [] });
});

test("a refusal outranks a question, which outranks silence", () => {
  assert.equal(PRECEDENCE.deny > PRECEDENCE.ask, true);
  assert.equal(PRECEDENCE.ask > PRECEDENCE.allow, true);

  assert.equal(fold([v("allow", "a"), v("ask", "b", "?"), v("deny", "c", "no")]).decision, "deny");
  assert.equal(fold([v("allow", "a"), v("ask", "b", "?")]).decision, "ask");
  assert.equal(fold([v("allow", "a"), v("allow", "b")]).decision, "allow");
});

test("the winning check is named, so telemetry knows which rule fired", () => {
  assert.equal(fold([v("allow", "size"), v("deny", "commit", "no")]).check, "commit");
});

test("several checks at the same decision are all reported, not just the first", () => {
  const r = fold([v("deny", "commit", "bad subject"), v("deny", "secrets", "token found")]);
  assert.equal(r.decision, "deny");
  assert.equal(r.check, "commit+secrets");
  assert.match(r.reason, /bad subject/);
  assert.match(r.reason, /token found/);
});

test("reporting one problem at a time is what this avoids", () => {
  // Three things wrong should be three things said, once — not three
  // consecutive refusals each revealing the next.
  const r = fold([v("deny", "a", "one"), v("deny", "b", "two"), v("deny", "c", "three")]);
  assert.equal(r.reason.split("\n\n").length, 3);
});

test("a losing verdict's reason does not leak into the outcome", () => {
  const r = fold([v("ask", "unreadable", "please confirm"), v("deny", "commit", "refused")]);
  assert.equal(r.reason, "refused");
  assert.doesNotMatch(r.reason, /please confirm/);
});

test("every verdict is kept for the record, including the losers", () => {
  const r = fold([v("allow", "size"), v("ask", "docs", "?"), v("deny", "commit", "no")]);
  assert.equal(r.verdicts.length, 3);
  assert.deepEqual(
    r.verdicts.map((x) => x.check),
    ["size", "docs", "commit"],
  );
});

test("an allow carries no reason even when one was supplied", () => {
  assert.equal(fold([v("allow", "a", null)]).reason, null);
});

test("null entries are ignored rather than counted", () => {
  assert.equal(fold([null, v("deny", "a", "no"), undefined]).decision, "deny");
});

// --- dispatching ---

test("only checks for this event run", async () => {
  const ran = [];
  const checks = [
    { name: "pre", event: "PreToolUse", applies: () => (ran.push("pre"), true), run: () => v("allow", "pre") },
    { name: "stop", event: "Stop", applies: () => (ran.push("stop"), true), run: () => v("deny", "stop", "no") },
  ];
  const r = await dispatch({}, {}, checks, "PreToolUse");
  assert.deepEqual(ran, ["pre"]);
  assert.equal(r.decision, "allow");
});

test("a check that does not apply is skipped and leaves no verdict", async () => {
  const checks = [
    check("skipped", v("deny", "skipped", "no"), { applies: () => false }),
    check("ran", v("allow", "ran")),
  ];
  const r = await dispatch({}, {}, checks, "PreToolUse");
  assert.deepEqual(
    r.verdicts.map((x) => x.check),
    ["ran"],
  );
});

test("an async check is awaited", async () => {
  const slow = {
    name: "slow",
    event: "PreToolUse",
    applies: () => true,
    run: async () => v("deny", "slow", "eventually no"),
  };
  const r = await dispatch({}, {}, [slow], "PreToolUse");
  assert.equal(r.decision, "deny");
  assert.equal(r.reason, "eventually no");
});

// --- the invariant that keeps one bad check from taking the rest down ---

test("a check that throws in run becomes an abstention, never a refusal", async () => {
  const checks = [
    {
      name: "broken",
      event: "PreToolUse",
      applies: () => true,
      run: () => {
        throw new Error("boom");
      },
    },
    check("healthy", v("allow", "healthy")),
  ];
  const r = await dispatch({}, {}, checks, "PreToolUse");
  assert.equal(r.decision, "allow", "a crash must not read as a deny");
  assert.equal(r.verdicts.length, 2, "the healthy check still ran");
  assert.match(r.verdicts.find((x) => x.check === "broken").error, /boom/);
});

test("a check that throws in applies is also survivable", async () => {
  const checks = [
    {
      name: "broken",
      event: "PreToolUse",
      applies: () => {
        throw new Error("bad predicate");
      },
      run: () => v("deny", "broken", "should never be reached"),
    },
    check("healthy", v("deny", "healthy", "real refusal")),
  ];
  const r = await dispatch({}, {}, checks, "PreToolUse");
  assert.equal(r.decision, "deny");
  assert.equal(r.check, "healthy", "only the working check decided");
});

test("a broken check does not suppress a real refusal from another check", async () => {
  const checks = [
    {
      name: "broken",
      event: "PreToolUse",
      applies: () => true,
      run: () => {
        throw new Error("boom");
      },
    },
    check("commit", v("deny", "commit", "bad subject")),
  ];
  const r = await dispatch({}, {}, checks, "PreToolUse");
  assert.equal(r.decision, "deny");
  assert.equal(r.reason, "bad subject");
});

test("checks run in registry order, so the record is stable", async () => {
  const order = [];
  const mk = (n) => ({
    name: n,
    event: "PreToolUse",
    applies: () => true,
    run: () => (order.push(n), v("allow", n)),
  });
  await dispatch({}, {}, [mk("a"), mk("b"), mk("c")], "PreToolUse");
  assert.deepEqual(order, ["a", "b", "c"]);
});
