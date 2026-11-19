---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Inside your MCP server's code, who is calling and what can you do about it? The C# SDK answers with
request filters (one family per MCP method, wrapped like middleware), a `ClaimsPrincipal` copied from
`HttpContext.User` into every handler, and `[Authorize]` attributes honored once you call
`AddAuthorizationFilters()`. Measured on localhost with no model: filter order, three ways to read the
caller, stateless against stateful sessions, a scoped tenant service, what the client sees when a tool,
a filter or an attribute says no, and a step-up requested from inside a filter.
Versions: `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15 (IdentityModel 8.19.2), TFM `net10.0`,
SDK 10.0.100, spec revision 2026-07-28.

## Use Cases

- Auditing which user called which tool, denied calls included.
- Letting each user see and call only the tools their scopes or roles allow.
- Scoping data by tenant from the token, and keeping internals out of error messages.

## Deep Dive

### The lab

One ASP.NET Core project is server and client. Tokens are minted in-process (claims `sub`, `scope` as a
space-separated string, `roles`, `tid`): the OAuth flow is the previous lesson's subject. Environment
variables pick a variant (`SESSION`, `AUTHZ`, `AUD`, `SWAP`, `STD`) and `/_log` returns what the filters
recorded. `JwtBearer`: `MapInboundClaims = false`, `RoleClaimType = "roles"`, `ValidAudience` = the MCP URL.

### Request filters: the first registered is the outermost

`WithRequestFilters` has one method per MCP operation (`AddListToolsFilter`, `AddCallToolFilter`,
`AddGetPromptFilter`, ...); `WithMessageFilters` (`AddIncomingFilter`, `AddOutgoingFilter`) sees every
JSON-RPC message. A filter maps a handler to a handler:

```csharp
static McpRequestFilter<P, R> Audit<P, R>(string method) => next => async (ctx, ct) =>
{
    var sub = ctx.User?.FindFirst("sub")?.Value ?? "anonymous";
    try { var res = await next(ctx, ct); Log($"audit {method} {Name(ctx.Params)} sub={sub} ok"); return res; }
    catch (Exception e) { Log($"audit {method} {Name(ctx.Params)} sub={sub} {e.GetType().Name}: {e.Message}"); throw; }
};
builder.Services.AddMcpServer().WithHttpTransport().WithTools<LabTools>()
    .WithRequestFilters(f => { f.AddCallToolFilter(Audit<CallToolRequestParams, CallToolResult>("tools/call")); f.AddCallToolFilter(Trace("outer")); })
    .AddAuthorizationFilters()
    .WithRequestFilters(f => f.AddCallToolFilter(Trace("inner")));   // Trace logs "outer>" before next and "outer<" after
```

Alice lists tools, calls a tool and reads a resource. Server log (prompts log the same way):

```text
audit tools/list  sub=alice ok
outer>
inner>
tool whoami_param
inner<
outer<
audit tools/call whoami_param sub=alice ok
audit resources/read doc://public sub=alice ok
```

`audit` was registered first, so it finishes last; the order holds across several `WithRequestFilters`
calls, and the authorization filters sit where `AddAuthorizationFilters()` is called.

### Who is calling, and for which tenant

```csharp
[McpServerToolType]
public class LabTools(IHttpContextAccessor acc)   // builder.Services.AddHttpContextAccessor();
{
    [McpServerTool(Name = "whoami_param")]    public string WhoParam(ClaimsPrincipal? user) => Who(user);
    [McpServerTool(Name = "whoami_context")]  public string WhoContext(RequestContext<CallToolRequestParams> ctx) => Who(ctx.User);
    [McpServerTool(Name = "whoami_accessor")] public string WhoAccessor() =>
        $"{Who(acc.HttpContext?.User)} X-Trace={acc.HttpContext?.Request.Headers["X-Trace"]} reqId={acc.HttpContext?.TraceIdentifier}";
    [McpServerTool(Name = "tenant")] public string TenantTool(ITenant t) => $"tenant={t.Id} scope={t.ScopeId.ToString("N")[..6]}";
}   // AddScoped<ITenant>(sp => new Tenant(accessor.HttpContext?.User.FindFirst("tid")?.Value ?? "none"))
```

```text
whoami_param (and whoami_context, same line):  sub=alice scope=invoices:read roles=[] isAdmin=False
whoami_accessor: sub=alice scope=invoices:read roles=[] isAdmin=False X-Trace=abc reqId=0HNQ5QLGGKOFG:00000004
tenant (alice tid=t1) x2: tenant=t1 scope=dd514d | tenant=t1 scope=e578d5
tenant after switching to bob (tid=t2): tenant=t2 scope=9cb7aa
```

The `ClaimsPrincipal` parameter and the `ITenant` service stay out of the schema (`tools/list` printed
`"properties":{}` for `whoami_param`). `IHttpContextAccessor` adds headers but works only over HTTP; the
SDK copies `HttpContext.User` into the JSON-RPC message, so the principal route is transport-agnostic (on
stdio it is `null` unless a message filter sets it, docs only). The scoped tenant is new per request, so
a service built from the token cannot leak across users.

### Stateless and stateful: is it the current request?

Stateless is the default and builds a fresh context per request. `Stateful` is the back-compat mode (the
SDK calls it an escape hatch for 2025-11-25 clients), so I swapped the token between calls of one session:

```text
2 whoami_param (same sub, new token with admin): sub=alice scope=invoices:read invoices:write roles=[admin] isAdmin=True
2 admin_reset: IsError=null "reset done"
3 whoami_param (other sub, same session): HttpRequestException: ... 403 (Forbidden). Response body: {"error":{"code":-32000,"message":"Forbidden: The currently authenticated user does not match the user who initiated the session."},...
```

Over Streamable HTTP both routes saw the new token on the next request (the accessor printed
`X-Trace=second` and a new `reqId`, and `[Authorize(Roles = "admin")]` passed). The session pins the user by `sub`: another
`sub` gets 403 and `-32000`. The docs' stale-claims warning concerns the legacy SSE transport (docs only).

### Authorization by attribute

```csharp
[McpServerTool(Name = "read_invoices"), Authorize(Policy = "invoices:read")]   public string ReadInvoices() ...
[McpServerTool(Name = "delete_invoice"), Authorize(Policy = "invoices:write")] public string DeleteInvoice(int id) ...
[McpServerTool(Name = "admin_reset"), Authorize(Roles = "admin")]              public string AdminReset() ...
[McpServerTool(Name = "public_ping"), AllowAnonymous]                          public string PublicPing() => "pong";
```

The policies assert that the `scope` claim contains `invoices:read` or `invoices:write`. With
`AddAuthorizationFilters()` the SDK honors `[Authorize]` (policy, roles) and `[AllowAnonymous]` on tools,
prompts and resources, on a method or a class: listings are filtered per caller, direct calls refused.
`MapMcp` left anonymous; alice has `invoices:read`, carol `admin` and both scopes:

```text
== alice   tools: whoami_*,tenant,read_invoices,public_ping,export_report,boom,leaky,bad_input   prompts: public_prompt
read_invoices: IsError=null "3 invoices"
delete_invoice: McpProtocolException (-32600): Request failed (remote): Access forbidden: This tool requires authorization.
== carol   all 12 tools, prompts public_prompt,admin_prompt   admin_reset: IsError=null "reset done"
```

A denial is a JSON-RPC `-32600`, not `IsError`, and does not name the policy; a tool hidden from the list is
refused by name too (`prompts/get` and `resources/read` behave the same). Two traps. With
`MapInboundClaims = false` the claim is `roles`, but `IsInRole` reads the identity's `RoleClaimType`,
which defaults to `ClaimTypes.Role`: with that default carol's `roles:["admin"]` token lost `admin_reset`,
`admin_prompt` and `admin_doc`, hidden and refused. And an `[Authorize]` tool without `AddAuthorizationFilters()` fails closed:

```text
tools/list: McpProtocolException (-32603): Request failed (remote): An error occurred.
admin_reset: IsError=True "An error occurred invoking 'admin_reset'."
server log: InvalidOperationException: Authorization filter was not invoked for tools/list operation, but authorization metadata was found on the tools. Ensure that AddAuthorizationFilters() is called ...
```

### Denied tool calls never reach ordinary call-tool filters

The docs say filters registered before `AddAuthorizationFilters()` still see unauthorized requests. In
2.4.0 that holds for lists, `prompts/get` and `resources/read`, but not for `tools/call`: tool
authorization is inserted at position 0 of the alternate-result pipeline (`CallToolWithAlternateFilters`,
experimental `MCPEXP002`), outside every `AddCallToolFilter`. Alice's denied `delete_invoice` left no
`outer>` and no `audit` line. An `AddIncomingFilter` (before routing) checking `ctx.JsonRpcMessage is
JsonRpcRequest { Method: "tools/call" }` and logging `ctx.User` did see it: `incoming tools/call
delete_invoice sub=alice`.

### A filter that decides: what the client sees

`export_report` has no attribute; a filter checks the `reports:export` scope. The same refusal, written
four ways, called by alice:

| the filter | what `CallToolAsync` gives the client |
| --- | --- |
| returns `new CallToolResult { IsError = true, ... }` | `IsError=True "scope reports:export required"` |
| throws `McpException(msg)` | `IsError=True "An error occurred invoking 'export_report': scope reports:export required"` |
| throws `McpProtocolException(msg, McpErrorCode.InvalidRequest)` | JSON-RPC `-32600`, the call throws |
| throws any other exception | `IsError=True "An error occurred invoking 'export_report'."` |

Only `McpProtocolException` becomes a JSON-RPC error; any other exception, in a filter as in a tool,
becomes an `IsError` result. Use the first two rows for a refusal the model can act on, the third for a
caller that should not be here.

### Asking for more scope from inside a filter

The spec answers "this token lacks a scope" with HTTP 403 and `WWW-Authenticate: Bearer
error="insufficient_scope", scope="...", resource_metadata="..."`, and the client reruns authorization with
the union of scopes. The SDK has no helper, but a filter can set both through the accessor:

```csharp
var h = ctx.Services!.GetRequiredService<IHttpContextAccessor>().HttpContext!; h.Response.StatusCode = 403;
h.Response.Headers.WWWAuthenticate = $"Bearer error=\"insufficient_scope\", scope=\"reports:export\", resource_metadata=\"{prm}\"";
throw new McpException("scope reports:export required");
```

With the previous lesson's test authorization server (copied, `ValidResources` changed) as the `JwtBearer`
`Authority` and the SDK client with `OAuth` options (the first request got a 401 and each `/authorize` is
followed by `POST /token`, left out):

```text
--> GET https://localhost:6141/authorize scope=invoices:read invoices:write -> 302
--> POST http://127.0.0.1:6140/mcp [Mcp-Name: export_report] [bearer] -> 403 WWW-Authenticate: Bearer error="insufficient_scope", scope="reports:export", resource_metadata="..."
--> GET https://localhost:6141/authorize scope=invoices:read invoices:write reports:export -> 302
--> POST http://127.0.0.1:6140/mcp [Mcp-Name: export_report] [bearer] -> 200
export_report: IsError=null "report.csv"
```

The client unioned the new scope with the old, got a new token and retried the same call (the first 401
had no `scope`, so it used `scopes_supported`). A 403 set after the response began, for example after
progress notifications, was not tried (docs only).

### Reauthorization when a filter changes the tool

The 2.0.0 item "Reauthorize tools changed by call-tool filters" (#1737) is not OAuth step-up: authorization
evaluates `context.MatchedPrimitive`, and a filter may replace it. A filter after
`AddAuthorizationFilters()` swaps `public_ping` (anonymous) for `admin_reset`; alice calls `public_ping`:

```text
SWAP=on:             alice calls public_ping: IsError=null "reset done"     (log: tool admin_reset RAN)
SWAP=on, REAUTH=on:  alice calls public_ping: McpProtocolException (-32600): ... Access forbidden: This tool requires authorization.
```

`REAUTH=on` calls `AddAuthorizationFilters()` again after the swap, as its XML doc advises: each call adds
a checkpoint for the current `MatchedPrimitive` and `User`.

### One filter that standardizes exceptions

A plain exception already reaches the client as generic text, but an `McpException` message always does.
`leaky` wraps an inner message in `McpException`; `bad_input` throws `UserFacingException : McpException`.
A filter registered first lets only the second family through (`McpProtocolException` is rethrown):

```csharp
catch (UserFacingException e) { return new() { IsError = true, Content = [new TextContentBlock { Text = e.Message }] }; }
catch (Exception e) { var id = Guid.NewGuid().ToString("N")[..8]; Log($"std ref={id} {e}"); return new() { IsError = true, Content = [new TextContentBlock { Text = $"Internal error, reference {id}" }] }; }
```

```text
without: leaky     IsError=True "An error occurred invoking 'leaky': lookup failed: Server=db1;Password=hunter2"
with:    leaky     IsError=True "Internal error, reference d9616be8"
         bad_input IsError=True "quantity must be positive"
```

The password leaked until the filter stopped it; the server log keeps the reference and the real message.

### Filters do not replace audience validation

A token minted for another API (`aud=http://other-api.example/`) with the right scopes calls
`delete_invoice`:

```text
AUD=on  (ValidAudience = this server):  HttpRequestException: ... 401 (Unauthorized).
AUD=off (ValidateAudience = false):     IsError=null "deleted 7"
```

`[Authorize(Policy = "invoices:write")]` reads the claims it is given, and a token issued to someone else
satisfied it; the 401 came only from `JwtBearer` checking `aud`. Issuer, audience and signature belong to
the authentication pipeline; filters and attributes decide what an already valid caller may do.

## Trade-offs

- **Attributes vs a custom filter.** `[Authorize]` gives filtered listings and a uniform `-32600`; a filter
  can return a refusal the model reads or ask for step-up, but every tool needs its own check.
- **`ClaimsPrincipal` vs `IHttpContextAccessor`.** The parameter is transport-agnostic and easy to fake in
  a test; the accessor reaches headers but makes the tool HTTP-only.
- **Auditing denials.** Ordinary call-tool filters miss them in 2.4.0; a message filter sees every
  request but not its outcome.

## Documentation Links

- [Filters, MCP C# SDK 2.4.0 docs, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/filters.md) (doc)
- [Identity and Role Propagation, MCP C# SDK 2.4.0 docs, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/identity/identity.md) (doc)
- [HTTP Context, MCP C# SDK 2.4.0 docs, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/httpcontext/httpcontext.md) (doc)
- [MCP C# SDK v2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [Reauthorize tools changed by call-tool filters, pull request 1737, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/pull/1737) (doc)
- [Authorization, MCP specification 2026-07-28, scope challenge handling](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) (doc)
- [Access HttpContext in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-context) (doc)
