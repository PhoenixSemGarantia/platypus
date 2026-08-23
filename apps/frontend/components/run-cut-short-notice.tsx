"use client";

import { TurnNotice } from "./turn-notice";

/**
 * What the person reading run history is told when a run stopped at the
 * model's output ceiling rather than because the Agent had finished. A
 * constant so tests assert the wording without restating the prose.
 */
export const RUN_CUT_SHORT_NOTICE =
  "Run cut short at the model's output limit.";

/**
 * The same thing for the other limit: the run's tool-calling loop ran out of
 * steps while the Agent was still working, so it stopped with work outstanding.
 * Still a successful run — it did what it was allowed to do.
 */
export const RUN_STEP_LIMIT_NOTICE = "Run cut short at the step limit.";

/**
 * The Trigger-run counterpart of the marker a cut-short Chat reply carries.
 * Nobody watched the run, so this line and the run's stats are the only place
 * the cutoff shows up at all.
 *
 * A component rather than markup inside the runs page: a page file may only
 * export the fields Next recognises, and the wording has to be importable.
 */
export const RunCutShortNotice = () => (
  <TurnNotice className="mt-1">{RUN_CUT_SHORT_NOTICE}</TurnNotice>
);

/** The same row for a run whose loop was stopped at its step ceiling. */
export const RunStepLimitNotice = () => (
  <TurnNotice className="mt-1">{RUN_STEP_LIMIT_NOTICE}</TurnNotice>
);
