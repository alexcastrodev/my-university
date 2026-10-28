---
version: 1.0
updatedAt: 2026-10-28
title: "Serviços gRPC e JSON transcoding"
summary: gRPC no ASP.NET Core 10 com resultados medidos: contratos .proto e código gerado, a exigência de HTTP/2 (h2c, HTTP_1_1_REQUIRED, 426 em HTTP/1.1), reuso de channel, os quatro tipos de chamada, deadlines e cancelamento, status codes e erros ricos, metadata, interceptors, evolução do contrato, tamanho de protobuf contra JSON, JSON transcoding e seus limites de streaming, e quando escolher gRPC, REST ou transcoding.
---
## Objective

gRPC é um framework de chamada de procedimento remoto em que o contrato é um arquivo `.proto`, as mensagens viajam como Protocol Buffers (um formato binário compacto) e cada chamada é uma requisição HTTP/2. No ASP.NET Core, um serviço é uma classe que sobrescreve métodos de uma classe base gerada, e um cliente é uma classe gerada em cima de um `GrpcChannel`. Ele brilha entre serviços que são seus: um contrato rígido compartilhado pelos dois lados, payloads menores que JSON e streaming nas duas direções numa única conexão. Também traz regras próprias: só HTTP/2, um modelo de erro diferente (status codes em trailers em vez de status HTTP), deadlines que o servidor precisa respeitar e números de campo que nunca podem ser reutilizados. O JSON transcoding expõe o mesmo serviço como uma API JSON para clientes que não falam gRPC. Este conceito constrói um serviço com os quatro tipos de chamada, chama esse serviço a partir de um cliente .NET e do curl, e mostra os erros de protocolo, tempos, tamanhos e status codes observados. Versões usadas: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0, `Grpc.AspNetCore` 2.84.0 (com `Grpc.Tools` 2.84.0 e `Google.Protobuf` 3.35.1), `Grpc.Net.Client` 2.84.0, `Grpc.StatusProto` 2.84.0, `Microsoft.AspNetCore.Grpc.JsonTranscoding` 10.0.14 e `Microsoft.AspNetCore.Grpc.Swagger` 0.10.11 (um pacote 0.x, com Swashbuckle 6.6.2).

## Use Cases

- Chamadas internas entre serviços em que os dois lados são seus e podem compartilhar o contrato `.proto`.
- Streaming: um servidor enviando progresso ou eventos, um cliente subindo muitos registros, ou uma conversa nos dois sentidos numa única chamada.
- Tráfego sensível a latência ou a banda, em que um payload binário e uma conexão multiplexada fazem diferença.
- Uma implementação gRPC que também serve uma API JSON (transcoding) para navegadores e parceiros que não conseguem usar gRPC.

## Deep Dive

### O contrato e o código gerado

O arquivo `.proto` declara mensagens com campos numerados e um serviço com métodos. O `Grpc.Tools` (que vem junto com o `Grpc.AspNetCore`) roda o `protoc` durante o build para cada item `<Protobuf Include="Protos\greet.proto" GrpcServices="Both" />`; `GrpcServices` escolhe o que gerar: `Server`, `Client`, `Both` ou `None` (só as mensagens).

```protobuf
syntax = "proto3";
package lab.v1;
service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc Countdown (CountRequest) returns (stream Tick);   // server streaming
  rpc Sum (stream Number) returns (Total);               // client streaming
  rpc Echo (stream Chat) returns (stream Chat);          // bidirecional
}
message HelloRequest { string name = 1; }   message HelloReply { string message = 1; }
```

O build gerou `obj/Debug/net10.0/Protos/GreetGrpc.cs`. Todo método da classe base gerada é virtual e lança exceção:

```csharp
public abstract partial class GreeterBase {
  public virtual Task<HelloReply> SayHello(HelloRequest request, ServerCallContext context)
    { throw new RpcException(new Status(StatusCode.Unimplemented, "")); }
```

O serviço sobrescreve o que implementa e é registrado com `AddGrpc()` e `MapGrpcService<GreeterService>()`. Um método declarado no proto mas não sobrescrito continua existindo na rede: chamá-lo retornou `Unimplemented detail=''`. A URL de uma chamada é `/{package}.{Service}/{Method}`, aqui `/lab.v1.Greeter/SayHello`.

### HTTP/2 é obrigatório: h2c, HTTP/1.1 e TLS

Abri quatro endpoints no Kestrel e chamei `SayHello` em cada um com `GrpcChannel.ForAddress`:

```csharp
k.ListenLocalhost(5721, o => o.Protocols = HttpProtocols.Http2);          // h2c
k.ListenLocalhost(5722, o => o.Protocols = HttpProtocols.Http1);
k.ListenLocalhost(5723, o => o.Protocols = HttpProtocols.Http1AndHttp2);  // sem TLS
k.ListenLocalhost(5725, o => { o.Protocols = HttpProtocols.Http1AndHttp2; o.UseHttps(cert); });
```

```text
http://localhost:5721 OK Hello world
http://localhost:5722 Internal detail='Error starting gRPC call. HttpRequestException: The HTTP/2 server closed the connection. HTTP/2 error code 'HTTP_1_1_REQUIRED' (0xd). (HttpProtocolError) ...'
http://localhost:5723 Internal (same HTTP_1_1_REQUIRED error)
https://localhost:5725 (Http1AndHttp2 + TLS) OK Hello tls, server saw HTTP/2
```

Com um endereço `http://`, o cliente .NET fala HTTP/2 direto (cleartext com "prior knowledge", h2c), então o endpoint do servidor precisa ser só `Http2`. `Http1AndHttp2` sem TLS vira HTTP/1.1 em silêncio; o Kestrel registrou isso na inicialização: `HTTP/2 is not enabled for 127.0.0.1:5723. The endpoint is configured to use HTTP/1.1 and HTTP/2, but TLS is not enabled. HTTP/2 requires TLS application protocol negotiation.` Com TLS, o ALPN negociou HTTP/2 no macOS sem nenhuma configuração extra (a documentação diz que o macOS só precisava de contornos antes do .NET 8). Do outro lado, uma requisição gRPC enviada com `curl --http1.1` foi recusada pelo próprio middleware do gRPC: `HTTP/1.1 426 Upgrade Required` com `Upgrade: HTTP/2`, `Grpc-Status: 13` e `Grpc-Message: Request protocol 'HTTP/1.1' is not supported.`

### Channels: crie uma vez, reutilize sempre

Um `GrpcChannel` é dono da conexão HTTP/2. Fiz 300 chamadas unárias sequenciais em localhost, uma vez com um channel novo por chamada e outra com um único channel compartilhado, contando os valores distintos de `Connection.Id` no servidor:

```text
round 0: new channel each: 142 ms (0.47 ms/call, 300 TCP connections); reused: 33 ms (0.11 ms/call, 1 connections)
round 1: new channel each: 127 ms (0.42 ms/call, 300 TCP connections); reused: 32 ms (0.11 ms/call, 1 connections)
250 concurrent 500 ms calls on one channel: 509 ms, 3 TCP connection(s)
```

Um channel por chamada foi cerca de 4 vezes mais lento mesmo em loopback, onde uma conexão quase não custa nada; numa rede de verdade, cada channel novo soma handshakes de TCP e TLS. A última linha bate com a documentação: uma conexão HTTP/2 costuma aceitar 100 streams simultâneos, e o `GrpcChannel` abre conexões extras quando esse limite é atingido em vez de enfileirar. A documentação diz que channels e clientes são thread-safe, então crie uma vez (ou registre com `AddGrpcClient<T>` do `Grpc.Net.ClientFactory`), como no `HttpClient`.

### Os quatro tipos de chamada

```csharp
using var down = client.Countdown(new CountRequest { From = 3 });
await foreach (var tick in down.ResponseStream.ReadAllAsync()) { /* print */ }
using var sum = client.Sum();
for (var i = 1; i <= 1000; i++) await sum.RequestStream.WriteAsync(new Number { Value = i });
await sum.RequestStream.CompleteAsync();
var total = await sum;
using var echo = client.Echo();   // uma task leitora imprime as respostas enquanto o loop escreve a, b, c a cada 200 ms
```

O servidor escreve com `IServerStreamWriter<T>.WriteAsync` (com 500 ms de intervalo no `Countdown`) e lê com `IAsyncStreamReader<T>`:

```text
[server-stream] tick 3 at 4 ms
[server-stream] tick 2 at 505 ms
[server-stream] tick 1 at 1006 ms
[client-stream] sent 1000 messages, server replied sum=500500 count=1000 after 22 ms
[bidi]    0 ms sent 'a'
[bidi]    2 ms received 'A'
[bidi]  201 ms sent 'b'
[bidi]  202 ms received 'B'
[bidi]  403 ms sent 'c'
[bidi]  403 ms received 'C'
```

Cada tick chegou quando foi escrito, não no final, e as respostas bidirecionais se intercalaram com as requisições na mesma chamada. A chamada unária anterior levou cerca de 0,1 ms num channel já aquecido.

### Deadlines e cancelamento

A documentação diz que não existe deadline padrão: uma chamada sem deadline pode rodar para sempre. O deadline é um horário UTC absoluto que viaja com a chamada, e o servidor o enxerga como `context.Deadline`. Meu método `Slow` espera 2000 ms, passando `context.CancellationToken` ou ignorando o token:

```csharp
await client.SlowAsync(new SlowRequest { Millis = 2000, HonorToken = honor },
    deadline: DateTime.UtcNow.AddMilliseconds(300));
```

```text
honor=True  client got DeadlineExceeded detail='' after 319 ms
            server: deadline in 299 ms; token cancelled after 314 ms; Task.Delay threw OperationCanceledException at 314 ms
honor=False client got DeadlineExceeded detail='' after 314 ms
            server: deadline in 299 ms; token cancelled after 313 ms; handler finished after 2001 ms (token cancelled=True)
CancellationTokenSource(300): client got Cancelled detail='Call canceled by the client.' after 302 ms
no deadline: server saw context.Deadline = DateTime.MaxValue
deadline: DateTime.Now.AddSeconds(5) -> InvalidOperationException: Deadline must have a kind DateTimeKind.Utc or be equal to DateTime.MaxValue or DateTime.MinValue.
```

O cliente desiste no tempo certo nos dois casos, mas um handler que ignora o token continua trabalhando pelos 2 segundos inteiros, como a documentação avisa. Passe `context.CancellationToken` para toda chamada de banco e de HTTP, e propague `context.Deadline` para as chamadas gRPC seguintes (segundo a documentação, o `EnableCallContextPropagation()` da client factory faz isso automaticamente).

### Erros: status codes, Unknown e EnableDetailedErrors

Uma chamada gRPC termina com um status code (`OK`, `InvalidArgument`, `NotFound`, `DeadlineExceeded`, `Unavailable`, `Internal`...) e uma string de detalhe, enviados em trailers; o cliente vê uma falha como `RpcException`. Meu método `Fail` lança de três formas: uma `RpcException`, uma `InvalidOperationException` comum e um erro rico montado com `Grpc.StatusProto` (`Google.Rpc.Status` com um detalhe `BadRequest`, depois `.ToRpcException()`). As mesmas chamadas contra um servidor com `EnableDetailedErrors = false` (o padrão) e `true`:

```text
detailed=false kind=rpc:   InvalidArgument detail='Name is required.'
detailed=false kind=plain: Unknown detail='Exception was thrown by handler.'
detailed=false kind=rich:  InvalidArgument detail='Bad request'
         BadRequest field=name description='Value is null or empty' trailer keys: date,server,grpc-status-details-bin
detailed=true  kind=plain: Unknown detail='Exception was thrown by handler. InvalidOperationException: Connection string 'Server=db;Password=hunter2' failed'
```

Qualquer exceção que não seja `RpcException` vira `Unknown` com uma mensagem genérica. O `EnableDetailedErrors` envia o tipo e a mensagem da exceção para quem chamou, aqui uma senha, então deixe-o só para desenvolvimento. O erro rico viaja no trailer `grpc-status-details-bin` e o cliente o lê com `ex.GetRpcStatus()?.GetDetail<BadRequest>()`.

### Metadata: headers e trailers

Metadata é o nome que o gRPC dá aos headers HTTP. Enviei duas entradas e fiz o servidor escrever um header de resposta e um trailer:

```csharp
var call = client.SayHelloAsync(req, new Metadata { { "X-Tenant", "acme" }, { "trace-bin", new byte[] { 1, 2, 3 } } });
// servidor: lê context.RequestHeaders; await context.WriteResponseHeadersAsync(...x-served-by...); context.ResponseTrailers.Add("x-cost-ms", "3");
```

```text
server saw request headers: x-tenant=acme, trace-bin=[1,2,3]
response headers: date=Wed, 28 Oct 2026 16:21:45 GMT, server=Kestrel, x-served-by=node-1
trailers: x-cost-ms=3 status=OK
```

As chaves viram minúsculas, e chaves terminadas em `-bin` carregam bytes em vez de texto. Os trailers são lidos com `call.GetTrailers()` depois da resposta, e é ali que ficam valores calculados no fim da chamada (custo, status final).

### Interceptors

Um interceptor é o equivalente gRPC de um middleware, tipado por tipo de chamada. No servidor, registrado com `AddGrpc(o => o.Interceptors.Add<ServerLogInterceptor>())`; no cliente, aplicado em volta do channel com `channel.Intercept(new ClientLogInterceptor())`:

```csharp
public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(TRequest request,
    ServerCallContext context, UnaryServerMethod<TRequest, TResponse> continuation)
{   try { return await continuation(request, context); }
    catch (RpcException ex) { outcome = ex.StatusCode.ToString(); throw; }
    finally { Console.WriteLine($"[server interceptor] {context.Method} via {protocol} -> {outcome}"); } }
```

```text
[server interceptor] /lab.v1.Greeter/Fail via HTTP/2 application/grpc -> InvalidArgument 0 ms
[client interceptor] /lab.v1.Greeter/Fail InvalidArgument in 0 ms
```

Um interceptor unário só cobre chamadas unárias; chamadas de streaming passam por `ServerStreamingServerHandler`, `ClientStreamingServerHandler` e `DuplexStreamingServerHandler` (e os equivalentes do cliente). Os interceptors de servidor também rodaram para as requisições JSON do transcoding (mostrado abaixo).

### Evolução do contrato

O guia do proto3 diz que os números de campo identificam os campos na rede e nunca devem ser reutilizados; o número (e o nome) de um campo removido vai para `reserved`. Meu `User` v2 removeu `email = 3`, reservou esse número e adicionou `phone = 4` e `roles = 5`. O cliente antigo foi compilado a partir da v1 (`id = 1, name = 2, email = 3`):

```text
v2 bytes=38; old client reads: id=7 name=Ana email=''
old client re-serializes, v2 reads back: phone='+55 11 99999-0000' roles=2 (unknown fields kept)
old client over gRPC (v1 marshaller on /lab.v1.Greeter/GetUser): id=7 name=Ana email=''
field 3 reused for phone, old client reads email='+55 11 99999-0000'
adding 'string nickname = 3;' to v2: error : Field "nickname" uses reserved number 3.
```

Adicionar campos é seguro: leitores antigos pulam números desconhecidos e ainda os preservam quando serializam de novo. Reutilizar um número é corrupção silenciosa (o telefone foi parar em `email`), e o `reserved` transforma esse erro em erro de build.

### Bytes na rede: protobuf contra JSON

O mesmo método `GetCatalog` (produtos com id, nome, preço, flag de estoque e duas tags) servido de três formas, com os bytes do corpo da resposta medidos pelo `size_download` do curl, sem compressão em nenhum dos lados:

```text
1 product:    gRPC 47   transcoded JSON 98    minimal API JSON 85
100 products: gRPC 4231 transcoded JSON 8531  minimal API JSON 8518
```

O protobuf ficou com cerca de metade do tamanho do JSON aqui (o corpo gRPC inclui o frame de 5 bytes da mensagem). O JSON repete o nome de cada campo em cada objeto, enquanto o protobuf escreve um número de campo; o guia do proto3 diz que os números de 1 a 15 ocupam um byte, então reserve-os para os campos mais frequentes.

### JSON transcoding

Adicione `Microsoft.AspNetCore.Grpc.JsonTranscoding`, troque o registro para `AddGrpc().AddJsonTranscoding()`, defina `<IncludeHttpRuleProtos>true</IncludeHttpRuleProtos>` no projeto e anote os métodos:

```protobuf
import "google/api/annotations.proto";
rpc SayHello (HelloRequest) returns (HelloReply) { option (google.api.http) = { get: "/v1/greeter/{name}" }; }
rpc Countdown (CountRequest) returns (stream Tick) { option (google.api.http) = { get: "/v1/countdown/{from}" }; }
rpc Sum (stream Number) returns (Total) { option (google.api.http) = { post: "/v1/sum" body: "*" }; }
```

```text
GET /v1/greeter/world (HTTP/1.1)  -> 200 application/json; charset=utf-8  {"message":"Hello world"}
GET /v1/countdown/3 (curl -N, arrival time in s):
  554.0 {"value":3}
  554.4 {"value":2}
  554.9 {"value":1}
POST /v1/sum -> 404 Not Found
startup: warn: Unable to bind Sum on lab.v1.Greeter to gRPC JSON transcoding. Client and bidirectional streaming methods are not supported.
GET /v1/greeter/world on the Http2-only endpoint with HTTP/1.1 -> 400 An HTTP/1.x request was sent to an HTTP/2 only endpoint.
```

O server streaming funciona como a documentação descreve: um objeto JSON por linha, enviado à medida que cada mensagem é escrita (chunked, com cerca de 0,5 s de intervalo). Um método de client streaming anotado gerou só um aviso na inicialização e um 404, sem erro de build nem de inicialização. O transcoding roda sobre HTTP/1.1, então precisa de um endpoint que aceite esse protocolo (`Http1AndHttp2` com TLS, ou uma porta `Http1` separada). Os status gRPC viram status HTTP, e o corpo é um `google.rpc.Status` em JSON:

```text
/v1/fail/rpc   -> 400 {"code":3,"message":"Name is required.","details":[]}
/v1/fail/plain -> 500 {"code":2,"message":"Exception was thrown by handler.","details":[]}
/v1/fail/rich  -> 500, empty body; log: InvalidOperationException: Type registry has no descriptor for type name 'google.rpc.BadRequest'.
  with o.TypeRegistry = TypeRegistry.FromMessages(BadRequest.Descriptor):
               -> 400 {"code":3,"message":"Bad request","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[...]}]}
```

O erro rico quebrou o transcoding até eu registrar o tipo do detalhe em `AddJsonTranscoding(o => o.TypeRegistry = ...)`. O interceptor de servidor registrou essas requisições como `via HTTP/1.1` com content type vazio, então interceptors de log, autenticação e validação valem para as duas portas de entrada.

### OpenAPI, gRPC-Web e balanceamento de carga

O `Microsoft.AspNetCore.Grpc.Swagger` funcionou de primeira: `AddGrpcSwagger()` mais `AddSwaggerGen()` e `UseSwagger()` produziram `/swagger/v1/swagger.json` com `/v1/greeter/{name}`, `/v1/countdown/{from}`, `/v1/fail/{kind}` e `/v1/catalog/{count}`; o `/v1/sum`, que não foi vinculado, ficou de fora. Ainda é um pacote 0.x construído sobre o Swashbuckle. gRPC-Web (só documentação): a documentação explica que os navegadores não suportam HTTP/2 por completo do jeito que o gRPC precisa, então o `Grpc.AspNetCore.Web` adiciona `app.UseGrpcWeb()` e `.EnableGrpcWeb()` no serviço, e o navegador usa um cliente gRPC-Web com protobuf. A documentação diz que clientes gRPC-Web no navegador não conseguem chamar métodos de client streaming nem bidirecionais, e chamadas cross-origin precisam de CORS expondo os headers do gRPC. Balanceamento de carga (só documentação): um channel multiplexa todas as chamadas numa única conexão HTTP/2 de longa duração (como medido acima), e a documentação explica a consequência: um balanceador L4 distribui conexões TCP, então todas as chamadas daquela conexão vão para um único endpoint, e o Kubernetes usa esse tipo de balanceador de rede por padrão. A documentação oferece duas saídas: um proxy L7 que entende HTTP/2 (Envoy, Linkerd e parecidos), ou balanceamento no cliente com o `Grpc.Net.Client`, usando um endereço `dns:///` que resolve um headless service do Kubernetes e a política `round_robin`, o que, como a documentação reforça, só funciona quando o channel é reutilizado.

## Trade-offs

- **gRPC é para clientes que você controla.** Ele precisa de HTTP/2 de ponta a ponta e de código gerado; navegadores precisam de gRPC-Web, e tudo que estiver no meio precisa deixar o HTTP/2 passar. Uma aba de navegador não consegue chamá-lo, e com o curl eu tive que montar o frame binário na mão.
- **HTTP/2 em cleartext precisa de um endpoint próprio.** `Http1AndHttp2` sem TLS é HTTP/1.1 e faz toda chamada gRPC falhar com `HTTP_1_1_REQUIRED`; use `Http2` para h2c em desenvolvimento ou TLS (ALPN) em produção.
- **Reutilize channels.** Um channel por chamada abriu 300 conexões para 300 chamadas e ficou cerca de 4 vezes mais lento em loopback; a documentação acrescenta que o balanceamento no cliente exige um channel reutilizado.
- **Sempre defina um deadline, e respeite o token.** Não existe padrão; um handler que ignora `context.CancellationToken` continua rodando depois que o cliente desistiu.
- **Exceções inesperadas escondem a mensagem.** Elas chegam como `Unknown`; lance `RpcException` (ou um `Google.Rpc.Status` rico) para erros com que quem chamou deve lidar (`throw new RpcException(new Status(StatusCode.NotFound, "Order 42 not found"))`), e nunca ative erros detalhados em produção.
- **O contrato são números, não nomes.** Adicione campos à vontade, reserve os números removidos, nunca os reutilize.
- **Como escolher:** gRPC para chamadas internas, streaming e contratos entre linguagens diferentes; REST (minimal APIs) para APIs públicas e voltadas ao navegador, cache via semântica HTTP e o ferramental mais amplo; transcoding quando uma implementação precisa servir os dois, aceitando só unário e server streaming na superfície JSON e a configuração do `TypeRegistry` para erros ricos.

## Documentation Links

- [Overview for gRPC on .NET, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/?view=aspnetcore-10.0) (doc)
- [Call gRPC services with the .NET client, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/client?view=aspnetcore-10.0) (doc)
- [gRPC JSON transcoding in ASP.NET Core gRPC apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/json-transcoding?view=aspnetcore-10.0) (doc)
- [Reliable gRPC services with deadlines and cancellation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/deadlines-cancellation?view=aspnetcore-10.0) (doc)
- [Error handling with gRPC on .NET, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/error-handling?view=aspnetcore-10.0) (doc)
- [Language Guide (proto 3), Protocol Buffers Documentation](https://protobuf.dev/programming-guides/proto3/) (doc)
