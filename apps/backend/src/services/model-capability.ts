import {
  defaultPassthroughFileTypes,
  resolveExtractedTextCap,
  resolveModelReference,
  type ConcreteModelId,
  type ModelConfig,
  type Provider,
} from "@platypus/schemas";

// The provider-type default set is shared with the frontend via
// @platypus/schemas; re-exported so this module stays the backend's single
// capability import surface.
export { defaultPassthroughFileTypes };

/**
 * Per-model file capability resolution.
 *
 * Capability is a property of the `(provider, model)` pair and is *declared*,
 * not inferred (see issue #328). A model's `passthroughFileTypes` lists the
 * media types it ingests natively; anything else is converted to text where
 * possible (Phase 2) or, until then, cleanly rejected. This module is the
 * single source of truth for turning a provider's stored models — which may be
 * the new per-model objects OR a legacy `string[]` — into resolved
 * `ModelConfig`s with sensible provider-type defaults filled in.
 */

/**
 * Normalize a provider's stored models into resolved `ModelConfig`s.
 *
 * Tolerates both shapes so the runtime is correct regardless of migration
 * state (dev `drizzle-kit push` skips the data backfill): a bare `string`
 * entry, or an object with no `passthroughFileTypes`, inherits the
 * provider-type default. An empty list also inherits the default — this keeps a
 * newly-added model (whose types default to `[]`) from accidentally rejecting
 * every file, including images; the trade-off is that "accept nothing natively"
 * can't be expressed, which is fine (the images-only floor is already the
 * minimum, and Phase 2 extracts the rest to text).
 */
export const resolveProviderModels = (provider: Provider): ModelConfig[] => {
  const fallback = defaultPassthroughFileTypes(provider);
  const raw = provider.modelIds as unknown as Array<
    string | Partial<ModelConfig>
  >;
  return raw.map((entry) => {
    if (typeof entry === "string") {
      return { id: entry, passthroughFileTypes: fallback };
    }
    const declared = entry.passthroughFileTypes;
    // Spread the stored entry so per-model metadata added later (e.g.
    // `maxExtractedTextChars`) survives resolution without touching this.
    return {
      ...entry,
      id: entry.id ?? "",
      passthroughFileTypes:
        declared && declared.length > 0 ? declared : fallback,
    };
  });
};

/** The plain model-id list, preserving order — for existing `string[]` consumers. */
export const providerModelIds = (provider: Provider): string[] =>
  resolveProviderModels(provider).map((model) => model.id);

/**
 * Dedupe a provider payload's models by id (first entry wins, so an operator's
 * explicit `passthroughFileTypes` is kept over a later duplicate) and sort by
 * id for stable storage. Replaces the old `dedupeArray(modelIds).sort()` on the
 * flat string list, which no longer works now that entries are objects.
 */
export const dedupeModelConfigs = (models: ModelConfig[]): ModelConfig[] => {
  const byId = new Map<string, ModelConfig>();
  for (const model of models) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
};

/**
 * Resolve a stored model reference — `agent.modelId`, `chat.modelId`, or an
 * API-supplied `modelId` — to the concrete model it names, or `undefined` when
 * it names nothing this provider has.
 *
 * The SOLE producer of `ConcreteModelId`, and therefore the only way into the
 * capability helpers and `openProvider(...).languageModel(...)` below. Callers
 * must treat `undefined` as a hard error and never fall back to another model
 * (ADR-0017): silently answering with a different model is worse than failing
 * the turn, which is what a dangling concrete id has always done.
 */
export const resolveModelId = (
  provider: Provider,
  reference: string,
): ConcreteModelId | undefined =>
  resolveModelReference(resolveProviderModels(provider), reference);

/**
 * Brand one of the Provider's own pointer-settings — `taskModelId`,
 * `memoryExtractionModelId`, `embeddingModelId` — as concrete.
 *
 * Sound because `providerBaseSchema` rejects an `alias:`-prefixed value in all
 * three, so they cannot hold a reference in the first place. Deliberately
 * long-named: this is the one hole in the brand, and passing an `agent.modelId`
 * or `chat.modelId` through it defeats the guarantee the brand exists for.
 */
export const pointerSettingModelId = (value: string): ConcreteModelId =>
  value as ConcreteModelId;

/**
 * The media types the given model ingests natively. Falls back to the
 * provider-type default when the model isn't found (defensive — callers should
 * validate the model id first).
 */
export const passthroughFileTypesForModel = (
  provider: Provider,
  modelId: ConcreteModelId,
): string[] => {
  const model = resolveProviderModels(provider).find((m) => m.id === modelId);
  return model
    ? model.passthroughFileTypes
    : defaultPassthroughFileTypes(provider);
};

/**
 * How much extracted document text this model may be sent (issue #342).
 * `resolveExtractedTextCap` decides what an absent or nonsense declaration
 * means, so this and the schema can't drift.
 */
export const maxExtractedTextCharsForModel = (
  provider: Provider,
  modelId: ConcreteModelId,
): number =>
  resolveExtractedTextCap(
    resolveProviderModels(provider).find((m) => m.id === modelId)
      ?.maxExtractedTextChars,
  );
