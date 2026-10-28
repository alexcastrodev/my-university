---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

gRPC is a remote procedure call framework where the contract is a `.proto` file, messages travel as Protocol Buffers (a compact binary format) and every call is an HTTP/2 request. In ASP.NET Core a service is a class that overrides methods of a generated base class, and a client is a generated class on top of a `GrpcChannel`. It shines between services you own: a strict contract shared by both sides, smaller payloads than JSON, and streaming in both directions on one connection. It also brings its own rules: HTTP/2 only, a different error model (status codes in trailers instead of HTTP statuses), deadlines that the server must honor, and field numbers that can never be reused. JSON transcoding exposes the same service as a JSON API for clients that cannot speak gRPC. This concept builds one service with all four call types, calls it from a .NET client and from curl, and reports the protocol errors, timings, sizes and status codes observed. Versions used: SDK 10.0.100, runtime `Microsoft.AspNetCore.App` 10.0.0, `Grpc.AspNetCore` 2.84.0 (with `Grpc.Tools` 2.84.0 and `Google.Protobuf` 3.35.1), `Grpc.Net.Client` 2.84.0, `Grpc.StatusProto` 2.84.0, `Microsoft.AspNetCore.Grpc.JsonTranscoding` 10.0.14 and `Microsoft.AspNetCore.Grpc.Swagger` 0.10.11 (a 0.x package, with Swashbuckle 6.6.2).

## Use Cases

- Internal service-to-service calls where both sides are yours and can share the `.proto` contract.
- Streaming: a server pushing progress or events, a client uploading many records, or a two-way conversation on one call.
- Latency- or bandwidth-sensitive traffic where a binary payload and one multiplexed connection matter.
- One gRPC implementation that also serves a JSON API (transcoding) to browsers and partners that cannot use gRPC.

## Deep Dive

### The contract and the generated code

The `.proto` file declares messages with numbered fields and a service with methods. `Grpc.Tools` (pulled in by `Grpc.AspNetCore`) runs `protoc` during the build for each `<Protobuf Include="Protos\greet.proto" GrpcServices="Both" />` item; `GrpcServices` picks what to generate: `Server`, `Client`, `Both` or `None` (messages only).

```protobuf
syntax = "proto3";
package lab.v1;
service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc Countdown (CountRequest) returns (stream Tick);   // server streaming
  rpc Sum (stream Number) returns (Total);               // client streaming
  rpc Echo (stream Chat) returns (stream Chat);          // bidirectional
}
message HelloRequest { string name = 1; }   message HelloReply { string message = 1; }
```

The build wrote `obj/Debug/net10.0/Protos/GreetGrpc.cs`. Every method of the generated base class is virtual and throws:

```csharp
public abstract partial class GreeterBase {
  public virtual Task<HelloReply> SayHello(HelloRequest request, ServerCallContext context)
    { throw new RpcException(new Status(StatusCode.Unimplemented, "")); }
```

The service overrides what it implements and is registered with `AddGrpc()` and `MapGrpcService<GreeterService>()`. A method declared in the proto but not overridden still exists on the wire: calling it returned `Unimplemented detail=''`. The URL of a call is `/{package}.{Service}/{Method}`, here `/lab.v1.Greeter/SayHello`.

### HTTP/2 is required: h2c, HTTP/1.1 and TLS

I opened four Kestrel endpoints and called `SayHello` on each with `GrpcChannel.ForAddress`:

```csharp
k.ListenLocalhost(5721, o => o.Protocols = HttpProtocols.Http2);          // h2c
k.ListenLocalhost(5722, o => o.Protocols = HttpProtocols.Http1);
k.ListenLocalhost(5723, o => o.Protocols = HttpProtocols.Http1AndHttp2);  // no TLS
k.ListenLocalhost(5725, o => { o.Protocols = HttpProtocols.Http1AndHttp2; o.UseHttps(cert); });
```

```text
http://localhost:5721 OK Hello world
http://localhost:5722 Internal detail='Error starting gRPC call. HttpRequestException: The HTTP/2 server closed the connection. HTTP/2 error code 'HTTP_1_1_REQUIRED' (0xd). (HttpProtocolError) ...'
http://localhost:5723 Internal (same HTTP_1_1_REQUIRED error)
https://localhost:5725 (Http1AndHttp2 + TLS) OK Hello tls, server saw HTTP/2
```

With an `http://` address the .NET client speaks HTTP/2 directly (cleartext "prior knowledge", h2c), so the server endpoint must be `Http2` only. `Http1AndHttp2` without TLS silently becomes HTTP/1.1; Kestrel logged it at startup: `HTTP/2 is not enabled for 127.0.0.1:5723. The endpoint is configured to use HTTP/1.1 and HTTP/2, but TLS is not enabled. HTTP/2 requires TLS application protocol negotiation.` With TLS, ALPN negotiated HTTP/2 on macOS without any extra setup (the docs say macOS needed workarounds only before .NET 8). From the other side, a gRPC request sent with `curl --http1.1` was refused by the gRPC middleware itself: `HTTP/1.1 426 Upgrade Required` with `Upgrade: HTTP/2`, `Grpc-Status: 13` and `Grpc-Message: Request protocol 'HTTP/1.1' is not supported.`

### Channels: create once, reuse everywhere

A `GrpcChannel` owns the HTTP/2 connection. I made 300 sequential unary calls on localhost, once with a new channel per call and once on one shared channel, counting distinct `Connection.Id` values on the server:

```text
round 0: new channel each: 142 ms (0.47 ms/call, 300 TCP connections); reused: 33 ms (0.11 ms/call, 1 connections)
round 1: new channel each: 127 ms (0.42 ms/call, 300 TCP connections); reused: 32 ms (0.11 ms/call, 1 connections)
250 concurrent 500 ms calls on one channel: 509 ms, 3 TCP connection(s)
```

A channel per call was about 4 times slower even on loopback, where a connection costs almost nothing; over a real network each new channel adds TCP and TLS handshakes. The last line matches the docs: an HTTP/2 connection usually allows 100 concurrent streams, and `GrpcChannel` opens extra connections when that limit is reached instead of queuing. The docs say channels and clients are thread-safe, so create them once (or register them with `AddGrpcClient<T>` from `Grpc.Net.ClientFactory`), as with `HttpClient`.

### The four call types

```csharp
using var down = client.Countdown(new CountRequest { From = 3 });
await foreach (var tick in down.ResponseStream.ReadAllAsync()) { /* print */ }
using var sum = client.Sum();
for (var i = 1; i <= 1000; i++) await sum.RequestStream.WriteAsync(new Number { Value = i });
await sum.RequestStream.CompleteAsync();
var total = await sum;
using var echo = client.Echo();   // a reader task prints responses while the loop writes a, b, c every 200 ms
```

The server writes with `IServerStreamWriter<T>.WriteAsync` (500 ms apart in `Countdown`) and reads with `IAsyncStreamReader<T>`:

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

Each tick arrived when it was written, not at the end, and the bidirectional replies interleaved with the requests on the same call. The unary call earlier took about 0.1 ms on a warm channel.

### Deadlines and cancellation

The docs say there is no default deadline: a call without one can run forever. The deadline is an absolute UTC time that travels with the call, and the server sees it as `context.Deadline`. My `Slow` method waits 2000 ms, passing `context.CancellationToken` or ignoring it:

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

The client gives up on time either way, but a handler that ignores the token keeps working for the full 2 seconds, as the docs warn. Pass `context.CancellationToken` to every database and HTTP call, and propagate `context.Deadline` to downstream gRPC calls (the client factory's `EnableCallContextPropagation()` does it automatically, per the docs).

### Errors: status codes, Unknown and EnableDetailedErrors

A gRPC call ends with a status code (`OK`, `InvalidArgument`, `NotFound`, `DeadlineExceeded`, `Unavailable`, `Internal`...) and a detail string, sent in trailers; the client sees a failure as `RpcException`. My `Fail` method throws three ways: an `RpcException`, a plain `InvalidOperationException` and a rich error built with `Grpc.StatusProto` (`Google.Rpc.Status` with a `BadRequest` detail, then `.ToRpcException()`). Same calls against a server with `EnableDetailedErrors = false` (the default) and `true`:

```text
detailed=false kind=rpc:   InvalidArgument detail='Name is required.'
detailed=false kind=plain: Unknown detail='Exception was thrown by handler.'
detailed=false kind=rich:  InvalidArgument detail='Bad request'
         BadRequest field=name description='Value is null or empty' trailer keys: date,server,grpc-status-details-bin
detailed=true  kind=plain: Unknown detail='Exception was thrown by handler. InvalidOperationException: Connection string 'Server=db;Password=hunter2' failed'
```

Any exception that is not an `RpcException` becomes `Unknown` with a generic message. `EnableDetailedErrors` sends the exception type and message to the caller, here a password, so keep it for development. The rich error travels in the `grpc-status-details-bin` trailer and the client reads it with `ex.GetRpcStatus()?.GetDetail<BadRequest>()`.

### Metadata: headers and trailers

Metadata is gRPC's name for HTTP headers. I sent two entries and had the server write a response header and a trailer:

```csharp
var call = client.SayHelloAsync(req, new Metadata { { "X-Tenant", "acme" }, { "trace-bin", new byte[] { 1, 2, 3 } } });
// server: read context.RequestHeaders; await context.WriteResponseHeadersAsync(...x-served-by...); context.ResponseTrailers.Add("x-cost-ms", "3");
```

```text
server saw request headers: x-tenant=acme, trace-bin=[1,2,3]
response headers: date=Wed, 28 Oct 2026 16:21:45 GMT, server=Kestrel, x-served-by=node-1
trailers: x-cost-ms=3 status=OK
```

Keys are lowercased, and keys ending in `-bin` carry bytes instead of text. Trailers are read with `call.GetTrailers()` after the response, which is where values computed at the end of a call (cost, final status) belong.

### Interceptors

An interceptor is the gRPC equivalent of middleware, typed per call kind. Server side, registered with `AddGrpc(o => o.Interceptors.Add<ServerLogInterceptor>())`; client side, wrapped around the channel with `channel.Intercept(new ClientLogInterceptor())`:

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

A unary interceptor only covers unary calls; streaming calls go through `ServerStreamingServerHandler`, `ClientStreamingServerHandler` and `DuplexStreamingServerHandler` (and their client counterparts). Server interceptors also ran for transcoded JSON requests (shown below).

### Contract evolution

The proto3 guide says field numbers identify fields on the wire and must never be reused; a removed field's number (and name) goes in `reserved`. My v2 `User` removed `email = 3`, reserved it and added `phone = 4` and `roles = 5`. The old client was compiled from v1 (`id = 1, name = 2, email = 3`):

```text
v2 bytes=38; old client reads: id=7 name=Ana email=''
old client re-serializes, v2 reads back: phone='+55 11 99999-0000' roles=2 (unknown fields kept)
old client over gRPC (v1 marshaller on /lab.v1.Greeter/GetUser): id=7 name=Ana email=''
field 3 reused for phone, old client reads email='+55 11 99999-0000'
adding 'string nickname = 3;' to v2: error : Field "nickname" uses reserved number 3.
```

Adding fields is safe: old readers skip unknown numbers and even keep them when they re-serialize. Reusing a number is silent corruption (the phone number landed in `email`), and `reserved` turns that mistake into a build error.

### Bytes on the wire: protobuf vs JSON

The same `GetCatalog` method (products with id, name, price, in-stock flag and two tags) served three ways, response body bytes measured with curl's `size_download`, no compression on either side:

```text
1 product:    gRPC 47   transcoded JSON 98    minimal API JSON 85
100 products: gRPC 4231 transcoded JSON 8531  minimal API JSON 8518
```

Protobuf was about half the size of JSON here (the gRPC body includes the 5-byte message frame). JSON repeats every field name in every object, while protobuf writes a field number; the proto3 guide says numbers 1 to 15 take one byte, so keep them for the frequent fields.

### JSON transcoding

Add `Microsoft.AspNetCore.Grpc.JsonTranscoding`, change the registration to `AddGrpc().AddJsonTranscoding()`, set `<IncludeHttpRuleProtos>true</IncludeHttpRuleProtos>` in the project and annotate methods:

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

Server streaming works as the docs describe: one JSON object per line, flushed as each message is written (chunked, about 0.5 s apart). An annotated client streaming method produced only a startup warning and a 404, not a build or startup error. Transcoding runs over HTTP/1.1, so it needs an endpoint that accepts it (`Http1AndHttp2` with TLS, or a separate `Http1` port). gRPC statuses map to HTTP statuses, and the body is a JSON `google.rpc.Status`:

```text
/v1/fail/rpc   -> 400 {"code":3,"message":"Name is required.","details":[]}
/v1/fail/plain -> 500 {"code":2,"message":"Exception was thrown by handler.","details":[]}
/v1/fail/rich  -> 500, empty body; log: InvalidOperationException: Type registry has no descriptor for type name 'google.rpc.BadRequest'.
  with o.TypeRegistry = TypeRegistry.FromMessages(BadRequest.Descriptor):
               -> 400 {"code":3,"message":"Bad request","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[...]}]}
```

The rich error broke transcoding until I registered its detail type in `AddJsonTranscoding(o => o.TypeRegistry = ...)`. The server interceptor logged these requests as `via HTTP/1.1` with an empty content type, so logging, auth and validation interceptors apply to both front doors.

### OpenAPI, gRPC-Web and load balancing

`Microsoft.AspNetCore.Grpc.Swagger` worked at first try: `AddGrpcSwagger()` plus `AddSwaggerGen()` and `UseSwagger()` produced `/swagger/v1/swagger.json` with `/v1/greeter/{name}`, `/v1/countdown/{from}`, `/v1/fail/{kind}` and `/v1/catalog/{count}`; the unbound `/v1/sum` was absent. It is still a 0.x package built on Swashbuckle. gRPC-Web (docs only): the docs explain that browsers do not fully support HTTP/2 the way gRPC needs it, so `Grpc.AspNetCore.Web` adds `app.UseGrpcWeb()` and `.EnableGrpcWeb()` on the service and the browser uses a gRPC-Web client with protobuf. The docs say gRPC-Web browser clients cannot call client streaming or bidirectional methods, and cross-origin calls need CORS exposing the gRPC headers. Load balancing (docs only): one channel multiplexes every call on one long-lived HTTP/2 connection (as measured above), and the docs explain the consequence: an L4 balancer distributes TCP connections, so all calls on that connection go to one endpoint, and Kubernetes uses that kind of network balancer by default. The docs offer two fixes: an L7 proxy that understands HTTP/2 (Envoy, Linkerd and similar), or client-side load balancing in `Grpc.Net.Client`, with a `dns:///` address resolving a Kubernetes headless service and a `round_robin` policy, which, the docs stress, only works when the channel is reused.

## Trade-offs

- **gRPC is for clients you control.** It needs HTTP/2 end to end and generated code; browsers need gRPC-Web, and everything in between must pass HTTP/2 through. A browser tab cannot call it, and with curl I had to build the binary frame by hand.
- **Cleartext HTTP/2 needs its own endpoint.** `Http1AndHttp2` without TLS is HTTP/1.1 and fails every gRPC call with `HTTP_1_1_REQUIRED`; use `Http2` for h2c in dev or TLS (ALPN) in production.
- **Reuse channels.** A channel per call opened 300 connections for 300 calls and ran about 4 times slower on loopback; the docs add that client-side load balancing needs a reused channel.
- **Always set a deadline, and honor the token.** There is no default; a handler that ignores `context.CancellationToken` keeps running after the client gave up.
- **Unexpected exceptions hide their message.** They arrive as `Unknown`; throw `RpcException` (or a rich `Google.Rpc.Status`) for errors the caller should act on (`throw new RpcException(new Status(StatusCode.NotFound, "Order 42 not found"))`), and never enable detailed errors in production.
- **The contract is numbers, not names.** Add fields freely, reserve removed numbers, never reuse them.
- **Choosing:** gRPC for internal calls, streaming and polyglot contracts; REST (minimal APIs) for public and browser-facing APIs, caching through HTTP semantics and the widest tooling; transcoding when one implementation must serve both, accepting unary and server streaming only in the JSON surface and the `TypeRegistry` setup for rich errors.

## Documentation Links

- [Overview for gRPC on .NET, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/?view=aspnetcore-10.0) (doc)
- [Call gRPC services with the .NET client, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/client?view=aspnetcore-10.0) (doc)
- [gRPC JSON transcoding in ASP.NET Core gRPC apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/json-transcoding?view=aspnetcore-10.0) (doc)
- [Reliable gRPC services with deadlines and cancellation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/deadlines-cancellation?view=aspnetcore-10.0) (doc)
- [Error handling with gRPC on .NET, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/grpc/error-handling?view=aspnetcore-10.0) (doc)
- [Language Guide (proto 3), Protocol Buffers Documentation](https://protobuf.dev/programming-guides/proto3/) (doc)
