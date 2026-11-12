---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A JSON list of 2,000 products is 371,090 bytes on the wire if nobody compresses it, and 25,822 bytes if the server uses Zstandard at its fastest level. That is a 93 percent drop for one line in `Program.cs`, and it is the cheapest performance change most APIs have. It also comes with decisions that are easy to get wrong: which encodings to offer, in what order, whether to compress over HTTPS, what a cache in front of you sees, and whether the app should do it at all or leave it to the reverse proxy.

This concept covers the response compression middleware (`AddResponseCompression` and `UseResponseCompression`), the providers it ships, what .NET 11 changed (a built-in Zstandard provider and `Vary: Accept-Encoding` on every response) and numbers measured on the 11.0.100 SDK for size and time. The compression of static files at build time (`MapStaticAssets`) is a different mechanism, covered in the static files concept.

## Use Cases

- A JSON API that returns large lists, where the payload is the main cost on mobile networks.
- Server-rendered HTML or a Blazor app that serves text over a link that is slower than the server.
- An app that is not behind a proxy that compresses (a container behind a plain load balancer, a single Kestrel process).
- Deciding to turn the middleware off because the proxy or CDN already does it.

## Deep Dive

### Two lines

```csharp
builder.Services.AddResponseCompression();

var app = builder.Build();
app.UseResponseCompression();   // before the endpoints that write the body
```

The middleware looks at the request's `Accept-Encoding`, picks a provider and wraps the response body in a compressing stream. It has to be registered before the endpoints: a middleware after the endpoint never sees the body.

With no configuration, .NET 11 registers three providers, in this order of preference: Zstandard (`zstd`), Brotli (`br`) and Gzip (`gzip`). The official docs describe the same order: Zstandard if the client supports it, otherwise Brotli, otherwise Gzip. In the test below the same endpoint answered each request:

```text
Accept-Encoding: gzip, br         -> Content-Encoding: br
Accept-Encoding: zstd, gzip, br   -> Content-Encoding: zstd
Accept-Encoding: *                -> Content-Encoding: zstd
Accept-Encoding: identity         -> (not compressed)
Accept-Encoding: br;q=0, gzip     -> Content-Encoding: gzip
Accept-Encoding: deflate          -> (not compressed)
```

A quality of zero removes an encoding from the choice. The server's own order breaks ties; the client's order does not matter, which is why `gzip, br` gets `br`. A client that accepts only `deflate` gets the plain body, because there is no deflate provider.

### What is compressed

The middleware compresses a response when the client sent a usable `Accept-Encoding`, when the content type is on the list (JSON, HTML, plain text, CSS, JavaScript and similar text types, from `ResponseCompressionDefaults.MimeTypes`) and when the response is not already encoded. A `image/png` response of 50,000 bytes went out untouched with `Accept-Encoding: br`, which is right: images, fonts and archives are already compressed, and compressing them again costs CPU for nothing.

A type that is not on the list is not compressed either, and it gets no `Vary` header in the test. To add one, extend the defaults instead of replacing them:

```csharp
builder.Services.AddResponseCompression(options =>
{
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["application/x-ndjson"]);
});
```

A request for `application/x-ndjson` with `Accept-Encoding: br` came back with 5,000 plain bytes and no `Content-Encoding` under the defaults, and went out as `br` in the lab test after the line above.

There is no minimum body size. A response of 11 bytes (`{"ok":true}`) came out of Brotli with 15 bytes. The cost is small for one such response and real if your API is made of them: you pay CPU to make the response bigger. If your traffic is mostly tiny bodies, this is one reason to do the work in a proxy that has a threshold.

### Choosing and ordering providers

To use only some providers, clear the list and add them in the order you want:

```csharp
builder.Services.AddResponseCompression(options =>
{
    options.Providers.Clear();
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});
```

With that, `Accept-Encoding: zstd, br, gzip` is answered with `br`. A reason to do this is a client population or a CDN that does not handle `zstd` yet; a browser that does not send `zstd` in `Accept-Encoding` never receives it in any case, so the risk is in intermediaries that rewrite the header, not in the browser.

Levels are set per provider. Brotli and Gzip default to `CompressionLevel.Fastest`, and Zstandard takes a quality number from its own options type:

```csharp
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Optimal);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.SmallestSize);
builder.Services.Configure<ZstandardCompressionProviderOptions>(o =>
    o.CompressionOptions = new ZstandardCompressionOptions { Quality = 3 });
```

The docs give the Zstandard range as 1 to 22. Quality 0 is what an untouched app has (the property printed `0` in the test), and this page did not measure what level that maps to, so set the number if the number matters.

### Numbers: size and time

The payload is a JSON array of 2,000 objects (an id, a name, a SKU, a price, three tags and a 76 character description), 371,090 bytes, generated with a fixed random seed. The server was a Kestrel process on loopback, the client was an `HttpClient` with automatic decompression off, and each cell is the mean of 300 sequential requests: the time includes compression on the server and reading the body on the client, so it is not a pure compression cost. One machine, one payload, one run: use it to compare the shape, not as a benchmark.

| Level in the test | gzip bytes | gzip ms | br bytes | br ms | zstd bytes | zstd ms |
|---|---|---|---|---|---|---|
| Fastest (gzip and br `Fastest`, zstd quality 1) | 46,433 | 0.59 | 49,136 | 1.05 | 25,822 | 0.38 |
| Optimal (gzip and br `Optimal`, zstd quality 3) | 30,121 | 1.05 | 25,867 | 1.01 | 27,305 | 0.53 |
| SmallestSize (gzip, br at their top level, zstd quality 19) | 29,637 | 2.18 | 18,054 | 396.08 | 19,645 | 168.82 |

For comparison, the same request with no compression took 0.36 ms and sent all 371,090 bytes.

What the numbers say:

- **Zstandard at its fastest level beat Gzip and Brotli at theirs on both size and time.** 25,822 bytes in 0.38 ms against 46,433 in 0.59 for Gzip and 49,136 in 1.05 for Brotli. This is the default order's reason: a client that accepts `zstd` gets the best size per CPU.
- **At the middle level the three are close.** Brotli is smallest (25,867), Zstandard is 5.6 percent bigger (27,305) and took about half the time (0.53 ms against 1.01), and Gzip is 16 percent bigger than Brotli (30,121).
- **The top level is a trap for dynamic responses.** Brotli at its top level saved another 30 percent over its middle level (18,054 against 25,867) and cost 396 ms per request against 1 ms. Zstandard at 19 cost 169 ms. That is fine for a file compressed once at build time (what `MapStaticAssets` does) and a self-inflicted outage for a response compressed on each request.
- **Gzip barely moves with level.** From Optimal to SmallestSize it went from 30,121 to 29,637 bytes and doubled its time.

The practical reading: for dynamic responses stay at the fast or middle levels, and let the default order (Zstandard first) pick. Measure with your own payload: JSON with long repeated keys, as here, compresses much better than a payload of random identifiers.

### `Vary: Accept-Encoding`

The same URL now has more than one possible body: the plain one, the gzip one, the Zstandard one. A cache between you and the client (a CDN, a proxy, the browser's HTTP cache) must know that the request header `Accept-Encoding` is part of the key, and the way to say so is `Vary: Accept-Encoding`.

Before .NET 11 the middleware added `Vary` only to responses it compressed. Since .NET 11 (a documented breaking change) it adds it to responses it handled even when it did not compress them, so a cache cannot store the plain version and serve it to a client that asked for gzip, or the opposite. In the test, a request with no `Accept-Encoding` at all came back with `Vary: Accept-Encoding` and a plain body of 371,090 bytes.

One detail did not match the documentation. The docs say the header is added to every response that passes through the middleware, including content types outside `MimeTypes`. In the test a 50,000 byte `image/png` response with `Accept-Encoding: br` came back with no `Vary` at all. The text of the breaking change page and the observed behavior differ on that case; it does not affect JSON or HTML, which are the compressed types, and a CDN will usually key on the encoding anyway. The action the docs recommend is to check that the CDN or proxy normalizes `Accept-Encoding`, so that it does not store a variant per spelling of the header.

### HTTPS and BREACH

`EnableForHttps` is `false` by default, and the docs say why: compressing responses over TLS can expose an app to CRIME and BREACH attacks. BREACH needs a response that contains both a secret (a CSRF token, a session identifier in the body) and text an attacker can make the server reflect, and it measures the compressed size to guess the secret one character at a time. Compression changes the length, the length leaks, and TLS does not hide length.

This is a decision about the response, not a switch for the app:

- A public JSON list or a static-like page with no secret and no reflected input is fine to compress.
- A page that has a form with an antiforgery token and echoes a query string is the case the default protects.

With the flag off, a request that reaches the app over `https` is not compressed. The lab test uses a base address of `https://localhost` and checks both values of the flag. A subtle consequence: when TLS ends at a proxy and the app sees plain `http`, the app compresses, and the secret is just as exposed on the way to the client. The scheme the app sees is not the scheme the client used.

### When the proxy should do it

The docs recommend server-based compression (IIS, Apache, Nginx) over the middleware, with the reason that the middleware "probably can't match" the server modules, and list the cases where the middleware is the choice: the app cannot use those modules, or it is hosted directly on Kestrel or HTTP.sys, which have no built-in compression. In practice:

- **Behind a CDN or an Nginx that compresses**, leave the middleware off. Compressing twice wastes CPU. The proxy also has what the middleware lacks: a minimum size, caching of the compressed version and compression of static files done once.
- **A proxy that strips `Accept-Encoding`** makes the middleware compress nothing. The docs name Nginx as an example (issue 5989) and the fix is in the proxy configuration, not the app.
- **A container behind a plain TCP or HTTP load balancer** with no compression is where the middleware pays for itself.
- **Whoever compresses, do it in one place.** A response that is compressed by the app and then again by the proxy is the failure to avoid, and `curl -s -D - -o /dev/null -H "Accept-Encoding: zstd"` against both the app and the public URL shows which layer answered.

## Trade-offs

- **CPU in the request path.** The middleware compresses on every request, on the thread that serves it. At fast levels the cost in the test was under a millisecond, but at top levels it was 169 to 396 ms for one 371 KB body. A compressed copy cached by the proxy or produced at build time is free at runtime; the middleware's is not.
- **Smaller is not always faster.** Bytes saved only help if the link is the bottleneck. On a fast internal network between two services the saved transfer can be less than the compression time, and for tiny bodies the response gets bigger.
- **A new encoding needs a client that sends it.** Zstandard is first in the default order, but a client that does not list `zstd` gets Brotli or Gzip, and a proxy that rewrites `Accept-Encoding` decides on its own. The server cannot choose an encoding the client did not offer.
- **Defaults favor safety over size.** Compression over HTTPS is off and levels are `Fastest`. The result is conservative: a missed 30 percent at Brotli's middle level, and zero compression for apps behind a TLS-terminating proxy that sees `http`.
- **`Vary` adds cache variants.** A cache that does not normalize `Accept-Encoding` keeps one copy per spelling of the header, so the same URL occupies several slots. The documentation's advice is to check the CDN configuration.
- **The security risk is in the content, not the code.** BREACH is not fixed by a library version. Which pages mix secrets with reflected input is something the team has to know, and it is not visible in the middleware configuration.
- **Do not forget to test it.** A misplaced `UseResponseCompression` or a removed MIME type compiles and runs and simply sends the big body. A test that asks for `br` and asserts `Content-Encoding` is the only safety net.

## Lab

In this lab you get an API with four endpoints (370 KB of JSON, the same body as `application/x-ndjson`, an 11 byte JSON body and a 50 KB `image/png`) and no compression. You register the middleware, extend the MIME types, read the HTTPS decision from configuration and make the provider order configurable. The tests ask for each encoding and assert `Content-Encoding`, `Vary` and the size of what travels. The lab targets `net11.0` and needs the .NET 11 SDK. No Docker and no certificate: the tests play HTTPS by using an `https://localhost` base address.

**The scenario**

- `Program.cs`: the four endpoints and a generated catalog of 2,000 products.
- Two configuration keys: `Compression:EnableForHttps` and `Compression:PreferBrotli`, set by the tests.

**What you will do, step by step**

1. **Register compression (TODO-00).** HTTPS flag from the configuration, MIME types as the defaults plus `application/x-ndjson`, and Brotli then Gzip only when `PreferBrotli` is true.
2. **Add the middleware (TODO-01).** Put it before the endpoints.

**How you know you are done**

`dotnet test` is green. For each test you should be able to say who decided: the client's `Accept-Encoding`, the provider order, the MIME type list or the HTTPS flag. You should also be able to say why the 11 byte body grew.

**Optional challenges**

- **TODO-02:** write down two ways to leave small bodies uncompressed and pick one.
- **TODO-03:** set the Gzip level to `SmallestSize`, compare the size with the default and say what you paid.

**Prerequisites:** Minimal APIs, middleware order, what `Accept-Encoding` is and the .NET 11 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The starter compiles and the compression tests fail until you complete the TODOs.

## Documentation Links

- [Response compression in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/response-compression) (doc)
- [Breaking change: response compression always emits Vary: Accept-Encoding, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/response-compression-always-vary) (doc)
- [RFC 8878: Zstandard Compression and the application/zstd Media Type](https://datatracker.ietf.org/doc/html/rfc8878) (doc)
- [BREACH (security exploit), Wikipedia](https://en.wikipedia.org/wiki/BREACH) (doc)
- [Vary header, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary) (doc)
