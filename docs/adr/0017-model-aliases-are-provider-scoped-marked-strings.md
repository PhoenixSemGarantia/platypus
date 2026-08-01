---
status: proposed
---

# Model aliases are Provider-scoped marked strings

## Context

Agents, Chats, and Provider pointer-settings (`taskModelId`, `memoryExtractionModelId`, `embeddingModelId`) each store a concrete model id as a plain string. Upgrading a model means editing every Agent/Chat that references the old id by hand. A Model alias lets a Provider name one of its `modelIds` entries so those references repoint at once. Originates from [#386](https://github.com/willdady/platypus/issues/386).

## Decision

A Model alias is **Provider-scoped only** — it does not span Providers. It is stored as a new optional field on the existing per-model config object inside `modelIds` (no new table, no new column on Agent/Chat/Provider). Any field that already stores a model id (`agent.modelId`, `chat.modelId`, and the Provider's own `taskModelId`/`memoryExtractionModelId`/`embeddingModelId`) may store either a concrete id or an alias reference, disambiguated by an explicit `alias:` prefix (e.g. `alias:default`) rather than a lookup-with-fallback scheme.

The prefix lives on the **reference**, never the **definition**:

- `modelIds[].alias` stores the bare name (`default`). This field is unambiguous by construction, so carrying the prefix would be redundant and invite strip-before-compare bugs.
- `agent.modelId` and friends store `alias:default`. These are the only fields where a string could mean either thing, so they are the only ones that need marking.

Resolution strips the `alias:` prefix from the reference and matches the remainder against `modelIds[].alias`.

The prefix is **never user-visible**. It is a storage disambiguator, not user vocabulary: an Org Admin types `default` into an "Alias" field on the provider form, and model-select fields render `default` as the option label while submitting `alias:default` as the value.

## Considered options

- **Cross-Provider (Workspace/Org-scoped) aliases** — rejected. An Agent already pins exactly one Provider via `providerId`; a cross-Provider alias would have to resolve which Provider too, reopening a question the Agent already answers. Cross-Provider model routing/fallback is a distinct feature with its own failure modes (mismatched credentials, provider outages) and is left for a separate design if ever needed.
- **`@` prefix** — rejected. Several real vendor model ids legitimately start with `@`, so it wouldn't be unambiguous.
- **Lookup-with-fallback (try alias match, else treat as literal id)** — rejected in favor of an explicit marker. An unmarked string is unreadable in isolation (e.g. looking directly at a database row) — you can't tell whether `"default"` is an alias or someone's literal model id without cross-referencing the Provider's `modelIds`. The `alias:` prefix makes every reference self-describing and resolution a deterministic prefix check, not a two-step lookup.

## Consequences

- **Resolution failure is a hard error.** If `alias:foo` no longer matches any `modelIds` entry (renamed, repointed away, or the model removed from the Provider), the Chat turn / one-shot task fails visibly — same error class as a dangling literal id today. No silent fallback to another model.
- **No reproducibility pinning.** Aliases always re-resolve on every Chat turn; repointing an alias changes behavior on the very next turn for every Agent/Chat using it. This matches existing behavior for literal ids — `chat.modelId` already has no per-turn pinning mechanism today, and no message currently records which concrete model actually produced it — so this introduces no new asymmetry.
- **Out of scope for v1:** a "what's using this alias" view before repointing. The query is cheap (`agent`/`chat` both carry `providerId` + `modelId`), but is deferred until it's a real pain point rather than built speculatively.
- **UI:** existing model-select fields (Agent, Chat, Provider pointer settings) show only the alias — not the underlying concrete id — for any `modelIds` entry that has one configured.
- **Names form one flat namespace per Provider.** The union of every entry's `id` and every entry's `alias` must contain no duplicates. Because the `alias:` prefix is hidden in the UI, an alias named after a real model id would render a second, identical-looking option in the picker pointing somewhere else entirely (`alias:gpt-4` → `gpt-3` displayed as `gpt-4`, alongside the genuine `gpt-4`). Note this constraint is forced by the hidden-prefix choice, not by resolution: the prefix alone keeps resolution unambiguous. The stricter flat-namespace rule is preferred over merely requiring distinct display labels, since the looser rule still permits a misleading label when the colliding concrete id carries its own alias.
- **Alias name validation:** non-empty, non-whitespace, and may not itself begin with `alias:` (no `alias:alias:foo`). Enforced with the namespace rule in a `.superRefine` on `modelIdsSchema` (`packages/schemas/index.ts:602`), after the existing `.transform` so it sees normalized objects — a whole-array invariant, so it cannot live on `modelConfigSchema`.
- **Value and label diverge in the frontend for the first time.** `getModelIds` (`apps/frontend/lib/model-config.ts:43`) returns one string used as React key, option value, and visible label at `agent-form.tsx:643` and `model-selector-dialog.tsx:92`; aliases split these, so an options helper returning `{ value, label }` is needed.
- **Aliasing a model that is already referenced concretely is safe at run time, but selection matching must be entry-based.** Adding an alias does not change the entry's `id`, and resolution keys on `id`, so every existing `agent.modelId` / `chat.modelId` holding the bare id keeps resolving to the same model — no migration, no backfill, no behavioural change to any running Chat turn. The UI is what breaks, silently and in two places, because both compare model strings for equality: the Agent form builds its option values from the model list, so a stored `gpt-4` matches no option once the entry is labelled `flagship` and the Select renders its "Select a model" placeholder over an Agent that is in fact configured; and the persisted chat selection is validated by membership against that same list, so it fails and falls through to the first Provider's first model — a different model entirely. The fix is to resolve **both** the stored reference and each option to a `modelIds` **entry** and match on the entry, not the string: a stored bare `gpt-4` selects the entry now labelled `flagship`, a stored `alias:flagship` selects the same entry, and an un-aliased entry still matches by `id`. A reference matching no entry at all keeps today's behaviour (the model was genuinely removed from the Provider).
- **References migrate from concrete to alias opportunistically, on save.** Because an option's value is the alias reference, entry-based matching means editing and saving an Agent that stored `gpt-4` writes `alias:flagship`. This is deliberate: once a model is aliased the picker no longer offers the concrete id, so "pin to exactly `gpt-4`" is not an expressible choice — an Org Admin adding the alias _is_ the declaration that the model should be referenced by name. Rejected the alternative of **backfilling every reference when an alias is created**: it is a many-row write triggered by a config edit, it needs precisely the "what's using this alias" machinery deferred above, and data migrations do not run in the `drizzle-kit push` dev flow.
