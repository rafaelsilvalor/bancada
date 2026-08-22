/**
 * Reading the stream back: did the gates earn what they cost?
 *
 * A harness that cannot answer that is asking to be taken on faith, which is
 * the thing this project refuses to do. So the report is built around the
 * questions whose answers would change a decision:
 *
 *   Did anything fire at all?      A gate that never denies is either
 *                                  unnecessary or broken, and the stream
 *                                  cannot tell you which — but it can tell you
 *                                  that the question needs asking.
 *
 *   Which checks never ran?        Dead weight. Retire it or fix why it never
 *                                  applies.
 *
 *   Is the same input refused      This is the sharpest signal in the report.
 *   more than once?                A refusal is supposed to teach; the same
 *                                  digest denied repeatedly means it did not,
 *                                  and the gate has become friction rather
 *                                  than feedback.
 *
 * A damaged line is counted, never skipped silently. The stream is append-only
 * from short writes, so damage should be rare — and a reader that hides it
 * would turn a real problem into a quietly smaller denominator.
 */

/** Parse a JSONL stream. Returns the records and how many lines were unreadable. */
export function parseStream(text) {
  const records = [];
  let damaged = 0;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) records.push(parsed);
      else damaged++;
    } catch {
      damaged++;
    }
  }
  return { records, damaged };
}

const DECISIONS = ["allow", "ask", "deny"];

/**
 * Reduce records to the numbers the report is made of.
 *
 * `knownChecks` is the registry, so a check that never appears in the stream
 * can be named. Without it the report can only describe what happened, never
 * what failed to.
 */
export function aggregate(records, knownChecks = []) {
  const totals = { allow: 0, ask: 0, deny: 0, other: 0 };
  const perCheck = new Map();
  const denialsByHash = new Map();
  const sessions = new Set();
  const errors = [];
  let first = null;
  let last = null;

  for (const r of records) {
    const decision = DECISIONS.includes(r.decision) ? r.decision : "other";
    totals[decision]++;

    if (typeof r.session === "string" && r.session !== "") sessions.add(r.session);
    if (typeof r.ts === "string") {
      if (first === null || r.ts < first) first = r.ts;
      if (last === null || r.ts > last) last = r.ts;
    }

    for (const c of Array.isArray(r.checks) ? r.checks : []) {
      const name = String(c?.name ?? "unknown");
      if (!perCheck.has(name)) {
        perCheck.set(name, { name, applied: 0, allow: 0, ask: 0, deny: 0, errors: 0, rules: new Map() });
      }
      const entry = perCheck.get(name);
      entry.applied++;
      if (DECISIONS.includes(c?.decision)) entry[c.decision]++;

      // The rule is what fired inside the gate. Counting rules separately is
      // what tells you whether one rule does all the work while the rest are
      // decoration.
      const rule = c?.rule ?? c?.name;
      if (rule) entry.rules.set(rule, (entry.rules.get(rule) ?? 0) + 1);

      if (c?.error) {
        entry.errors++;
        errors.push({ check: name, error: c.error, ts: r.ts });
      }
    }

    // Recurrence is measured on refusals only. The same input allowed twice is
    // ordinary; the same input refused twice means the reason did not land.
    if (decision === "deny" && typeof r.inputHash === "string" && r.inputHash !== "") {
      const label = r.rule ?? r.check;
      const seen = denialsByHash.get(r.inputHash) ?? { hash: r.inputHash, count: 0, check: label };
      seen.count++;
      denialsByHash.set(r.inputHash, seen);
    }
  }

  // A record names the gate and the rule separately, so this is a plain set
  // difference. It used to need a prefix match, which was a sign the record
  // was conflating the two.
  const seenNames = new Set(perCheck.keys());
  const neverFired = knownChecks.filter((name) => !seenNames.has(name));

  const recurring = [...denialsByHash.values()].filter((d) => d.count > 1).sort((a, b) => b.count - a.count);

  return {
    total: records.length,
    totals,
    sessions: sessions.size,
    window: { first, last },
    checks: [...perCheck.values()]
      .map((c) => ({ ...c, rules: [...c.rules.entries()].map(([rule, n]) => ({ rule, n })).sort((a, b) => b.n - a.n) }))
      .sort((a, b) => b.applied - a.applied),
    neverFired,
    recurring,
    errors,
  };
}

const pct = (n, of) => (of === 0 ? "0%" : `${Math.round((n / of) * 100)}%`);

/** Render the report. Plain text, one fact per line. */
export function formatReport(agg, { damaged = 0 } = {}) {
  const out = ["bancada yield", ""];

  if (agg.total === 0) {
    out.push("The stream is empty. No tool call has passed a gate yet.");
    out.push("");
    out.push("That is not the same as the gates working and finding nothing:");
    out.push("an empty stream cannot tell the two apart. Run something the gates");
    out.push("should refuse, then read this again.");
    return out;
  }

  out.push(
    `${agg.total} tool call(s) across ${agg.sessions} session(s)` +
      (agg.window.first ? `, ${agg.window.first} to ${agg.window.last}` : ""),
  );
  if (damaged > 0) {
    out.push(`${damaged} unreadable line(s) in the stream, counted but not parsed.`);
  }
  out.push("");

  out.push("Decisions");
  for (const d of DECISIONS) {
    out.push(`  ${String(agg.totals[d]).padStart(5)}  ${d.padEnd(6)} ${pct(agg.totals[d], agg.total)}`);
  }
  if (agg.totals.other > 0) out.push(`  ${String(agg.totals.other).padStart(5)}  other`);
  out.push("");

  out.push("Per check");
  if (agg.checks.length === 0) {
    out.push("  no check has reported a result yet");
  } else {
    for (const c of agg.checks) {
      out.push(
        `  ${c.name.padEnd(14)} applied ${String(c.applied).padStart(4)}   ` +
          `deny ${String(c.deny).padStart(3)}  ask ${String(c.ask).padStart(3)}  allow ${String(c.allow).padStart(4)}` +
          (c.errors > 0 ? `   errors ${c.errors}` : ""),
      );
      for (const { rule, n } of c.rules) {
        out.push(`    ${String(n).padStart(5)}  ${rule}`);
      }
    }
  }
  out.push("");

  if (agg.neverFired.length > 0) {
    out.push("Never fired");
    for (const name of agg.neverFired) {
      out.push(`  ${name} — registered but has not reported once. Dead weight, or never applicable here.`);
    }
    out.push("");
  }

  if (agg.recurring.length > 0) {
    out.push("Refused more than once");
    for (const r of agg.recurring) {
      out.push(`  ${r.hash}  ${r.count}x  ${r.check ?? ""}`);
    }
    out.push("  The same input refused repeatedly means the reason is not landing.");
    out.push("  That is friction, not feedback: rewrite the reason, or reconsider the rule.");
    out.push("");
  }

  if (agg.errors.length > 0) {
    out.push("Checks that failed to run");
    for (const e of agg.errors.slice(0, 10)) out.push(`  ${e.check}: ${e.error}`);
    out.push("  These abstained rather than refusing, so nothing was blocked by them.");
    out.push("");
  }

  if (agg.totals.deny === 0 && agg.totals.ask === 0) {
    out.push("Nothing has been refused or escalated in this window.");
    out.push("Either the gates have nothing to catch here, or they are not catching.");
    out.push("The stream cannot tell you which; a deliberately bad input can.");
  }

  return out;
}
