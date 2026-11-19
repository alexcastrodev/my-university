---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Policies and requirements decide inside your process. When the rules must be shared by several services, change without a deploy, or follow a graph of relations ("editor of the folder that contains the document"), the decision moves to a Policy Decision Point (PDP) and ASP.NET Core keeps only the Policy Enforcement Point (PEP): a handler or an endpoint filter that asks and obeys. This lesson wires the two common PDPs into a .NET 10 minimal API, OpenFGA (relations, Zanzibar style) and OPA (Rego over JSON), and measures what the choice costs: latency per call, the N+1 trap on lists, decision-cache staleness after a revoke, and what happens to a request when the PDP is down. For the models and engines in the abstract (RBAC, ABAC, ReBAC, Cedar), see the neutral lesson [Authorization Models: RBAC, ABAC, ReBAC and Policy Engines](/identity-concepts/authorization-models-rbac-abac-rebac-and-policy-engines); this one is the .NET integration and its failure modes.
Versions: `OpenFga.Sdk` 0.10.5 (NuGet, pre-1.0, so the API may still change), `openfga/openfga:v1.22.1` (memory store, authentication disabled), `openpolicyagent/opa:1.22.4` (Rego v1), `fga` CLI `openfga/cli:v0.9.0` only to turn the DSL into JSON, `nginx:alpine` as the bundle server, `net10.0`, SDK 10.0.100, runtime 10.0.0 on macOS arm64, Docker Desktop on loopback.

## Use Cases

- Sharing: many services and a UI must agree on "who can edit this document", so the rule lives once, outside any of them.
- Changing a rule without redeploying the API (an OPA bundle, an OpenFGA model write).
- Filtering a list page to what the caller may see, instead of authorizing row by row.
- Deciding how much stale access and how much downtime the product tolerates when the authorization service is a dependency.

## Deep Dive

### What changes compared with built-in authorization

[Authentication and Authorization Fundamentals](authentication-and-authorization-fundamentals) covers schemes, policies, requirements and the resource-based handler. Nothing in that machinery changes: `IAuthorizationService.AuthorizeAsync(user, resource, requirement)` still runs your `AuthorizationHandler<TRequirement, TResource>`. What changes is the body of the handler, an in-process comparison becomes a network call. Same endpoint, same caller (`bob`, document 30), 1000 requests through Kestrel on loopback after 100 warm-ups:

```text
                                         p50      p95
no authorization (baseline)              0.14 ms  0.18 ms
built-in handler (owner or department)   0.15 ms  0.17 ms
handler -> OPA  /v1/data/docs/allow      0.55 ms  0.69 ms
handler -> OpenFGA Check                 0.67 ms  0.84 ms
```

Roughly 0.4 to 0.5 ms per decision here. It is a laptop, no TLS, no real network and a tiny graph, so read the ratio (3 to 5 times the built-in handler), not the milliseconds. Every decision you make per request is multiplied by it, which is why the rest of this lesson is about counting calls.

### The experiment app

One minimal API, an `IPdp` interface with an OpenFGA and an OPA implementation chosen by an environment variable, a throwaway `X-User` header scheme (never ship it), and an in-memory "database" of 1000 documents. The data: alice owns documents 1 to 20, team `eng` (alice and bob) may view 21 to 80, dave has nothing. The OpenFGA model (converted to JSON with the `fga` CLI and loaded with `WriteAuthorizationModel`):

```text
model
  schema 1.1
type user
type team
  relations
    define member: [user]
type document
  relations
    define owner: [user]
    define editor: [user, team#member] or owner
    define viewer: [user, team#member] or editor
```

The OPA policy takes the user, action and resource attributes in `input`; the app is the information point and loads the document first:

```rego
package docs
import rego.v1
default allow := false
allow if can(input.user, input.action, input.resource)
allowed_ids contains r.id if { some r in input.resources; can(input.user, input.action, r) }   # one call, N questions
can(user, _, _) if user.role == "admin"
can(user, _, r) if r.owner == user.name
can(user, "read", r) if r.department == user.department
```

A relation engine needs only ids (`user:bob`, `viewer`, `document:30`); an attribute engine needs the attributes, so it needs the resource loaded. That decides which enforcement point fits, below.

### Enforcement point 1: a resource-based handler

The requirement carries the relation, the handler asks the PDP and succeeds or stays silent. Not calling `Succeed` is the safe default: the requirement fails and `Results.Forbid()` answers 403.

```csharp
public record DocumentAccess(string Relation) : IAuthorizationRequirement;

public sealed class DocumentHandler(IPdp pdp, PdpOptions opt, ILogger<DocumentHandler> log)
    : AuthorizationHandler<DocumentAccess, Document>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext ctx, DocumentAccess req, Document doc)
    {
        try
        {
            using var cts = new CancellationTokenSource(opt.TimeoutMs);   // never wait on a PDP forever
            if (await pdp.CheckAsync(ctx.User.Identity!.Name!, req.Relation, doc, cts.Token)) ctx.Succeed(req);
        }
        catch (Exception e) when (opt.FailMode != "throw")
        {
            log.LogWarning("PDP unavailable ({Type}), failing {Mode}", e.GetType().Name, opt.FailMode);
            if (opt.FailMode == "open") ctx.Succeed(req);   // otherwise no Succeed: 403
        }
    }
}
// endpoint: var r = await authz.AuthorizeAsync(user, doc, new DocumentAccess("viewer"));
//           return r.Succeeded ? Results.Ok(doc) : Results.Forbid();
```

The OpenFGA side of `IPdp.CheckAsync` is one SDK call: `fga.Check(new ClientCheckRequest { User = "user:bob", Relation = "viewer", Object = "document:30" }, null, ct)` returning `Allowed`. Registering the handler as `IAuthorizationHandler` is all the wiring ASP.NET Core needs.

### Enforcement point 2: an endpoint filter

When the route id is enough, a filter asks before the endpoint runs and before any database read, so a forbidden request costs one PDP call and no query:

```csharp
app.MapGet("/f/docs/{id:int}", (int id) => Results.Ok(new { id }))
   .AddEndpointFilter(async (ctx, next) =>
   {
       int id = ctx.GetArgument<int>(0);
       var pdp = ctx.HttpContext.RequestServices.GetRequiredService<IPdp>();
       bool ok = await pdp.CheckAsync(ctx.HttpContext.User.Identity!.Name!, "viewer", new Document(id, "?", "?"), ct);
       return ok ? await next(ctx) : Results.Forbid();
   });
```

Against OpenFGA it returned 200 for bob and the same latency as the handler (0.67 ms p50). Against OPA the same filter returned **403 for bob on a document he may read**: the filter passed `"?"` as owner and department, and the Rego rule compares attributes. No error, no log, just a wrong denial. Rule of thumb from this run: the filter fits relation engines; with an attribute engine use the handler, which receives the loaded resource. A filter also cannot authorize a resource the endpoint itself creates, and it adds a second place where authorization lives, so keep it to the check and leave the rest to `RequireAuthorization`.

### The OpenFGA SDK in .NET

`OpenFga.Sdk` 0.10.5 (package id exactly that, from the `openfga/dotnet-sdk` repo; community packages on NuGet such as `Fga.Net.DependencyInjection` and `Fga.Net.AspNetCore` target DI and ASP.NET Core, not used here). `OpenFgaClient` takes `ApiUrl`, `StoreId` and optionally `AuthorizationModelId` (the docs say the latest model is used when omitted; I set it). The calls used here:

```csharp
await fga.Check(new ClientCheckRequest { User = "user:bob", Relation = "viewer", Object = "document:30" });  // bool? Allowed
await fga.ListObjects(new ClientListObjectsRequest { User = "user:alice", Relation = "viewer", Type = "document" }); // Objects
await fga.BatchCheck(new ClientBatchCheckRequest { Checks = [new ClientBatchCheckItem { User = .., Relation = .., Object = .., CorrelationId = "30" }, ..] });
await fga.WriteTuples([new ClientTupleKey { User = "team:eng#member", Relation = "viewer", Object = "document:30" }]);
await fga.DeleteTuples([new ClientTupleKeyWithoutCondition { .. }]);
```

Facts the server enforced here: a write takes at most 100 tuples (`MaxTuplesPerWrite`), `BatchCheck` at most 50 checks, and writing a tuple that already exists is an error (`FgaApiValidationError: cannot write a tuple which already exists`), so a seed routine must be idempotent. `ClientBatchCheck` (client-side fan-out of many `Check`s, as opposed to the server `BatchCheck` above) exists in the SDK but was not run (docs only).

A trap in 0.10.5: `ClientConfiguration.RetryParams = new RetryParams { MaxRetry = 0 }` (documented as retries after rate limiting) changed **nothing** for connection errors, while setting `MaxRetry` and `MinWaitInMs` directly on `ClientConfiguration` did; their defaults are 3 and 100 ms. The cost is in the PDP-down section.

### OPA from .NET: plain HTTP

There is no SDK to take. `POST /v1/data/docs/allow` with `{"input": ...}` returns `{"decision_id": "...", "result": true}`:

```csharp
using var resp = await http.PostAsync("v1/data/docs/allow", new StringContent(body, Encoding.UTF8, "application/json"), ct);
resp.EnsureSuccessStatusCode();
using var json = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
return json.RootElement.TryGetProperty("result", out var r) && r.GetBoolean();   // no "result" means undefined: deny
```

Measured behaviors that shape that last line: a query for a path that does not exist (`/v1/data/docs/missing`) answers 200 with only a `decision_id` and no `result`; an invalid JSON body answers 400; a request without `input` answers `"result": false` plus an `api_usage_warning`. A client that reads `GetProperty("result")` would throw on the first, and a handler that catches every exception and fails open would then turn a typo in the policy path into "allow everyone".

**Bundles** replace redeploying the policy. OPA polls a bundle server (here nginx serving `docs.tar.gz` built with `opa build`), with `polling: { min_delay_seconds: 1, max_delay_seconds: 2 }`. I removed the department rule, rebuilt the bundle and polled the decision: bob's read of document 30 flipped from `true` to `false` **0.97 s** after the new file was published, and the log said `Bundle loaded and activated successfully. Etag updated`. The staleness of a policy change is the polling interval, set by you.

**Decision logs** (`decision_logs.console: true`; a collector or `service` in production) give one JSON line per decision, enough to audit who was allowed what:

```text
{"decision_id": "fb61df6e-...", "path": "docs/allow", "result": false, "bundles": {"docs": {}},
 "input": {"action": "read", "resource": {"department": "eng", "id": 30, "owner": "nobody"}, "user": {"department": "eng", "name": "bob", "role": "user"}}}
```

The `bundles` entry was empty because my bundle had no `.manifest` revision; add one if you want to know which policy version decided.

### Per-call latency

1000 calls after 100 warm-ups (300 for `ListObjects` and `BatchCheck`), keep-alive loopback, from a .NET console app, no ASP.NET Core in the loop:

```text
OpenFGA SDK Check (allow)     p50 0.45 ms  p95 0.56 ms
OpenFGA SDK Check (deny)      p50 0.45 ms  p95 0.56 ms
OpenFGA ListObjects (80 hits) p50 0.53 ms  p95 0.85 ms
OpenFGA BatchCheck x50        p50 1.60 ms  p95 2.86 ms
OPA /v1/data/docs/allow       p50 0.27 ms  p95 0.32 ms
```

Everything is under a millisecond because the graph has 82 tuples and the memory store has no disk. OpenFGA's cost grows with the depth and fan-out of the relations (its server defaults cap resolution depth and breadth), OPA's with the policy and the data; a database-backed store and a real network add to both. Treat this as the floor.

### The N+1 authorization problem

A list page over 1000 candidate documents, alice sees 80 of them. Four strategies against the same data, p50 of 20 requests (3 warm-ups) for the whole HTTP request, n = candidates:

```text
OpenFGA                      n=10      n=100     n=1000
one Check per item           5.53 ms   45.73 ms  394.44 ms   (1000 PDP calls)
16 in parallel               1.13 ms    7.65 ms   64.55 ms   (1000 PDP calls)
BatchCheck, 50 per call      0.92 ms    3.74 ms   33.99 ms   (20 PDP calls)
ListObjects, then intersect  0.85 ms    0.77 ms    0.84 ms   (1 PDP call)

OPA                          n=10      n=100     n=1000
one request per item         3.85 ms   31.63 ms  278.58 ms
16 in parallel               1.13 ms    6.99 ms   65.82 ms
one input with all resources 0.50 ms    1.07 ms    5.69 ms   (1 PDP call, "allowed_ids")
```

Sequential checks are the N+1 problem: 0.4 ms times 1000 is the whole request. Parallelism hides latency but not load, 1000 calls still hit the PDP per page view. The real fixes cut the number of calls. `BatchCheck` is capped at 50 per call by the server, so 1000 items need 20 calls. `ListObjects` is flat at 0.8 ms because it answers "everything alice can reach" and ignores your candidate list; the app intersects. Its caveats, measured: for a user with 1200 viewable documents it returned **1000** objects, silently (`listObjectsMaxResults` default 1000, `listObjectsDeadline` default 3 s, per the OpenFGA docs), so it is wrong as a filter for users who reach more than the cap unless you raise it or paginate your side. And it enumerates the user's whole reach: 1.58 ms p50 with 1200 hits against 0.53 ms with 80. Pushing the filter into the data query (the PDP returns ids or a residual condition, the database does the `WHERE`) is the scalable form; OPA's partial evaluation is the engine feature for that (see the neutral lesson, not repeated here).

### Decision cache and the risk of stale decisions

The usual cure for per-call cost is `IMemoryCache` around the PDP: key `(user, relation, document)`, value the boolean, TTL a few seconds. Cost saved: a hit is a dictionary lookup. Cost paid: the PDP is no longer the truth. A TTL of 5 s, bob reads document 30 through his team, then the tuple `team:eng#member viewer document:30` is deleted at t = 0 and the endpoint is polled every 100 ms:

```text
app cache 5 s, revoke:                  t=0.02 s status 200 (stale)   t=5.03 s status 403
app cache 5 s, grant after cached deny: t=0.02 s status 403 (stale)   t=5.05 s status 200
no app cache, OpenFGA --check-query-cache-enabled (5 s): 200 until t=5.06 s, then 403
same server, client sends HIGHER_CONSISTENCY:            403 at t=0.02 s
no cache anywhere:                                       403 at t=0.02 s
```

A revoke is real only when every cache in the path has expired, and the cache stores denials too, so a fresh grant also waits. The first request filled the cache just before the revoke, so these are worst cases; the average is half the TTL. There are two independent caches here: yours, and OpenFGA's own query cache, **off by default** in v1.22.1 and enabled with `--check-query-cache-enabled` (TTL default 10 s; its help text says it makes `Check` and `ListObjects` eventually consistent). Per-request `Consistency = HIGHER_CONSISTENCY` in the SDK's check options skips the server cache, at a latency cost, so use it for the sensitive path (after a permission change, before a destructive action) and the cache for the rest. That the two stack to the sum of their TTLs was not measured. Revocation that must be immediate (a fired employee, a leaked token) does not belong behind a TTL: use TTL 0 for that relation or push invalidation. `--cache-controller-enabled` (invalidate on recent writes) exists in the server help; not run (docs only).

### When the PDP is down: fail-open or fail-closed

Same request (bob, document 30), the PDP container stopped, so the connection is refused:

```text
OpenFGA, closed, SDK default retries (MaxRetry 3)     403 in 1.02 s
OpenFGA, closed, MaxRetry = 0                         403 in 0.009 s
OpenFGA, closed, MaxRetry = 3, timeout 300 ms         403 in 0.49 s
OpenFGA, open,   MaxRetry = 0                         200 in 0.007 s
OpenFGA, handler lets the exception escape            500 in 0.010 s
OPA, closed                                           403 in 0.009 s
OPA, open                                             200 in 0.008 s
```

Fail-open also let dave read document 500, which nobody shared with him: during the outage authorization did not exist. Fail-closed is the default for a security decision; fail-open is only defensible where the resource is low value and the outage is rare, and it needs an alert. An exception that escapes the handler is neither: a 500, which also looks like a server bug to clients and monitors. Decide the mode in code, as above.

The SDK retry setting matters most when the PDP is hung or down. Per failed call on a stopped container: `MaxRetry` 0 took 35 ms, 1 took about 160 ms, 3 (the default) 0.8 to 1.0 s, 6 took 10.5 s (exponential backoff), while a plain `HttpClient` failed in 1 ms. Retrying an authorization call 6 times holds the user's request for 10 s. Now `docker pause` instead of stop, so the connection is accepted and nobody answers:

```text
OpenFGA, closed, timeout 60 s      no answer in 5 s (curl gave up)
OpenFGA, closed, timeout 300 ms    403 in 0.33 s
OpenFGA, open,   timeout 300 ms    200 in 0.32 s
OPA,     closed, timeout 300 ms    403 in 0.32 s   (HttpClient.Timeout)
```

A hung PDP is worse than a dead one: without your own timeout (a `CancellationTokenSource` as in the handler, plus `HttpClient.Timeout` for OPA) requests pile up behind it. The cache is also an availability buffer: with a 30 s TTL, after warming document 30 and stopping the PDP, bob still got 200 for document 30 (cache hit) and 403 for document 31 (miss, closed). That is "serve stale on error", gained and paid for with the same TTL.

### Only in the docs (not run here)

OpenFGA **contextual tuples** (tuples sent with a single check, nothing written) and **conditions** (CEL attributes on tuples) cover ABAC-like rules in a relation model. OpenFGA authentication (preshared key, OIDC) was off in my container. OPA can be compiled to **WASM** and run in process, with no hop. Neither was measured; the numbers above are all out-of-process.

## Trade-offs

- **Built-in policy vs external PDP.** In-process is 0.15 ms and one deploy; external is 0.5 ms or more, a new dependency with its own availability, and in exchange one rule shared by many services, changeable without redeploying, auditable in one log. Start built-in; move out when the second service needs the same rule.
- **Handler vs filter.** The handler has the loaded resource and joins `IAuthorizationService`; the filter avoids the database read but sees only the route. With OPA the filter above denied a valid user. Relation engines tolerate the filter, attribute engines do not.
- **OpenFGA vs OPA.** OpenFGA owns the data (tuples) and is strong for sharing and hierarchies, with `ListObjects` for "what can I see"; you must write and delete tuples as the domain changes (the same call, in your code). OPA owns no data: attributes arrive in `input` or bundles, which suits rules over request context but pushes the information-point work to your app.
- **Cache TTL.** Longer is faster and more stale; the revoke test showed the whole TTL, in both directions. Short TTL for revocable rights, `HIGHER_CONSISTENCY` for the critical path, never cache what must be revoked instantly.
- **Fail-closed vs fail-open.** Closed is safe and turns a PDP outage into an app outage; open keeps the app and drops access control. A timeout plus closed plus an alert is the common choice; a stale-if-error cache softens it.
- **Lists.** Per-item checks are O(N) calls. `BatchCheck` (50 per call), `ListObjects` (cap 1000) or one OPA call with all resources each trade a limit for fewer calls.
- **Pre-1.0 SDK.** `OpenFga.Sdk` is 0.10.5: pin it, and test retry and timeout behavior yourself, as `RetryParams` showed.

## Documentation Links

- [Resource-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resourcebased) (doc)
- [Policy-based authorization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies) (doc)
- [Filters in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/min-api-filters) (doc)
- [OpenFGA .NET SDK, GitHub](https://github.com/openfga/dotnet-sdk) (doc)
- [Perform a check, OpenFGA](https://openfga.dev/docs/getting-started/perform-check) (doc)
- [Relationship queries: Check, BatchCheck, ListObjects, OpenFGA](https://openfga.dev/docs/interacting/relationship-queries) (doc)
- [Query consistency modes, OpenFGA](https://openfga.dev/docs/interacting/consistency) (doc)
- [Contextual tuples, OpenFGA](https://openfga.dev/docs/interacting/contextual-tuples) (doc)
- [Conditions, OpenFGA](https://openfga.dev/docs/modeling/conditions) (doc)
- [Configure OpenFGA, OpenFGA](https://openfga.dev/docs/getting-started/setup-openfga/configure-openfga) (doc)
- [OPA REST API, Open Policy Agent](https://www.openpolicyagent.org/docs/rest-api) (doc)
- [OPA bundles, Open Policy Agent](https://www.openpolicyagent.org/docs/management-bundles) (doc)
- [OPA decision logs, Open Policy Agent](https://www.openpolicyagent.org/docs/management-decision-logs) (doc)
- [OPA WebAssembly, Open Policy Agent](https://www.openpolicyagent.org/docs/wasm) (doc)
- [Zanzibar: Google's Consistent, Global Authorization System, Google Research](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/) (doc)
