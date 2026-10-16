---
version: 1.0
updatedAt: 2026-10-15
title: "CORS para SPAs e clientes WebAssembly"
summary: O que o middleware de CORS do ASP.NET Core envia, o que é o preflight, quais configurações falham em silêncio (barra final, any origin com credenciais, ordem com autorização) e como ler o erro no navegador, verificado com curl e com fetch real no Chrome.
---
## Objective

CORS é o motivo de um front-end que funciona contra a sua API no `curl` falhar no navegador. Uma single-page app ou um cliente Blazor WebAssembly servido de uma origem que chama uma API em outra é cross-origin, e o navegador pede permissão à API antes de deixar a página ler a resposta. Este conceito mostra exatamente quais headers o middleware de CORS do ASP.NET Core envia, o que é um preflight, quais configurações falham em silêncio e como ler o erro do navegador. Tudo foi verificado duas vezes: com `curl` contra a API para ver os headers brutos, e com chamadas `fetch` reais de uma página em outra origem no Chrome, cujas mensagens do console estão citadas abaixo. Versões: SDK 10.0.100, runtime 10.0.0.

## Use Cases

- Um app React, Angular ou Vue em `http://localhost:5410` chamando uma API em `http://localhost:5403`, ou a mesma divisão em produção em dois subdomínios.
- Um app Blazor WebAssembly servido de uma CDN ou de um host estático que chama uma API ASP.NET Core em outro host.
- Uma API que também precisa aceitar credenciais de cookie vindas da SPA.
- Diagnosticar um erro "blocked by CORS policy" que os logs do servidor nunca mencionam.

## Deep Dive

### O servidor responde, o navegador decide

Uma origem é esquema, host e porta. A documentação afirma que CORS não é um recurso de segurança, e sim um relaxamento da regra de mesma origem do navegador, e que cabe ao navegador aplicá-lo: o servidor executa a requisição e devolve a resposta, e o navegador a retém da página. Isso tem uma consequência visível. Com uma política para `http://localhost:5410`, uma requisição de outra origem ainda chegou ao endpoint e recebeu uma resposta normal:

```text
GET /items  Origin: http://evil.example   ->  200 OK   (no Access-Control-Allow-Origin header)
GET /items  (no Origin header at all)     ->  200 OK
```

`curl`, Postman e chamadas servidor a servidor ignoram o CORS por completo. Ele protege os navegadores dos usuários, não a sua API. A autorização continua sendo responsabilidade do servidor.

### Configurando uma política

```csharp
const string Spa = "http://localhost:5410";
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(Spa)
    .WithMethods("GET", "POST")
    .WithHeaders("Content-Type")));

var app = builder.Build();
app.UseRouting();
app.UseCors();            // before UseAuthorization
app.UseAuthentication();
app.UseAuthorization();
```

Com essa política, uma requisição da origem permitida recebeu um header extra na resposta:

```text
GET /items  Origin: http://localhost:5410
200 OK
Access-Control-Allow-Origin: http://localhost:5410
```

Uma política padrão vale por meio de `UseCors()`; uma política nomeada é aplicada globalmente com `UseCors("name")` ou por endpoint com `.RequireCors("name")` (e `[EnableCors]` em controllers). A documentação recomenda não misturar o atributo e o middleware no mesmo app.

### Preflight

Antes de algumas requisições, o navegador envia primeiro uma requisição `OPTIONS`, o preflight, perguntando se a requisição real seria permitida. Segundo a documentação, ele só pula essa etapa para GET, HEAD ou POST, com apenas os headers da lista segura (`Accept`, `Accept-Language`, `Content-Language`, `Content-Type`, `Last-Event-ID`) e um `Content-Type` de `application/x-www-form-urlencoded`, `multipart/form-data` ou `text/plain`. Um `POST` com JSON, um `PUT`, um `DELETE`, ou qualquer header customizado ou `Authorization` dispara preflight. O middleware responde sem chegar ao seu endpoint:

```text
OPTIONS /items
Origin: http://localhost:5410
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type

204 No Content
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: GET,POST
Access-Control-Allow-Origin: http://localhost:5410
```

Repare em quem julga. Para um método ou header não permitido, o servidor ainda respondeu `204` com as listas da própria política (`GET,POST`, `Content-Type`) e o navegador as comparou com o que a página pediu. Só uma origem não permitida recebeu um `204` vazio, sem headers de CORS. Uma requisição `OPTIONS` sem `Access-Control-Request-Method` não é tratada como preflight e recebeu `405`. No Chrome, com essa política:

```text
fetch(..., { headers: { 'X-Custom': '1' } })
  blocked: Request header field x-custom is not allowed by Access-Control-Allow-Headers in preflight response.
fetch(..., { method: 'PUT' })
  blocked: Method PUT is not allowed by Access-Control-Allow-Methods in preflight response.
```

O código da página vê apenas `TypeError: Failed to fetch`. O motivo está no console, e é por isso que bugs de CORS parecem invisíveis do lado do servidor.

### Credenciais, headers expostos e cache do preflight

Cookies e outras credenciais gerenciadas pelo navegador precisam dos dois lados: a página define `credentials: 'include'` e a política chama `AllowCredentials()`. Sem isso o Chrome recusou: `The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials mode is 'include'.` Uma política com credenciais, um header exposto e tempo de cache do preflight:

```csharp
p.WithOrigins(Spa).AllowAnyHeader().AllowAnyMethod().AllowCredentials()
 .WithExposedHeaders("X-Total-Count").SetPreflightMaxAge(TimeSpan.FromMinutes(10));
```

```text
Access-Control-Allow-Credentials: true
Access-Control-Allow-Origin: http://localhost:5410
Access-Control-Expose-Headers: X-Total-Count
Access-Control-Max-Age: 600          (on the preflight)
```

Ler `response.headers.get('X-Total-Count')` devolveu `null` no navegador sob a primeira política, embora o header estivesse na rede, e `42` sob esta. A documentação lista os únicos headers de resposta que uma página lê por padrão: `Cache-Control`, `Content-Language`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`.

### Curingas e os erros que falham em silêncio

- `AllowAnyOrigin()` envia `Access-Control-Allow-Origin: *`, e o preflight devolve os headers e métodos pedidos.
- `AllowAnyOrigin()` junto com `AllowCredentials()` é inválido. Neste runtime a aplicação **não subiu**: `InvalidOperationException: The CORS protocol does not allow specifying a wildcard (any) origin and credentials at the same time. Configure the CORS policy by listing individual origins if credentials needs to be supported.`
- Barra final na origem está errado: `WithOrigins("http://localhost:5410/")` não lançou nada e simplesmente **não** enviou `Access-Control-Allow-Origin` em nenhuma requisição. A documentação diz que a comparação falha.
- `127.0.0.1` não é `localhost`. Uma página aberta em `http://127.0.0.1:5410` chamando a política de `http://localhost:5410` falhou com `No 'Access-Control-Allow-Origin' header is present on the requested resource.`
- Com duas ou mais origens permitidas, o middleware também enviou `Vary: Origin`; com uma única origem, não. Caches na frente da API precisam desse header para separar as respostas por origem.

### Ordem com a autorização

A documentação diz que `UseCors` vai depois de `UseRouting` e antes de `UseAuthorization`. Testei as duas ordens contra um endpoint com `RequireAuthorization()` e sem credenciais:

```text
UseCors before UseAuthorization:  401, Access-Control-Allow-Origin present  -> fetch reads status 401
UseCors after  UseAuthorization:  401, no CORS header                       -> fetch: TypeError: Failed to fetch
```

O preflight funcionou nas duas ordens. Só a resposta real mudou, e no segundo caso a página nem consegue ver que foi um 401. A documentação acrescenta um alerta separado: um redirecionamento de HTTP para HTTPS no preflight falha no navegador (`ERR_INVALID_REDIRECT`), então uma API deve rejeitar HTTP em vez de redirecioná-lo. Não executei esse caso.

## Trade-offs

- **`AllowAnyOrigin` é cômodo para APIs públicas sem credenciais e errado para o resto.** Leia as origens da configuração em vez de fixá-las no código.
  ```csharp
  p.WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>()!)
  ```
- **Credenciais elevam o risco.** Permitir credenciais cross-origin é um risco de segurança, nas palavras da documentação. Mantenha a lista de origens curta e exata.
- **Headers expostos são opt-in.** Headers de paginação ou ETag somem para a página até você listá-los.
- **O cache do preflight corta idas e voltas, mas atrasa mudanças de política.** Um `SetPreflightMaxAge` de dez minutos significa que uma política mais restrita pode levar dez minutos para chegar a um navegador que guardou a resposta antiga.
- **Erros de CORS se escondem no navegador.** Mantenha o console aberto e teste com `curl -i -H "Origin: ..."` para ver os headers brutos antes de mexer no código do cliente.
- **Uma implantação de mesma origem não precisa de nada disso.** Servir a SPA ou o app Blazor da própria origem da API, ou por um reverse proxy, elimina o mecanismo inteiro.

## Documentation Links

- [Enable Cross-Origin Requests (CORS) in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/cors) (doc)
- [Cross-Origin Resource Sharing (CORS), MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) (doc)
- [Fetch Standard: CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol) (doc)
- [Call a web API from ASP.NET Core Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/call-web-api) (doc)
- [Use the IHttpClientFactory, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) (doc)
