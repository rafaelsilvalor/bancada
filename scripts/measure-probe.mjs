/**
 * Does the probe actually pay for itself?
 *
 * Everything this project has claimed about the probe's economics so far came
 * from documentation: a non-fork subagent reloads the CLAUDE.md hierarchy, a
 * forked Explore agent does not, exploration in an isolated window costs the
 * caller only the summary. All plausible, none of it measured here.
 *
 * This runs the same research question two ways and reports what each cost.
 *
 *   inline   the session answers it itself, reading files in its own context
 *   probe    the session delegates to /bancada-context:probe and gets a summary
 *
 * What this can and cannot measure, stated up front.
 *
 * It measures the total cost of answering the question each way. That is real
 * and it is what appears on the bill.
 *
 * It does NOT measure the thing the probe mainly exists for — the context the
 * ongoing conversation does not accumulate — and `claude -p` structurally
 * cannot. A one-shot run has no ongoing conversation: it ends immediately, so
 * there is no later turn to be cheaper. Worse, a forked skill reports
 * `usage` as all zeros with `num_turns: 0`, because the fork replaces the main
 * turn rather than being spawned beside it. The first version of this script
 * read `usage` and concluded the probe was free.
 *
 * Measuring context preservation needs a two-turn session: ask the research
 * question, then ask something trivial, and read the cache-read tokens on the
 * second turn to see what the first left behind. That is not built here.
 *
 *   node scripts/measure-probe.mjs [--runs 2] [--model haiku]
 */

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const RUNS = Number(flag("--runs", "2"));
const MODEL = flag("--model", "haiku");

/**
 * A question that cannot be answered from one file. If the inline arm can
 * settle it by opening a single known path, the comparison measures nothing.
 */
const QUESTION =
  "Across plugins/bancada/lib, which modules export a function that returns an object with a " +
  "'decision' field? List each as path and the exported function name. Answer only that.";

function run(label, extraArgs, prompt) {
  const started = Date.now();
  const r = spawnSync(
    "claude",
    ["-p", prompt, "--model", MODEL, "--output-format", "json", ...extraArgs],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000 },
  );
  const wall = Date.now() - started;

  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { label, ok: false, error: (r.stderr || r.stdout || "no output").slice(0, 300), wall };
  }
  if (parsed.is_error) return { label, ok: false, error: String(parsed.result).slice(0, 300), wall };

  // A run that spent nothing did nothing. The first version of this script
  // reported an unrecognised slash command as a completed run with zero tokens,
  // which came out the other end as a 100% saving — an instrument turning its
  // own failure into a spectacular result. Both guards exist because of that.
  const answer = String(parsed.result ?? "");
  if (/^Unknown command/i.test(answer.trim())) {
    return { label, ok: false, error: `the prompt was not understood: ${answer.slice(0, 120)}`, wall };
  }
  // Judge "did it work" by the bill, not by `usage`: a forked skill legitimately
  // reports zero there while having done all the work.
  if ((parsed.total_cost_usd ?? 0) === 0) {
    return { label, ok: false, error: "the run cost nothing, so it did no work", wall };
  }
  if (answer.trim().length < 40) {
    return { label, ok: false, error: `the answer was too short to be one: ${JSON.stringify(answer.slice(0, 80))}`, wall };
  }

  // `modelUsage` is the honest total. `usage` describes the main turn only, and
  // for a forked skill there is no main turn, so it reads as zero.
  const models = Object.values(parsed.modelUsage ?? {});
  const mainIn = models.reduce((n, m) => n + (m.inputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0), 0);
  const mainOut = models.reduce((n, m) => n + (m.outputTokens ?? 0), 0);
  const cacheRead = models.reduce((n, m) => n + (m.cacheReadInputTokens ?? 0), 0);

  const sub = parsed.subagent_stats ?? {};
  return {
    label,
    ok: true,
    wall,
    mainIn,
    mainOut,
    mainTotal: mainIn + mainOut,
    cacheRead,
    cost: parsed.total_cost_usd ?? 0,
    turns: parsed.num_turns ?? 0,
    subagents: sub.count ?? sub.total ?? 0,
    answer: String(parsed.result ?? "").replace(/\s+/g, " ").slice(0, 140),
  };
}

const ARMS = [
  {
    label: "inline",
    args: ["--allowedTools", "Read,Grep,Glob"],
    prompt: QUESTION,
  },
  {
    label: "probe",
    // Both plugins, because bancada-context declares a dependency on bancada
    // and a plugin whose dependency is unsatisfied loads with its skills absent
    // and nothing said about it.
    args: [
      "--plugin-dir",
      "./plugins/bancada",
      "--plugin-dir",
      "./plugins/bancada-context",
      "--allowedTools",
      "Read,Grep,Glob,Task,Skill",
    ],
    prompt: `/bancada-context:probe ${QUESTION}`,
  },
];

const results = [];
for (const arm of ARMS) {
  for (let i = 0; i < RUNS; i++) {
    process.stderr.write(`running ${arm.label} ${i + 1}/${RUNS}...\n`);
    results.push(run(arm.label, arm.args, arm.prompt));
  }
}

const failed = results.filter((r) => !r.ok);
const ok = results.filter((r) => r.ok);

console.log(`\nprobe A/B — ${MODEL}, ${RUNS} run(s) per arm\n`);

if (failed.length > 0) {
  console.log("Failed runs (reported, not dropped — a smaller denominator would flatter the result):");
  for (const f of failed) console.log(`  ${f.label}: ${f.error}`);
  console.log("");
}

if (ok.length === 0) {
  console.log("No run completed. Nothing can be concluded.");
  process.exit(1);
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const byArm = {};
for (const r of ok) (byArm[r.label] ??= []).push(r);

console.log("arm      runs      billed input      output    cache read      cost USD     wall s");
for (const [label, rs] of Object.entries(byArm)) {
  console.log(
    `${label.padEnd(8)} ${String(rs.length).padStart(4)}   ` +
      `${String(median(rs.map((r) => r.mainIn))).padStart(15)} ` +
      `${String(median(rs.map((r) => r.mainOut))).padStart(11)} ` +
      `${String(median(rs.map((r) => r.cacheRead))).padStart(13)} ` +
      `${median(rs.map((r) => r.cost)).toFixed(4).padStart(13)} ` +
      `${(median(rs.map((r) => r.wall)) / 1000).toFixed(1).padStart(10)}`,
  );
}

const a = byArm.inline;
const b = byArm.probe;
if (a && b) {
  const ctxA = median(a.map((r) => r.mainTotal));
  const ctxB = median(b.map((r) => r.mainTotal));
  const costA = median(a.map((r) => r.cost));
  const costB = median(b.map((r) => r.cost));
  console.log("");
  console.log(`Billed tokens: ${ctxA} inline vs ${ctxB} through the probe (${(ctxB / ctxA).toFixed(2)}x).`);
  console.log(`Total cost:    ${costA.toFixed(4)} vs ${costB.toFixed(4)} (${(costB / costA).toFixed(2)}x).`);
  console.log("");
  console.log("This is total cost, not context preserved. See the note at the top of this");
  console.log("script for why a one-shot run cannot measure the second thing.");
  console.log("");
  console.log("Answers returned, so the two arms can be checked for having done the same job:");
  console.log(`  inline: ${a[0].answer}`);
  console.log(`  probe : ${b[0].answer}`);
}

console.log(`\nTotal spent on this measurement: $${ok.reduce((n, r) => n + r.cost, 0).toFixed(4)}`);
