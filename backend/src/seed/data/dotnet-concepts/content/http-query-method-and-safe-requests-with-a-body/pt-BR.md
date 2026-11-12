---
version: 1.0
updatedAt: 2026-11-12
title: "Método HTTP QUERY: requisições seguras com corpo"
summary: O método QUERY (RFC 10008) como busca com corpo, segura e idempotente: como mapear com MapMethods e chamar com HttpMethod.Query no .NET 11, cache, CORS, OpenAPI 3.2 contra 3.1, e o que foi testado contra o que só a documentação afirma.
---
## Objective

Algumas buscas não cabem na URL: um filtro com dezenas de campos, uma lista de
ids, uma consulta estruturada em JSON. A saída de sempre é `POST /products/search`,
que funciona, mas diz a todo cliente, proxy e cache que a requisição pode alterar
estado, então nenhum deles pode repeti-la às cegas nem guardar a resposta. O
método HTTP `QUERY` (RFC 10008) foi escrito para esse caso: uma requisição com
corpo que é **segura e idempotente**. O objetivo é entender o que o padrão diz,
como mapear e chamar `QUERY` no ASP.NET Core 11 e no `HttpClient`, o que o
framework faz por você (e o que não faz: cache, CORS) e até onde dá para confiar
nele hoje, separando as verificações que eu rodei do que só a documentação afirma.

## Use Cases

- Um endpoint de busca cujo filtro é um documento JSON, grande ou estruturado
  demais para a query string, e que você quer manter repetível.
- Leituras entre serviços em que você controla o cliente, o servidor e os proxies
  do caminho, então adotar um método novo sai barato.
- Revisar uma API que já expõe `POST /search` e decidir se vale acrescentar
  `QUERY` ao lado.
- Explicar por que um navegador, uma CDN ou um gerador de código rejeita ou
  ignora uma operação que usa um método que ele não conhece.

## Deep Dive

### O que o padrão diz

A RFC 10008, "The HTTP QUERY Method", é um documento Standards Track (Proposed
Standard, publicado em junho de 2026, depois de anos como o draft
`safe-method-w-body`). Os pontos principais:

- `QUERY` é **seguro** (não altera o estado do servidor) e **idempotente**, e a
  consulta vai no conteúdo da requisição, como no `POST`, não na URI.
- O servidor deve falhar uma requisição com `Content-Type` ausente ou
  inconsistente (`400`, ou `415` para um tipo que não suporta) e não deve
  adivinhar o conteúdo. Conteúdo válido que não dá para processar é `422`. Um
  `Accept` inaceitável é `406`.
- As respostas são **cacheáveis**, e a chave de cache precisa incluir o conteúdo
  da requisição.
- Um `2xx` pode trazer `Content-Location` (onde um `GET` busca esses resultados)
  ou `Location` (um recurso equivalente em que um `GET` repete a consulta).
- O cabeçalho de resposta `Accept-Query` lista os tipos de mídia que o recurso
  aceita em `QUERY`, e é assim que o cliente descobre o suporte.
- CORS: `QUERY` não é um método seguro para CORS (não está na lista de métodos
  "safelisted"), então o navegador sempre envia um preflight.

### Por que GET com corpo não resolve

A semântica HTTP (RFC 9110) não dá significado a conteúdo em um `GET`, e algumas
implementações o rejeitam ou o descartam. O padrão Fetch usado pelos navegadores
lança `TypeError` se você passa corpo a um `GET` (vem da especificação, não é algo
que eu rodei). Proxies e caches usam só a URL como chave de um `GET`, então dois
`GET` com corpos diferentes poderiam receber a mesma resposta em cache. O `QUERY`
resolve os dois lados: o corpo faz parte do significado do método e da chave de
cache.

| Opção | Corpo | Seguro/idempotente | Chave de cache | Funciona em todo lugar hoje |
|---|---|---|---|---|
| `GET /products?category=Books` | não | sim | URL | sim |
| `GET` com corpo | indefinido | sim | só a URL | não |
| `POST /products/search` | sim | não | não é cacheado por padrão | sim |
| `QUERY /products` | sim | sim | URL mais corpo | não (veja a última seção) |

### Mapeando QUERY em uma minimal API

Não existe `MapQuery` no .NET 11. Listei as extensões `Map*` do endpoint builder
no SDK 11.0.100: `MapGet`, `MapPost`, `MapPut`, `MapDelete`, `MapPatch`,
`MapMethods`, `Map`, `MapGroup` e `MapFallback`. O `MapMethods` recebe os nomes
dos métodos, e `HttpMethods.Query` (uma constante string com o valor `QUERY`) e
`HttpMethods.IsQuery(...)` existem em `Microsoft.AspNetCore.Http`.

```csharp
app.MapMethods("/products", [HttpMethods.Query],
    ([FromBody] ProductFilter filter, Catalog catalog, HttpResponse response) =>
    {
        response.Headers["Accept-Query"] = "application/json";
        return catalog.Search(filter);
    });
```

O binding de parâmetros trata o corpo de um `QUERY` como o de um `POST`, e os casos
de erro da RFC saem certos sem código: `Content-Type` que não é JSON deu `415`,
corpo ausente deu `400` e JSON malformado deu `400`. Um `GET` em uma rota que só
mapeia `QUERY` respondeu `405` com `Allow: QUERY`, então o cliente descobre o
método pelo erro. Dá para mapear `GET` e `QUERY` no mesmo caminho: são endpoints
separados.

### Chamando com HttpClient

`HttpMethod.Query` existe no .NET 11. Antes dele era preciso escrever
`new HttpMethod("QUERY")`, que continua funcionando em runtimes mais antigos.

```csharp
using var request = new HttpRequestMessage(HttpMethod.Query, "/products")
{
    Content = JsonContent.Create(filter),
};
using var response = await http.SendAsync(request);
```

Não há `HttpClient.QueryAsync` nem `QueryAsJsonAsync`, então você passa pelo
`SendAsync`, como em qualquer método sem atalho.

Os redirecionamentos mostram a semântica nova. Chamei um servidor que redirecionava
com cada código e comparei `POST` e `QUERY` no `HttpClient` padrão:

```text
POST  301 -> GET   (corpo descartado)   QUERY 301 -> QUERY  (corpo reenviado)
POST  302 -> GET   (corpo descartado)   QUERY 302 -> QUERY  (corpo reenviado)
POST  303 -> GET                        QUERY 303 -> GET
POST  307 -> POST  (corpo reenviado)    QUERY 307 -> QUERY  (corpo reenviado)
POST  308 -> POST  (corpo reenviado)    QUERY 308 -> QUERY  (corpo reenviado)
```

Isso bate com a RFC: a regra antiga que transforma `POST` em `GET` depois de `301`
e `302` não vale para `QUERY`, e o `303` é a forma de o servidor dizer "busque o
resultado com um `GET` no `Location`".

### Seguro e idempotente: o que isso compra

Nada no ASP.NET Core verifica se um handler `QUERY` realmente só lê. A garantia é
uma promessa que o seu código faz, e os clientes agem em cima dela. Um caso
concreto é o retry. Com `Microsoft.Extensions.Http.Resilience` (10.11.0, rodando em
`net11.0`) e `DisableForUnsafeHttpMethods()` nas opções de retry, um servidor que
sempre respondia `503` foi chamado este número de vezes (uma tentativa mais duas
repetições):

```text
GET    attempts=3
PUT    attempts=1
POST   attempts=1
QUERY  attempts=3
```

O `QUERY` foi repetido como o `GET`, que é o objetivo do método, e é a razão de um
handler `QUERY` nunca poder escrever. Compare com as chaves de idempotência que
você acrescenta ao `POST` no concept de semântica REST: o `QUERY` não precisa
delas.

### Cache

A RFC torna as respostas de `QUERY` cacheáveis com o corpo na chave. O output
caching do ASP.NET Core não faz isso por padrão. Com `.CacheOutput()` em um
endpoint `QUERY`, três requisições idênticas executaram o handler três vezes (um
contador no handler foi 1, 2, 3): a política padrão só guarda `GET` e `HEAD`.

Uma `IOutputCachePolicy` própria pode aderir, e ela precisa pôr o corpo na chave.
Eu calculei o hash do corpo, rebobinei o stream para o binding continuar
funcionando e variei a chave pelo hash:

```csharp
public async ValueTask CacheRequestAsync(OutputCacheContext context, CancellationToken ct)
{
    var request = context.HttpContext.Request;
    if (!HttpMethods.IsQuery(request.Method)) return;

    request.EnableBuffering();
    var hash = Convert.ToHexString(await SHA256.HashDataAsync(request.Body, ct));
    request.Body.Position = 0;

    context.CacheVaryByRules.VaryByValues["body"] = hash;
    context.EnableOutputCaching = true;
    context.AllowCacheLookup = true;
    context.AllowCacheStorage = true;
}
```

Com ela, o mesmo corpo foi servido do cache (cabeçalho `Age` presente, handler
executado uma vez) e um corpo diferente executou o handler de novo. Sem o hash na
chave, dois filtros diferentes dividiriam a mesma entrada, que é o bug contra o
qual a RFC avisa. Guardar em buffer e calcular o hash de todo corpo tem custo,
então limite o tamanho da requisição. Os caches de navegador e de CDN seguem regras
próprias; não testei nenhum.

### CORS

Como o `QUERY` não é "safelisted", toda chamada cross-origin de um navegador
começa com um preflight `OPTIONS`, mesmo com corpo pequeno. A política precisa
listar o método e o cabeçalho `Content-Type`:

```csharp
builder.Services.AddCors(o => o.AddPolicy("spa", p => p
    .WithOrigins("https://app.test")
    .WithMethods("GET", "QUERY")
    .WithHeaders("Content-Type")));
```

Com `Access-Control-Request-Method: QUERY` e a origem certa, a resposta foi `204`
com `Access-Control-Allow-Methods` contendo `QUERY`. Uma política que só permitia
`GET` respondeu ao mesmo preflight com `Allow-Methods: GET`, que o navegador lê
como recusa. (Conferi os cabeçalhos com `curl` e em testes, não em um navegador
de verdade.)

### OpenAPI 3.2 contra 3.1

O OpenAPI 3.1 não tem lugar para `QUERY` em um path item: ele conhece `get`,
`put`, `post`, `delete`, `options`, `head`, `patch` e `trace`. O OpenAPI 3.2
acrescentou a chave `query`. O .NET 11 escreve `3.2.0` por padrão, e um endpoint
mapeado com `QUERY` aparece como `"query"` ali, enquanto fixar `OpenApi3_1` o move
para `x-oai-additionalOperations`. O concept de OpenAPI mostra os dois documentos,
então não repito aqui. A regra prática é a daquele concept: o gerador foi para o
3.2, os seus consumidores talvez não.

### Onde o suporte ainda é fraco

O que eu rodei, no SDK 11.0.100: o mapeamento, os status codes, o cabeçalho
`Allow`, o output caching, o preflight de CORS, os redirecionamentos do
`HttpClient` e o handler de retry, tudo no lab com `WebApplicationFactory` e
`HttpClient` contra o Kestrel.

O que eu não rodei, e que portanto depende da documentação ou do resultado de
outra pessoa: proxies reversos (nginx, HAProxy, Envoy), CDNs e API gateways,
firewalls de aplicação (WAF), navegadores chamando `QUERY` por `fetch`, e
ferramentas de log ou tracing que assumem uma lista curta de verbos. Um proxy que
só encaminha métodos conhecidos, um WAF que bloqueia os desconhecidos ou uma CDN
que não faz cache do método quebram a história. Confira cada salto que você
controla.

Um resultado de ferramenta que posso citar vem da auditoria do release candidate
do .NET 11 (não reexecutada no GA): o gerador de clientes Kiota, versão 1.38.0,
falhou em um documento OpenAPI 3.2 com uma operação `QUERY` (`Requested value
'QUERY' was not found`), e gerou normalmente a mesma API em 3.1 e 3.0. Não testei
o Scalar nem outros geradores com 3.2.

## Trade-offs

- **Padrão, mas jovem.** A RFC 10008 é recente, e o ecossistema (proxies,
  gateways, geradores, ferramentas de teste) ainda está alcançando. Em uma API
  pública atrás de CDN, `POST /search` continua funcionando em todo lugar. Um
  caminho do meio é oferecer os dois e deixar os clientes que podem usar `QUERY`
  usá-lo.
  ```text
  QUERY /products           mesmo corpo de filtro, cacheável e repetível
  POST  /products/search    mesmo corpo de filtro, passa por qualquer proxy
  ```
- **Filtro curto pertence à URL.** Se o filtro cabe na query string, o `GET` ainda
  é melhor: dá para guardar nos favoritos, aparece nos logs e é cacheado por tudo.
  O `QUERY` compensa quando o filtro é grande ou estruturado.
- **Sem cache embutido.** Você ganha um método cacheável, mas, no ASP.NET Core,
  uma política escrita à mão. Uma chave que esquece o corpo devolve respostas
  erradas, e calcular o hash dos corpos custa memória e CPU.
- **Sempre com preflight.** Toda chamada cross-origin de navegador ao `QUERY` custa
  uma ida e volta a mais, a menos que você faça cache do preflight com
  `SetPreflightMaxAge`.
- **Segurança é uma promessa.** Nada impede um handler de escrever. Uma camada de
  retry que confia no `QUERY` vai repetir essa escrita.
- **O corpo aparece em lugares diferentes da URL.** A RFC observa que as URIs têm
  mais chance de ser registradas por intermediários do que o conteúdo. Isso é bom
  para segredos em um filtro e ruim para depuração: os logs de acesso não mostram
  o filtro a menos que você o registre por conta própria.

## Lab

Neste lab você recebe uma API pequena de catálogo que já busca com `POST /products/search`, e acrescenta a versão `QUERY` dela. A ideia central é ver que o método é cidadão de primeira classe no ASP.NET Core 11 e no `HttpClient` sem nenhum atalho, e cobrir as partes que não são automáticas: descoberta, CORS e cache. O lab usa `net11.0`, então precisa do SDK 11 do .NET.

**O cenário**

Os testes usam `WebApplicationFactory<Program>` e `HttpClient` com `HttpMethod.Query`.

- `Catalog.cs`: cinco produtos, `Search(filter)` e um contador de quantas vezes uma busca realmente rodou.
- `Program.cs`: `GET /products`, o antigo `POST /products/search` e comentários TODO onde entra o código novo.
- `ProductsClient.cs`: um cliente tipado com um `SearchAsync` para implementar.
- `QueryCachePolicy.cs`: a política de output cache que deixa o `QUERY` entrar e varia pelo hash do corpo (já escrita).

**O que você vai fazer, passo a passo**

1. **Mapear o QUERY (TODO-00).** Use `MapMethods("/products", [HttpMethods.Query], ...)` com um `ProductFilter` lido do corpo, e confira que um corpo de texto dá `415` e um corpo vazio dá `400`.
2. **Anunciar (TODO-01).** Envie `Accept-Query: application/json` no `GET /products` e na resposta do `QUERY`.
3. **Abrir o CORS (TODO-02).** Registre a política `spa` com `GET` e `QUERY` e o cabeçalho `Content-Type`, para o preflight passar.
4. **Chamar (TODO-03).** Implemente `ProductsClient.SearchAsync` com `HttpMethod.Query` e `JsonContent`.

**Como você sabe que terminou**

`dotnet test` fica todo verde. Você deve conseguir dizer por que `GET` com corpo não é opção, o que um proxy pode fazer com um método seguro e idempotente que não pode fazer com `POST`, e por que o preflight é inevitável.

**Desafios opcionais**

- **TODO-04:** registre a `QueryCachePolicy` fornecida, adicione `UseOutputCache()` e `.CacheOutput("query")`. O último teste confere que o mesmo corpo executa o filtro uma vez. Depois tente `.CacheOutput()` sem a política e veja o padrão recusar o `QUERY`.

**Pré-requisitos:** minimal APIs, `WebApplicationFactory`, a ideia de métodos seguros e idempotentes, e o SDK 11 do .NET.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. O starter compila e todos os testes falham até você fazer os TODOs em `Program.cs` e `ProductsClient.cs`.

## Documentation Links

- [The HTTP QUERY Method, RFC 10008](https://www.rfc-editor.org/info/rfc10008) (doc)
- [What's new in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11?view=aspnetcore-11.0) (doc)
- [Minimal APIs, route handlers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/route-handlers) (doc)
- [Output caching middleware, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/output) (doc)
- [Enable CORS in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/cors) (doc)
- [HTTP semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) (doc)
- [OpenAPI Specification 3.2.0](https://spec.openapis.org/oas/v3.2.0.html) (doc)
