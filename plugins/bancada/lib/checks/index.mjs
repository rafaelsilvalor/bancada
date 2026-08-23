/**
 * Every check bancada has, across every event.
 *
 * Only callers that genuinely need the whole set import this — `bancada yield`
 * does, because a report of what the gates did has to name the ones that never
 * fired, and a gate missing from that list is invisible rather than reported.
 *
 * A hook entry point must not import this file. It would pull in the checks for
 * events it will never dispatch, which is exactly what the per-event registries
 * exist to prevent.
 */

import { PRE_TOOL_USE_CHECKS } from "./pre-tool-use.mjs";
import { STOP_CHECKS } from "./stop.mjs";

export { PRE_TOOL_USE_CHECKS, STOP_CHECKS };

export const CHECKS = [...PRE_TOOL_USE_CHECKS, ...STOP_CHECKS];

/**
 * Checks that appear in bancada's stream without being bancada's to run.
 *
 * bancada-flow appends records under the gate name `flow` — through the file
 * format rather than through an import, which
 * docs/decisions/0002-flow-ships-its-own-dispatcher.md argues for. That decision
 * also recorded what it cost: `bancada yield` built its "never fired" list from
 * the registry above, so a Pause that was switched on and never fired was
 * invisible to the report that exists to find exactly that, while `doctor`
 * listed it. The two reports disagreed about what they could see. This list is
 * what they now both read.
 *
 * `enabled` is the config predicate rather than a flag, because bancada cannot
 * observe another plugin — only what the project's config says should be
 * running. That is also why the two possible causes of silence stay separate in
 * the report: nothing matched, or the plugin was never installed.
 *
 * The name is the sixth thing the two plugins duplicate, and it is held the same
 * way as the other five: `plugins/bancada-flow/lib/pinned.test.mjs` imports both
 * sides and fails on the first divergence.
 */
export const FOREIGN_CHECKS = [
  { name: "flow", plugin: "bancada-flow", enabled: (config) => config?.flow?.enabled === true },
];

/**
 * Every check whose absence from the stream is worth reporting, given a config.
 *
 * bancada's own are listed unconditionally — the registry is complete, and a
 * gate that is off is a fact the reader can check against `doctor`. A foreign
 * one is listed only when the config switched it on, because naming a plugin
 * nobody asked for as "never fired" is noise in the one report that has to be
 * worth reading.
 */
export function expectedChecks(config) {
  return [
    ...CHECKS.map((c) => ({ name: c.name, plugin: null })),
    ...FOREIGN_CHECKS.filter((c) => c.enabled(config)).map(({ name, plugin }) => ({ name, plugin })),
  ];
}
