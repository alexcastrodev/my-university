---
version: 1.0
updatedAt: 2026-11-19
title: "Filtros do Servidor MCP, HttpContext e Identidade do Chamador"
summary: Como o código de um servidor MCP feito com o SDK C# 2.4.0 e ASP.NET Core enxerga quem chama e intercepta as chamadas, medido sem LLM: filtros de request e sua ordem, ClaimsPrincipal, RequestContext e IHttpContextAccessor, sessões stateless contra stateful, um serviço scoped de tenant, atributos [Authorize] via AddAuthorizationFilters (o que tools/list e tools/call devolvem), chamadas negadas que pulam os filtros de call-tool, filtros que recusam de quatro jeitos, um step-up com 403 insufficient_scope disparado de dentro de um filtro, reautorização quando um filtro troca a tool, um filtro que padroniza exceções e por que a validação de audience fica na autenticação.
---
## Objective

Dentro do código do seu servidor MCP, quem está chamando e o que dá para fazer a respeito? O SDK C# responde com
filtros de request (uma família por método MCP, encadeados como middleware), um `ClaimsPrincipal` copiado de
`HttpContext.User` para todo handler e atributos `[Authorize]` respeitados depois de `AddAuthorizationFilters()`.
Medido em localhost, sem modelo: a ordem dos filtros, três jeitos de ler o chamador, stateless contra stateful, um
serviço scoped de tenant, o que o cliente vê quando uma tool, um filtro ou um atributo diz não, e um step-up pedido de
dentro de um filtro.
Versões: `ModelContextProtocol` e `ModelContextProtocol.AspNetCore` 2.4.0,
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15 (IdentityModel 8.19.2), TFM `net10.0`, SDK 10.0.100, revisão
da spec 2026-07-28.

## Use Cases

- Auditar qual usuário chamou qual tool, inclusive as chamadas negadas.
- Deixar cada usuário ver e chamar só as tools que seus escopos ou roles permitem.
- Restringir dados por tenant a partir do token, e manter detalhes internos fora das mensagens de erro.

## Deep Dive

### O laboratório

Um projeto ASP.NET Core é servidor e cliente. Os tokens são gerados no próprio processo (claims `sub`, `scope` como
string separada por espaços, `roles`, `tid`): o fluxo OAuth é assunto da lição anterior. Variáveis de ambiente
escolhem a variante (`SESSION`, `AUTHZ`, `AUD`, `SWAP`, `STD`) e `/_log` devolve o que os filtros registraram.
`JwtBearer`: `MapInboundClaims = false`, `RoleClaimType = "roles"`, `ValidAudience` = a URL do MCP.

### Filtros de request: o primeiro registrado é o mais externo

`WithRequestFilters` tem um método por operação MCP (`AddListToolsFilter`, `AddCallToolFilter`, `AddGetPromptFilter`,
...); `WithMessageFilters` (`AddIncomingFilter`, `AddOutgoingFilter`) vê toda mensagem JSON-RPC. Um filtro mapeia um
handler em outro handler:

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
    .WithRequestFilters(f => f.AddCallToolFilter(Trace("inner")));   // Trace loga "outer>" antes de next e "outer<" depois
```

Alice lista as tools, chama uma tool e lê um resource. Log do servidor (prompts logam do mesmo jeito):

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

O `audit` foi registrado primeiro, então termina por último; a ordem vale entre várias chamadas de
`WithRequestFilters`, e os filtros de autorização ficam onde `AddAuthorizationFilters()` é chamado.

### Quem está chamando, e de qual tenant

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

O parâmetro `ClaimsPrincipal` e o serviço `ITenant` ficam fora do schema (`tools/list` mostrou `"properties":{}` para
`whoami_param`). `IHttpContextAccessor` traz os headers mas só funciona em HTTP; o SDK copia `HttpContext.User` para a
mensagem JSON-RPC, então o caminho do principal vale para qualquer transporte (em stdio ele é `null`, a menos que um
message filter o preencha, só documentação). O tenant scoped é novo a cada request, então um serviço montado a partir
do token não vaza entre usuários.

### Stateless e stateful: é o request atual?

Stateless é o padrão e monta um contexto novo por request. `Stateful` é o modo de retrocompatibilidade (o SDK o chama
de escape hatch para clientes de 2025-11-25), então troquei o token entre chamadas de uma sessão:

```text
2 whoami_param (same sub, new token with admin): sub=alice scope=invoices:read invoices:write roles=[admin] isAdmin=True
2 admin_reset: IsError=null "reset done"
3 whoami_param (other sub, same session): HttpRequestException: ... 403 (Forbidden). Response body: {"error":{"code":-32000,"message":"Forbidden: The currently authenticated user does not match the user who initiated the session."},...
```

Em Streamable HTTP os dois caminhos viram o token novo no request seguinte (o accessor imprimiu `X-Trace=second` e um
`reqId` novo, e `[Authorize(Roles = "admin")]` passou). A sessão fixa o usuário pelo `sub`: outro `sub` recebe 403 e
`-32000`. O aviso da doc sobre claims velhas vale para o transporte SSE legado (só documentação).

### Autorização por atributo

```csharp
[McpServerTool(Name = "read_invoices"), Authorize(Policy = "invoices:read")]   public string ReadInvoices() ...
[McpServerTool(Name = "delete_invoice"), Authorize(Policy = "invoices:write")] public string DeleteInvoice(int id) ...
[McpServerTool(Name = "admin_reset"), Authorize(Roles = "admin")]              public string AdminReset() ...
[McpServerTool(Name = "public_ping"), AllowAnonymous]                          public string PublicPing() => "pong";
```

As policies afirmam que a claim `scope` contém `invoices:read` ou `invoices:write`. Com `AddAuthorizationFilters()` o
SDK respeita `[Authorize]` (policy, roles) e `[AllowAnonymous]` em tools, prompts e resources, no método ou na classe:
as listagens são filtradas por chamador e as chamadas diretas são recusadas. `MapMcp` ficou anônimo; alice tem
`invoices:read`, carol tem `admin` e os dois escopos:

```text
== alice   tools: whoami_*,tenant,read_invoices,public_ping,export_report,boom,leaky,bad_input   prompts: public_prompt
read_invoices: IsError=null "3 invoices"
delete_invoice: McpProtocolException (-32600): Request failed (remote): Access forbidden: This tool requires authorization.
== carol   all 12 tools, prompts public_prompt,admin_prompt   admin_reset: IsError=null "reset done"
```

A negação é um erro JSON-RPC `-32600`, não `IsError`, e não cita a policy; uma tool escondida da listagem é recusada
pelo nome também (`prompts/get` e `resources/read` se comportam igual). Duas armadilhas. Com `MapInboundClaims =
false` a claim se chama `roles`, mas `IsInRole` lê o `RoleClaimType` da identidade, que por padrão é
`ClaimTypes.Role`: com esse padrão o token de carol com `roles:["admin"]` perdeu `admin_reset`, `admin_prompt` e
`admin_doc`, escondidos e recusados. E uma tool com `[Authorize]` sem `AddAuthorizationFilters()` falha fechada:

```text
tools/list: McpProtocolException (-32603): Request failed (remote): An error occurred.
admin_reset: IsError=True "An error occurred invoking 'admin_reset'."
server log: InvalidOperationException: Authorization filter was not invoked for tools/list operation, but authorization metadata was found on the tools. Ensure that AddAuthorizationFilters() is called ...
```

### Chamadas de tool negadas não chegam aos filtros comuns de call-tool

A doc diz que filtros registrados antes de `AddAuthorizationFilters()` ainda veem requests não autorizados. Na 2.4.0
isso vale para listagens, `prompts/get` e `resources/read`, mas não para `tools/call`: a autorização de tools é
inserida na posição 0 do pipeline de resultado alternativo (`CallToolWithAlternateFilters`, experimental `MCPEXP002`),
fora de todo `AddCallToolFilter`. O `delete_invoice` negado de alice não deixou `outer>` nem linha de `audit`. Um
`AddIncomingFilter` (antes do roteamento) que testa `ctx.JsonRpcMessage is JsonRpcRequest { Method: "tools/call" }` e
loga `ctx.User` viu a chamada: `incoming tools/call delete_invoice sub=alice`.

### Um filtro que decide: o que o cliente vê

`export_report` não tem atributo; um filtro confere o escopo `reports:export`. A mesma recusa, escrita de quatro
jeitos, chamada por alice:

| o filtro | o que `CallToolAsync` entrega ao cliente |
| --- | --- |
| devolve `new CallToolResult { IsError = true, ... }` | `IsError=True "scope reports:export required"` |
| lança `McpException(msg)` | `IsError=True "An error occurred invoking 'export_report': scope reports:export required"` |
| lança `McpProtocolException(msg, McpErrorCode.InvalidRequest)` | erro JSON-RPC `-32600`, a chamada lança exceção |
| lança qualquer outra exceção | `IsError=True "An error occurred invoking 'export_report'."` |

Só `McpProtocolException` vira erro JSON-RPC; qualquer outra exceção, num filtro ou numa tool, vira um resultado
`IsError`. Use as duas primeiras linhas para uma recusa que o modelo consegue tratar, e a terceira para um chamador
que não deveria estar ali.

### Pedindo mais escopo de dentro de um filtro

A spec responde "este token não tem um escopo" com HTTP 403 e `WWW-Authenticate: Bearer error="insufficient_scope",
scope="...", resource_metadata="..."`, e o cliente refaz a autorização com a união dos escopos. O SDK não tem helper
para isso, mas um filtro pode definir os dois pelo accessor:

```csharp
var h = ctx.Services!.GetRequiredService<IHttpContextAccessor>().HttpContext!; h.Response.StatusCode = 403;
h.Response.Headers.WWWAuthenticate = $"Bearer error=\"insufficient_scope\", scope=\"reports:export\", resource_metadata=\"{prm}\"";
throw new McpException("scope reports:export required");
```

Com o authorization server de teste da lição anterior (copiado, `ValidResources` trocado) como `Authority` do
`JwtBearer` e o cliente do SDK com `OAuth` (o primeiro request levou 401 e cada `/authorize` é seguido de `POST
/token`, omitido):

```text
--> GET https://localhost:6141/authorize scope=invoices:read invoices:write -> 302
--> POST http://127.0.0.1:6140/mcp [Mcp-Name: export_report] [bearer] -> 403 WWW-Authenticate: Bearer error="insufficient_scope", scope="reports:export", resource_metadata="..."
--> GET https://localhost:6141/authorize scope=invoices:read invoices:write reports:export -> 302
--> POST http://127.0.0.1:6140/mcp [Mcp-Name: export_report] [bearer] -> 200
export_report: IsError=null "report.csv"
```

O cliente uniu o escopo novo aos antigos, pegou outro token e repetiu a mesma chamada (o primeiro 401 não trazia
`scope`, então ele usou `scopes_supported`). Um 403 definido depois que a resposta já começou, por exemplo depois de
notificações de progresso, não foi testado (só documentação).

### Reautorização quando um filtro troca a tool

O item do 2.0.0 "Reauthorize tools changed by call-tool filters" (#1737) não é step-up de OAuth: a autorização avalia
`context.MatchedPrimitive`, e um filtro pode substituí-lo. Um filtro depois de `AddAuthorizationFilters()` troca
`public_ping` (anônima) por `admin_reset`; alice chama `public_ping`:

```text
SWAP=on:             alice calls public_ping: IsError=null "reset done"     (log: tool admin_reset RAN)
SWAP=on, REAUTH=on:  alice calls public_ping: McpProtocolException (-32600): ... Access forbidden: This tool requires authorization.
```

`REAUTH=on` chama `AddAuthorizationFilters()` de novo depois da troca, como o XML doc recomenda: cada chamada adiciona
um checkpoint para o `MatchedPrimitive` e o `User` correntes.

### Um filtro que padroniza exceções

Uma exceção comum já chega ao cliente como texto genérico, mas a mensagem de uma `McpException` sempre chega. `leaky`
embrulha uma mensagem interna numa `McpException`; `bad_input` lança `UserFacingException : McpException`. Um filtro
registrado primeiro deixa passar só a segunda família (`McpProtocolException` é relançada):

```csharp
catch (UserFacingException e) { return new() { IsError = true, Content = [new TextContentBlock { Text = e.Message }] }; }
catch (Exception e) { var id = Guid.NewGuid().ToString("N")[..8]; Log($"std ref={id} {e}"); return new() { IsError = true, Content = [new TextContentBlock { Text = $"Internal error, reference {id}" }] }; }
```

```text
without: leaky     IsError=True "An error occurred invoking 'leaky': lookup failed: Server=db1;Password=hunter2"
with:    leaky     IsError=True "Internal error, reference d9616be8"
         bad_input IsError=True "quantity must be positive"
```

A senha vazava até o filtro barrá-la; o log do servidor guarda a referência e a mensagem real.

### Filtros não substituem a validação de audience

Um token gerado para outra API (`aud=http://other-api.example/`) com os escopos certos chama `delete_invoice`:

```text
AUD=on  (ValidAudience = this server):  HttpRequestException: ... 401 (Unauthorized).
AUD=off (ValidateAudience = false):     IsError=null "deleted 7"
```

`[Authorize(Policy = "invoices:write")]` lê as claims que recebe, e um token emitido para outro destinatário a
satisfez; o 401 só veio do `JwtBearer` conferindo `aud`. Issuer, audience e assinatura pertencem ao pipeline de
autenticação; filtros e atributos decidem o que um chamador já válido pode fazer.

## Trade-offs

- **Atributos vs filtro próprio.** `[Authorize]` dá listagens filtradas e um `-32600` uniforme; um filtro
  pode devolver uma recusa que o modelo lê ou pedir step-up, mas cada tool precisa da sua checagem.
- **`ClaimsPrincipal` vs `IHttpContextAccessor`.** O parâmetro vale para qualquer transporte e é fácil de
  simular num teste; o accessor alcança os headers mas deixa a tool só HTTP.
- **Auditar negações.** Os filtros comuns de call-tool não as veem na 2.4.0; um message filter vê todo
  request, mas não o resultado.

## Documentation Links

- [Filters, MCP C# SDK 2.4.0 docs, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/filters.md) (doc)
- [Identity and Role Propagation, MCP C# SDK 2.4.0 docs, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/identity/identity.md) (doc)
- [HTTP Context, MCP C# SDK 2.4.0 docs, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/v2.4.0/docs/concepts/httpcontext/httpcontext.md) (doc)
- [MCP C# SDK v2.0.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.0.0) (doc)
- [Reauthorize tools changed by call-tool filters, pull request 1737, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/pull/1737) (doc)
- [Authorization, MCP specification 2026-07-28, scope challenge handling](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) (doc)
- [Access HttpContext in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-context) (doc)
