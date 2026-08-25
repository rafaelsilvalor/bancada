/**
 * The colocation boundary, as a dispatcher entry on `Stop`.
 *
 * `Stop` rather than `PreToolUse`, and the reason is creation order: a
 * brand-new module cannot have its test at the instant the module file is
 * written, so a write-time deny would refuse every scaffold before its pair
 * exists — whichever of the two is written first. The turn is the unit of work
 * that can legitimately be asked to contain both. The full argument, with the
 * alternative it rejected, is docs/decisions/0003-colocated-blocks-the-turn-not-the-write.md.
 *
 * What "changed this turn" means here is what `git status` says — the same
 * answer the green boundary reads, borrowed from the same function. That buys
 * two declared limits: a working tree that already carried an uncovered change
 * when the turn started is asked for its test anyway, and a turn that commits
 * everything before stopping shows a clean status and is asked for nothing.
 * The repository-wide gap never hides, though: `bancada doctor` reports it
 * whole, whatever this boundary saw.
 *
 * No state rides between stops, unlike green. The verdict costs a `git status`
 * and set lookups, not a suite run, so re-checking is always affordable and
 * always right — by the next stop the missing test either exists or it still
 * does not. A model that stops without writing it is re-blocked with the same
 * reason until Claude Code's cap of eight consecutive blocks ends the
 * sequence, the same real number the green boundary leans on.
 */

import { colocationReport } from "../colocated.mjs";
import { listProjectFiles } from "../files.mjs";
import { normalisePath } from "../glob.mjs";
import { changedFiles } from "../green.mjs";
import { projectDirOf } from "./where.mjs";

const verdict = (decision, rule, reason = null, note = null) => ({
  decision,
  check: colocatedCheck.name,
  rule,
  reason,
  note,
});

export const colocatedCheck = {
  name: "colocated",
  event: "Stop",

  applies(input, config) {
    if (!config.gates.colocated.enabled) return false;
    // An empty include is "the project said nothing", the same reading the size
    // gate gives it — warned about by the validator, never read as everything.
    return (config.source.include ?? []).length > 0;
  },

  run(input, config, deps = {}) {
    const projectDir = projectDirOf(input);
    const changed = deps.changed !== undefined ? deps.changed : changedFiles(projectDir);

    // Without git there is no answer to "what did this turn touch", and judging
    // the whole tree instead would block the turn for every gap the repository
    // already had — an adoption story that ends with the gate switched off. Not
    // running is stated out loud, because a configured gate that never runs
    // must not look like one that always passes.
    if (changed === null) {
      return verdict(
        "allow",
        "colocated-unlisted",
        null,
        "bancada's colocated boundary could not list what this turn changed (git gave\n" +
          "no answer here), so it did not judge the stop. `bancada doctor` still reports\n" +
          "the full colocation gap.",
      );
    }
    if (changed.length === 0) return verdict("allow", "colocated-unchanged");

    const { files } = (deps.listFiles ?? listProjectFiles)(projectDir);
    const report = colocationReport({
      files,
      source: config.source,
      settings: config.gates.colocated,
      testGlobs: config.pair.testGlobs,
    });

    // A module is the turn's problem when the turn touched it — or touched the
    // test that should cover it, which is how a deleted test surfaces here even
    // though the module itself never changed.
    const touched = new Set(changed.map(normalisePath));
    const offenders = report.missing.filter(
      (m) => touched.has(m.file) || m.candidates.some((c) => touched.has(c)),
    );
    if (offenders.length === 0) return verdict("allow", "colocated-ok");

    return verdict(
      "deny",
      "colocated-missing",
      [
        `${offenders.length} changed source file(s) have no test, and this project requires a colocated one:`,
        "",
        ...offenders.map((m) => `  ${m.file} — expected ${m.candidates.join(" or ") || "a covering suite"}`),
        "",
        "Write the missing test before ending the turn. If a suite elsewhere already",
        "covers one of these files, declare it under gates.colocated.suites in",
        "bancada.config.json; a gap accepted on purpose is recorded under",
        "gates.colocated.exceptions, with a reason and a date.",
      ].join("\n"),
    );
  },
};
