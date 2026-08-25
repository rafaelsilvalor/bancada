/**
 * The checks that run when the assistant thinks it is finished.
 *
 * They are here rather than in the tool-call registry because their questions
 * have no answer mid-turn. The green boundary runs the project's test suite,
 * and nothing that takes seconds belongs on a path that is walked on every tool
 * call; the colocation boundary asks whether the turn's new module has its
 * test, which cannot be true at the instant the module file is first written.
 */

import { colocatedCheck } from "./colocated.mjs";
import { greenCheck } from "./green.mjs";

export const STOP_CHECKS = [greenCheck, colocatedCheck];
