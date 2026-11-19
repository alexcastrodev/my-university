---
version: 1.0
updatedAt: 2026-11-19
title: "Autorização Externa com OpenFGA ou OPA no ASP.NET Core"
summary: "Um PDP externo (OpenFGA e OPA reais em Docker) chamado por um handler baseado em recurso e por um endpoint filter no ASP.NET Core, medido em .NET 10, com o SDK OpenFga.Sdk 0.10.5: latência por chamada (0,45 ms contra 0,15 ms do handler embutido), o problema N+1 em listas (Check item a item, BatchCheck de 50, ListObjects que corta em 1000), cache de decisão e decisão velha após revogar (5 s de TTL, nos dois sentidos), bundles e decision logs do OPA, e o que acontece quando o PDP cai ou trava (fail-open contra fail-closed, retries do SDK, timeout)."
---
## Objective

Políticas e requirements decidem dentro do seu processo. Quando as regras precisam ser compartilhadas entre serviços, mudar sem deploy ou seguir um grafo de relações ("editor da pasta que contém o documento"), a decisão vai para um Policy Decision Point (PDP) e o ASP.NET Core fica só com o Policy Enforcement Point (PEP): um handler ou um endpoint filter que pergunta e obedece. Esta lição liga os dois PDPs mais comuns a uma minimal API em .NET 10, OpenFGA (relações, estilo Zanzibar) e OPA (Rego sobre JSON), e mede o que a escolha custa: latência por chamada, a armadilha do N+1 em listas, a decisão velha no cache depois de uma revogação, e o que acontece com a requisição quando o PDP está fora do ar. Para os modelos e os motores em abstrato (RBAC, ABAC, ReBAC, Cedar), veja a lição neutra [Modelos de Autorização: RBAC, ABAC, ReBAC e Policy Engines](/identity-concepts/authorization-models-rbac-abac-rebac-and-policy-engines); esta é a integração em .NET e seus modos de falha.
Versions: `OpenFga.Sdk` 0.10.5 (NuGet, pré-1.0, então a API ainda pode mudar), `openfga/openfga:v1.22.1` (memory store, autenticação desligada), `openpolicyagent/opa:1.22.4` (Rego v1), CLI `openfga/cli:v0.9.0` só para converter o DSL em JSON, `nginx:alpine` como servidor de bundles, `net10.0`, SDK 10.0.100, runtime 10.0.0 em macOS arm64, Docker Desktop em loopback.

## Use Cases

- Compartilhar: vários serviços e uma UI precisam concordar em "quem pode editar este documento", então a regra mora num lugar só, fora de todos eles.
- Mudar uma regra sem redeployar a API (um bundle do OPA, uma escrita de modelo no OpenFGA).
- Filtrar uma página de lista para o que o chamador pode ver, em vez de autorizar linha por linha.
- Decidir quanta permissão velha e quanta indisponibilidade o produto tolera quando o serviço de autorização é uma dependência.

## Deep Dive

### O que muda em relação à autorização embutida

[Fundamentos de Autenticação e Autorização](authentication-and-authorization-fundamentals) cobre schemes, policies, requirements e o handler baseado em recurso. Nada dessa mecânica muda: `IAuthorizationService.AuthorizeAsync(user, resource, requirement)` continua executando seu `AuthorizationHandler<TRequirement, TResource>`. O que muda é o corpo do handler: uma comparação em processo vira uma chamada de rede. Mesmo endpoint, mesmo chamador (`bob`, documento 30), 1000 requisições pelo Kestrel em loopback depois de 100 de aquecimento:

```text
                                         p50      p95
sem autorização (baseline)               0.14 ms  0.18 ms
handler embutido (dono ou departamento)  0.15 ms  0.17 ms
handler -> OPA  /v1/data/docs/allow      0.55 ms  0.69 ms
handler -> OpenFGA Check                 0.67 ms  0.84 ms
```

Algo como 0,4 a 0,5 ms por decisão aqui. É um notebook, sem TLS, sem rede de verdade e com um grafo minúsculo, então leia a razão (3 a 5 vezes o handler embutido), não os milissegundos. Toda decisão que você toma por requisição é multiplicada por isso, e por isso o resto da lição é sobre contar chamadas.

### O app do experimento

Uma minimal API, uma interface `IPdp` com implementação para OpenFGA e para OPA escolhida por variável de ambiente, um scheme descartável por header `X-User` (nunca publique isso) e um "banco" em memória com 1000 documentos. Os dados: alice é dona dos documentos 1 a 20, o time `eng` (alice e bob) pode ver 21 a 80, dave não tem nada. O modelo do OpenFGA (convertido para JSON com a CLI `fga` e carregado com `WriteAuthorizationModel`):

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

A política do OPA recebe usuário, ação e atributos do recurso em `input`; o app faz o papel de ponto de informação e carrega o documento antes:

```rego
package docs
import rego.v1
default allow := false
allow if can(input.user, input.action, input.resource)
allowed_ids contains r.id if { some r in input.resources; can(input.user, input.action, r) }   # uma chamada, N perguntas
can(user, _, _) if user.role == "admin"
can(user, _, r) if r.owner == user.name
can(user, "read", r) if r.department == user.department
```

Um motor de relações só precisa de ids (`user:bob`, `viewer`, `document:30`); um motor de atributos precisa dos atributos, então precisa do recurso carregado. Isso decide qual ponto de enforcement serve, abaixo.

### Ponto de enforcement 1: um handler baseado em recurso

O requirement carrega a relação, o handler pergunta ao PDP e chama `Succeed` ou fica quieto. Não chamar `Succeed` é o padrão seguro: o requirement falha e `Results.Forbid()` responde 403.

```csharp
public record DocumentAccess(string Relation) : IAuthorizationRequirement;

public sealed class DocumentHandler(IPdp pdp, PdpOptions opt, ILogger<DocumentHandler> log)
    : AuthorizationHandler<DocumentAccess, Document>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext ctx, DocumentAccess req, Document doc)
    {
        try
        {
            using var cts = new CancellationTokenSource(opt.TimeoutMs);   // nunca espere um PDP para sempre
            if (await pdp.CheckAsync(ctx.User.Identity!.Name!, req.Relation, doc, cts.Token)) ctx.Succeed(req);
        }
        catch (Exception e) when (opt.FailMode != "throw")
        {
            log.LogWarning("PDP unavailable ({Type}), failing {Mode}", e.GetType().Name, opt.FailMode);
            if (opt.FailMode == "open") ctx.Succeed(req);   // senão, sem Succeed: 403
        }
    }
}
// endpoint: var r = await authz.AuthorizeAsync(user, doc, new DocumentAccess("viewer"));
//           return r.Succeeded ? Results.Ok(doc) : Results.Forbid();
```

O lado OpenFGA de `IPdp.CheckAsync` é uma chamada do SDK: `fga.Check(new ClientCheckRequest { User = "user:bob", Relation = "viewer", Object = "document:30" }, null, ct)`, que devolve `Allowed`. Registrar o handler como `IAuthorizationHandler` é toda a ligação que o ASP.NET Core precisa.

### Ponto de enforcement 2: um endpoint filter

Quando o id da rota basta, o filter pergunta antes de o endpoint rodar e antes de qualquer leitura no banco, então uma requisição proibida custa uma chamada ao PDP e nenhuma query:

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

Contra o OpenFGA devolveu 200 para o bob e a mesma latência do handler (0,67 ms p50). Contra o OPA o mesmo filter devolveu **403 para o bob num documento que ele pode ler**: o filter passou `"?"` como dono e departamento, e a regra Rego compara atributos. Sem erro, sem log, só uma negação errada. Regra prática desta execução: o filter serve para motores de relações; com um motor de atributos use o handler, que recebe o recurso carregado. Um filter também não consegue autorizar um recurso que o próprio endpoint cria, e é um segundo lugar onde a autorização mora, então limite-o à checagem e deixe o resto para o `RequireAuthorization`.

### O SDK do OpenFGA em .NET

`OpenFga.Sdk` 0.10.5 (esse é exatamente o id do pacote, vindo do repositório `openfga/dotnet-sdk`; pacotes da comunidade no NuGet como `Fga.Net.DependencyInjection` e `Fga.Net.AspNetCore` miram DI e ASP.NET Core, não usados aqui). O `OpenFgaClient` recebe `ApiUrl`, `StoreId` e, opcionalmente, `AuthorizationModelId` (a doc diz que o modelo mais recente é usado quando omitido; eu defini). As chamadas usadas:

```csharp
await fga.Check(new ClientCheckRequest { User = "user:bob", Relation = "viewer", Object = "document:30" });  // bool? Allowed
await fga.ListObjects(new ClientListObjectsRequest { User = "user:alice", Relation = "viewer", Type = "document" }); // Objects
await fga.BatchCheck(new ClientBatchCheckRequest { Checks = [new ClientBatchCheckItem { User = .., Relation = .., Object = .., CorrelationId = "30" }, ..] });
await fga.WriteTuples([new ClientTupleKey { User = "team:eng#member", Relation = "viewer", Object = "document:30" }]);
await fga.DeleteTuples([new ClientTupleKeyWithoutCondition { .. }]);
```

Fatos que o servidor impôs aqui: uma escrita aceita no máximo 100 tuplas (`MaxTuplesPerWrite`), o `BatchCheck` no máximo 50 checagens, e escrever uma tupla que já existe é erro (`FgaApiValidationError: cannot write a tuple which already exists`), então uma rotina de seed precisa ser idempotente. O `ClientBatchCheck` (fan-out de vários `Check` no cliente, diferente do `BatchCheck` do servidor acima) existe no SDK mas não foi executado (só documentação).

Uma armadilha na 0.10.5: `ClientConfiguration.RetryParams = new RetryParams { MaxRetry = 0 }` (documentado como retentativas após rate limit) **não mudou nada** para erros de conexão, enquanto definir `MaxRetry` e `MinWaitInMs` direto no `ClientConfiguration` mudou; os padrões são 3 e 100 ms. O custo aparece na seção do PDP fora do ar.

### OPA a partir do .NET: HTTP puro

Não há SDK a adotar. `POST /v1/data/docs/allow` com `{"input": ...}` devolve `{"decision_id": "...", "result": true}`:

```csharp
using var resp = await http.PostAsync("v1/data/docs/allow", new StringContent(body, Encoding.UTF8, "application/json"), ct);
resp.EnsureSuccessStatusCode();
using var json = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
return json.RootElement.TryGetProperty("result", out var r) && r.GetBoolean();   // sem "result" é indefinido: negue
```

Comportamentos medidos que moldam essa última linha: uma consulta a um caminho que não existe (`/v1/data/docs/missing`) responde 200 só com um `decision_id` e sem `result`; um corpo JSON inválido responde 400; uma requisição sem `input` responde `"result": false` mais um `api_usage_warning`. Um cliente que lê `GetProperty("result")` lançaria exceção no primeiro caso, e um handler que captura toda exceção e faz fail-open transformaria então um erro de digitação no caminho da política em "libera todo mundo".

**Bundles** substituem o redeploy da política. O OPA consulta um servidor de bundles (aqui o nginx servindo o `docs.tar.gz` gerado com `opa build`), com `polling: { min_delay_seconds: 1, max_delay_seconds: 2 }`. Removi a regra de departamento, refiz o bundle e consultei a decisão: a leitura do documento 30 pelo bob mudou de `true` para `false` **0,97 s** depois de o novo arquivo ser publicado, e o log disse `Bundle loaded and activated successfully. Etag updated`. A defasagem de uma mudança de política é o intervalo de polling, que você define.

**Decision logs** (`decision_logs.console: true`; em produção um coletor ou `service`) dão uma linha JSON por decisão, o bastante para auditar quem foi liberado em quê:

```text
{"decision_id": "fb61df6e-...", "path": "docs/allow", "result": false, "bundles": {"docs": {}},
 "input": {"action": "read", "resource": {"department": "eng", "id": 30, "owner": "nobody"}, "user": {"department": "eng", "name": "bob", "role": "user"}}}
```

A entrada `bundles` veio vazia porque meu bundle não tinha `.manifest` com revisão; adicione um se quiser saber qual versão da política decidiu.

### Latência por chamada

1000 chamadas depois de 100 de aquecimento (300 para `ListObjects` e `BatchCheck`), loopback com keep-alive, de um console .NET, sem ASP.NET Core no caminho:

```text
OpenFGA SDK Check (allow)     p50 0.45 ms  p95 0.56 ms
OpenFGA SDK Check (deny)      p50 0.45 ms  p95 0.56 ms
OpenFGA ListObjects (80 hits) p50 0.53 ms  p95 0.85 ms
OpenFGA BatchCheck x50        p50 1.60 ms  p95 2.86 ms
OPA /v1/data/docs/allow       p50 0.27 ms  p95 0.32 ms
```

Tudo abaixo de um milissegundo porque o grafo tem 82 tuplas e o memory store não tem disco. O custo do OpenFGA cresce com a profundidade e a ramificação das relações (os padrões do servidor limitam profundidade e largura da resolução), o do OPA com a política e os dados; um store em banco e uma rede de verdade somam aos dois. Trate isto como o piso.

### O problema N+1 de autorização

Uma página de lista sobre 1000 documentos candidatos, alice vê 80. Quatro estratégias sobre os mesmos dados, p50 de 20 requisições (3 de aquecimento) para a requisição HTTP inteira, n = candidatos:

```text
OpenFGA                      n=10      n=100     n=1000
one Check per item           5.53 ms   45.73 ms  394.44 ms   (1000 chamadas ao PDP)
16 in parallel               1.13 ms    7.65 ms   64.55 ms   (1000 chamadas ao PDP)
BatchCheck, 50 per call      0.92 ms    3.74 ms   33.99 ms   (20 chamadas ao PDP)
ListObjects, then intersect  0.85 ms    0.77 ms    0.84 ms   (1 chamada ao PDP)

OPA                          n=10      n=100     n=1000
one request per item         3.85 ms   31.63 ms  278.58 ms
16 in parallel               1.13 ms    6.99 ms   65.82 ms
one input with all resources 0.50 ms    1.07 ms    5.69 ms   (1 chamada ao PDP, "allowed_ids")
```

Checagens sequenciais são o problema N+1: 0,4 ms vezes 1000 é a requisição inteira. Paralelismo esconde a latência, não a carga: 1000 chamadas ainda chegam ao PDP a cada visualização de página. As correções de verdade reduzem o número de chamadas. O `BatchCheck` é limitado a 50 por chamada pelo servidor, então 1000 itens pedem 20 chamadas. O `ListObjects` fica plano em 0,8 ms porque responde "tudo que a alice alcança" e ignora sua lista de candidatos; o app faz a interseção. Suas ressalvas, medidas: para um usuário com 1200 documentos visíveis ele devolveu **1000** objetos, em silêncio (`listObjectsMaxResults` padrão 1000, `listObjectsDeadline` padrão 3 s, segundo a doc do OpenFGA), então é errado como filtro para quem alcança mais que o teto, a menos que você suba o limite ou pagine do seu lado. E ele enumera todo o alcance do usuário: 1,58 ms de p50 com 1200 resultados contra 0,53 ms com 80. Empurrar o filtro para a query de dados (o PDP devolve ids ou uma condição residual, o banco faz o `WHERE`) é a forma que escala; a avaliação parcial do OPA é o recurso do motor para isso (veja a lição neutra, não repetido aqui).

### Cache de decisão e o risco de decisão velha

O remédio usual para o custo por chamada é um `IMemoryCache` em volta do PDP: chave `(user, relation, document)`, valor o booleano, TTL de alguns segundos. Custo poupado: um hit é uma busca em dicionário. Custo pago: o PDP deixa de ser a verdade. Com TTL de 5 s, o bob lê o documento 30 pelo time, e então a tupla `team:eng#member viewer document:30` é apagada em t = 0 e o endpoint é consultado a cada 100 ms:

```text
app cache 5 s, revoke:                  t=0.02 s status 200 (stale)   t=5.03 s status 403
app cache 5 s, grant after cached deny: t=0.02 s status 403 (stale)   t=5.05 s status 200
no app cache, OpenFGA --check-query-cache-enabled (5 s): 200 until t=5.06 s, then 403
same server, client sends HIGHER_CONSISTENCY:            403 at t=0.02 s
no cache anywhere:                                       403 at t=0.02 s
```

Uma revogação só vale quando todo cache no caminho expirou, e o cache guarda negações também, então uma concessão nova também espera. A primeira requisição encheu o cache logo antes da revogação, então estes são os piores casos; a média é metade do TTL. Aqui há dois caches independentes: o seu, e o query cache do próprio OpenFGA, **desligado por padrão** na v1.22.1 e ligado com `--check-query-cache-enabled` (TTL padrão de 10 s; o help diz que ele torna `Check` e `ListObjects` eventualmente consistentes). O `Consistency = HIGHER_CONSISTENCY` por requisição nas opções de check do SDK ignora o cache do servidor, ao custo de latência, então use-o no caminho sensível (depois de uma mudança de permissão, antes de uma ação destrutiva) e o cache no resto. Que os dois somem seus TTLs não foi medido. Revogação que precisa ser imediata (um funcionário desligado, um token vazado) não pertence atrás de um TTL: use TTL 0 para essa relação ou invalide por push. O `--cache-controller-enabled` (invalida com base em escritas recentes) existe no help do servidor; não executado (só documentação).

### Quando o PDP cai: fail-open ou fail-closed

Mesma requisição (bob, documento 30), com o container do PDP parado, então a conexão é recusada:

```text
OpenFGA, closed, SDK default retries (MaxRetry 3)     403 in 1.02 s
OpenFGA, closed, MaxRetry = 0                         403 in 0.009 s
OpenFGA, closed, MaxRetry = 3, timeout 300 ms         403 in 0.49 s
OpenFGA, open,   MaxRetry = 0                         200 in 0.007 s
OpenFGA, handler lets the exception escape            500 in 0.010 s
OPA, closed                                           403 in 0.009 s
OPA, open                                             200 in 0.008 s
```

O fail-open também deixou o dave ler o documento 500, que ninguém compartilhou com ele: durante a queda a autorização não existiu. Fail-closed é o padrão para uma decisão de segurança; fail-open só se defende onde o recurso vale pouco e a queda é rara, e exige alerta. Uma exceção que escapa do handler não é nenhum dos dois: é um 500, que ainda parece bug do servidor para clientes e monitoramento. Decida o modo no código, como acima.

A configuração de retry do SDK pesa mais quando o PDP está travado ou fora. Por chamada que falha num container parado: `MaxRetry` 0 levou 35 ms, 1 levou cerca de 160 ms, 3 (o padrão) 0,8 a 1,0 s, 6 levou 10,5 s (backoff exponencial), enquanto um `HttpClient` puro falhou em 1 ms. Tentar uma chamada de autorização 6 vezes segura a requisição do usuário por 10 s. Agora `docker pause` em vez de parar, então a conexão é aceita e ninguém responde:

```text
OpenFGA, closed, timeout 60 s      no answer in 5 s (curl gave up)
OpenFGA, closed, timeout 300 ms    403 in 0.33 s
OpenFGA, open,   timeout 300 ms    200 in 0.32 s
OPA,     closed, timeout 300 ms    403 in 0.32 s   (HttpClient.Timeout)
```

Um PDP travado é pior que um morto: sem seu próprio timeout (um `CancellationTokenSource` como no handler, mais `HttpClient.Timeout` para o OPA) as requisições se acumulam atrás dele. O cache também é um amortecedor de disponibilidade: com TTL de 30 s, depois de aquecer o documento 30 e parar o PDP, o bob ainda recebeu 200 no documento 30 (hit) e 403 no 31 (miss, closed). É "servir velho em caso de erro", ganho e pago com o mesmo TTL.

### Só na documentação (não executado aqui)

As **contextual tuples** do OpenFGA (tuplas enviadas com uma única checagem, nada gravado) e as **conditions** (atributos CEL nas tuplas) cobrem regras de tipo ABAC num modelo de relações. A autenticação do OpenFGA (preshared key, OIDC) estava desligada no meu container. O OPA pode ser compilado para **WASM** e rodar em processo, sem salto de rede. Nada disso foi medido; todos os números acima são fora de processo.

## Trade-offs

- **Política embutida vs PDP externo.** Em processo são 0,15 ms e um deploy; externo são 0,5 ms ou mais, uma dependência nova com disponibilidade própria, e em troca uma regra compartilhada por vários serviços, alterável sem redeploy, auditável num log só. Comece embutido; saia quando o segundo serviço precisar da mesma regra.
- **Handler vs filter.** O handler tem o recurso carregado e entra no `IAuthorizationService`; o filter evita a leitura no banco mas só enxerga a rota. Com o OPA, o filter acima negou um usuário válido. Motores de relações toleram o filter, motores de atributos não.
- **OpenFGA vs OPA.** O OpenFGA é dono dos dados (tuplas) e é forte em compartilhamento e hierarquias, com o `ListObjects` para "o que posso ver"; você precisa escrever e apagar tuplas conforme o domínio muda (a mesma operação, no seu código). O OPA não é dono de dado nenhum: os atributos chegam em `input` ou em bundles, o que serve a regras sobre o contexto da requisição mas empurra o trabalho de ponto de informação para o seu app.
- **TTL do cache.** Maior é mais rápido e mais velho; o teste de revogação mostrou o TTL inteiro, nos dois sentidos. TTL curto para direitos revogáveis, `HIGHER_CONSISTENCY` no caminho crítico, e nunca cache o que precisa ser revogado na hora.
- **Fail-closed vs fail-open.** Closed é seguro e transforma uma queda do PDP numa queda do app; open mantém o app e abandona o controle de acesso. Um timeout mais closed mais um alerta é a escolha comum; um cache servindo velho em caso de erro suaviza.
- **Listas.** Checagens por item são O(N) chamadas. `BatchCheck` (50 por chamada), `ListObjects` (teto de 1000) ou uma chamada ao OPA com todos os recursos trocam, cada um, um limite por menos chamadas.
- **SDK pré-1.0.** O `OpenFga.Sdk` está na 0.10.5: fixe a versão e teste você mesmo o comportamento de retry e timeout, como o `RetryParams` mostrou.

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
