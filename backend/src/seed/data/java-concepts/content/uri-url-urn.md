---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

"URI", "URL", and "URN" get used interchangeably in casual speech, but `java.net` models them as genuinely different things with different guarantees: a **URI** is pure syntax — a string parsed against RFC 3986 with no promise it refers to anything reachable; a **URL** is a URI that additionally knows *how to locate* a resource (scheme, host, port, path) and can open a connection to it; a **URN** is a URI that *names* a resource without saying where to find it (`mailto:`, `urn:isbn:...`). `java.net.URI` and `java.net.URL` are separate classes for exactly this reason, and since JDK 20 the JDK itself steers you toward constructing a `URI` first and converting to a `URL` only at the point you actually need one, rather than constructing a `URL` directly.

## Use Cases

- Validating and normalizing a user-supplied link (stripping `..` segments, resolving it against a base URL) before ever trying to open a connection to it.
- Building one URL out of a base and a relative reference — pagination links, `Location` redirect headers, HTML `<a href>` targets — via `resolve()`.
- Comparing or deduplicating links that are textually different but point at the same resource, via `normalize()`.
- Representing a non-fetchable identifier — an ISBN, a database key, an internal opaque ID — as a `URI` (`urn:isbn:0-486-27557-4`) without it ever being mistaken for something you can `openStream()` on.
- Migrating code off the deprecated `new URL(String)` constructors without changing behavior.

## Deep Dive

### The three terms, and which class models which

```java
URI uri = new URI("https://darwinsys.com/java/../openbsd/../index.html");
URI normalized = uri.normalize();
System.out.println(normalized);                 // https://darwinsys.com/index.html

URI base = new URI("https://darwinsys.com");
System.out.println(base.relativize(uri));        // index.html

URL url = normalized.toURL();                    // now a locator, ready to connect
```

A `URI` only checks syntax — `new URI("bean:WonderBean")` succeeds even though nothing named `bean` is a real network scheme, because URI doesn't need to know how to reach anything. A `URL` is stricter in one specific way and looser in another: it requires a registered protocol handler for its scheme (so `new URL("bean:WonderBean")` throws `MalformedURLException`), but historically its per-scheme parsing was inconsistent about what counted as valid syntax — which is the reason for the deprecation below.

A **URN** isn't a distinct Java class at all — it's just a `URI` whose scheme names a resource rather than locating one:

```java
URI mailto = new URI("mailto:someone@example.com");
URI isbn   = URI.create("urn:isbn:0-486-27557-4");
```

Neither of these can be opened as a stream — there's no `toURL()` for `mailto:` or `urn:` without a registered handler, because "how would you fetch it" isn't a question a URN answers.

### normalize(), relativize(), resolve()

These three are the operations that actually justify keeping `URI` and `URL` separate rather than doing everything on one class:

```java
URI base = URI.create("https://api.example.com/v1/");

base.resolve("orders/42");        // https://api.example.com/v1/orders/42
base.resolve("/v2/orders/42");    // https://api.example.com/v2/orders/42  (absolute path wins)
base.relativize(
    URI.create("https://api.example.com/v1/orders/42"));   // orders/42
```

`resolve` is what turns a relative link from an HTML page or a `Location` header into an absolute one against the page's own URL; `relativize` is its inverse, useful for printing shorter, relative links when you already know the base every reader is starting from. `normalize` only rewrites `.`/`..` segments — it does not follow redirects, check reachability, or fetch anything; it is pure string manipulation over the parsed components.

### Why `new URL(String)` is deprecated (since JDK 20)

```java
URL url = new URL("https://example.com/page");   // deprecated since Java 20
```

`URL`'s public constructors were deprecated because their syntax checking varied by scheme and was, in places, inconsistent with the RFC — a string that should have been rejected sometimes wasn't, depending on which handler happened to be installed. `URI`'s parsing is uniform RFC 3986 syntax checking regardless of scheme, so the recommended construction path is now URI-first:

```java
URL url = URI.create("https://example.com/page").toURL();

// or, for anything with a userinfo/host/port worth validating explicitly:
URI uri = new URI("https://example.com/page");
uri.parseServerAuthority();     // throws URISyntaxException if the authority isn't well-formed
URL strict = uri.toURL();
```

`URI.create(String)` throws the unchecked `IllegalArgumentException` on malformed input (handy for literals you know are valid); the `URI(String)` constructor throws the checked `URISyntaxException` (handy when the string comes from outside your program and a malformed one is an expected, recoverable case).

### Opening the connection

Only a `URL` — never a `URI` — can actually fetch anything:

```java
URL url = URI.create("https://darwinsys.com").toURL();
try (InputStream in = url.openStream()) {
    // read the resource
}
```

For anything beyond a GET-and-read-the-body — headers, POST bodies, timeouts, HTTP/2 — reach for `HttpClient` instead of `URLConnection`; `openStream()` remains useful for exactly the "just fetch these bytes" case.

## Trade-offs

- **A `URI` that parses successfully is not a `URI` that refers to anything real.** `new URI("https://this-domain-does-not-exist.invalid/")` succeeds — syntax validation and reachability are two entirely different questions, and only `toURL()` plus an actual connection attempt answers the second one.
- **`normalize()` is purely syntactic.** It removes `..` and `.` segments textually; it has no notion of which segments are meaningful to the server (a `..` past the root, or a server that treats query parameters as significant to identity) and cannot substitute for a server-side canonical-URL policy.
- **The deprecated `URL` constructors still work — they're deprecated, not removed** — existing code compiles today with a warning, not an error, so there's no forcing function to migrate beyond the warning itself; a codebase that never looks at compiler warnings will carry the deprecated form indefinitely.
- **URN as a concept has essentially no runtime behavior in `java.net`.** There's no `URN` class and no dedicated resolution mechanism — treating something as a URN is purely a modeling choice about what the string *means*, enforced by convention (never calling `toURL()` on it), not by the type system.

## Documentation Links

- [URI — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/URI.html) — doc
- [URL — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/URL.html) — doc
- [RFC 3986: Uniform Resource Identifier (URI): Generic Syntax — IETF](https://datatracker.ietf.org/doc/html/rfc3986) — doc
- [JDK-8296385: Release Note — java.net.URL Constructors Are Deprecated](https://bugs.openjdk.org/browse/JDK-8296385) — doc
- [Quality Outreach Heads-up — JDK 20: Deprecate URL Public Constructors — Inside.java](https://inside.java/2023/02/15/quality-heads-up/) — doc
