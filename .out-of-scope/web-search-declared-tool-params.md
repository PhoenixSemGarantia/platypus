# Backend-declared `web_search` / `read_url` Parameters

A Web-search backend cannot add input parameters to the tools the model calls.
`web_search` takes `{ query }` and `read_url` takes `{ url, max_length?,
start_index? }`, on every backend, forever — there is no mechanism for a backend
to declare `region`, `freshness`, `site`, `language`, `safesearch` or anything
else that core merges onto that base before building the `Tool`.

This rejects both spellings of the idea: a backend supplying a Zod schema core
merges, and the softer version where a backend _declares_ params from a small
core-validated vocabulary of primitive, length-capped, enum-ish types. The
objections below survive the constrained spelling intact, so constraining the
declaration only changes how much machinery it takes to arrive at the same
place.

It does **not** reject the underlying want. A metasearch instance really does
answer differently with a time range or a language applied, and search quality
on a self-hosted stack often lives in exactly those knobs. Most of that is
reachable today. See "What to do instead".

## Why this is out of scope

### One signature across every backend is the feature, not a side effect

ADR-0014 has core, not the backend, build the `Tool` objects, so that every
Web-search backend presents the same model-facing signature and an Agent prompt
does not couple to whichever backend an Operator happened to configure. Declared
params break that directly. Selection is per-Provider, so two Providers on two
backends would hand the _same Agent_ two different `web_search` signatures
depending on which Provider the turn ran against — and an Agent prompt written
against one of them silently degrades on the other.

This is the property that makes a backend swappable. A deployment that moves
from SearXNG to Brave should not have to re-audit its Agent prompts.

### A declared parameter can promise the model something core then takes away

Core's output bounds bind after any merge, and they are not negotiable:

```ts
export const MAX_SEARCH_RESULTS = 10;
export const MAX_SNIPPET_CHARS = 500;
export const MAX_TITLE_CHARS = 200;
export const MAX_ANSWER_CHARS = 4_000;
export const MAX_SEARCH_RESULT_SCAN = MAX_SEARCH_RESULTS * 10;
```

So a backend declaring `count: 1..50` publishes a promise in the tool schema that
core silently cuts to ten. The model asked for fifty, the schema said fifty was
valid, and it got ten with no indication that a bound was applied. Backends
never truncate and core always caps — that split is what stops a botched
truncation dropping a multi-hundred-kilobyte response into a context window, and
it means any declared parameter that shadows a cap is a lie told to the model.

Policing that needs a boot-time refusal list: params colliding with a base field
name, params shadowing a cap, params whose bounds exceed a core bound. That is a
meaningful amount of machinery whose entire job is guarding a surface core
already said it owned.

### Always-on schema cost is the thing this Extension point exists to avoid

Part of why Web-search backends are a core Extension point rather than "wire your
search service up as an MCP server" is that MCP tools sit in the schema on every
turn, whether or not the turn searches. Declared params reintroduce a smaller
version of the same cost: they ride in the tool schema on every searching turn,
paid by every Agent on that Provider, to serve the fraction of turns where the
model would actually narrow a search.

## What to do instead

Fixed policy belongs in the executor factory, not in the model's schema. A
backend receives the per-turn request context and its deploy-time config in the
same call, so it can apply a region, a language or a category set to every
upstream request without core knowing the knob exists:

```ts
createExecutors(ctx, plugin) {
  // ctx    → { orgId, workspaceId, userId }
  // plugin → { config, credentials, logger }
  const policy = plugin.config.policy[ctx.orgId] ?? plugin.config.policy.default;

  return {
    web_search: ({ query }) =>
      searchUpstream({ query, language: policy.language, categories: policy.categories }),
  };
}
```

That covers everything an Operator wants to _set_, including varying it per
Organization or per Workspace — the same pattern documented in
[web-search-per-provider-config.md](./web-search-per-provider-config.md). It does
not need core to change, and it keeps the model-facing schema identical across
backends, which is the point.

What this genuinely does not cover is the model _choosing_ a value on a
particular turn — narrowing to the last week, or to one site, because it can tell
its own search came back too broad. That capability is real and is not available.
It is the only part of the request the factory cannot absorb, and it is the part
that would cost the two properties above.

## What would change our mind

Not a headcount, and not a wish list of knobs. Reconsidering means a real,
named, shipped Web-search backend whose author can show:

- the upstream capability exists and is unreachable through the factory, **and**
- what they are blocked on is genuinely the _per-turn model choice_, not a fixed
  value an Operator sets ahead of time.

The second clause is the load-bearing one. Nearly every parameter named so far —
region, language, category set, safesearch — is fixed Operator policy that the
factory already handles. A request that cannot separate the two has not yet found
the thing this record rejects.

Note that #520 was filed as a direction call rather than a proposal to start
work, and asked for exactly this answer to be recorded. At the time of writing
there is no Web-search backend in the tree at all — the trigger the original
deferral named ("a backend needs to expose more than the base") has not fired.

## Prior requests

- #520 — "[Web-search backend] Should a backend be able to declare extra
  `web_search` / `read_url` parameters that core merges onto the fixed schema?"
  (deferred twice on #329 before being recorded here)
