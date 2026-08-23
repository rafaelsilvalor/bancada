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
