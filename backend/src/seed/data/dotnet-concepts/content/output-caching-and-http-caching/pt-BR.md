---
version: 1.0
updatedAt: 2026-10-28
title: "Output caching e cache HTTP"
summary: Os três jeitos de fazer cache de respostas inteiras no ASP.NET Core medidos com contadores nos handlers: headers HTTP e ETag com 304, o middleware de Response Caching que o cliente desliga com um header, e o Output Caching com políticas, chaves, tags, resource locking, limites e o vazamento real causado pela ordem errada dos middlewares.
---
## Objective

Fazer cache de uma resposta HTTP inteira é a requisição mais barata que você vai servir, e o ASP.NET Core oferece três jeitos diferentes de fazer isso que são fáceis de confundir. Headers de cache HTTP (`Cache-Control`, `ETag`, `Vary`) são instruções que a aplicação escreve para outra pessoa: o navegador, uma CDN, um proxy. O middleware de Response Caching é um cache no servidor que obedece a esses mesmos headers, inclusive os que o cliente envia, então um cliente consegue desligá-lo. O middleware de Output Caching é um cache no servidor que o servidor controla: políticas, tags para invalidação e um lock que faz uma requisição fazer o trabalho enquanto as outras esperam. Este conceito roda os três contra servidores locais com um contador em cada handler, então cada afirmação vem com quantas vezes o handler rodou de verdade, qual status voltou e quantos bytes passaram pela rede. Ele também reproduz um vazamento real causado por colocar `UseOutputCache` antes da autenticação. É o par, no nível de resposta, da lição de cache de dados (`IMemoryCache`, `HybridCache`). Versões usadas: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0 (todo middleware está no shared framework, sem pacote), mais o runtime 10.0.14 no experimento de ordem dos middlewares.

## Use Cases

- Deixar navegadores e CDNs guardarem respostas estáticas ou que mudam pouco (um catálogo, uma tabela de preços pública) e revalidá-las com `ETag` em vez de baixá-las de novo.
- Servir um endpoint público caro a partir da memória do servidor por alguns segundos, para que um pico de tráfego bata no cache e não no banco.
- Remover do cache todas as páginas de um produto assim que um admin o edita, com uma tag.
- Proteger um endpoint frio de uma manada de requisições (thundering herd) logo depois de um deploy ou da expiração do cache.

## Deep Dive

### Headers de cache HTTP: instruções para outra pessoa

Headers não fazem nada no servidor. Eles dizem ao próximo cache da fila (navegador, CDN, proxy) o que ele pode fazer. Eu os defini com a API de headers tipados num endpoint minimal:

```csharp
app.MapGet("/headers", (HttpContext ctx) =>
{
    var h = ctx.Response.GetTypedHeaders();
    h.CacheControl = new() { Public = true, MaxAge = TimeSpan.FromSeconds(60) };
    h.LastModified = new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);
    ctx.Response.Headers.Vary = "Accept-Encoding";
    return "hello";
});
app.MapGet("/nostore", (HttpContext ctx) => { ctx.Response.Headers.CacheControl = "no-store"; return "secret"; });
```

```text
/headers: Cache-Control=public, max-age=60 | Vary=Accept-Encoding | Last-Modified=Thu, 01 Oct 2026 12:00:00 GMT
/nostore: Cache-Control=no-store
```

O que significam, segundo a RFC 9111: `public` permite que caches compartilhados (CDN, proxy) guardem a resposta e `private` restringe ao navegador do usuário; `max-age` é o tempo de validade em segundos; `no-store` significa que nenhum cache pode guardar parte alguma dela (use para dados pessoais ou sensíveis); `no-cache` não significa "não faça cache", significa "guarde, mas revalide antes de cada reuso". `Vary` faz o cache manter uma cópia por valor dos headers de requisição listados. `Expires` é a data absoluta do HTTP/1.0, e a RFC diz que um cache deve ignorá-lo quando `max-age` está presente, então código novo só precisa de `max-age`.

### [ResponseCache] escreve headers, mas só em MVC

O atributo `[ResponseCache]` é um atalho que escreve esses headers. Ele é um filtro do MVC, e confirmei que é ignorado em silêncio numa lambda de minimal API:

```text
[ResponseCache(Duration = 30)] on a minimal API lambda: Cache-Control=(none)
controller Duration=30:                                Cache-Control=public, max-age=30
controller Duration=30, Location=Client, VaryByHeader: Cache-Control=max-age=30, private  Vary=Accept-Language
controller NoStore=true, Location=None:                Cache-Control=no-store, no-cache  Pragma=no-cache
controller VaryByQueryKeys=["page"]:                   500 InvalidOperationException: 'VaryByQueryKeys' requires the response cache middleware.
```

`Location.Any` vira `public`, `Client` vira `private`, e `VaryByQueryKeys` não tem header HTTP nenhum: é uma instrução para o middleware de Response Caching, e sem ele a action lança exceção. Em minimal APIs, escreva os headers você mesmo, como acima.

### Requisições condicionais: ETag e 304 na mão

Um `ETag` é um rótulo de versão de uma representação. O cliente guarda e devolve como `If-None-Match`; se ainda bater, o servidor responde `304 Not Modified` sem corpo. Gerei um ETag a partir do hash de um payload de 50.000 bytes e implementei a checagem na mão:

```csharp
app.MapGet("/etag", (HttpContext ctx) =>
{
    ctx.Response.Headers.ETag = etag;
    ctx.Response.Headers.CacheControl = "no-cache"; // guarde, mas me pergunte toda vez
    if (ctx.Request.Headers.IfNoneMatch == etag) return Results.StatusCode(304);
    return Results.Text(payload);
});
```

```text
first request:              200 ETag="AB8F07056F06AF00" body=50000 bytes
If-None-Match=same ETag:    304 body=0 bytes
If-None-Match=other value:  200 body=50000 bytes
```

A ida e volta continua acontecendo, mas 50.000 bytes viraram 0. Repare que o handler rodou mesmo assim: revalidação economiza banda, não trabalho do servidor, a menos que calcular o ETag seja mais barato que a resposta (um row version, o timestamp de um arquivo).

### Middleware de Response Caching: quem manda é o cliente

`AddResponseCaching()` mais `UseResponseCaching()` adicionam um cache no servidor que aplica as regras de cache HTTP. Coloquei um contador num handler que devolve `Cache-Control: public,max-age=10` e um `ETag`, e enviei três requisições por cenário:

```text
public,max-age=10:                handler runs=1, Age=0 on the third
max-age=10 without public:        handler runs=3
public + Set-Cookie:              handler runs=3
public + request Authorization:   handler runs=3
public, status 404 / POST:        handler runs=3 / 3
If-None-Match matching the ETag:  304, body=0 bytes, no extra handler run
```

Tudo isso bate com as condições de cache da documentação: só `GET`/`HEAD` com 200, `public` obrigatório, sem header `Authorization`, sem `Set-Cookie`. O header `Age` é o sinal visível de um hit. A fraqueza está no lado da requisição. Com a entrada já no cache, enviei duas requisições com cada um de três headers diferentes:

```text
client sends Cache-Control: no-cache   -> handler runs went 1 -> 3
client sends Cache-Control: max-age=0  -> 3 -> 5
client sends Pragma: no-cache          -> 5 -> 7
plain GET                              -> 7 -> 7 (Age=0)
```

Todos passaram por cima do cache. A documentação diz que isso é proposital (a RFC 9111 exige respeitar as diretivas da requisição) e que não há controle do desenvolvedor sobre isso; ela acrescenta que Chrome e Edge enviam `max-age=0` na navegação normal, e é por isso que a visão geral diz que o Output Caching existe. Qualquer cliente que queira furar seu cache só precisa de um header.

### Response Caching ignora a query string

Mais um comportamento me surpreendeu. Três GETs no mesmo path com query strings diferentes:

```text
GET /rc/q?page=1: body="run 1"
GET /rc/q?page=2: body="run 1" Age=0
GET /rc/q?page=3: body="run 1" Age=0
```

A página 2 e a página 3 receberam a página 1. A query string não faz parte da chave; ela só conta quando você define `VaryByQueryKeys` (no `[ResponseCache]` ou via `IResponseCachingFeature`). Padrões lidos: `SizeLimit=104857600` (100 MB), `MaximumBodySize=67108864` (64 MB), `UseCaseSensitivePaths=False`.

### Output Caching: quem manda é o servidor

`AddOutputCache()` mais `UseOutputCache()` deixam o cache disponível; nada é guardado até que um endpoint opte com `.CacheOutput()` ou `[OutputCache]`, ou que uma política base se aplique:

```csharp
builder.Services.AddOutputCache();   // depois do build: app.UseOutputCache();
app.MapGet("/oc/default", () => Body("default")).CacheOutput();
app.MapGet("/oc/attr", [OutputCache(Duration = 5)] () => Body("attr"));
```

```text
3 GETs:                                        handler runs=1, Age=0, Cache-Control=(none)
then 2 GETs with Cache-Control: no-cache:      handler runs=1
then 2 GETs with Pragma: no-cache + max-age=0: handler runs=1
then 2 POSTs:                                  handler runs=3
then GET /OC/DEFAULT (upper case):             handler runs=3 (hit)
[OutputCache(Duration = 5)] on a lambda:       2 GETs, handler runs=1
endpoint with no CacheOutput:                  2 GETs, handler runs=2
```

Os headers que derrubaram o Response Caching não mudaram nada. Repare também em `Cache-Control=(none)`: o output caching não diz nada aos navegadores, então ele combina livremente com os headers HTTP acima. Diferente do `[ResponseCache]`, o atributo `[OutputCache]` funciona numa lambda de minimal API. Paths não diferenciam maiúsculas por padrão.

### O que a política padrão recusa

A documentação lista quatro regras padrão: só 200, só GET/HEAD, nada de respostas que definem cookies, nada de requisições autenticadas. Com dois GETs cada, uma requisição com header `Authorization`, um handler que define um cookie e um handler que devolve 404 rodaram duas vezes (o POST apareceu acima). Qualquer header `Authorization` desliga o cache, mesmo um que nenhum handler valida. Padrões lidos de `OutputCacheOptions`:

```text
SizeLimit=104857600, MaximumBodySize=67108864, DefaultExpirationTimeSpan=00:01:00, UseCaseSensitivePaths=False
default IOutputCacheStore: Microsoft.AspNetCore.OutputCaching.Memory.MemoryOutputCacheStore
```

A documentação diz que, quando `SizeLimit` é atingido, nenhuma resposta nova é guardada até que entradas antigas sejam removidas. Testei `MaximumBodySize`: com 1024, uma resposta de 512 bytes foi para o cache (1 execução em 2 GETs) e uma de 2048 bytes não (2 execuções).

### Políticas e chaves de cache

Políticas nomeadas são registradas uma vez e escolhidas pelo nome; uma política base vale para toda requisição:

```csharp
builder.Services.AddOutputCache(o =>
{
    o.AddPolicy("short", p => p.Expire(TimeSpan.FromSeconds(2)));
    o.AddPolicy("culture", p => p.SetVaryByQuery("culture"));
    o.AddPolicy("lang", p => p.SetVaryByHeader("Accept-Language"));
    o.AddPolicy("tenant", p => p.VaryByValue(ctx => new KeyValuePair<string, string>("tenant", ctx.Request.Headers["X-Tenant"].ToString())));
    o.AddPolicy("prefix", p => p.SetCacheKeyPrefix(ctx => "t-" + ctx.Request.Headers["X-Tenant"]));
});
```

```text
default policy, ?a=1, ?a=1, ?a=2, ?a=2&b=1:        handler runs=3
SetVaryByQuery("culture"): pt&x=1, pt&x=2, en&x=1: handler runs=2
SetVaryByHeader(Accept-Language): pt-BR, pt-BR, en: handler runs=2
VaryByValue(X-Tenant): a, a, b:                    handler runs=2
SetCacheKeyPrefix(t-{X-Tenant}): a, a, b:          handler runs=2
```

Por padrão toda chave da query diferencia a entrada (o oposto do Response Caching), então `SetVaryByQuery` é como você impede que parâmetros inúteis (`?utm_source=...`) multipliquem entradas. `SetVaryByRouteValue` faz o mesmo para valores de rota. Numa outra aplicação com `AddBasePolicy(p => p.Expire(TimeSpan.FromSeconds(10)))` e nenhum `CacheOutput`, um endpoint comum foi para o cache (1 execução em 2 GETs) e um marcado com `.CacheOutput(p => p.NoCache())` não (2 execuções): uma política base faz cache de tudo, a menos que você saia dela.

### Expiração, NoCache e remoção por tag

```csharp
app.MapGet("/oc/tagged", () => Body("tagged")).CacheOutput(p => p.Tag("products"));
app.MapPost("/purge/{tag}", async (string tag, IOutputCacheStore store, CancellationToken ct) =>
{ await store.EvictByTagAsync(tag, ct); return Results.NoContent(); });
```

```text
Expire(2s): GET, GET, wait 2.5 s, GET:                 handler runs=2
NoCache(): 3 GETs:                                     handler runs=3
Tag("products"): GET, GET, EvictByTagAsync, GET, GET:  handler runs=2
```

Depois da remoção, a requisição seguinte recalculou uma vez e voltou a ser hit. Tags são o motivo pelo qual o Output Caching pode ser invalidado sob demanda e o Response Caching não. Proteja qualquer endpoint de purge como uma operação de admin.

### Resource locking contra stampede

Dez GETs concorrentes numa chave fria, handler que leva 500 ms, com a política padrão e com `SetLocking(false)`:

```text
default (locking on): handler runs=1,  all 200=True, elapsed about 500 ms
SetLocking(false):    handler runs=10, all 200=True, elapsed about 500 ms
```

Com o lock, uma requisição preencheu a entrada e as outras nove esperaram e receberam o resultado em cache, como a documentação descreve. A latência foi a mesma; a diferença é que o banco teria visto 1 consulta em vez de 10.

### Revalidação de graça

O handler só definiu um `ETag`; o output caching respondeu `If-None-Match` com 304 e 0 bytes, e um `If-Modified-Since` posterior à entrada com 304, com uma única execução do handler no total. É o "cache revalidation is automatic" da documentação. A visão geral também diz que o Response Caching não revalida, mas no meu teste ele devolveu 304 para um `If-None-Match` que batia (acima), então no 10.0.0 essa frase não se sustenta.

### Armazenamento: um cache por instância

O store padrão fica em memória, então cada instância do servidor tem seu próprio cache, uma remoção alcança só aquela instância, e um restart esvazia tudo. A documentação oferece Redis via `Microsoft.AspNetCore.OutputCaching.StackExchangeRedis` (`AddStackExchangeRedisOutputCache`, não `AddStackExchangeRedisCache`) e desaconselha `IDistributedCache` como store, porque ele não tem as operações atômicas de que as tags precisam. Eu não tinha um servidor Redis disponível, então essa parte vem só da documentação.

### Ordem dos middlewares: um vazamento reproduzido

A documentação exige `UseOutputCache` depois de `UseCors`, depois de `UseRouting` quando você o chama, e depois de `UseAuthentication`/`UseAuthorization`, senão "output caching middleware can serve content cached for unauthorized users". Montei um endpoint com `.RequireAuthorization().CacheOutput()` e um handler de API key (header `X-Api-Key`, não `Authorization`), e chamei como alice e depois anonimamente:

```csharp
app.UseOutputCache();      // ERRADO: antes da autenticação
app.UseAuthentication();
app.UseAuthorization();
```

```text
runtime 10.0.0,  WRONG order: alice -> 200 "salary report for alice, run 1"; anonymous -> 200 "salary report for alice, run 1"
runtime 10.0.0,  RIGHT order: alice -> 200 "salary report for alice, run 1"; anonymous -> 401 ""
runtime 10.0.14, WRONG order: alice -> 200 "salary report for alice, run 1"; anonymous -> 401 ""
```

No 10.0.0 um chamador anônimo recebeu a resposta privada da alice. Quando o middleware de cache rodou, ninguém estava autenticado ainda, então a política padrão guardou a resposta; a requisição seguinte foi respondida do cache antes de a autorização sequer rodar. No 10.0.14 a mesma aplicação não vazou mais: o código-fonte de `DefaultPolicy` a partir da tag v10.0.10 se recusa a guardar uma resposta quando o usuário está autenticado no momento da resposta. Mantenha a ordem documentada mesmo assim e atualize o runtime: é a ordem que mantém seguras as políticas customizadas.

### Cache de resposta versus cache de dados

| | Cache do navegador/CDN | Response Caching | Output Caching | Cache de dados (`HybridCache`) |
|---|---|---|---|---|
| Guarda | resposta inteira | resposta inteira | resposta inteira | objetos que você escolhe |
| Controlado por | headers da resposta | headers da requisição e da resposta | políticas do servidor | seu código |
| Fica em | cliente ou borda | memória do servidor | memória do servidor ou Redis | memória, L2 opcional |
| Invalidado por | expiração do `max-age`, revalidação | só expiração | expiração, `EvictByTagAsync` | expiração, `RemoveAsync`, tags |
| Proteção contra stampede | não | não | sim, locking | sim, por instância |

O cache de resposta pula o pipeline inteiro (binding, handler, serialização); o cache de dados pula só a consulta cara dentro dele. Os dois se somam bem: cache de dados para objetos compartilhados, output cache para endpoints públicos quentes, headers para o navegador.

## Trade-offs

- **Output Caching é a escolha padrão para cache de resposta no servidor.** O servidor decide, clientes não conseguem furar, e ele tem tags e locking. Response Caching só serve para APIs GET públicas cujos clientes você confia que enviam headers sensatos.
- **A query string é uma decisão de chave.** Response Caching a ignora a menos que você diga (a página 2 recebeu a página 1); Output Caching varia por todas as chaves, então restrinja.
  ```csharp
  o.AddPolicy("catalog", p => p.SetVaryByQuery("page", "category"));
  ```
- **Nunca faça cache de saída personalizada sem variar pelo usuário.** A política padrão pula requisições autenticadas por um motivo; se você sobrescrevê-la, adicione `VaryByValue` por usuário ou tenant e mantenha `UseOutputCache` depois da autorização.
- **Cada instância tem seu próprio cache.** Remover uma tag em um pod deixa os outros desatualizados até expirar, a menos que o store seja compartilhado (Redis).
- **Headers HTTP sobrevivem ao seu deploy.** Um `max-age=86400` que já está num navegador não pode ser recolhido; use `max-age` curto mais `ETag`, ou URLs versionadas para assets estáticos.
- **Revalidação economiza bytes, não CPU.** Um 304 escrito na mão ainda roda o handler; faça o ETag ser barato de calcular.

## Documentation Links

- [Output caching middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output?view=aspnetcore-10.0) (doc)
- [Response caching in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/response?view=aspnetcore-10.0) (doc)
- [Response Caching Middleware in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/middleware?view=aspnetcore-10.0) (doc)
- [Overview of caching in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/overview?view=aspnetcore-10.0) (doc)
- [RFC 9111: HTTP Caching, IETF](https://www.rfc-editor.org/rfc/rfc9111.html) (doc)
