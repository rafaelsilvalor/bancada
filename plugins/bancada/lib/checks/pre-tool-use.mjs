/**
 * The checks that run before a tool call.
 *
 * One registry per event, mirroring one entry point per event. The split is not
 * tidiness: `hooks/pre-tool-use.mjs` imports this file and only this file, so
 * the green boundary's module — which reaches for `child_process` and exists to
 * run a test suite — is never loaded on a tool call that could not possibly need
 * it. A single registry would have put it in every one, and the cost check would
 * have counted it as hot-path code, which is what it would then have been.
 *
 * Order matters only for the record: the dispatcher runs checks in this order
 * and the telemetry lists them the same way, so a stream stays comparable across
 * runs. It does not affect the verdict — the fold is by precedence, not by
 * position.
 *
 * A check added here needs nothing else wired.
 */

import { commitCheck } from "./commit.mjs";
import { secretsCheck } from "./secrets.mjs";
import { sizeCheck } from "./size.mjs";
import { structureCheck } from "./structure.mjs";
import { pairCheck } from "./pair.mjs";

export const PRE_TOOL_USE_CHECKS = [commitCheck, secretsCheck, sizeCheck, structureCheck, pairCheck];
