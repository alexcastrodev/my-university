---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

The JDK ships an HTTP server. Not a socket library you build one from — an actual server, in the `jdk.httpserver` module, exported as `com.sun.net.httpserver` and officially supported since Java 6: you call `HttpServer.create(...)`, register a handler per URL path, `start()`, and you have an HTTP endpoint with no dependency on Tomcat, Jetty, Netty, or Spring. `HttpsServer` is the same API with an `SSLContext` attached for TLS. The module's own documentation is explicit that the bundled implementation is aimed at "local testing, development, and debugging" and "does not intend to be a full-featured, high performance HTTP server" — so the point of knowing it is not to replace your framework, it's to have a zero-dependency HTTP endpoint whenever you need one, and to see the request/response cycle at its smallest: one `HttpExchange` object carrying both directions.

## Use Cases

- Standing up a fake upstream in an integration test — a real HTTP server on a real port returning canned responses, instead of mocking the HTTP client.
- A health/metrics/admin endpoint bolted onto a process that isn't a web application (a batch job, a desktop app, a message consumer) without pulling a web framework into it.
- Reproducing a client-side bug that depends on server behavior you can't get from a real server: a wrong `Content-Length`, a slow response, a 500 on the third call.
- Serving a directory of static files during development, via `jwebserver` from the command line or `SimpleFileServer` from code, instead of installing nginx.
- Learning or teaching HTTP: `HttpExchange` exposes the method, URI, headers, and body streams directly, with nothing between you and the protocol.

## Deep Dive

### Create, register a context, start

```java
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

HttpServer server = HttpServer.create(new InetSocketAddress(8931), 0);  // 0 backlog = system default

server.createContext("/hello", exchange -> {
    byte[] body = "Hello from the JDK\n".getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
    exchange.sendResponseHeaders(200, body.length);
    try (var out = exchange.getResponseBody()) {
        out.write(body);
    }
});

server.start();          // returns immediately — the server runs on a background thread
// ... later
server.stop(0);          // stop accepting, wait up to N seconds for in-flight handlers, then close
```

Three moving parts. `HttpServer.create(addr, backlog)` binds the listening socket (backlog is the TCP accept queue depth; `<= 0` means "use the system default"). `createContext(path, handler)` maps a URI path *prefix* to an `HttpHandler` — a functional interface, so a lambda works. `start()` spawns a background thread and returns, which means a `main` that starts a server and falls off the end keeps running; `stop(delay)` is the counterpart, and a stopped server cannot be restarted.

Path matching is longest-prefix, not exact — `/hello` also handles `/hello/world` unless a more specific context claims it:

```java
server.createContext("/",       rootHandler);      // catch-all
server.createContext("/api",    apiHandler);       // wins for /api and /api/anything
server.createContext("/api/v2", v2Handler);        // wins for /api/v2/... — longest prefix
```

### `HttpExchange`: one object for both directions

```java
server.createContext("/echo", exchange -> {
    String method = exchange.getRequestMethod();          // "GET", "POST", ...
    java.net.URI uri = exchange.getRequestURI();          // "/echo?name=ana" — path + query, no host
    String accept = exchange.getRequestHeaders().getFirst("Accept");
    byte[] requestBody = exchange.getRequestBody().readAllBytes();   // an InputStream

    exchange.getResponseHeaders().add("X-Method", method);
    exchange.sendResponseHeaders(200, requestBody.length);           // status + body length
    try (var out = exchange.getResponseBody()) {                     // an OutputStream
        out.write(requestBody);
    }
});
```

There is no `HttpServletRequest`/`HttpServletResponse` pair here — a single `HttpExchange` carries the request (immutable `Headers`, an `InputStream`) and the response (mutable `Headers`, an `OutputStream`). The ordering rule is strict and easy to get wrong: response headers must be set **before** `sendResponseHeaders(...)`, and `getResponseBody()` is only usable **after** it.

The second argument to `sendResponseHeaders` is where the raw protocol shows through, with three distinct meanings:

```java
exchange.sendResponseHeaders(200, body.length);  // > 0: exactly this many bytes must be written
exchange.sendResponseHeaders(200, 0);            //   0: chunked transfer encoding, write any amount
exchange.sendResponseHeaders(204, -1);           //  -1: no response body at all
```

Use `-1` for `204 No Content`, a `304`, or an error status with an empty body. Use `0` when you're streaming and don't know the length up front — the server switches to `Transfer-Encoding: chunked` and closing the stream terminates the body.

### A minimal REST-style handler

Nothing routes by HTTP method for you, so a REST-ish resource is a `switch` over `getRequestMethod()` inside one context:

```java
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

class ProductsHandler implements com.sun.net.httpserver.HttpHandler {
    private final Map<String, String> store = new ConcurrentHashMap<>();

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try (exchange) {                                   // HttpExchange is AutoCloseable
            String id = exchange.getRequestURI().getPath()
                                .replaceFirst("^/products/?", "");   // "" or "42"
            switch (exchange.getRequestMethod()) {
                case "GET" -> {
                    String found = store.get(id);
                    if (found == null) {
                        exchange.sendResponseHeaders(404, -1);
                    } else {
                        respond(exchange, 200, found);
                    }
                }
                case "PUT" -> {
                    String body = new String(exchange.getRequestBody().readAllBytes(),
                                             StandardCharsets.UTF_8);
                    boolean created = store.put(id, body) == null;
                    exchange.sendResponseHeaders(created ? 201 : 204, -1);
                }
                case "DELETE" -> exchange.sendResponseHeaders(store.remove(id) == null ? 404 : 204, -1);
                default -> {
                    exchange.getResponseHeaders().set("Allow", "GET, PUT, DELETE");
                    exchange.sendResponseHeaders(405, -1);   // Method Not Allowed
                }
            }
        }
    }

    private static void respond(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
```

Two details worth copying. `try (exchange)` works because `HttpExchange` implements `AutoCloseable`, and closing it releases the connection — a handler that returns without closing (or without writing the exact promised byte count) leaves the client waiting. And an unhandled method has to be answered explicitly with `405` plus an `Allow` header; there is no framework default doing that for you.

### The executor: why the default server handles one request at a time

```java
HttpServer server = HttpServer.create(new InetSocketAddress(8951), 0);
// no setExecutor(...) call — every exchange runs on the single start() thread
```

If `setExecutor` is never called (or is called with `null`), *all* exchanges are handled on the one background thread `start()` created. Three concurrent requests to a handler that sleeps 500 ms take about 1.5 seconds, because they run one after another. Handing the server an executor fixes it:

```java
import java.util.concurrent.Executors;

HttpServer server = HttpServer.create(new InetSocketAddress(8952), 0);
server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());   // must be before start()
server.start();
```

Measured against the same 500 ms handler, three concurrent requests now finish in ~505 ms instead of ~1553 ms. A virtual-thread-per-task executor is the natural choice here — handler code is blocking I/O, which is exactly what virtual threads are for (see `thread-model-legacy-vs-virtual-threads`). `setExecutor` throws `IllegalStateException` if the server has already started, so it belongs immediately after `create`.

### Prebuilt handlers and request-adapting filters (JDK 18+)

JDK 18 added helpers so trivial handlers don't need a lambda body at all:

```java
import com.sun.net.httpserver.Filter;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpHandlers;
import java.util.List;

// canned response — status, headers, body, fixed
HttpHandler teapot = HttpHandlers.of(418, Headers.of("Content-Type", "text/plain"), "teapot\n");

// route by any predicate over the request, with a fallback
HttpHandler routed = HttpHandlers.handleOrElse(
        request -> request.getRequestMethod().equals("PUT"),
        putHandler,
        getHandler);

// pre-processing filter that rewrites the request before the handler sees it
Filter addHeader = Filter.adaptRequest("tag request",
        request -> request.with("X-Source", List.of("internal")));

HttpServer server = HttpServer.create(new InetSocketAddress(8080), 10, "/api", routed, addHeader);
server.createContext("/teapot", teapot);
```

`HttpHandlers.of(...)` really does return the given status verbatim — a `GET /teapot` against the server above answers `418 text/plain teapot`. The `Request` interface those helpers take is deliberately smaller than `HttpExchange`: method, URI, headers, and a `with(name, values)` copy method, with no body streams, because a filter or a router has no business consuming the body. Note the five-argument `HttpServer.create(addr, backlog, path, handler, filters...)` overload — also JDK 18 — which creates the server and its first context in one call.

### `SimpleFileServer` and `jwebserver`: static files with no code

```java
import com.sun.net.httpserver.SimpleFileServer;
import com.sun.net.httpserver.SimpleFileServer.OutputLevel;
import java.nio.file.Path;

var server = SimpleFileServer.createFileServer(
        new InetSocketAddress(8000),
        Path.of("/srv/site"),          // must be an absolute path
        OutputLevel.INFO);             // NONE | INFO | VERBOSE request logging
server.start();
```

Same thing from the shell, with no Java file at all:

```
$ jwebserver -p 8000 -d /srv/site
Binding to loopback by default. For all interfaces use "-b 0.0.0.0" or "-b ::".
Serving /srv/site and subdirectories on 127.0.0.1 port 8000
URL http://127.0.0.1:8000/
127.0.0.1 - - [19/Aug/2026:13:34:11 +0000] "GET /index.html HTTP/1.1" 200 -
```

Both come from JEP 408 (JDK 18). The defaults are deliberately conservative: port 8000, bound to **loopback only**, `GET` and `HEAD` only (anything else gets `501` or `405`), HTTP/1.1 with no HTTPS, MIME types inferred from the file extension, symbolic links and hidden files neither listed nor served. The pieces are also reusable individually — `SimpleFileServer.createFileHandler(root)` gives you just the static-file handler to mount under any path on your own server, and `createOutputFilter(out, level)` gives you just the access log.

### TLS: `HttpsServer` plus an `SSLContext`

```java
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.KeyStore;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

KeyStore keyStore = KeyStore.getInstance("PKCS12");
try (InputStream in = new FileInputStream("ks.p12")) {
    keyStore.load(in, "secret".toCharArray());
}
KeyManagerFactory kmf = KeyManagerFactory.getInstance("PKIX");
kmf.init(keyStore, "secret".toCharArray());

SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(kmf.getKeyManagers(), null, null);   // key managers, trust managers, RNG

HttpsServer server = HttpsServer.create(new InetSocketAddress(8443), 0);
server.setHttpsConfigurator(new HttpsConfigurator(sslContext));   // required
server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
server.createContext("/secure", exchange -> {
    byte[] body = "over TLS\n".getBytes(StandardCharsets.UTF_8);
    exchange.sendResponseHeaders(200, body.length);
    try (var out = exchange.getResponseBody()) { out.write(body); }
});
server.start();
```

`HttpsServer` is a subclass of `HttpServer`, so contexts, handlers, and executors work identically — the only addition is `setHttpsConfigurator(new HttpsConfigurator(sslContext))`, and the whole TLS story lives in the `SSLContext` you hand it, not in the server API. That `SSLContext` needs a server certificate and private key, which is what the keystore holds; a self-signed one from `keytool` is fine for local work:

```
$ keytool -genkeypair -alias demo -keyalg RSA -keysize 2048 -validity 365 \
      -dname "CN=localhost" -keystore ks.p12 -storetype PKCS12 -storepass secret -keypass secret
```

Forget the configurator and the server starts happily, then fails per connection at handshake time rather than at startup:

```
WARNING: sun.net.httpserver.ServerImpl$Exchange run: SSL connection received. No https context created
```
```
javax.net.ssl.SSLHandshakeException: Remote host terminated the handshake
```

You can also subclass `HttpsConfigurator` and override `configure(HttpsParameters)` to pin protocols/cipher suites or require client certificates, instead of accepting the `SSLContext` defaults.

## Trade-offs

- **Officially supported API, explicitly non-production implementation — two different claims, and it's worth keeping them apart.** The `com.sun.net.httpserver` package is documented and supported (JEP 408 states it plainly: "The package is officially supported"), so the `com.sun` prefix is not the usual "internal, don't touch" signal here. What is *not* production-grade is the bundled implementation, per the `jdk.httpserver` docs: intended for "local testing, development, and debugging", and it "does not intend to be a full-featured, high performance HTTP server". It is JDK-specific rather than Java SE, so it is absent from a `jlink`ed runtime that doesn't include `jdk.httpserver`, and from non-JDK-derived runtimes.
- **HTTP/1.1 only.** No HTTP/2, no WebSocket upgrade, no multiplexing — a client that prefers HTTP/2 negotiates down. Reproducing anything HTTP/2-specific needs a real server.
```java
var resp = HttpClient.newHttpClient().send(request, BodyHandlers.ofString());
System.out.println(resp.version());   // HTTP_1_1, even against HttpsServer with ALPN-capable clients
```
- **The default executor makes a concurrent server look like a slow one.** Forgetting `setExecutor` doesn't fail, it silently serializes every request onto the `start()` thread — a symptom that only shows under concurrent load, which is exactly when a test suite starts flaking.
```java
// 3 concurrent requests, handler sleeps 500ms:
// no setExecutor(...)                        -> ~1553 ms  (serialized)
// setExecutor(newVirtualThreadPerTaskExecutor()) -> ~505 ms  (concurrent)
```
- **No routing, no serialization, no validation, no content negotiation.** Everything a framework gives you — path variables, `@PathParam`, JSON binding, `Accept` handling, error mapping — is hand-written string work here, which is fine for three endpoints and miserable for thirty. Jakarta EE/JAX-RS (RESTEasy, Jersey) and Spring Boot, Quarkus, Helidon, and Micronaut exist for the thirty-endpoint case; several of them ship their own embedded HTTP server, so "no external server process" is not a reason to prefer the JDK one.
- **The exchange contract is unforgiving about byte counts and closing.** Promise `n` bytes with `sendResponseHeaders(200, n)` and write fewer, and the client blocks waiting for the rest; return from a handler without closing the exchange and the connection leaks. Frameworks paper over both.
```java
byte[] body = "12345".getBytes();
exchange.sendResponseHeaders(200, 10);   // claims 10 bytes...
exchange.getResponseBody().write(body);  // ...sends 5 — client hangs on the missing 5
```
- **`SimpleFileServer` binds to loopback and serves `GET`/`HEAD` only, by design.** That is a feature for a dev server and a hard stop for anything else: no HTTPS, no auth, no access control, no uploads. Exposing it with `-b 0.0.0.0` publishes a directory tree to the network with no authentication whatsoever.

## Documentation Links

- [jdk.httpserver module — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/module-summary.html) — doc
- [HttpServer — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpServer.html) — doc
- [HttpExchange — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpExchange.html) — doc
- [HttpsConfigurator — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpsConfigurator.html) — doc
- [SimpleFileServer — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/SimpleFileServer.html) — doc
- [HttpHandlers — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpHandlers.html) — doc
- [jwebserver — JDK 25 tool reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jwebserver.html) — doc
- [JEP 408: Simple Web Server](https://openjdk.org/jeps/408) — doc
