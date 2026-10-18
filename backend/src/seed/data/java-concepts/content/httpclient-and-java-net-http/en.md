---
version: 1.0
updatedAt: 2026-08-02
---
## Objective

`HttpClient` (in `java.net.http`, since Java 11) replaced the old `HttpURLConnection` with a builder-based API purpose-built for HTTP: a request and its configuration are assembled with fluent builders instead of mutating a connection object property-by-property, the client speaks HTTP/2 by default, and every request can be sent either synchronously (`send()`, blocking) or asynchronously (`sendAsync()`, returning a `CompletableFuture`).

## Use Cases

- Calling a REST API and getting the response body back as a `String`, without manually wiring up an `InputStreamReader` over the connection's input stream.
- Firing off several independent HTTP calls concurrently and composing their results with `CompletableFuture`, instead of blocking one thread per call.
- Downloading a file straight to disk by handing the response body a target `Path`, without streaming bytes through application code by hand.
- Configuring one client (timeouts, redirect policy, proxy) once and reusing it for every request in an application, since `HttpClient` instances are immutable and thread-safe.

## Deep Dive

### Building a client

```java
HttpClient client = HttpClient.newHttpClient();   // default settings
```

```java
HttpClient client = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_1_1)
    .followRedirects(HttpClient.Redirect.NORMAL)
    .connectTimeout(Duration.ofSeconds(20))
    .build();
```

`newHttpClient()` is a shortcut for the common case; `newBuilder()` exposes the configuration knobs — protocol version, redirect policy (`ALWAYS`, `NEVER`, or `NORMAL`, which follows redirects except HTTPS→HTTP downgrades), connect timeout, proxy selector, authenticator. Left unconfigured, the client prefers HTTP/2 and falls back to HTTP/1.1 when the server or proxy doesn't support it. A built `HttpClient` is immutable and safe to share/reuse across many requests instead of building one per call.

### Building a request

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/users/42"))
    .header("Accept", "application/json")
    .GET()                       // default method is GET; also POST/PUT/DELETE(...) etc.
    .build();
```

Like the client, `HttpRequest` is built once via `HttpRequest.newBuilder()` and is immutable afterward — headers, method, URI, and body are all fixed at build time.

### Sending: synchronous vs. asynchronous

```java
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.statusCode());
System.out.println(response.body());
```

`send()` blocks the calling thread until the response arrives — straightforward for scripts and simple call chains.

```java
client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
    .thenApply(HttpResponse::body)
    .thenAccept(System.out::println);
```

`sendAsync()` returns a `CompletableFuture<HttpResponse<T>>` immediately; the actual request runs without blocking the calling thread, and `.thenApply()`/`.thenAccept()`/`.thenCombine()` chain further processing once the response lands — the same composition style as any other `CompletableFuture`.

### BodyHandlers: choosing the response body's shape

```java
HttpResponse.BodyHandlers.ofString();          // response.body() is a String
HttpResponse.BodyHandlers.ofByteArray();        // response.body() is a byte[]
HttpResponse.BodyHandlers.ofFile(Path.of("out.bin"));  // streams straight to a file
HttpResponse.BodyHandlers.ofInputStream();      // response.body() is an InputStream
```

The `BodyHandler` passed to `send()`/`sendAsync()` determines `HttpResponse<T>`'s type parameter — pick `ofFile()` for a large download so bytes stream to disk instead of buffering the whole response in memory, `ofString()` for a typical JSON API response.

## Trade-offs

- **`HttpURLConnection` still exists and still works** — `HttpClient` doesn't replace it at the language level, it's simply the API official documentation and most current tutorials point to for new code, thanks to the builder ergonomics and native async support neither of which `HttpURLConnection` ever had.
- **HTTP/2 by default means multiplexed connections, which changes some assumptions carried over from HTTP/1.1-only code** — e.g., relying on one connection per request for ordering or rate-limiting reasoning no longer holds the same way.
- **`sendAsync()`'s `CompletableFuture` composes well, but exceptions surface differently than with `send()`.** A synchronous `send()` throws `IOException` directly; an async chain wraps failures in the future itself, and forgetting a `.exceptionally()`/`.handle()` stage means a failed request can silently produce no visible error until something calls `.get()` or `.join()`.
  ```java
  client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
      .exceptionally(ex -> { System.err.println("request failed: " + ex); return null; })
      .thenAccept(System.out::println);
  ```
- **Choosing the wrong `BodyHandler` for the size of the response matters.** `ofString()`/`ofByteArray()` buffer the entire body in memory before returning — fine for a small JSON payload, a poor choice for a multi-gigabyte download where `ofFile()` (or `ofInputStream()` for manual streaming) avoids holding the whole thing in memory at once.
- **`sendAsync()`'s original reason to exist — not tying up one of a limited number of platform threads on I/O wait — mostly disappears on virtual threads (JDK 21+).** A virtual thread blocked in `send()` doesn't pin an OS thread the way a platform thread would; current guidance for virtual-thread-based code favors the simpler synchronous `send()` plus spawning many virtual threads for concurrency, over composing `CompletableFuture` chains to avoid blocking a thread type that's no longer scarce.

## Lab

In this lab you get `ApiClient`, a small wrapper around `java.net.http.HttpClient`, with empty methods. Your job is to fill them in. The core idea is to practice the builder API of `HttpRequest`, the difference between the blocking `send()` and the `sendAsync()` that returns a `CompletableFuture`, and why forgetting `.exceptionally()` on an async chain lets failures vanish silently.

**The scenario**

A client that makes a GET to a URL and returns the response body, both synchronously and asynchronously.

- `ApiClient.get(URI)`: synchronous GET that returns the body as a `String`.
- `ApiClient.getAsync(URI)`: asynchronous GET that returns a `CompletableFuture<String>`.
- `ApiClient.getAsyncWithFallback(URI, fallback)`: an async version that recovers from failures (optional).
- `ApiException`: an exception (with `statusCode()`) thrown for non-2xx responses.

The tests start a real local HTTP server with `com.sun.net.httpserver.HttpServer`, which is part of the JDK. There is no extra dependency and no external network access, and you still exercise the real `send()`/`sendAsync()` flow.

**What you will do, step by step**

1. **Build the request (TODO-00).** Build a GET `HttpRequest` for `uri` with the `Accept: application/json` header.
2. **Send synchronously (TODO-01).** Call `client.send(...)` with `HttpResponse.BodyHandlers.ofString()`. If the status is not between 200 and 299, throw `new ApiException(response.statusCode())`. Otherwise return the body.
3. **Send asynchronously (TODO-02).** Build the same request, use `client.sendAsync(...)` and turn the `HttpResponse<String>` into just its body with `thenApply`.

**How you know you are done**

`mvn test` is all green. You should be able to explain what happens to the exception of a failed request if nobody handles the `CompletableFuture`, and on which thread each variant waits for the response.

**Optional challenges**

- **TODO-03:** implement `getAsyncWithFallback()`, recovering from a failed request (for example, connection refused) with a default value through `CompletableFuture.exceptionally()`.

**Prerequisites:** basic Java syntax, `CompletableFuture` basics (`thenApply`, `exceptionally`) and exception handling. The project uses Java 21 and Maven.

**How to run it:** clone the repository, go into `java-concepts/httpclient-and-java-net-http` and run `mvn test` (from the root: `mvn -pl java-concepts/httpclient-and-java-net-http test`). The methods start out throwing `UnsupportedOperationException("Not implemented yet.")` and the `TODO-NN` comments explain each step, so the red tests are your checklist.

## Documentation Links

- [HttpClient — Java SE 25 API (java.net.http)](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html) — doc
- [HttpRequest — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.html) — doc
- [HttpResponse.BodyHandlers — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpResponse.BodyHandlers.html) — doc
