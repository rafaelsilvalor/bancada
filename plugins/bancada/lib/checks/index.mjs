/**
 * The check registry.
 *
 * Order matters only for the record: the dispatcher runs checks in this order
 * and the telemetry lists them the same way, so a stream stays comparable
 * across runs. It does not affect the verdict — the fold is by precedence, not
 * by position.
 *
 * A check added here needs nothing else wired. That is the point of having one
 * entry point per event rather than one hook per gate.
 */

import { commitCheck } from "./commit.mjs";
import { structureCheck } from "./structure.mjs";

export const CHECKS = [commitCheck, structureCheck];
