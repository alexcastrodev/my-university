---
version: 1.0
updatedAt: 2026-10-28
title: "Versionamento de APIs com Asp.Versioning"
summary: Versionamento de APIs no ASP.NET Core 10 com os pacotes Asp.Versioning: qual pacote serve para Minimal APIs, controllers e OpenAPI, os leitores por query string, header, segmento de URL e media type com os códigos de status e corpos de problem details que cada um devolveu, versão padrão, endpoints neutros, cabeçalhos de deprecation e sunset, documentos OpenAPI por versão e uma comparação de estratégias baseada nas medições.
---
## Objective

Uma API HTTP é um contrato com clientes que você não publica: assim que um app mobile ou uma integração de parceiro lê `total` como número, transformá-lo em objeto quebra esses clientes no dia do deploy. Versionar permite que o contrato antigo e o novo convivam enquanto os clientes migram. O ASP.NET Core não traz versionamento pronto; a biblioteca de fato é a ASP.NET API Versioning (os pacotes `Asp.Versioning.*`), um projeto da .NET Foundation que não faz parte do framework; a documentação dela fica no próprio repositório do GitHub e no site do projeto, não na documentação do ASP.NET Core. Este conceito roda a biblioteca no .NET 10 com Minimal APIs e controllers, envia a versão pela query string, por um header, pelo caminho da URL e pelo media type, e mostra os códigos de status, cabeçalhos e corpos de problem details exatos que voltaram, incluindo os cabeçalhos de deprecation e sunset e o que cada configuração de OpenAPI realmente gera por versão. Versões usadas: SDK 10.0.100, `Asp.Versioning.Http` 10.2.3 (10.2.1 de forma transitiva no projeto de controllers), `Asp.Versioning.Mvc` 10.2.1, `Asp.Versioning.Mvc.ApiExplorer` 10.2.1, `Asp.Versioning.OpenApi` 10.2.3, `Microsoft.AspNetCore.OpenApi` 10.0.14.

## Use Cases

- Publicar uma mudança incompatível no formato de uma resposta (um campo muda de tipo, um campo é removido) enquanto os clientes existentes continuam chamando o contrato antigo.
- Anunciar aos clientes, em cada resposta, quais versões existem, quais estão obsoletas e quando uma delas será desligada.
- Publicar um documento OpenAPI por versão para que cada cliente gere código contra o contrato que de fato usa.
- Deixar alguns endpoints (health, ping) fora do esquema de versões para que probes e load balancers nunca precisem enviar versão.

## Deep Dive

### Mudanças incompatíveis versus aditivas

Adicionar um campo opcional na requisição ou um campo novo na resposta é aditivo: um cliente tolerante ignora o que não conhece. Remover ou renomear um campo, mudar seu tipo ou significado, tornar obrigatória uma entrada opcional ou mudar o código de status de um resultado conhecido quebra alguém. É para isso que existem versões. O DTO é o contrato (veja o conceito de DTOs): versione os DTOs, não as classes de domínio. As regras de códigos de status do conceito de semântica REST continuam valendo dentro de cada versão.

### Qual pacote para qual modelo de aplicação

| Pacote | Para que serve |
|---|---|
| `Asp.Versioning.Http` | Minimal APIs (`NewVersionedApi`, `HasApiVersion`) e as opções, leitores e erros centrais |
| `Asp.Versioning.Mvc` | Controllers (`[ApiVersion]`, `[MapToApiVersion]`, `.AddMvc()`); traz `Asp.Versioning.Http` junto |
| `Asp.Versioning.Mvc.ApiExplorer` | API explorer versionado (`.AddApiExplorer()`), um group name por versão, para Minimal APIs e controllers |
| `Asp.Versioning.OpenApi` | Integração com `Microsoft.AspNetCore.OpenApi` (`.AddOpenApi()`, `WithDocumentPerVersion()`) |

A linha 10.x é a do .NET 10: os pacotes que restaurei só têm a pasta `net10.0` (o 8.1.1 tem como alvo `net8.0`). Desde a 10.2, o `Asp.Versioning.Http` também traz analisadores Roslyn; o primeiro build do meu projeto de controllers já produziu `AV0015` ("Configure 'ApiVersioningOptions.ApiVersionReader = new QueryStringApiVersionReader();' to optimize performance"), `AV0029` e `AV0030`, mostrados mais abaixo.

### Minimal APIs: version sets, grupos e MapToApiVersion

```csharp
builder.Services.AddProblemDetails();
builder.Services.AddApiVersioning(o => o.ReportApiVersions = true);
// depois de builder.Build():
var orders = app.NewVersionedApi("Orders");                         // um version set
var v1 = orders.MapGroup("/orders").HasDeprecatedApiVersion(1.0);
var v2 = orders.MapGroup("/orders").HasApiVersion(2.0);
v1.MapGet("/{id:int}", (int id, ApiVersion version) => new { id, total = 10.5m, servedBy = version.ToString() });
v2.MapGet("/{id:int}", (int id, ApiVersion version) => new { id, total = new { amount = 10.5m, currency = "EUR" }, servedBy = version.ToString() });

var products = app.NewVersionedApi("Products").MapGroup("/products").HasApiVersion(1.0).HasApiVersion(2.0);
products.MapGet("/", (HttpContext ctx) => $"list for {ctx.RequestedApiVersion}");
products.MapPost("/", () => "created (2.0 only)").MapToApiVersion(2.0);
```

Dois grupos compartilham a rota `/orders`; a versão escolhe o handler. O `ApiVersion` foi vinculado como parâmetro do handler sem configuração extra (o código-fonte da biblioteca o registra como serviço transient resolvido a partir da requisição atual). Com o leitor padrão:

```text
GET /orders/7?api-version=1.0   -> 200 {"id":7,"total":10.5,"servedBy":"1.0"}
GET /orders/7?api-version=2.0   -> 200 {"id":7,"total":{"amount":10.5,"currency":"EUR"},"servedBy":"2.0"}
GET /orders/7?api-version=2     -> 200 ... "servedBy":"2"
GET /products?api-version=1.0   -> 200 list for 1.0
POST /products?api-version=1.0  -> 400 UnsupportedApiVersion
POST /products?api-version=2.0  -> 200 created (2.0 only)
```

`2` casou com `2.0` (a parte menor é opcional), mas `servedBy` ecoa a forma crua, então não compare versões como strings. A divulgação é por version set: quando `/products` estava no set `Orders`, as respostas dele também listavam `api-deprecated-versions: 1.0`, a obsolescência de `/orders`. Dê a cada API lógica o seu próprio nome em `NewVersionedApi`.

### As quatro respostas de erro

Com `AddProblemDetails()` registrado, enviei versões ruins para `/orders/7`:

```text
(no version)          400 {"type":"https://docs.api-versioning.org/problems#unspecified","title":"Unspecified API version","status":400,"detail":"An API version is required, but was not specified.","code":"ApiVersionUnspecified","traceId":"00-..."}
?api-version=3.0      400 {"type":"https://docs.api-versioning.org/problems#unsupported","title":"Unsupported API version","status":400,"detail":"The HTTP resource that matches the request URI 'http://127.0.0.1:5741/orders/7' does not support the API version '3.0'.","code":"UnsupportedApiVersion",...}
?api-version=abc      400 {"type":"https://docs.api-versioning.org/problems#invalid","title":"Invalid API version","status":400,"detail":"The HTTP resource that matches the request URI 'http://127.0.0.1:5741/orders/7' does not support the API version 'abc'.","code":"InvalidApiVersion",...}
?api-version=1.0&api-version=2.0
                      400 {"type":"https://docs.api-versioning.org/problems#ambiguous","title":"Ambiguous API version","status":400,"detail":"The following API versions were requested: 1.0, 2.0. At most, only a single API version may be specified. Please update the intended API version and retry the request.","code":"AmbiguousApiVersion",...}
```

Todas vieram como `application/problem+json`, e as três primeiras também traziam `api-supported-versions: 2.0` e `api-deprecated-versions: 1.0`, então o cliente consegue descobrir o que enviar. Repare que o caso inválido reaproveita o texto "does not support" embora o código seja `InvalidApiVersion`; decida pelo `code`, não pelo `detail`. Sem `AddProblemDetails()`, as requisições sem versão e com versão não suportada devolveram `400` com `Content-Length: 0`, o que bate com a documentação.

### Query string, header e combinação de leitores

A documentação diz que o leitor padrão é a combinação de query string com segmento de URL, com `api-version` como nome do parâmetro. Headers não são lidos por padrão: `X-Version: 2.0` sem query string devolveu `400 ApiVersionUnspecified`. O analisador `AV0015` sugere configurar `QueryStringApiVersionReader` explicitamente quando você não usa segmentos de URL, porque a documentação chama a extração pelo segmento de URL de método mais lento.

```csharp
o.ApiVersionReader = new HeaderApiVersionReader("X-Version");       // só header
o.ApiVersionReader = ApiVersionReader.Combine(new QueryStringApiVersionReader(),
    new HeaderApiVersionReader("X-Version"), new MediaTypeApiVersionReader());   // qualquer um dos três
```

```text
header only: X-Version: 2.0 -> 200    X-Version: 3.0 -> 400 UnsupportedApiVersion
             ?api-version=2.0 -> 400 ApiVersionUnspecified    two X-Version values -> 400 AmbiguousApiVersion
combined:    X-Version: 2.0 -> 200    X-Version: 2.0 + ?api-version=2.0 -> 200
             X-Version: 1.0 + ?api-version=2.0 -> 400 AmbiguousApiVersion
```

Não existe nome de header padrão; você escolhe um, e um leitor que você não configurou simplesmente não é consultado. Leitores combinados aceitam a mesma versão repetida e rejeitam fontes que discordam, em vez de escolher uma delas.

### Segmento de URL

```csharp
o.ApiVersionReader = new UrlSegmentApiVersionReader();
var v1 = orders.MapGroup("/v{version:apiVersion}/orders").HasDeprecatedApiVersion(1.0);
```

```text
GET /v1/orders/7     -> 200 ... "servedBy":"1"
GET /v2.0/orders/7   -> 200 ... "servedBy":"2.0"
GET /v3/orders/7     -> 404, Content-Length: 0, no api-supported-versions header
GET /vabc/orders/7   -> 404, Content-Length: 0          GET /orders/7 -> 404
```

A documentação diz que uma versão não suportada sempre dá 404 com esse método, não importa o valor de `UnsupportedApiVersionStatusCode`. O que recebi foi um 404 comum de roteamento: sem corpo de problem details e sem cabeçalhos de divulgação, então um cliente que digitou `v3` não aprende nada. Com `AssumeDefaultVersionWhenUnspecified = true` acrescentado, `/orders/7` continuou 404: um caminho sem o segmento não casa com nenhuma rota.

### Media type

```csharp
o.ApiVersionReader = new MediaTypeApiVersionReader();   // parâmetro "v"
```

```text
Accept: application/json;v=2.0   -> 200 Content-Type: application/json; charset=utf-8; v=2.0
Accept: application/json;v=3.0   -> 406 Not Acceptable, problem+json, "code":"UnsupportedApiVersion"
Accept: application/json         -> 400 ApiVersionUnspecified
Accept: application/json;v=1.0;q=0.5, application/json;v=2.0;q=0.9 -> 200 ... "servedBy":"2.0"
POST, Content-Type: application/json;v=2.0 + Accept: application/json;v=1.0 -> 400 AmbiguousApiVersion
Accept: application/xml;v=2.0    -> 200 Content-Type: application/json; charset=utf-8; v=2.0
```

A resposta ecoa a versão no próprio `Content-Type`, e o maior valor de qualidade venceu, como diz a documentação. Duas coisas diferem da documentação: ela diz que o Content-Type tem preferência quando os dois headers estão presentes, mas valores diferentes deram `AmbiguousApiVersion`; e pedir XML trouxe JSON, porque o leitor só extrai a versão, ele não negocia formatos.

### Versão padrão quando nenhuma é informada

```csharp
o.AssumeDefaultVersionWhenUnspecified = true; o.DefaultApiVersion = new ApiVersion(1, 0); // docs: já é o padrão
// ou: o.ApiVersionSelector = new CurrentImplementationApiVersionSelector(o);
```

```text
DefaultApiVersion 1.0:            GET /orders/7 -> 200 "servedBy":"1.0"    GET /products -> list for 1.0
CurrentImplementationSelector:    GET /orders/7 -> 200 "servedBy":"2.0"    GET /products -> list for 2.0
```

A primeira opção mantém os clientes antigos, que não mandam versão, no contrato antigo (o motivo usual para ligá-la ao versionar uma API existente). A "current implementation" leva esses clientes para a versão mais nova a cada release, o que traz de volta a quebra que o versionamento deveria evitar.

### Controllers

```csharp
builder.Services.AddControllers();
builder.Services.AddApiVersioning(o => o.ReportApiVersions = true).AddMvc();

[ApiController, ApiVersion(1.0, Deprecated = true), ApiVersion(2.0), Route("orders")]
public class OrdersController : ControllerBase
{
    [HttpGet("{id:int}")] public OrderV1 Get(int id) => new(id, 10.5m);
    [HttpGet("{id:int}"), MapToApiVersion(2.0)]
    public OrderV2 GetV2(int id, ApiVersion version) => new(id, new Money(10.5m, "EUR"), version.ToString());
}
```

```text
GET /orders/7?api-version=1.0 -> 200 {"id":7,"total":10.5}
GET /orders/7?api-version=2.0 -> 200 {"id":7,"total":{"amount":10.5,"currency":"EUR"},"servedBy":"2.0"}
GET /orders/7                 -> 400 ApiVersionUnspecified (same body as above)
```

A action sem mapeamento atendeu a 1.0 e a mapeada explicitamente venceu na 2.0. O modelo de controllers é coberto no conceito de MVC controllers.

### Endpoints neutros e endpoints sem versionamento

`[ApiVersionNeutral]` ou `.IsApiVersionNeutral()` marca um endpoint que aceita requisições sem versão. A documentação diz que ele aceita "qualquer versão de API válida"; o que observei é mais restrito:

```text
GET /ping                   -> 200 pong
GET /ping?api-version=1.0   -> 200 pong
GET /ping?api-version=9.0   -> 400 UnsupportedApiVersion   (Minimal API and controller alike)
GET /health?api-version=9.0 -> 200                          (plain MapGet, no versioning metadata)
```

Um endpoint neutro aceitou as versões que a aplicação declara e rejeitou uma que ninguém declara. Para health probes, um endpoint comum fora de `NewVersionedApi` foi o mais permissivo.

### Deprecation, divulgação e políticas de sunset

`Deprecated = true` (ou `HasDeprecatedApiVersion`) não deixa de atender: a 1.0 continuou respondendo 200. Isso só muda o que `ReportApiVersions = true` escreve. Políticas acrescentam datas e links:

```csharp
o.Policies.Deprecate(1.0).Effective(2026, 1, 1)
    .Link("https://example.com/api-policy").Title("Versioning policy").Type("text/html");
o.Policies.Sunset(1.0).Effective(2027, 1, 1)
    .Link("https://example.com/api-policy").Title("Versioning policy").Type("text/html");
```

```text
GET /orders/7?api-version=1.0 -> HTTP/1.1 200 OK
api-deprecated-versions: 1.0
Sunset: Fri, 01 Jan 2027 00:00:00 GMT
Link: <https://example.com/api-policy>; rel="sunset"; title="Versioning policy"; type="text/html"
Link: <https://example.com/api-policy>; rel="deprecation"; title="Versioning policy"; type="text/html"
Deprecation: @1767225600
```

`Deprecation` está no formato da RFC 9745 (`@` mais segundos Unix, aqui 2026-01-01T00:00:00Z) e `Sunset` é a data HTTP da RFC 8594. Os cabeçalhos de política só aparecem em requisições para a versão que descrevem (a resposta da 2.0 trouxe apenas os dois cabeçalhos `api-*`), e nenhum deles apareceu com `ReportApiVersions = false`. Com a data de sunset movida para 2025, a 1.0 continuou devolvendo 200 com um `Sunset` no passado: a biblioteca divulga, ela nunca desliga uma versão. O cabeçalho `Deprecation` também sumiu nessa execução; o código-fonte do reporter só o escreve quando a data de deprecation não é posterior à de sunset. Uma requisição `OPTIONS`, usada na documentação para mostrar esses cabeçalhos, devolveu `405` com `Allow: GET` aqui: o `OPTIONS` você mapeia por conta própria.

### OpenAPI: um documento por versão

Gerei `/openapi/v1.json` e `/openapi/v2.json` para o controller acima em três configurações (resumo de cada documento):

```text
A) AddOpenApi() only, no versioned explorer
   v1: GET /orders/{id} -> OrderV2, no api-version parameter     v2: 404
B) .AddApiExplorer(o => o.GroupNameFormat = "'v'VVV") + AddOpenApi("v1") + AddOpenApi("v2")
   v1: GET /orders/{id} -> OrderV1, api-version {"type":"string"}, deprecated=false, info.version 1.0.0
   v2: GET /orders/{id} -> OrderV2, api-version {"type":"string"}, deprecated=false, info.version 1.0.0
C) .AddApiExplorer(...).AddOpenApi() + app.MapOpenApi().WithDocumentPerVersion()
   v1: OrderV1, api-version {"enum":["1.0"]}, deprecated=true, info.version 1.0, description "The API is deprecated."
   v2: OrderV2, api-version {"enum":["2.0"]}, deprecated=false, info.version 2.0
```

A configuração A descartou em silêncio a operação da 1.0 (duas actions na mesma rota viraram uma só entrada em paths) e não documentou nenhuma forma de enviar a versão. A configuração B funciona só com o pacote do framework porque o explorer versionado preenche `ApiDescription.GroupName` com `v1`/`v2`, e a documentação do Microsoft Learn diz que o `ShouldInclude` padrão mantém os endpoints cujo group name é igual ao nome do documento ou nulo; você lista os documentos à mão e perde os detalhes de deprecation e de versão. Em B os analisadores avisaram `AV0029` ("AddApiVersioning().AddOpenApi() registers the OpenAPI services that describe API versions") e `AV0030` ("Call MapOpenApi().WithDocumentPerVersion() ..."). A configuração C derivou os documentos das versões declaradas. Um controller neutro `/ping` com `[ApiVersionNeutral]` apareceu em todos os documentos.

### Comparando as estratégias

| | Query string | Header | URL segment | Media type |
|---|---|---|---|---|
| Chave de cache HTTP | a URL, funciona | precisa de `Vary` nesse header | a URL, funciona | precisa de `Vary: Accept` |
| Visível em links e logs | sim | não | sim | não |
| Amigável a proxy/CDN | sim | só se o header for repassado e variado | o melhor | o pior |
| Atrito para o cliente | baixo | médio (header próprio) | o menor | o maior |
| Resposta para versão não suportada | 400 + corpo | 400 + corpo | 404, vazio | 406 + corpo |
| Purismo REST (segundo a documentação da biblioteca) | recomendado para APIs novas | não segue as Microsoft REST Guidelines | viola a interface uniforme | "generally accepted as fully REST-compliant" |

Nenhuma resposta em nenhuma execução trouxe cabeçalho `Vary`: se existe um cache na frente de versionamento por header ou media type, adicionar `Vary` é responsabilidade sua (veja o conceito de output caching e HTTP caching). Minha recomendação a partir dessas execuções: query string como padrão para APIs novas (cacheável, visível, erros ricos, o padrão da biblioteca), segmento de URL quando a API é consumida através de CDNs ou por clientes que só montam caminhos, e header ou media type só quando todos os caches no caminho estiverem configurados para variar.

## Trade-offs

- **Versionar não é a única resposta.** Mudanças aditivas mais leitores tolerantes (ignorar campos desconhecidos, nunca reaproveitar um campo) dispensam versões; versione só quebras de verdade, porque cada versão viva é código que você testa e protege.
- **A biblioteca é uma dependência, não o framework.** Segundo o README, é um projeto da .NET Foundation cujos releases acompanham o ciclo LTS do .NET; a 10.x é só `net10.0`, e a 10.0 remodelou APIs (`HttpContext.GetRequestedApiVersion()` não compilou, agora é a propriedade `RequestedApiVersion`). Reserve tempo para isso a cada troca de LTS.
- **Segmentos de URL escondem erros.** Um `v3` desconhecido recebeu um 404 vazio sem o cabeçalho de versões suportadas, enquanto query, header e media type devolveram um corpo de problem details com o código.
- **Versões por header e media type quebram caches ingênuos.** Nada adiciona `Vary` por você; este middleware fez as respostas carregarem `Vary: X-Version`.
  ```csharp
  app.Use(async (ctx, next) => { ctx.Response.Headers.Append("Vary", "X-Version"); await next(); });
  ```
- **Assumir uma versão padrão é ferramenta de migração.** Fixe `DefaultApiVersion` no contrato mais antigo; o seletor de current implementation leva os clientes sem versão para frente sem avisar.
- **Deprecation e sunset são apenas divulgados.** Uma data de `Sunset` no passado continuou atendendo 200; remover uma versão é um deploy que você agenda, de preferência depois de observar quem ainda a envia.
- **Use a integração de OpenAPI versionada.** O framework sozinho produziu um documento que escondia a operação da 1.0; o `Asp.Versioning.OpenApi` gerou documentos por versão com a marcação de deprecated e valores limitados para `api-version`.

## Documentation Links

- [ASP.NET API Versioning repository, GitHub](https://github.com/dotnet/aspnet-api-versioning) (doc)
- [API Version Reader, ASP.NET API Versioning Documentation](https://dotnet.github.io/aspnet-api-versioning/aspnet-core/config/reader.html) (doc)
- [Error Responses, ASP.NET API Versioning Documentation](https://dotnet.github.io/aspnet-api-versioning/aspnet-core/errors.html) (doc)
- [Version Policies, ASP.NET API Versioning Documentation](https://dotnet.github.io/aspnet-api-versioning/aspnet-core/version-policies.html) (doc)
- [API Documentation, ASP.NET API Versioning Documentation](https://dotnet.github.io/aspnet-api-versioning/aspnet-core/docs/overview.html) (doc)
- [Generate OpenAPI documents, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/aspnetcore-openapi?view=aspnetcore-10.0) (doc)
