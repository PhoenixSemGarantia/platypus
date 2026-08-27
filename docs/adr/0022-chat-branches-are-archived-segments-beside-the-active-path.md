---
status: accepted-pending-implementation
implemented-by: "#709"
---

# Chat branches are archived segments stored beside the active path, not a message tree

> **Not in the code yet.** Today editing a message is destructive: the client
> truncates the array at the edited message and resubmits, and the dropped
> messages are gone. `chat.messages` is a single linear jsonb array and there is
> no `chat.branches` column. The edit surface is also a bare `<textarea>` that
> round-trips text only, so editing a message with attachments silently drops
> them — see the first Consequence.

Editing a message in Platypus drops every message after it. Every comparable
product — ChatGPT, Claude.ai, LibreChat, Open WebUI — keeps the abandoned branch
and offers version arrows to return to it, and the products that do so store the
transcript as a tree of message rows with parent pointers. Platypus cannot cheaply
follow them there, because the transcript is not owned by the server: the client
sends the entire message array on every turn (`routes/chat.ts`), and `ChatSink`
writes whatever the run produced back over the whole `chat.messages` column on a
flush interval. Every downstream reader — `convertToModelMessages`, memory
extraction, auto-titling, context occupancy — treats that column as _the_
conversation. The decision is to keep `chat.messages` exactly as it is, the linear
**active path**, and to add a sibling `chat.branches` column holding the _inactive_
segments, each tagged with the message it forks from. The sink's contract is
untouched, no downstream reader learns that branching exists, and forking becomes
a client-side splice plus one write. This is a deliberate compression of the
message-tree model rather than an attempt at it, adopted because it buys the whole
user-visible behaviour for a fraction of the cost and because it records
divergence points explicitly enough to migrate _out of_ later.

The stored shape carries no duplicate of the active path:

```ts
branches: {
  active: {
    id: string;
    parentMessageId: string | null;
    createdAt: string;
  }
  archived: Array<{
    id: string;
    parentMessageId: string;
    createdAt: string;
    messages: PlatypusUIMessage[];
  }>;
}
```

`active` is a marker, not a copy — it exists so the active path can be ordered
among its siblings for a `‹ 2/3 ›` control, and `active.parentMessageId` is `null`
for the original path. The sibling set at a fork point is `active` (when its
`parentMessageId` matches) plus the `archived` entries sharing that
`parentMessageId`, ordered by `createdAt`.

## Considered Options

- **A tree inside `chat.messages`.** The obvious shape, and it does not survive contact with the sink: `writeRow` replaces the entire column on every mid-run flush, so any branch stored there is erased by the next turn. Salvaging it means teaching the sink to write into a path within a tree, which drags the flush scheduler, the monotonic hydration guard and mid-run recovery into a change that is nominally about an edit button. Rejected as the largest possible blast radius for the smallest possible gain over a second column.

- **One row per message with a `parentId`, and an active-leaf pointer on the Chat.** The model LibreChat and Open WebUI actually use, and the honest answer to "what is best practice". Rejected on cost, not correctness. It touches every consumer of `chat.messages`, the sink's write path, the client's `useChat` wiring and the recovery logic, and because `drizzle-kit push` applies DDL only, migrating existing jsonb transcripts into rows needs a real data migration in `scripts/migrate.ts`. The Consequences name the three signals that should trigger it.

- **Store every segment in `branches`, including the active one, with an `activeBranchId` pointer.** Attractive because switching becomes a symmetric pointer flip rather than a move, and sibling ordering falls out with no special case. Rejected because it creates two writers for the same message content: the sink rewrites `chat.messages` continuously during a run and would know nothing about the copy inside `branches`, so that copy is stale within seconds of a turn starting. A denormalised copy nothing keeps current is worse than the asymmetry it removes. The `active` marker buys the ordering without the duplication.

- **Persist a branch switch lazily, on the next message submit.** Rejected on three counts, the first decisive. The client's hydration effect rejects any fetched snapshot that is not at least as complete as what is held, so a client-only switch means suppressing that guard indefinitely rather than for one deliberate swap, and every SWR revalidation tries to drag the user back. Memory extraction and auto-titling both read the persisted `chat.messages`, so a lazy switch leaves background jobs operating on a path the user is not looking at. And a version that silently reverts when the tab closes is worse than no version history at all.

- **Leave editing destructive and do nothing.** The status quo, and it stops being tenable once a user message can carry structure beyond text. It is already lossy for attachments today, and issue [#649](https://github.com/willdady/platypus/issues/649) would make a `/skill` command the second thing an edit silently destroys.

## Consequences

- **The edit surface must become the composer before any of this is safe, and that is part of this decision rather than a follow-on.** `useMessageEditing` resubmits `{ text }` and the edit textarea is seeded from text parts only, so file parts on the edited message are dropped on submit — an existing defect, not a hypothetical one. Preserving a branch whose messages were already truncated to their text would preserve nothing worth returning to. The edit affordance therefore becomes an inline instance of `PromptInput` operating on `UIMessage.parts`, carrying attachments, the textarea and the attachment menu, and dropping the model picker, the info and settings dialogs and the context meter — everything that configures the Chat or the run rather than shaping the message. Two mechanical notes for whoever builds it: `PromptInput` initialises its attachment state to `[]` with no seeding prop, so it needs one; and the edit instance must not set `globalDrop`, or two inputs will both claim a window-level file drop.

- **The branch endpoint owns both columns; the sink owns only `messages`.** This is the invariant the whole design rests on. A switch moves content — the current suffix out of `messages` into `archived`, the chosen segment the other way, and the `active` marker updated — so it must be one transaction, and it must not run while a run is in flight. "In flight" includes recovery, not just `status === "streaming"`: the recovery path reconciles a live run against the persisted row and a concurrent switch corrupts that reconciliation. The existing `PUT /:chatId` is not the place for it — it is gated on `requireWorkspaceOwner` and accepts only `title`, `isPinned` and `tags`, where branch switching must be available to anyone permitted to send a message.

- **A switch needs optimistic concurrency from the first commit, not as later hardening.** Because a switch moves message content between columns rather than setting a field, a lost update does not lose a stale value — it loses a branch's messages permanently. Two tabs are enough. The switch must carry a version or `updatedAt` precondition and fail rather than overwrite. This is the one item here that is a correctness requirement rather than a refinement.

- **Forking is only ever from the active path, and that invariant is what makes the flat shape sufficient.** Editing inside an archived branch means switching to it first — which is also how every comparable product behaves, since a version you are not viewing is not one you can edit. Once a segment is active, an edit within it is an ordinary fork off the active path. The shape therefore supports arbitrary depth despite storing one flat list, and a reader should not mistake `archived` for a one-level model.

- **Message ids become a join key, so they must be unique within a Chat across branches.** They round-trip intact today — the hydration snapshot returns the persisted array untouched — but `parentMessageId` silently groups unrelated forks as siblings if an id is ever reused or regenerated on resubmit. A switch should resolve its `parentMessageId` and fail loudly when it does not, rather than rendering a plausible wrong sibling count.

- **Two existing message walks become incomplete the moment a branch exists.** Chat deletion calls `deleteFiles` over `chatRecord.messages` only, so attachments on archived branches would orphan in storage; and the `GET /:chatId` read path rewrites `storage://` URLs on `chatResponse.messages` only, so a branch's attachments arrive unrewritten and render broken the instant a user switches to it. Both must walk `branches.archived` too. The Chat _list_ route deliberately omits `messages` and must omit `branches` for the same reason.

- **Regenerate has to move at the same time.** Regeneration is destructive today. Shipping non-destructive edit beside destructive regenerate teaches a user that old versions are kept and then loses their work to the other button. Either both fork — which is nearly free once this shape exists, being the same operation from a different trigger — or the asymmetry needs a reason better than sequencing.

- **Deleting a message that a branch forks from must have a stated rule.** Message deletion filters the array today, which would orphan any branch naming that message as its `parentMessageId`. Cascade, reparent to the preceding message, or refuse the delete — any is defensible, silently orphaning is not.

- **Abandoned branches still reach long-term memory, and this ADR accepts that.** Memory extraction formats the entire active path and merges it into the day's existing summary for the User and Workspace; there is no un-extract. Once branch A has been extracted its content is permanent, so switching to branch B and re-extracting leaves both in the same summary. This is not introduced here — a destructive edit today has exactly the same hole, since truncation cannot retract what was already summarised — but branching makes it routine rather than occasional. Recorded as a known limitation because the alternative is per-message extraction provenance, which is a larger decision than this one and should not be smuggled in beneath it.

- **Triggered runs are outside this entirely, by construction rather than by exclusion.** `TriggerSink` writes to `triggerRun` and never touches the `chat` table, so there is no path by which a Trigger observes or mutates a branch. Nothing needs to guard against it.

- **Three signals say it is time to migrate to the message table.** Concurrent writers beyond the single-user case, at which point the precondition above is a bolt-on where row-level isolation would be free; row growth, since the whole `branches` blob is rewritten on every switch and read on every fetch with no pagination escape hatch; and any feature that needs to address one message directly — per-message comments, metadata, citations, permalinks. The migration is tractable precisely because `archived` records `parentMessageId` and `createdAt` explicitly: a data migration can reconstruct a parent-pointer tree from it without inferring structure. That property is why this shape is a waypoint and not a dead end, and it should be preserved by anything that extends the column.
