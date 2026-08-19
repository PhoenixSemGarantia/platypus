# Per-Workspace Call Budgets for `web_search` (and for Tool Calls Generally)

Platypus does **not** give a Workspace a call budget, quota or rate limit for
`web_search` and `read_url`, and core does **not** add a general per-Workspace
tool-call budget covering `fetchUrl`, sandbox `shellExec` and MCP tools either.
The bounds core places on a runaway Agent stay what they are today: a step
ceiling, wall-clock timeouts, and a per-call executor timeout. All of them bound
a **turn**. None of them bounds a time window or a spend, and that is the
current, deliberate position.

This rejects **core owning the control**, not the underlying need. An Agent
looping on search against a metered API really can burn someone's monthly quota,
and that is a reasonable thing to want stopped. What is out of scope is core
growing a counter and a knob to stop it.

## Why a core budget is out of scope

### There is nothing for a budget to protect

A budget is only meaningful if exceeding it costs an identifiable party
something. ADR-0014 puts a backend's key and endpoint in deploy-time Plugin
config, deployment-wide, and the request to make them per-Provider was rejected
in [web-search-per-provider-config.md](./web-search-per-provider-config.md). So
one Brave or Tavily key is shared by every Provider in every Workspace in the
deployment, permanently.

That leaves a per-Workspace budget with nothing to attribute. #521 saw this and
said it directly: with one deployment-wide key "there is nothing to attribute",
and "rate limiting without it is half a feature". The attribution half has since
been decided against. The remaining half does not stand up on its own — it
throttles one Workspace to leave the same shared quota available to the next one
that loops.

### The backend already holds both the tenant identity and the call site

A Web-search backend's factory receives the request context once per Chat turn:

```ts
// packages/plugin-sdk/index.ts:304
export interface WebBackendContext {
  orgId: string;
  workspaceId: string;
  userId: string;
}

// invoked at apps/backend/src/web-backends/index.ts:554
createExecutors(ctx, plugin);
```

Everything a budget needs is in that one call. A backend written over a metered
API can hold its own counter, key it on `ctx.workspaceId`, and refuse:

```ts
createExecutors(ctx, plugin) {
  const limit = plugin.config.hourlyLimit ?? 100;
  return {
    web_search: async ({ query }) => {
      if (count(ctx.workspaceId) >= limit) {
        return { error: "Search budget for this workspace is exhausted." };
      }
      bump(ctx.workspaceId);
      return callUpstream(query);
    },
  };
}
```

The refusal rides the `WebToolError` contract core already owns, so it reaches
the model as a string on the tool result rather than as an AI-SDK tool error.
No core change, no new column, no new knob.

The one property core would add that a backend author cannot is **uniformity** —
one budget spelled the same way across every backend, visible to an Operator in
one place. That is worth something in principle. It is worth very little while
the population of backends metered enough to care about it is empty.

### The deployments this Extension point was built for do not pay per call

The Extension point ships no backend of its own, and the deployments it was
designed for point at a self-hosted metasearch engine (SearXNG) or a local
browser service, where an extra thousand calls costs CPU and nothing else. #521
opened by conceding the point: "Right now it buys close to nothing."

It was filed off the deferred-follow-up list in #329 (PR7, marked optional), not
off an Operator who hit the wall. Neither an incident nor a metered backend in
the field has been reported.

### The cheap counter is misleading and the honest one is a new store

`composeWebBackend` (`apps/backend/src/web-backends/index.ts:235`) is the
obvious choke point, and an in-memory counter keyed on `ctx.workspaceId` really
would be a few lines there. It would also inherit the run registry's constraint:
that module is explicitly single-process
(`apps/backend/src/runs/run-registry.ts:3-9`), so a multi-process deployment
would silently multiply the budget by its process count. A limit that reads as
"100 per hour" and enforces 400 is worse than no limit, because an Operator
plans against the number they were shown.

A durable budget needs somewhere to persist counts across turns, and that place
does not exist. `accumulateStepStats` counts calls per tool name per run
(`apps/backend/src/runs/run-stats.ts:46-54`), and trigger runs persist that to
`trigger_run.stats` (`apps/backend/src/db/schema.ts:701`), but chat turns do not
persist it at all. So the correct version of this feature starts with a new
usage-accounting surface, built to serve a control nobody has yet needed.

### The general version is a different feature, not a bigger one

#521 also asked whether web search is special enough to deserve its own control,
or whether a **general per-Workspace tool-call budget** would be the better
shape. It is a fair question and the answer is the same: not now, and not
reserved here as pending design. A general budget is cross-cutting metering
across the sandbox, MCP and every Tool set — a question about usage accounting
and Workspace-level policy, not a question about Web search. If it is genuinely
needed, someone will raise it with a case attached, and it will be triaged as
its own concept.

## What bounds a runaway Agent today

Worth stating plainly so nobody reaches for a budget to buy something they
already have, or counts on a bound that is weaker than it looks:

- **Step ceiling.** `stopWhen: [stepCountIs(plan.maxSteps)]`
  (`apps/backend/src/runs/run-plan.ts:73-75`). An Agent without an explicit
  `maxSteps` gets `DEFAULT_AGENT_MAX_STEPS = 15`
  (`packages/schemas/index.ts:203`, resolved at
  `apps/backend/src/runs/agent-plan.ts:108-109`).
- **No-progress termination**, enabled for unattended runs only
  (`apps/backend/src/runs/drive.ts:92-94`). Interactive chats deliberately
  leave it off.
- **Wall-clock timers**: a per-step idle timeout and a per-run timeout
  (`apps/backend/src/runs/run-registry.ts:110-111`).
- **Per-call executor timeout**, 30s by default and 120s at the ceiling
  (`apps/backend/src/web-backends/index.ts:49-55`).

Three gaps in that set are real. A step ceiling caps _steps_, and one step can
carry several parallel tool calls. A delegated run gets its own ceiling, so a
parent's 15 does not bound the total across its delegates. And none of them
reset, so an Agent that searches 15 times per turn can be re-triggered
indefinitely.

One accidental bound is worth naming so nobody defends it: #463 reports that
Direct (no-Agent) chats resolve `maxSteps` to `1`
(`apps/backend/src/runs/agent-plan.ts:109`), which caps blast radius on the one
surface where search is the only tool. That is a bug to fix, not a control to
keep.

## What would change our mind

- **A metered backend actually in the field, plus an Operator who lost a quota
  to it.** Numbers from a real deployment — which backend, which API, how many
  calls, what it cost — turn this from a hypothetical into a sized problem.
- **A decision to make durable per-Workspace usage accounting a first-class core
  concept**, for billing or usage reporting. A budget then rides on that store
  instead of inventing one, and the design question becomes where the policy
  lives rather than where the counter lives.
- **A multi-process deployment topology.** That changes the counter question,
  though not the demand question, and would need the run registry revisited
  anyway.

## Prior requests

- #521 — "[Web-search backend] Should a Workspace have a call budget for
  `web_search`, or for tool calls generally?" Filed as PR7 of the deferred
  follow-ups in #329 and marked optional there. It carried the general
  tool-call-budget question too, which this file rejects with it.

Related decisions, both from the same batch of #329 follow-ups:

- [web-search-per-provider-config.md](./web-search-per-provider-config.md) —
  the deployment-wide-credentials decision this one rests on.
- [web-search-declared-tool-params.md](./web-search-declared-tool-params.md) —
  the fixed `web_search` / `read_url` input schemas.
