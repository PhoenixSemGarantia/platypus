import type { Chat, ChatStatus as RunStatus } from "@platypus/schemas";
import type { ChatStatus as TurnStatus } from "ai";
import type { PlatypusUIMessage } from "@platypus/backend/src/types";

/**
 * Recovering a Chat turn whose stream was cut (issue #648).
 *
 * A turn outlives the request that started it. Background the tab and the
 * browser tears down the connection carrying the stream, but the run keeps
 * going server-side and the chat row keeps taking the partial answer. So
 * recovery is a matter of asking the server again — and the three decisions
 * that involves live here, as pure functions, so each is testable without a
 * Chat component around it:
 *
 * - **Whether a run may be underway.** {@link runMayBeLive}, which the poll and
 *   the composer guard are both derived from. The trap is deriving it from the
 *   fetched status alone: on an existing Chat that status is last turn's
 *   `succeeded` until something refetches it, so a poll gated on it can never
 *   start — it only polls once the fetched row says a run is live, and only the
 *   poll would put that there. On a brand-new Chat there is no status at all,
 *   because the row does not exist until the run creates it.
 * - **What to say about the drop.** {@link classifyChatError}. A dropped
 *   connection to a healthy run is not a failed turn and must not be reported
 *   as one.
 * - **Whether a snapshot may land.** {@link snapshotIsAtLeastAsComplete}. The
 *   row lags the stream by up to one flush interval, so an unguarded snapshot
 *   rewinds visible text.
 */

/** How often a Chat with a live run re-reads its row. */
export const CHAT_POLL_INTERVAL_MS = 3_000;

/** A status the server reports for a run that has ended, however it ended. */
const isRunOver = (status: RunStatus | undefined): boolean =>
  status === "succeeded" || status === "failed" || status === "cancelled";

/** Everything the client knows about whether a turn is in flight. */
export type RunBelief = {
  /** The status on the fetched Chat row; absent before the row exists. */
  runStatus: RunStatus | undefined;
  /** This tab's own view of the turn, from the chat hook. */
  turnStatus: TurnStatus;
  /** Whether this turn's stream had started arriving before it broke. */
  turnEstablished: boolean;
};

/**
 * Whether a run for this Chat may still be underway.
 *
 * Three readings, because no one of them is enough:
 *
 * - The fetched row says `running`. Covers a tab that arrived mid-run and a
 *   second tab open on the same Chat — neither has a local turn to go on.
 * - This tab has a turn in flight. Covers the reason the poll never used to
 *   start: nothing has refetched the row since the previous turn finished, so
 *   its status still reads `succeeded` while a run is in fact underway.
 * - This tab's turn ended at `error` having streamed. That is a dropped
 *   connection to a run that is still going, and treating it as settled is what
 *   left the answer frozen forever. Having streamed is the qualifier: a request
 *   the server refused reaches `error` too, and there is no run behind it.
 *
 * A dropped turn stops counting once the row reports an outcome. That reading is
 * this turn's rather than the previous one's because the row is refetched when
 * the turn is submitted.
 */
export const runMayBeLive = ({
  runStatus,
  turnStatus,
  turnEstablished,
}: RunBelief): boolean => {
  if (runStatus === "running") return true;
  if (turnStatus === "submitted" || turnStatus === "streaming") return true;
  return turnStatus === "error" && turnEstablished && !isRunOver(runStatus);
};

/** How long until the Chat row should be read again, or `0` for "don't". */
export const chatPollIntervalMs = (belief: RunBelief): number =>
  runMayBeLive(belief) ? CHAT_POLL_INTERVAL_MS : 0;

/**
 * Whether a run may be underway that this tab is not streaming.
 *
 * What the composer is disabled on. The old guard required the local status to
 * be `ready`, which is why it missed a dropped stream — that status is `error`.
 * Submitting a second turn into a Chat that already has one is refused by the
 * server with a 409, so this is a courtesy rather than the protection; it exists
 * to stop the user asking for something they can't have.
 */
export const isRunHeldElsewhere = (belief: RunBelief): boolean =>
  runMayBeLive(belief) &&
  belief.turnStatus !== "streaming" &&
  belief.turnStatus !== "submitted";

/** How a Chat error should be surfaced. */
export type ChatErrorTreatment = "none" | "recovering" | "failure";

/**
 * Tells a dropped connection from a failed turn.
 *
 * The signal is whether the turn's stream ever started arriving. A request the
 * server refused — a rejected attachment, a duplicate submission, a network
 * that was never there — goes from `submitted` straight to `error` with nothing
 * received, and the user needs to be told. A turn that got bytes and then lost
 * them passed through `streaming` on its way, and the run behind it is fine:
 *
 * - `failure` — the modal. The run reached a terminal `failed` status, or the
 *   request never established in the first place.
 * - `recovering` — an inline line, never a modal. The run is still going and
 *   the partial answer keeps filling in from the poll.
 * - `none` — say nothing. The stream ended, but the run went on to finish, so
 *   the next snapshot is the whole answer.
 */
export const classifyChatError = ({
  error,
  ...belief
}: RunBelief & { error: Error | undefined }): ChatErrorTreatment => {
  if (!error) return "none";
  if (!belief.turnEstablished) return "failure";
  if (belief.runStatus === "failed") return "failure";
  return runMayBeLive(belief) ? "recovering" : "none";
};

/**
 * How far a transcript has got: the message count, the part count, and the
 * length of the text those parts carry.
 *
 * Three numbers rather than one because a turn grows in all three directions —
 * a new message, a new tool part, more text in the part being written — and any
 * one of them alone reads a step forward as no change.
 */
export type TranscriptExtent = {
  messages: number;
  parts: number;
  textLength: number;
};

export const transcriptExtent = (
  messages: readonly PlatypusUIMessage[] | undefined,
): TranscriptExtent => {
  const extent: TranscriptExtent = { messages: 0, parts: 0, textLength: 0 };
  if (!messages) return extent;
  extent.messages = messages.length;
  for (const message of messages) {
    const parts = message.parts ?? [];
    extent.parts += parts.length;
    for (const part of parts) {
      // Text and reasoning both carry a `text`; every other part shape carries
      // none, and is counted by `parts` alone.
      const text: unknown = (part as { text?: unknown }).text;
      if (typeof text === "string") extent.textLength += text.length;
    }
  }
  return extent;
};

/**
 * Whether a fetched snapshot may replace the messages on screen.
 *
 * The chat row is written on a flush interval, so a snapshot fetched mid-run is
 * behind the stream by up to one flush. Applying it unconditionally is what
 * makes text disappear and reappear. Monotonicity is the guard: a snapshot
 * lands only where it is at least as far along as what is already held, which
 * makes it safe to hydrate on any signal — a poll, a focus, a restored page —
 * without checking first whether a stream is live.
 *
 * An equal snapshot does land. That is deliberate: the row is the canonical form
 * of the transcript — attachment URLs rewritten, normalized tool parts — and
 * refusing an equal one would keep the page on its own version of the same
 * content until a reload.
 */
export const snapshotIsAtLeastAsComplete = (
  snapshot: readonly PlatypusUIMessage[] | undefined,
  held: readonly PlatypusUIMessage[] | undefined,
): boolean => {
  const next = transcriptExtent(snapshot);
  const current = transcriptExtent(held);
  if (next.messages !== current.messages) {
    return next.messages > current.messages;
  }
  return next.parts >= current.parts && next.textLength >= current.textLength;
};

/** The messages on a fetched Chat row, or `undefined` where it carries none. */
export const snapshotMessages = (
  chat: Chat | null | undefined,
): PlatypusUIMessage[] | undefined => {
  const messages = chat?.messages as PlatypusUIMessage[] | undefined;
  return messages && messages.length > 0 ? messages : undefined;
};
