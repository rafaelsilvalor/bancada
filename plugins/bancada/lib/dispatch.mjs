/**
 * One entry point per event: run the applicable checks, fold their verdicts.
 *
 * The reasoning is recorded in docs/decisions/0001-one-dispatcher-per-event.md.
 * The short version is that Claude Code runs matching hooks in parallel but does
 * not document how their conflicting decisions combine, and a tool whose claim
 * is that its refusals are deterministic cannot rest that on undocumented
 * behaviour. Inside one process the fold is ours and it is explicit.
 *
 * A check is a plain object:
 *
 *   name      what the telemetry calls it
 *   event     the hook event it belongs to
 *   applies   (input, config) => boolean, cheap, no I/O
 *   run       (input, config) => verdict
 *
 * and a verdict is `{ decision, check, reason }` where decision is one of
 * "allow", "ask" or "deny". A check that has no opinion returns "allow" with a
 * null reason; it does not return null, because "I looked and found nothing"
 * and "I did not look" are different facts and the telemetry wants both.
 */

/** Higher wins. A refusal outranks a question, which outranks silence. */
export const PRECEDENCE = { allow: 0, ask: 1, deny: 2 };

const rank = (decision) => PRECEDENCE[decision] ?? 0;

/**
 * Combine verdicts into the one the host is told about.
 *
 * When several checks land on the same highest decision, all of their reasons
 * are reported together. Handing back one problem at a time turns a single
 * refusal into a sequence of them, and the person fixing it learns the full
 * story only by failing repeatedly.
 */
export function fold(verdicts) {
  const considered = verdicts.filter(Boolean);
  if (considered.length === 0) {
    return { decision: "allow", check: "none", reason: null, verdicts: [] };
  }

  const top = Math.max(...considered.map((v) => rank(v.decision)));
  const decision = Object.keys(PRECEDENCE).find((k) => PRECEDENCE[k] === top);
  const winners = considered.filter((v) => rank(v.decision) === top);

  const reasons = winners.map((v) => v.reason).filter((r) => typeof r === "string" && r !== "");

  // `check` names the gate; `rule` names what inside it fired. A report needs
  // both — how often a gate looked, and what it found — and collapsing them
  // makes every rule look like a separate gate.
  const rules = winners.map((v) => v.rule).filter(Boolean);

  return {
    decision,
    check: winners.map((v) => v.check).join("+"),
    rule: rules.length > 0 ? rules.join("+") : undefined,
    reason: reasons.length > 0 ? reasons.join("\n\n") : null,
    verdicts: considered,
  };
}

/**
 * One check's verdict on the several files a single tool call writes.
 *
 * `fold` above combines different checks, so it joins their names; here every
 * verdict comes from the same check and the name is given rather than joined.
 * The rules are still joined, because "which of my rules fired" is exactly what
 * a report of one gate over three files needs to say.
 *
 * A check with no target to judge returns allow with no rule: it looked at this
 * tool call and there was nothing of its concern in it.
 */
export function foldOwn(name, verdicts) {
  const folded = fold(verdicts);
  return { decision: folded.decision, check: name, rule: folded.rule, reason: folded.reason };
}

/**
 * Run every check that applies to this input and fold the result.
 *
 * A check that throws is recorded as an abstention rather than taking the whole
 * dispatcher down with it. One broken check must not disable the others, and it
 * certainly must not turn into a refusal — the caller cannot tell a real deny
 * from a crash, so a crash is silence plus a note.
 */
export async function dispatch(input, config, checks, event) {
  const verdicts = [];
  for (const check of checks) {
    if (check.event !== event) continue;
    let applies = false;
    try {
      applies = check.applies(input, config);
    } catch (e) {
      verdicts.push({ decision: "allow", check: check.name, reason: null, error: String(e?.message ?? e) });
      continue;
    }
    if (!applies) continue;

    try {
      verdicts.push(await check.run(input, config));
    } catch (e) {
      verdicts.push({ decision: "allow", check: check.name, reason: null, error: String(e?.message ?? e) });
    }
  }
  return fold(verdicts);
}
