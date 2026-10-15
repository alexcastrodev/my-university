---
version: 1.0
updatedAt: 2026-10-15
title: "HttpClient e IHttpClientFactory"
summary: Esgotamento de sockets com um cliente por requisição, o problema de DNS do cliente estático e PooledConnectionLifetime, clientes nomeados e tipados, DelegatingHandler, Timeout versus CancellationToken, ResponseHeadersRead e GetFromJsonAsync, com o resultado real dos experimentos.
---
## Objective

O `HttpClient` parece um auxiliar descartável, e tratá-lo assim é o jeito clássico
de derrubar um serviço em produção. Cada cliente é dono de um pool de conexões, e
o pool vive e morre com o handler que fica embaixo dele. Este conceito mostra o
custo de criar clientes por requisição, o que um cliente de vida longa erra sobre
DNS, como o `IHttpClientFactory` (clientes nomeados e tipados, handler lifetime,
`DelegatingHandler`) resolve os dois problemas, e como são de verdade as exceções
quando uma requisição estoura o tempo ou é cancelada. Tudo foi executado contra um
Kestrel local, no SDK 10.0.100 (runtime 10.0.0).

## Use Cases

- Uma API que chama um serviço de pagamento ou de catálogo a cada requisição e não
  pode vazar sockets sob carga.
- Adicionar um header de correlação ou uma chave de API em toda chamada de saída num
  só lugar, em vez de em cada ponto de chamada.
- Um serviço atrás de um load balancer ou de um deploy blue/green cujo endereço muda
  enquanto o processo continua rodando.
- Ler um download grande ou um stream longo sem bufferizar tudo na memória.

## Deep Dive

### Um cliente por requisição esgota os sockets

Criar e descartar um cliente a cada chamada joga fora o pool de conexões todas as
vezes. Contra um servidor local, 1000 chamadas assim:

```csharp
for (int i = 0; i < 1000; i++)
{
    using var c = new HttpClient();
    await c.GetStringAsync("http://127.0.0.1:5300/ping");
}
```

deixaram **1000 sockets em `TIME_WAIT`** (`netstat -an -p tcp`). Um único cliente
compartilhado fazendo as mesmas 1000 chamadas acrescentou um. `TIME_WAIT` é o
estado do TCP em que o lado que fechou primeiro segura a porta por um tempo; a
documentação aponta a RFC 9293 para isso. Repetindo até algo quebrar, a requisição
16256 falhou com `HttpRequestException: Can't assign requested address
(127.0.0.1:5300)` (interna `SocketException`, `HttpRequestError.ConnectionError`),
aproximadamente o tamanho da faixa de portas efêmeras do macOS (49152 a 65535)
nesta máquina. O limite é do sistema operacional, então o número muda de máquina
para máquina, mas o modo de falha não.

### O cliente estático e o DNS

A correção que todo mundo aprende é um cliente compartilhado. Ele tem o problema
oposto: o `HttpClient` só resolve DNS quando abre uma conexão, e por padrão uma
conexão do pool é mantida enquanto estiver saudável (`PooledConnectionLifetime` é
infinito). A documentação diz que ele não acompanha o TTL do DNS. Simulei um nome
cujo endereço muda no segundo 3 (um `ConnectCallback` que escolhe a porta) com dois
clientes:

```text
t=2s  infinite lifetime -> server-5300   2s lifetime -> server-5300
--- DNS now answers with the new address (5301) ---
t=3s  infinite lifetime -> server-5300   2s lifetime -> server-5300
t=4s  infinite lifetime -> server-5300   2s lifetime -> server-5301
t=7s  infinite lifetime -> server-5300   2s lifetime -> server-5301
```

O cliente com as configurações padrão continuou falando com o servidor antigo até
o processo morrer. Definir `PooledConnectionLifetime` num `SocketsHttpHandler`
fecha a conexão depois desse tempo (quando a última requisição dela termina), e a
próxima conexão resolve o nome de novo:

```csharp
var shared = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) });
```

A orientação oficial aceita isto como uma de duas estratégias válidas: um cliente
de vida longa com `PooledConnectionLifetime`, ou clientes de vida curta vindos do
`IHttpClientFactory`. Nunca um cliente por requisição.

### IHttpClientFactory: clientes nomeados e tipados

`AddHttpClient` (pacote `Microsoft.Extensions.Http`, parte do shared framework do
ASP.NET Core) registra a factory. Um cliente nomeado é configurado uma vez e
buscado por string; um cliente tipado é uma classe que recebe um `HttpClient` no
construtor:

```csharp
builder.Services.AddHttpClient("games", c => c.BaseAddress = new Uri("http://127.0.0.1:5300"));
builder.Services.AddHttpClient<GamesClient>(c => c.BaseAddress = new Uri("http://127.0.0.1:5300"));

class GamesClient(HttpClient http) { public Task<string> WhoAsync() => http.GetStringAsync("/who"); }
```

O que a factory faz, observado:

- Todo `CreateClient` devolve um **`HttpClient` novo** (`ReferenceEquals` deu false)
  que compartilha o **mesmo handler** (true) enquanto ele estiver dentro do
  lifetime. 1000 chamadas a `CreateClient` com `Dispose` por requisição não fizeram
  o `TIME_WAIT` crescer: descartar um cliente da factory não descarta o handler do
  pool.
- O `HandlerLifetime` padrão voltou como `00:02:00`; `SetHandlerLifetime` muda isso
  por cliente. Quando expira, o próximo `CreateClient` recebe um handler novo e o
  antigo é descartado quando nenhum cliente o usa mais.
- A cadeia atrás de um cliente foi `LifetimeTrackingHttpMessageHandler`,
  `LoggingScopeHttpMessageHandler`, `LoggingHttpMessageHandler` e então um
  `SocketsHttpHandler` cujo `PooledConnectionLifetime` marcou `00:02:00`. A
  documentação chama o primary handler padrão da factory de detalhe de
  implementação, então não faça cast nele; use `ConfigurePrimaryHttpMessageHandler`
  ou `UseSocketsHttpHandler` quando precisar de controle.
- O cliente tipado é registrado como transient. A documentação acrescenta dois
  cuidados: não registre a classe tipada de novo por conta própria (o último
  registro sobrescreve o da factory) e mantenha limitado o número de nomes de
  cliente distintos, nunca derivado de entrada do usuário.

### Clientes tipados capturados por singletons

Clientes tipados foram pensados para vida curta: depois que um existe, a factory
não o controla mais. Dei ao `GamesClient` um handler lifetime de 3 segundos e usei
uma cópia transient resolvida a cada uso, mais uma capturada por um singleton, e
registrei por segundo a porta de cliente que o servidor via:

```text
t=2s  default handler: resolved 65452 captured 65452   |   explicit infinite SocketsHttpHandler: resolved 65453 captured 65453
t=3s  default handler: resolved 65457 captured 65458   |   explicit infinite SocketsHttpHandler: resolved 65459 captured 65453
t=7s  default handler: resolved 65462 captured 65463   |   explicit infinite SocketsHttpHandler: resolved 65464 captured 65453
```

Com o primary handler padrão, o cliente capturado ainda trocou de conexão (o
`PooledConnectionLifetime` marcou dois minutos no handler lifetime padrão, então
provavelmente acompanha o handler lifetime), mas com um primary handler criado como
um simples `new SocketsHttpHandler()` o capturado ficou na porta 65453 para sempre.
É a captive dependency do conceito anterior de DI, aplicada ao DNS. Os remédios da
documentação: injetar `IHttpClientFactory` no singleton e chamar `CreateClient`
quando precisar, ou definir você mesmo o `PooledConnectionLifetime` no primary
handler. Não dependa do primeiro comportamento, porque ele vem desse detalhe de
implementação.

### DelegatingHandler: middleware de saída

Um `DelegatingHandler` é o equivalente, no lado do cliente, do pipeline de
middleware. `AddHttpMessageHandler<T>` adiciona um, e o primeiro adicionado é o
mais externo:

```csharp
builder.Services.AddTransient<TraceHandler>();
builder.Services.AddHttpClient<GamesClient>(...).AddHttpMessageHandler<TimingHandler>().AddHttpMessageHandler<TraceHandler>();

class TraceHandler(RequestInfo info) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        request.Headers.Add("X-Trace", info.Id);   // roda antes de a requisição sair
        return base.SendAsync(request, ct);
    }
}
```

O log mostrou `TimingHandler: before`, `TraceHandler` e depois `TimingHandler:
after`. Há uma armadilha com serviços scoped. A factory cria um escopo de DI próprio
por instância de handler, separado do escopo da requisição. Um `RequestInfo` scoped
era `787f50` no escopo da primeira requisição e `f14957` no da segunda, mas o
handler viu `027923` nas duas, porque o mesmo handler em cache atendeu ambas. A
documentação recomenda não guardar dados de escopo em handlers e descreve um handler
transient ciente de escopo, envolvendo o handler em cache, para os casos que
precisam disso.

### Timeouts e cancelamento

`HttpClient.Timeout` vale 100 segundos por padrão (confirmado) e se aplica a toda
requisição daquele cliente. Um `CancellationToken` se aplica a uma chamada. A
documentação diz que vale o menor dos dois. O que você captura é diferente:

```csharp
catch (OperationCanceledException) when (ct.IsCancellationRequested)            { /* o chamador cancelou */ }
catch (OperationCanceledException ex) when (ex.InnerException is TimeoutException) { /* estourou o Timeout */ }
catch (HttpRequestException ex) { /* ex.StatusCode (após EnsureSuccessStatusCode) ou ex.HttpRequestError */ }
```

Saída com `Timeout` de 500 ms, token de 200 ms e um endpoint de 2 segundos:
`caller cancelled`; sem o token: `HttpClient.Timeout elapsed`; um `503`:
`ServiceUnavailable`; uma porta fechada: `ConnectionError`. Os dois cancelamentos
são uma `TaskCanceledException`; só o timeout traz uma `TimeoutException` dentro e
uma mensagem que cita `HttpClient.Timeout`. Passe sempre o token do chamador para
baixo, como no conceito coordinating-concurrent-work; um `Timeout` sozinho não
distingue a desconexão do cliente de um servidor lento.

### ResponseHeadersRead e GetFromJsonAsync

Por padrão o `GetAsync` só retorna depois que o corpo inteiro foi para o buffer.
Contra um endpoint que envia os headers na hora e o corpo ao longo de três segundos:

```text
ResponseContentRead: GetAsync returned after 3009 ms
ResponseHeadersRead: GetAsync returned after 0 ms (body read to the end after 3006 ms)
first 512 bytes after 20 ms when streaming with ReadAsStreamAsync
```

Use `HttpCompletionOption.ResponseHeadersRead` para olhar status e headers antes, ou
para transmitir um corpo grande. Duas consequências observadas: um cliente com
`Timeout` de 1500 ms leu o corpo de três segundos inteiro sem erro (o timeout
cobriu a obtenção dos headers, não a leitura posterior), e você precisa descartar a
resposta por conta própria.

`GetFromJsonAsync<T>` (`System.Net.Http.Json`) faz a requisição e a desserialização.
Um `404` lançou `HttpRequestException` (ele verifica o status por você), um corpo
`null` devolveu `null` sem exceção, e um corpo que não é JSON lançou
`JsonException`. `GetFromJsonAsAsyncEnumerable<T>` entregou os itens em 409, 812,
1211, 1612 e 2013 ms, enquanto `GetFromJsonAsync<List<T>>` devolveu os cinco de uma
vez em 2009 ms.

## Trade-offs

- **Um cliente estático é o mais simples, mas só com a configuração certa.** Sem
  `PooledConnectionLifetime` ele nunca vê uma mudança de DNS. A factory dá
  configuração nomeada e pipelines de handlers, em troca de um pacote e de um
  modelo de lifetime para entender.
  ```csharp
  new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) }
  ```
- **Clientes tipados são convenientes e fáceis de capturar.** Injetados num
  singleton, escapam do controle da factory. Um cliente nomeado com `CreateClient`
  a cada uso evita isso.
- **A rotação de handlers recicla estado.** A documentação avisa que os cookies de
  um `CookieContainer` em pool são compartilhados e se perdem quando o handler
  expira, então evite a factory quando você depende de cookies.
- **Handlers têm seu próprio escopo de DI.** Um serviço scoped é compartilhado por
  várias requisições ali. Passe dados por requisição no `HttpRequestMessage`, não
  pelo construtor do handler.
- **`Timeout` é um instrumento grosso.** Um valor por cliente, 100 segundos por
  padrão, e ele deixa de cobrir o corpo com `ResponseHeadersRead`. Limites por
  chamada pertencem a um token vinculado com `CancelAfter`.
  ```csharp
  using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
  cts.CancelAfter(TimeSpan.FromSeconds(5));
  ```
- **`ResponseHeadersRead` passa a limpeza para você.** Descarte a resposta, ou a
  conexão fica ocupada.
- **`GetFromJsonAsync` esconde o status code.** Ele lança em respostas sem sucesso,
  então use `GetAsync` quando precisar ler um corpo `ProblemDetails` de um `4xx`.

## Documentation Links

- [Use the IHttpClientFactory, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/httpclient-factory) (doc)
- [HttpClient guidelines for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines) (doc)
- [Send a request using HttpClient, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient) (doc)
- [HttpClient.Timeout, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclient.timeout) (doc)
- [HttpCompletionOption, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpcompletionoption) (doc)
- [SocketsHttpHandler.PooledConnectionLifetime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.socketshttphandler.pooledconnectionlifetime) (doc)
- [Make HTTP requests using IHttpClientFactory in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-requests) (doc)
