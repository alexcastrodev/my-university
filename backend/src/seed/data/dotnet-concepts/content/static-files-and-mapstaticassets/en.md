---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Serving CSS, JavaScript and images looks like the least interesting part of a web
app, yet it decides how fast pages load and whether users see stale files after a
deploy. Since .NET 9 the recommended way is `MapStaticAssets`, which does at build
time what `UseStaticFiles` did at request time: it compresses, fingerprints and
describes each file in a manifest, then serves it as a routed endpoint. The goal
is to understand what that manifest contains, what the response headers look like
with and without it, what it cannot serve, and when `UseStaticFiles` is still the
right tool.

## Use Cases

- Getting content-hashed URLs and long-lived caching for CSS and JS without a
  separate bundler.
- Understanding why a file you copied onto the server is a 404 even though it is
  in `wwwroot`.
- Serving a default document (`index.html`) for a small site or a SPA host.
- Mixing both mechanisms: optimized assets from the build plus user uploads from
  a folder outside the project.
- Keeping middleware such as logging or rate limiting away from static asset
  requests.

## Deep Dive

### What the build produces

A project that uses `Microsoft.NET.Sdk.Web` discovers the files under `wwwroot`
(the default web root; only that folder is addressable) at build time and writes
a manifest next to the assembly, named
`{AssemblyName}.staticwebassets.endpoints.json`. The experiment used
`dotnet new web` (SDK 10.0.100), with a 20 KB stylesheet `app.css`, an
`index.html`, a file with an unknown extension, and a copy of the stylesheet in
`lib/icons/`. The only change to `Program.cs` was the call:

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapStaticAssets();
app.MapGet("/api/hello", () => "hello");
app.Run();
```

Reading the manifest after `dotnet build` and after `dotnet publish`:

```text
build:    app.css -> app.css, app.css.gz                       (gzip only)
publish:  app.css -> app.css, app.css.gz, app.css.br           (gzip and brotli)
          20924 bytes raw, 3726 bytes gzip, 1393 bytes brotli
routes:   app.css                  Cache-Control: no-cache
          app.21z5vmge6z.css       Cache-Control: max-age=31536000, immutable
```

Every asset has two routes. The plain one (`/app.css`) revalidates every time.
The fingerprinted one (`/app.21z5vmge6z.css`) carries a hash of the content, so
the response can be cached for a year with `immutable`: when the file changes the
name changes, and the browser asks for a new URL. The docs describe the
fingerprint as a Base64-encoded SHA-256 of the content. Compression happens at
build time, so no CPU is spent compressing per request, and image and font files
that are already compressed are skipped.

### What the server sends

Against the published app (Production, `curl` on port 5310):

```text
GET /app.css                              -> 200, 20924 bytes, Cache-Control: no-cache, ETag "aqhc...", Vary: Accept-Encoding
GET /app.css  Accept-Encoding: gzip, br   -> 200, 1393 bytes,  Content-Encoding: br
GET /app.css  Accept-Encoding: gzip       -> 200, 3726 bytes,  Content-Encoding: gzip
GET /app.21z5vmge6z.css                   -> 200, Cache-Control: max-age=31536000, immutable
GET /app.css  If-None-Match: "aqhc..."    -> 304 Not Modified
```

The `Vary: Accept-Encoding` header is what keeps a cache from handing a Brotli
body to a client that cannot decode it. The `ETag` is derived from the content
hash even for the non-fingerprinted route, so a revalidation costs a 304 and no
body. In Development the docs say the framework rewrites `Cache-Control` to
`no-cache` so that edits show up, which `EnableStaticAssetsDevelopmentCaching`
turns off.

### What it will not serve

`MapStaticAssets` serves from the manifest, not by looking at the disk. Two
things follow, and both were observed. First, a file dropped into `wwwroot`
after the publish is a 404:

```text
echo late > pub/wwwroot/late.txt
GET /late.txt  -> 404           (not in the manifest)
```

Second, there are no default documents. `GET /` is also a 404 even though
`index.html` exists, while `GET /index.html` works. The docs list the cases
that stay with static file middleware: files outside the web root, files from
disk or embedded resources, custom response headers, directory browsing,
default documents and custom MIME mappings. For the default document the pair
`UseDefaultFiles` then `UseStaticFiles` is required:

```csharp
app.UseDefaultFiles();   // rewrites "/" to "/index.html"
app.UseStaticFiles();    // serves it from disk
app.MapStaticAssets();   // everything the build knew about
```

With that, `GET /` returned `index.html` and `GET /late.txt` returned `200`
from disk, and `GET /app.css` still came from the manifest endpoint, with the
build-time ETag and gzip, so the middleware did not take over a file that the
manifest endpoint already owned. The two differ in quality: per the docs, the
build-time compression and fingerprinting are not available to the file
middleware, and its ETag looked different (`"1dd5cddcb573234"`) from the
content hash of the manifest endpoints.

A related setting: the docs say `MapStaticAssets` eagerly loads the manifest
metadata, which costs memory, and for around a thousand assets or more they
recommend a bundler, or excluding a folder with the
`StaticWebAssetEndpointExclusionPattern` MSBuild property and letting
`UseStaticFiles` serve it.

### Pipeline position and short-circuit

`UseStaticFiles` is middleware, so it sits in the pipeline where you put it;
`MapStaticAssets` is an endpoint, so the whole pipeline around it runs first.
A small request logger placed before the call showed this:

```text
requests: GET /app.css, GET /api/hello
logger saw (default):                  /app.css  /api/hello
logger saw (MapStaticAssets().ShortCircuit()):  /api/hello
```

`ShortCircuit()` on the returned builder (documented for exactly this) makes the
asset response skip the remaining middleware. It also skips things you might
want, such as an authentication or CORS step, so apply it only when static
assets truly need none.

### Referring to the fingerprinted name

Fingerprinting only helps if the page links to the hashed URL. The docs say the
framework keeps the map from physical file to fingerprint and uses it to find
generated assets (scoped CSS for Blazor, files named in JS import maps) and to
generate preload links. In Razor-based UIs the template wires this up for you.
A hand-written HTML file has no such help: it links `app.css`, which works but
gets the `no-cache` revalidation, not the one-year cache.

The release notes add one .NET 10 detail: the Blazor script is now served as a
static web asset with automatic compression and fingerprinting, where it used to
come from an embedded resource in the shared framework.

## Trade-offs

- **The manifest is a build-time snapshot.** What is not in it is not served,
  and a deploy that copies files into `wwwroot` by hand loses them.
  ```csharp
  app.UseStaticFiles();   // only for files the build did not know about
  ```
- **Precompression trades disk and memory for CPU.** Publish stores three copies
  of each text asset; for rarely requested files the in-memory metadata may
  not pay off.
- **Long caching needs the hashed URL.** Linking the plain name keeps
  revalidation on every load, safe but slower; linking a fingerprinted name by
  hand goes stale when the hash changes.
- **Two mechanisms mean two behaviors.** ETags, compression and headers differ
  between the manifest and the file middleware, so test the URL you ship.
- **Short-circuiting is a speed-up with a cost.** Skipping the pipeline also
  skips middleware that adds security headers or logs requests.

## Documentation Links

- [Serve static files in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Response compression in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/response-compression) (doc)
- [ASP.NET Core Blazor static files, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/static-files) (doc)
- [Cache-Control header, MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) (doc)
