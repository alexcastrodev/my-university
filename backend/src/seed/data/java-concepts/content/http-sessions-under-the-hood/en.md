---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

HTTP is stateless by design — every request is independent, with no built-in memory of the previous one. "Session" is the layer built on top to fake statefulness: the server hands the client an opaque identifier via a cookie, the client sends that identifier back on every subsequent request, and the server uses it as the key into a server-side store of per-user data. `HttpSession` in a servlet container, Spring Session, and every "logged in" web app all implement this same idea — a random ID, a `Set-Cookie` header, and a server-side map keyed by that ID.

## Use Cases

- Understanding what a framework's `getSession()`/`req.session` call is actually backed by, before reaching for a distributed session store (Redis-backed sessions) in a multi-instance deployment.
- Debugging "user got logged out for no reason" — often a session store eviction, a cookie not being sent (missing `Secure` over HTTP, `SameSite` blocking a cross-site request), or two server instances not sharing session state.
- Recognizing why session data disappears on server restart in the simplest implementations — an in-memory map has no persistence unless explicitly added.
- Deciding between session-based state and a stateless alternative (JWT/signed tokens) — a real architectural trade-off, not just an implementation detail.

## Deep Dive

### The core mechanism: ID + cookie + server-side map

```java
public class SessionManager {
    private static final Map<String, Map<String, Object>> sessions = new ConcurrentHashMap<>();

    public static String getOrCreateSessionId(Request req, Response res) {
        String sessionId = req.getCookies().get("SESSION_ID");

        if (sessionId == null || !sessions.containsKey(sessionId)) {
            sessionId = UUID.randomUUID().toString();
            sessions.put(sessionId, new ConcurrentHashMap<>());
            res.addHeader("Set-Cookie", "SESSION_ID=" + sessionId + "; Path=/; HttpOnly");
        }
        return sessionId;
    }

    public static Map<String, Object> getSession(String sessionId) {
        return sessions.get(sessionId);
    }
}
```

Three moving parts: a **session ID** generated with a cryptographically strong random source (`UUID.randomUUID()` here — the ID must be unguessable, since anyone who has it can impersonate that session), a **cookie** carrying that ID back and forth (`Set-Cookie` on the way out, the `Cookie` header on the way back in), and a **server-side store** (`ConcurrentHashMap` — thread safety matters because concurrent requests for different sessions, or even the same session, can hit the map simultaneously) mapping the ID to arbitrary per-user data.

### Reading and writing session data

```java
// In a request handler:
String sessionId = SessionManager.getOrCreateSessionId(req, res);
Map<String, Object> session = SessionManager.getSession(sessionId);
session.put("lastVisit", LocalDateTime.now());

// Reading it back on a later request:
LocalDateTime last = (LocalDateTime) session.get("lastVisit");
res.write("Your last visit was: " + last);
```

Because the store is a generic `Map<String, Object>`, it can hold whatever the application needs — strings, domain objects, lists — with no schema. This flexibility is also the storage's biggest weakness: nothing prevents storing something large or non-serializable, which matters once sessions need to survive a restart or be shared across instances.

### What's still missing from this minimal version

A production session mechanism built on this same core idea typically adds: **expiration** (a time-to-live per session, with either a background sweep or lazy eviction on access), **invalidation** (an explicit logout removing the entry), and **externalized storage** (Redis, a database, or a distributed cache instead of an in-memory `Map` — required the moment there's more than one server instance, since an in-memory map is only visible to the process that created it).

## Trade-offs

- **An in-memory session store doesn't survive a restart, and doesn't scale past one instance** — the `ConcurrentHashMap` here lives in one JVM's heap; deploy a second instance behind a load balancer and a request routed to instance B has no idea about a session created on instance A, unless sessions are made "sticky" (routed consistently to the same instance) or the store is externalized.
- **A session ID is a bearer credential** — anyone holding the exact string in the `SESSION_ID` cookie can act as that user, no password required for the duration of the session; this is exactly why the ID has to come from a strong random source (`UUID.randomUUID()`, not a counter or timestamp) and why cookie theft (via XSS, network sniffing, or a leaked log line) is equivalent to credential theft.
```java
String weakId = String.valueOf(sessionCounter++);   // guessable — never do this
String strongId = UUID.randomUUID().toString();      // cryptographically strong
```
- **Sessions vs. stateless tokens (JWT) is a real architectural choice, not a style preference** — a session keeps state on the server (easy to invalidate immediately by deleting the entry, but requires a shared/sticky store across instances); a signed token keeps state in the client (trivially horizontally scalable, no server-side store needed, but can't be revoked before its expiry without an extra denylist mechanism). Neither is strictly better — the choice depends on whether instant revocation or stateless scaling matters more for a given system.
- **Book vs. today: the example's cookie is missing two attributes that current guidance treats as required for a session cookie, not optional.** `Set-Cookie: SESSION_ID=...; Path=/; HttpOnly` sets `HttpOnly` (correctly — it blocks JavaScript from reading the cookie, mitigating session-stealing via XSS) but omits `Secure` (which stops the cookie from ever being sent over plain HTTP, mitigating network-level interception) and `SameSite` (which controls whether the cookie is sent on cross-site requests, mitigating CSRF — `Strict` is the current recommendation for an authentication cookie specifically). A session cookie written today should read closer to `SESSION_ID=...; Path=/; HttpOnly; Secure; SameSite=Strict`.

## Documentation Links

- [MDN — Using HTTP cookies (attributes, security considerations)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies) — doc
- [UUID.randomUUID() — java.util API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/UUID.html#randomUUID()) — doc
- [ConcurrentHashMap — java.util.concurrent API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html) — doc
- [RFC 6265 — HTTP State Management Mechanism (cookies)](https://www.rfc-editor.org/rfc/rfc6265) — doc
- [IETF draft-ietf-httpbis-rfc6265bis — Cookies: HTTP State Management Mechanism (SameSite, in-progress update to RFC 6265)](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis) — doc
