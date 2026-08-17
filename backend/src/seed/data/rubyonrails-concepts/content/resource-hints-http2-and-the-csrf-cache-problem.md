---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Most of what a user experiences as page speed happens in the browser, not
the Rails server — and one Rails-specific detail quietly defeats a whole
category of front-end caching before it can even start: the CSRF token
embedded in every rendered `<head>` makes standard HTML documents
effectively uncacheable over HTTP. Understanding resource hints, what
HTTP/2 actually changes, and where that CSRF token bites is what separates
"the server responds in 80ms" from a page that actually feels fast to load.

## Use Cases

- Deciding which resource hint (`dns-prefetch`, `preconnect`, `prefetch`,
  `prerender`) is worth using for a specific third-party resource, instead
  of reflexively adding the strongest one everywhere.
- Understanding why HTTP caching (`Cache-Control`, ETags) works well for a
  JSON API but essentially can't for a normal Rails HTML page.
- Deciding whether splitting `application.js` into vendor/app bundles still
  matters once the app is served over HTTP/2.
- Auditing whether a script injected via JavaScript (a common analytics
  pattern) is invisible to the browser's speculative preloader, and fixing
  it.

## Deep Dive

### The preloader, and the one pattern that defeats it

```html
<!-- Invisible to the preloader — parser can't see this coming: -->
<script>
  var s = document.createElement("script");
  s.src = "https://analytics.example.com/a.js";
  document.head.appendChild(s);
</script>

<!-- Visible to the preloader, downloads in parallel with parsing: -->
<script async defer src="https://analytics.example.com/a.js"></script>
```

Browsers run a lightweight secondary parser (the "preloader") that scans
ahead for resources to start downloading speculatively while the main
parser is blocked on something else — but it works by pattern-matching
literal HTML, so a script tag *created by JavaScript* is invisible to it.
The classic analytics-snippet pattern above silently loses that benefit;
a real `<script async defer>` tag doesn't.

### Resource hints, weakest to strongest

```html
<link rel="dns-prefetch" href="//cdn.example.com">
<link rel="preconnect" href="https://api.example.com">
<link rel="prefetch" href="/next-page.html">
<link rel="prerender" href="/next-page.html">
```

`dns-prefetch` resolves DNS only — the cheapest hint, and today mostly
superseded. `preconnect` does DNS + TCP + TLS ahead of time, saving up to
five round-trips; its best use is a resource whose *origin* is known but
whose *exact URL* isn't yet (something injected by a script). `prefetch`
downloads a resource for the *next* navigation, entirely (no Safari
support). `prerender` renders the entire next page speculatively — rarely
supported, and expensive because it fetches every sub-resource on that
page too. Across the top of the web, `dns-prefetch` sees real adoption;
`preconnect`/`prefetch` are used by a small fraction of sites, and
`prerender` by fewer still — using the wrong (too-strong) hint for the
situation wastes bandwidth on speculation that doesn't pay off.

### The CSRF token problem

```erb
<meta name="csrf-token" content="<%= form_authenticity_token %>">
```

This tag, present in the `<head>` of essentially every server-rendered
Rails page, means the HTML response is different per-session — which makes
it effectively **uncacheable** by any shared HTTP cache (a CDN, a shared
browser cache). Real HTTP caching (`Cache-Control`, `ETag`/`304`) works well
for a JSON API, which typically doesn't carry session state in the same
way — but "just cache the whole HTML page at the HTTP layer" doesn't work
for a normal authenticated Rails view, no matter how well the
`Cache-Control` headers are tuned.

### HTTP/2: what actually changes

```
HTTP/1.1: 6 connections per domain limit → splitting assets into many small
          files helps (parallel downloads up to that limit).
HTTP/2:   one multiplexed connection, many streams → splitting into many
          small files stops mattering the same way; header compression and
          stream prioritization become the free wins instead.
```

Concatenating and domain-sharding assets were HTTP/1.1-era optimizations
working around its connection-per-domain limit — under HTTP/2's
multiplexing, downloading many small files costs close to what one large
file costs, so that specific optimization stops paying off (though
splitting by *change frequency*, vendor vs. app code, can still make sense
for cache-busting reasons). The HTTP/2 wins that apply regardless of app
code — header compression, stream prioritization — require termination at
a CDN or reverse proxy in front of the Rails app; Rack/Rails itself doesn't
speak HTTP/2 directly.

## Trade-offs

- **A script injected via `document.createElement` silently loses
  preloader visibility** — converting it to a real `<script async defer>`
  tag is close to a free win wherever it's possible.
- **`preconnect` used on every third-party domain "just in case" spends a
  real resource (an open TCP+TLS connection) speculatively** — reserve it
  for origins that are actually going to be used, not applied reflexively
  everywhere.
- **The CSRF-token-in-`<head>` cacheability problem has no HTTP-layer
  fix** — the practical options are fragment/Russian Doll caching at the
  application layer (see that concept), or moving genuinely public content
  to a route that doesn't render the authenticity token at all.

## Documentation Links

- [Resource Hints — W3C](https://www.w3.org/TR/resource-hints/) — doc
- [Layouts and Rendering in Rails — CSRF meta tags](https://guides.rubyonrails.org/layouts_and_rendering.html) — doc
- [The Complete Guide to Rails Performance — Resource Hints, HTTP/2 and You](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
