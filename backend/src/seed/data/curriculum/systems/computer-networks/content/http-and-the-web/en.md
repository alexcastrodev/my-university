---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Describe HTTP's request-response cycle, and state which transport protocol it relies on and why.
- Explain HTTP's statelessness, and explain what problem cookies solve and how, mechanically, they solve it.
- Distinguish persistent from non-persistent HTTP connections, and explain the transport-layer cost non-persistent connections incur repeatedly.
- Identify the parts of a real HTTP request and response message: request line/status line, headers, and body.
- Explain why HTTP is the concrete protocol this discipline's later transport and network-layer concepts are traced through, in the capstone.

## Context & Motivation

Having established, in the previous concept, that the Web is built on a client-server architecture, this concept develops the actual protocol that architecture runs: HTTP, the HyperText Transfer Protocol. HTTP is deliberately simple — a request-response protocol, with no built-in notion of a multi-step "session" — and that simplicity is a real design choice, not an oversight, one this concept examines directly through HTTP's statelessness and the cookie mechanism invented to work around it. HTTP is also chosen, throughout the rest of this discipline, as the running example every lower-layer mechanism is eventually traced underneath: when this discipline's capstone walks one request end-to-end through DNS, TCP's handshake, IP routing, and link-layer framing, it is an HTTP request doing the walking, precisely because HTTP is concrete, familiar, and sits at the very top of the stack — the natural starting point for tracing everything that has to happen underneath it.

## Core Theory

### The request-response cycle

HTTP is a request-response protocol: a client (typically a browser) sends an HTTP request message to a server, and the server responds with an HTTP response message. HTTP itself defines only the format of these messages and the rules for exchanging them; it relies entirely on the transport layer — specifically TCP, in the overwhelming majority of real deployments — to actually establish a connection and deliver the request and response bytes reliably and in order between client and server. HTTP is, in this sense, a genuinely simple protocol built directly on top of a much more complex transport-layer service it takes entirely for granted.

### Statelessness

HTTP is stateless: the server maintains no information about a client across separate requests, by design. Each request is processed entirely on its own, independent of any previous request from the same client. This is a deliberate simplification: a stateless server does not need to remember anything about millions of clients between their requests, which keeps the server's design and its ability to recover from a crash (it has no session state to lose) much simpler than a stateful alternative would allow.

### Cookies: the workaround

Statelessness is a real limitation for many genuinely useful applications — a shopping cart, a logged-in session — that need the server to recognize the same client across multiple requests. Cookies solve this without abandoning statelessness at the protocol level: the server includes a `Set-Cookie` header in a response, assigning the client a unique identifier; the browser stores this and automatically includes it in a `Cookie` header on every subsequent request to that server. The server then looks up its own server-side state (a session record, a shopping cart) keyed by that identifier. HTTP itself remains stateless — no request depends on the server remembering anything from a prior request without the client re-supplying the cookie — but the combination of a cookie plus server-side state produces the practical experience of a stateful session on top of it.

### Persistent vs. non-persistent connections

A non-persistent HTTP connection opens a fresh TCP connection for every single object requested (the base HTML page, then a separate connection for each image, each stylesheet), closing the connection after each object is delivered. A persistent connection, the default in HTTP/1.1 and later, keeps a single TCP connection open across multiple requests and responses in sequence, avoiding the overhead of establishing a brand-new TCP connection (with its own three-way handshake, covered later in this discipline) for every single object on a page that might reference dozens of them.

### Request and response message structure

A real HTTP request has a request line (method, URL, HTTP version — e.g. `GET /index.html HTTP/1.1`), a set of header lines (`Host:`, `User-Agent:`, `Cookie:`, and others), a blank line, and an optional body (present for methods like `POST`). A real HTTP response has a status line (HTTP version, a numeric status code, and a short reason phrase — e.g. `HTTP/1.1 200 OK`), header lines (`Content-Type:`, `Content-Length:`, possibly `Set-Cookie:`), a blank line, and the response body (the actual requested content).

## Worked Examples

### Example 1: A real HTTP request and response

```text
Request (client to server):

GET /index.html HTTP/1.1
Host: www.example.com
User-Agent: Mozilla/5.0
Cookie: session=a1b2c3d4

Response (server to client):

HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 3419
Set-Cookie: session=a1b2c3d4; Max-Age=3600

<html>...the actual page content...</html>
```

The status code `200` means success. Other common codes: `301` (moved permanently), `404` (not found), `500` (internal server error) — the status line alone, before any body is even read, tells the client how to interpret what follows.

### Example 2: Cookies solving statelessness, step by step

```text
1. A browser sends a first request to www.example.com with no Cookie
   header (no cookie set yet).
2. The server has no way to distinguish this client from any other new
   client — statelessness means it retains nothing from prior requests
   by anyone. It generates a fresh session identifier and responds with
   Set-Cookie: session=xyz789.
3. The browser stores "session=xyz789" associated with example.com.
4. On every subsequent request to example.com, the browser automatically
   includes Cookie: session=xyz789.
5. The server looks up its own server-side record keyed by "xyz789"
   (e.g., "this session has 2 items in its shopping cart") and responds
   accordingly.
```

At no point does the HTTP protocol itself carry any notion of a multi-request session — every individual request is still processed as an independent, stateless unit; the appearance of a stateful session is produced entirely by the cookie identifier plus server-side lookup, layered on top.

### Example 3: Counting connections, persistent vs. non-persistent

A web page consists of one HTML file and 10 embedded images, all served from the same server.

```text
Non-persistent HTTP: 11 separate TCP connections are opened and closed —
  one for the HTML file, one for each of the 10 images — each paying its
  own connection-setup cost (the three-way handshake, covered later in
  this discipline) before any of that object's actual bytes are sent.

Persistent HTTP: 1 TCP connection is opened once and reused for all 11
  requests and responses in sequence (or in parallel, over that same
  connection, with pipelining) — the connection-setup cost is paid once,
  not 11 times.
```

This is a direct, countable illustration of why persistent connections became the HTTP/1.1 default: for a real page with many embedded objects, avoiding repeated connection setup is a substantial, measurable savings.

## Common Misconceptions & Pitfalls

- **"HTTP handles its own reliability and ordering."** HTTP delegates all of that to TCP entirely; HTTP itself has no retransmission or sequencing logic of its own — it simply hands a request to TCP and trusts TCP's guarantee that the bytes will arrive, in order, at the other end.
- **"Cookies make HTTP a stateful protocol."** The protocol itself remains stateless — no HTTP request is processed differently based on protocol-level memory of a prior request. Cookies produce the appearance of statefulness entirely through an identifier the client re-supplies each time plus state the server keeps and looks up itself; nothing about HTTP's own request-handling logic changed.
- **"Non-persistent connections are simply an inferior, obsolete design with no upside."** Non-persistent connections were the original HTTP/1.0 default and are simpler to reason about (each connection maps to exactly one request-response pair, with no ambiguity about connection reuse or when to close it) — persistent connections' efficiency gain came with genuine added complexity in connection-lifecycle management that HTTP/1.1 had to specify carefully.
- **"A 200 status code means the page loaded correctly for the user."** It means the *server* successfully processed the request and is returning the requested resource — client-side rendering failures, broken JavaScript, or a malformed response body are entirely separate concerns HTTP's status code says nothing about.

## Summary

HTTP is a stateless, request-response protocol built entirely on top of TCP's connection and reliability guarantees, which it takes for granted rather than reimplementing. Its statelessness is a deliberate simplicity choice, worked around — not abandoned at the protocol level — via cookies: a server-assigned identifier the client automatically re-supplies on every request, letting the server maintain its own session state keyed by that identifier. HTTP/1.1's persistent connections keep one TCP connection open across many requests, avoiding the real, measurable cost of repeating connection setup for every single object a page references. A real HTTP request has a request line, headers, and an optional body; a real response has a status line, headers, and a body. HTTP is the concrete protocol this entire discipline's capstone traces end-to-end through every lower layer — DNS resolution, TCP's three-way handshake, IP routing, link-layer framing — precisely because it sits at the very top of the stack and is the protocol a user's actual click or page-load most directly experiences.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php) — the standard textbook's treatment of HTTP, statelessness, cookies, and persistent connections.
- [Stanford CS144 — Lecture Schedule ("Application protocols")](https://www.scs.stanford.edu/10au-cs144/sched/) — a real course lecture dedicated to application-layer protocols including HTTP, taught immediately after the network's structural foundations.
