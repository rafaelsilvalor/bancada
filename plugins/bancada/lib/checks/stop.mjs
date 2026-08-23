/**
 * The checks that run when the assistant thinks it is finished.
 *
 * One entry so far. It is here rather than in the tool-call registry because it
 * runs the project's test suite, and nothing that takes seconds belongs on a
 * path that is walked on every tool call.
 */

import { greenCheck } from "./green.mjs";

export const STOP_CHECKS = [greenCheck];
