---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Every HTTP framework — Tomcat, Netty, Spring's embedded server — is, underneath, a program that opens a `ServerSocket`, accepts TCP connections, and reads/writes bytes that happen to follow the HTTP text format. Nobody writes this by hand in production anymore, but understanding the raw layer explains framework behavior that otherwise looks like magic: why `Content-Length` has to be exact, what "keep-alive" actually keeps alive, and why a malformed request produces a connection-level failure instead of a clean HTTP error. `java.net.Socket`/`ServerSocket` is the client/server accept-connect-read-write primitive underneath all of it; HTTP itself is just a specific textual protocol running over that connection.

## Use Cases

- Diagnosing a hung request that turns out to be a `Content-Length` mismatch (client says N bytes, sends more or fewer) — something a raw socket read makes obvious and a framework's exception message sometimes obscures.
- Understanding why an idle "keep-alive" connection consumes a server thread/socket even between requests, motivating connection pooling and timeouts.
- Implementing a tiny protocol of your own (health-check pings, an internal service handshake) where a full HTTP stack is overkill and a raw `Socket` read/write loop is simpler and faster.
- Reading Wireshark/tcpdump captures or `curl -v` output and mapping what's on the wire back to the request/response model frameworks abstract away.

## Deep Dive

### `ServerSocket`/`Socket`: the accept-connect-read-write primitive

```java
// Server side
ServerSocket serverSocket = new ServerSocket(8350);
while (true) {
    Socket socket = serverSocket.accept();       // blocks until a client connects
    InputStream in = socket.getInputStream();     // bytes the client sent
    OutputStream out = socket.getOutputStream();  // bytes to send back
    // read the request, write the response, then typically socket.close()
}

// Client side
Socket socket = new Socket("localhost", 8350);    // connects — the TCP three-way handshake happens here
OutputStream out = socket.getOutputStream();
InputStream in = socket.getInputStream();
```

`ServerSocket` binds to a port and does exactly one thing: `accept()` incoming connections, each producing a new `Socket` dedicated to that one client. The port (1–65535) identifies *which application* on the machine; the IP address identifies *which machine*. This is a **connected** (TCP) socket — the OS guarantees delivery and ordering. `DatagramSocket`, by contrast, is Java's API for **unconnected** (UDP) communication — no delivery guarantee, no ordering, but lower overhead, which is why it's used for things like DNS lookups or real-time media rather than reliable request/response traffic.

### The request line, headers, and the blank-line terminator

Read byte-by-byte (or line-by-line once decoded as text) from a `Socket`'s `InputStream`, an HTTP/1.1 request has a fixed shape:

```
GET /products/42 HTTP/1.1
Host: localhost:8080
Connection: keep-alive
Accept: application/json

```

Four parts, always in this order: the **request line** (method + target + protocol version), zero or more **headers** (one per line, `Name: value`), a **blank line** marking the end of headers, and — only for methods that carry a body — the **message body** itself. That blank line is the only thing telling a byte-stream reader "headers are done, whatever comes next is either the body or nothing" — there's no length prefix on the header block itself, so a server has to read line-by-line until it hits it.

### Why `Content-Length` (or chunked encoding) has to be exact

A body-carrying request needs a way to tell the reader how many bytes to consume, since text doesn't self-delimit the way headers do (a body could legitimately contain blank lines):

```
POST /form HTTP/1.1
Host: localhost:8080
Content-Type: text/plain
Content-Length: 294

Lorem ipsum dolor sit amet, consectetur adipiscing elit...
```

`Content-Length` tells the reader precisely how many bytes of body follow the blank line. If the sender's count is wrong — too high, and the reader blocks waiting for bytes that never arrive; too low, and the reader treats the remainder as the start of the next message on the same connection — this is exactly the failure mode `Transfer-Encoding: chunked` exists to avoid for bodies whose length isn't known upfront (streamed/generated content): instead of one declared length, the body is sent as a series of length-prefixed chunks, ending with a zero-length chunk as the terminator.

### The response's mirror shape, and status code classes

```
HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 149

<html><body><h1>Hello World!</h1></body></html>
```

A response mirrors the request's shape: a status line (protocol version + 3-digit status code + reason phrase) instead of a request line, then headers, a blank line, then an optional body. The first digit of the status code groups its meaning: `1xx` informational, `2xx` success, `3xx` redirection, `4xx` client error, `5xx` server error — a convention precise enough that a client can make a coarse decision ("retry?", "give up?", "follow the redirect?") from that single digit alone, before even parsing the reason phrase.

### One page, many requests

A browser rendering `index.html` with an embedded image and stylesheet doesn't get all three in one response — HTML, CSS, and the image are three separate resources, so the browser issues three separate HTTP requests (historically three separate TCP connections; HTTP/1.1 keep-alive and HTTP/2 multiplexing both exist specifically to avoid paying the TCP handshake cost per resource). This is the concrete reason "one page load" can mean dozens of requests in a browser's network tab — every referenced resource is its own request/response cycle.

## Trade-offs

- **A byte-count mismatch on `Content-Length` isn't a clean HTTP error — it's a stuck connection.** Framework code turns this into a readable exception; a hand-rolled reader that trusts the header literally blocks on `InputStream.read()` waiting for bytes that were never sent.
```java
// naive: trusts Content-Length completely, no timeout — will hang forever on a lying client
byte[] body = new byte[contentLength];
in.readNBytes(body, 0, contentLength);
```
- **Serialization format is a compatibility decision, not just a convenience one** — Java's `Serializable`/`ObjectInputStream`/`ObjectOutputStream` marshaling is simple when both ends are Java, but locks the protocol to JVM clients only; a text format like JSON costs a bit more to encode/decode but works with any language on the other end of the socket. This is exactly why virtually every real HTTP API today uses JSON/Protobuf over the wire instead of Java's native object serialization, independent of the deserialization security concerns native serialization also carries (see `io-streams-fundamentals`).
- **Reading one connection = one thread doesn't scale past a few thousand clients** — the naive `accept()` loop shown here blocks a thread per connection; real servers use either a thread pool (bounded, still one thread per active connection) or a non-blocking/event-driven I/O model (Netty's `NioEventLoop`, Java NIO's `Selector`) precisely to avoid that ceiling. Virtual threads (see `thread-model-legacy-vs-virtual-threads`) make the naive "one thread per connection" model viable again at a much higher scale, since a blocked virtual thread doesn't tie up an OS thread while it waits.
- **Keep-alive trades server resources for per-request latency** — an idle keep-alive connection still holds a socket (and, without virtual threads, an OS thread) open on the server between requests, but avoids repeating the TCP handshake for every subsequent request on the same connection; server-side idle timeouts exist specifically to reclaim these resources from clients that never come back.

## Lab

In this lab you get the `RawHttpMessage` class with every method empty, and you build, then take apart, an HTTP request as it really is on the wire: plain text with a strict shape. The core idea is to see what an HTTP client hides from you: the request line, the header lines, the blank line that separates them from the body and the `Content-Length` computed in bytes.

**The scenario**

Instead of using an HTTP library, you write and interpret the request text by hand.

- `requestLine()`: builds the first line, in the form `"METHOD path HTTP/1.1\r\n"`.
- `buildRequest()`: builds the full request (request line, one `Name: value\r\n` per header, a blank line and the body).
- `parseHeaders()`: turns a block of header lines into an order-preserving `Map`.
- `parseMethod()`: extracts just the method from a raw request.
- `sendOverSocket()`: optional, sends the bytes through a real `java.net.Socket`.

Note that the HTTP line ending is CRLF (`\r\n`), not just `\n`. The tests check the exact text.

**What you will do, step by step**

1. **Build the request line (TODO-00).** Method, space, path, space, `HTTP/1.1` and CRLF.
2. **Build the whole request (TODO-01).** After the request line, emit one `Name: value\r\n` per entry in `headers`, in the map's iteration order, then the blank line (`\r\n`) and then the body. If `body` is null or empty, the blank line is still there, but with no text after it. If a body exists, add `Content-Length` automatically, with the size in bytes from `body.getBytes(StandardCharsets.UTF_8).length`, even if the caller did not provide it. Bytes and characters differ in UTF-8, which is why the count is done in bytes.
3. **Parse headers (TODO-02).** Split the block into lines, split each one at the first `:`, trim the space after the colon and store them in a `LinkedHashMap` to keep the order.
4. **Extract the method (TODO-03).** Given a raw request, return just the first token of the request line (`GET`, for example).

**How you know you are done**

`mvn test` is all green. You should be able to write the shape of an HTTP/1.1 request from memory and explain why the blank line is what separates headers from body.

**Optional challenges**

- **TODO-04:** implement `sendOverSocket()`: open a `Socket` to `host:port` in a try-with-resources, write the request bytes, flush and read everything the other end sends back with `readAllBytes()`. The test stands up a throwaway `ServerSocket` on an ephemeral port, so it is a genuine round trip over the network stack, with no HTTP library.

**Prerequisites:** basic Java syntax and familiarity with `Map`.

**How to run it:** clone the repository, go into `java-concepts/sockets-and-raw-http-anatomy` and run `mvn test` (or, from the root, `mvn -pl java-concepts/sockets-and-raw-http-anatomy test`). Every pending method throws `UnsupportedOperationException("Not implemented yet.")` and has a `TODO-NN` comment explaining the expected format, so the red tests are your checklist.

## Documentation Links

- [ServerSocket — java.net API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/ServerSocket.html) — doc
- [Socket — java.net API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/Socket.html) — doc
- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110) — doc
- [RFC 9112 — HTTP/1.1 (message syntax and routing)](https://www.rfc-editor.org/rfc/rfc9112) — doc
