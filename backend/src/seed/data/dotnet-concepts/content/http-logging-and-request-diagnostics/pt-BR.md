---
version: 1.0
updatedAt: 2026-10-15
title: "HTTP logging e diagnóstico de requisições"
summary: O que o HTTP logging e o W3C logging escrevem de verdade por padrão, o que liga as partes sensíveis (query string, corpos), controle por endpoint e por requisição com interceptor, e correlação por trace id com LoggerMessage.
---
## Objective

Quando um endpoint se comporta mal em produção, você quer ver o que chegou e o que saiu, sem vazar os dados que a requisição carregava. O ASP.NET Core tem dois middlewares para isso, o HTTP logging e o W3C logging, mais o logging estruturado com ids de correlação para amarrar tudo. Este conceito mostra o que cada um escreve por padrão (menos do que a maioria espera), o que liga as partes sensíveis, como desligar por endpoint ou por requisição e como um trace id aparece em todas as linhas. Tudo foi executado no SDK 10.0.100 (runtime 10.0.0) contra uma minimal API pequena.

## Use Cases

- Descobrir por que um cliente recebe 400: quais headers e qual corpo o servidor realmente viu.
- Manter um access log em formato padrão para ferramentas que já o leem.
- Registrar uma requisição sem nunca gravar senha, token ou segredo de query string em disco.
- Seguir uma requisição pelas linhas de log do middleware e do seu próprio código.

## Deep Dive

### O HTTP logging fica desligado até você pedir duas vezes

Duas chamadas habilitam o middleware, `AddHttpLogging` e `UseHttpLogging`. Isso não basta para ver nada. O template do projeto define a categoria `Microsoft.AspNetCore` como `Warning`, e o middleware loga em `Information`. Só com as duas chamadas, minha execução imprimiu zero linhas do `HttpLoggingMiddleware`. A correção da documentação é uma entrada de categoria no `appsettings.Development.json`:

```json
"Microsoft.AspNetCore.HttpLogging.HttpLoggingMiddleware": "Information"
```

(Passei a mesma chave como argumento de linha de comando.) Com isso, um `GET /search?q=secret-token` enviado com os headers `Authorization` e `X-Correlation-Id` produziu duas mensagens, com event ids 1 e 2:

```text
Request:
  Method: GET
  Path: /search
  Authorization: [Redacted]
  X-Correlation-Id: [Redacted]
Response:
  StatusCode: 200
  Content-Type: text/plain; charset=utf-8
```

Dois padrões para notar. Os valores de header só são logados para nomes de uma lista de permitidos; o resto aparece como `[Redacted]` (a documentação descreve `RequestHeaders` e `ResponseHeaders` como os conjuntos cujos valores são logados). E a query string `?q=secret-token` não aparece na saída.

### O que os flags de campo realmente incluem

`HttpLoggingFields` é um enum de flags. Imprimi os valores:

```text
RequestPath=0x1  RequestQuery=0x2  RequestProtocol=0x4  RequestMethod=0x8
RequestScheme=0x10  RequestProperties=0x1D  ResponseStatusCode=0x20
RequestHeaders=0x40  ResponseHeaders=0x80  RequestBody=0x400
ResponseBody=0x800  Duration=0x1000  All=0x1CFD
```

`RequestProperties` vale `0x1D`, que deixa de fora `RequestQuery` (`0x2`), e `All` (`0x1CFD`, que também omite os dois flags de trailers) idem. A query string é a única coisa que `All` não loga. Você ativa de propósito:

```csharp
o.LoggingFields = HttpLoggingFields.RequestPropertiesAndHeaders | HttpLoggingFields.RequestQuery;
```

e a linha `QueryString: ?q=secret-token` aparece. Pergunte-se se deveria: query strings são onde tokens e e-mails vão parar.

### Corpos, limites e uma linha combinada

Com `All`, limite de corpo 40 e `CombineLogs = true`, um `POST /login` com corpo JSON gerou uma única mensagem (event id 9) em vez de duas:

```text
Request and Response:
  Authorization: [Redacted]
  X-Correlation-Id: abc-123        (adicionado em RequestHeaders)
  RequestBody: {"user":"alice","password":"hunter2","no
  RequestBodyStatus: [Truncated by RequestBodyLogLimit]
  ResponseBody: {"ok":true}
  Duration: 6,357                  (ms; a vírgula é o separador decimal desta máquina)
```

A senha está no log. O limite só truncou, e só porque o corpo era longo. A documentação avisa que o HTTP logging pode registrar informação pessoal identificável e reduzir o desempenho, principalmente com corpos. Trate o log de corpo como diagnóstico temporário, não como configuração.

### Controle por endpoint e por requisição

`WithHttpLogging` (ou o atributo `[HttpLogging]`) sobrescreve os campos globais para um endpoint:

```csharp
app.MapGet("/health", () => "ok").WithHttpLogging(HttpLoggingFields.None);
app.MapGet("/dur", () => "d").WithHttpLogging(HttpLoggingFields.Duration | HttpLoggingFields.ResponseStatusCode);
```

`/health` não escreveu nada, que é o que você quer para uma sonda chamada a cada poucos segundos. `/dur` escreveu só uma mensagem de `StatusCode` e uma de `Duration`. Para decisões que dependem da requisição, registre um `IHttpLoggingInterceptor` com `AddHttpLoggingInterceptor`. A documentação lista a ordem: opções globais, depois configuração do endpoint, depois o interceptor, que pode mudar ambos. O meu removeu o corpo de `/login`, substituiu a query e adicionou o trace id:

```csharp
public ValueTask OnRequestAsync(HttpLoggingInterceptorContext c)
{
    if (c.HttpContext.Request.Path.StartsWithSegments("/login"))
        c.LoggingFields &= ~HttpLoggingFields.RequestBody;
    if (c.TryDisable(HttpLoggingFields.RequestQuery)) c.AddParameter("Query", "[hidden]");
    c.AddParameter("TraceId", c.HttpContext.TraceIdentifier);
    return default;
}
```

```text
Query: [hidden]
TraceId: 0HNPAULADS3DJ:00000001
Method: POST
Path: /login
ResponseBody: {"ok":true}
```

A redação tem que cobrir a resposta também: `GET /search?q=secret-token` devolveu o valor, e `ResponseBody: q=secret-token` foi logado mesmo com a query escondida. A documentação também descreve um caminho de redação de dados (`AddHttpLoggingRedaction` com `AddRedaction`); não o executei.

### W3C logging: um arquivo, não um logger

`AddW3CLogging` mais `UseW3CLogging` escreve um arquivo de log W3C estendido, não mensagens de `ILogger`. Apontado para uma pasta de rascunho, uma requisição e um 404 produziram:

```text
#Version: 1.0
#Fields: date time c-ip s-computername s-ip s-port cs-method cs-uri-stem cs-uri-query sc-status time-taken cs-version cs-host cs(User-Agent) cs(Referer)
2026-10-15 19:48:59 ::1 <machine> ::1 5401 GET /search ?q=secret-token 200 4.3882 HTTP/1.1 localhost:5401 curl/8.7.1 -
2026-10-15 19:48:59 ::1 <machine> ::1 5401 GET /nope - 404 0.1161 HTTP/1.1 localhost:5401 curl/8.7.1 -
```

O nome do arquivo foi `w3clog-20261015.0000.txt`. Note o que difere do HTTP logging: a query string entra por padrão, e o nome do host do servidor também. A documentação diz que os padrões excluem `UserName` e `Cookie` e dá estes padrões: `./logs/` sob a raiz de conteúdo, limite de 10 MB, 4 arquivos retidos, flush de 1 segundo. Como escreve em disco, garanta que a pasta exista e seja rotacionada, principalmente numa imagem de container somente leitura.

### Correlação e LoggerMessage

Suas próprias linhas de log precisam dos mesmos identificadores. Os scopes do console vêm desligados no template, então habilitei (`Logging:Console:IncludeScopes=true`) e loguei a partir de um método gerado por source generator:

```csharp
static partial class Msgs
{
    [LoggerMessage(EventId = 100, Level = LogLevel.Information,
        Message = "Handled order for {User} with {Items} items")]
    public static partial void Handled(ILogger logger, string user, int items);
}
```

Enviando um header `traceparent` do W3C, tanto a minha linha quanto a do middleware carregaram o scope abaixo, e o `TraceId` é igual ao que enviei:

```text
=> SpanId:729c0cc2e7b2a4cf, TraceId:0af7651916cd43dd8448eb211c80319c, ParentId:b7ad6b7169203331
=> ConnectionId:0HNPAULI8S6MD => RequestPath:/corr RequestId:0HNPAULI8S6MD:00000001
Handled order for alice with 3 items
```

Repare também que o próprio `traceparent` saiu como `[Redacted]`, porque não está na lista de permitidos; o trace id continua disponível pelo scope. Os placeholders `{User}` e `{Items}` continuam nomeados, então um destino estruturado consegue consultá-los.

## Trade-offs

- **Corpos são um vazamento esperando acontecer.** Logue só para um diagnóstico curto e dirigido, com limite pequeno.
  ```csharp
  o.RequestBodyLogLimit = 1024; // ainda loga o primeiro 1 KB de um formulário de senha
  ```
- **A lista de permitidos é uma rede de segurança, não uma política.** Adicionar um nome em `RequestHeaders` loga o valor dali em diante, inclusive `Authorization` se você adicionar.
- **Dois logs, dois padrões.** O HTTP logging omite a query string, o W3C inclui. Saiba em qual arquivo seus segredos podem cair.
- **Interceptors custam código em toda requisição.** Dão controle por requisição, mas um bug neles afeta todo o tráfego. Mantenha-os minúsculos.
- **Sondas e arquivos estáticos geram ruído.** Desligue com `WithHttpLogging(HttpLoggingFields.None)` em vez de filtrar depois.
- **Corpos de resposta vazam também.** Redigir a requisição não basta quando a resposta ecoa a entrada.

## Documentation Links

- [HTTP logging in .NET and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-logging/) (doc)
- [W3CLogger in .NET and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/w3c-logger/) (doc)
- [Logging in .NET and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/logging/) (doc)
- [Compile-time logging source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator) (doc)
- [Data redaction in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) (doc)
- [Trace Context, W3C Recommendation](https://www.w3.org/TR/trace-context/) (doc)
