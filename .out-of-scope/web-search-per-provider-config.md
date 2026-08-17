# Per-Provider Config / Credentials for Web-search Backends

Platypus does **not** add a `config` / `credentials` column to the Provider row
for Web-search backends, and does **not** re-add per-contribution
`configSchema` / `credentialsSchema` to the Web-search backend Extension point.
A Web-search backend's endpoint and API key come from deploy-time Plugin config
and stay deployment-wide.

This rejects the **data-model change**, not the underlying need. Pointing one
Provider at an internal SearXNG and another at a DMZ instance, or billing two
teams to two Brave keys, is a real thing to want — and it is **already
achievable today** without any core change. See "What to do instead" below.

## Why the column is out of scope

### The Provider row is the wrong axis

A Provider is dual-scope (ADR-0007): an org-scoped Shared Provider is a single
row that many Workspaces reference. A `credentials` column on that row is
org-wide credentials wearing a per-Provider costume — the setting would read as
"this Provider's key" while behaving as "this Organization's key" for exactly
the Shared case the feature is most wanted for.

If the honest ask is per-Organization, a Provider column is a confusing way to
spell it. If the ask is per-Workspace, it splits one feature across two rows:
ADR-0014 deliberately put web-search _selection_ on the Provider, next to
`nativeSearchEnabled`, so that "can this Provider search?" stays a pure function
of the Provider. Config on a different row than selection reopens what that
decision closed.

### Plugin-shaped secrets break Provider redaction

Provider reads pass through a single redaction function with a **fixed** strip
list — `apiKey` and `headers`:

```ts
export const redactProviderSecrets = <T extends ProviderSecretFields>(
  row: T,
  opts: { reveal?: boolean } = {},
) => {
  if (opts.reveal) return row;
  const { apiKey, headers, ...rest } = row;
  return {
    ...rest,
    apiKeySet: presence(apiKey),
    headersSet: presence(headers),
  };
};
```

A per-Provider `credentials` column is plugin-defined in shape, so this function
could no longer know what is secret from its own source — it would have to
consult a schema supplied by whichever plugin the row's `searchSource` names. A
redaction path that resolves plugin-supplied schemas at read time is a
materially worse security posture than one with a fixed field list.

The exposure is not hypothetical. Provider writes are already delegatable to a
non-admin Workspace Owner through the `providerSelfManagement` flag, so the
column would hand that role a second credential surface governed by machinery
that is harder to audit than the first (ADR-0006).

## What to do instead

A Web-search backend's executor factory receives the **request context** and the
Plugin's deploy-time config block in the same call, once per Chat turn:

```ts
createExecutors(ctx, plugin);
// ctx    → { orgId, workspaceId, userId }
// plugin → { config, credentials, logger }
```

So a backend can key its own config block by tenant and select inside the
factory. No core change, no new column, no new secret surface:

```jsonc
// PLATYPUS_PLUGIN_CONFIG
{
  "acme-search": {
    "config": {
      "endpoints": {
        "org-dmz-team": "https://searx.dmz.internal",
        "default": "https://searx.internal",
      },
    },
    "credentials": {
      "keys": { "org-dmz-team": "brave-key-a", "default": "brave-key-b" },
    },
  },
}
```

```ts
createExecutors(ctx, plugin) {
  const endpoint =
    plugin.config.endpoints[ctx.orgId] ?? plugin.config.endpoints.default;
  // ...
}
```

The credentials stay in the Operator-owned, boot-validated config block where
ADR-0013 puts them, and never touch a tenant-writable row. Reading process
environment variables directly from inside a backend is still the wrong move —
this pattern is the supported one.

## What would change our mind

The reasoning above is about **shape**, not effort — the plumbing is small and
append-only. Reconsidering means one of:

- A case the per-turn context genuinely cannot express. `orgId`, `workspaceId`,
  and `userId` cover every axis raised so far; a requirement that discriminates
  on something else would be new information.
- A decision to make per-tenant Plugin config a **first-class core concept**
  across all Extension points rather than a per-backend convention — at which
  point it is a plugin-system question (ADR-0013), not a Web-search one, and the
  Provider column is still not the answer.

Note that #519 was filed with no confirmed demand: it was raised pre-emptively
by the documentation, which told backend authors that per-Organization
credentials were "a gap to report" rather than showing the pattern above. That
sentence was corrected when this decision was recorded.

## Prior requests

- #519 — "[Web-search backend] Credentials are deployment-wide — is a
  per-Provider config knob worth adding?"
