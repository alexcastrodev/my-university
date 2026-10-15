---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Three small pieces make an ASP.NET Core site "secure by default" at the transport
level: HTTPS redirection sends plain HTTP clients to HTTPS, HSTS tells browsers to
never try plain HTTP again, and a local-URL check stops your own redirects from
being turned into phishing links. Each one has a precondition that fails
silently. Redirection does nothing when it cannot work out the HTTPS port, HSTS
is deliberately off on `localhost`, and `Results.Redirect` follows whatever
string it is given. The goal is to know what each piece reads, what it sends,
and how to see that it works, using only `curl` against a running app.

## Use Cases

- Moving a site from HTTP to HTTPS and choosing a safe first `max-age`.
- Debugging "the redirect does not happen" or "the redirect loops" behind a
  proxy.
- Handling `returnUrl` after a login without creating an open redirect.
- Deciding what an API (not a website) should do with plain HTTP requests.
- Setting up the local development certificate without surprises in
  containers.

## Deep Dive

### What UseHttpsRedirection needs: a port

The middleware answers an HTTP request with a redirect to the HTTPS URL, so it
must know the HTTPS port. `HttpsRedirectionOptions.HttpsPort` is `null` by
default, and the docs list where it is resolved from: code, the `https_port`
host setting (also `ASPNETCORE_HTTPS_PORT` or a top-level `"https_port"` in
`appsettings.json`), an `https://` entry in `ASPNETCORE_URLS`, the
`launchSettings.json` HTTPS URL, or an HTTPS endpoint of a public-facing Kestrel.
The docs do not state a precedence order, and
`ASPNETCORE_HTTPS_PORT` is not the same thing as `ASPNETCORE_HTTPS_PORTS`, which
configures Kestrel endpoints.

This app (a file-based app, SDK 10.0.100, with a throwaway self-signed
certificate loaded from a `.pfx`, so no machine-wide certificate changes) was run
in `Production` with both endpoints:

```csharp
#:sdk Microsoft.NET.Sdk.Web
using Microsoft.AspNetCore.Http.HttpResults;
var b = WebApplication.CreateBuilder(args);
b.WebHost.ConfigureKestrel(k => k.ConfigureHttpsDefaults(h =>
    h.ServerCertificate = X509CertificateLoader.LoadPkcs12FromFile("c.pfx", "x")));
var app = b.Build();
app.UseHsts();
app.UseHttpsRedirection();
app.MapGet("/", (HttpContext c) => $"scheme={c.Request.Scheme}");
app.Run();
// ASPNETCORE_URLS="http://localhost:5300;https://localhost:5301"
```

```text
curl -i  http://localhost:5300/   -> 307 Temporary Redirect, Location: https://localhost:5301/
curl -ik https://localhost:5301/  -> 200, "scheme=https"
```

Two observations. The status is `307`, the documented default, because
permanent redirects get cached by browsers and make development painful. A
permanent `308` is opt-in (`options.RedirectStatusCode`) and the docs suggest
setting it only outside Development. Second, the port came from the
`ASPNETCORE_URLS` HTTPS entry with no extra code.

The failure mode is the interesting one. With only the HTTP URL configured, the
same app answered the plain request with `200` and logged
`Failed to determine the https port for redirect.` Nothing crashed, and nothing
was redirected. With `ASPNETCORE_HTTPS_PORT=443` set, the redirect went to
`https://localhost/` (the default port is omitted from the URL). That is the fix
behind a TLS-terminating proxy: Kestrel only sees HTTP, so you tell the app the
public port explicitly and make `UseForwardedHeaders` run first, as the hosting
concept explains.

### HSTS: a header the browser remembers

`Strict-Transport-Security` tells a browser: for the next `max-age` seconds,
talk to this host only over HTTPS, even if the user types `http://`. That
removes the unprotected first hop that a redirect always leaves. The options
and their defaults, per the docs: `MaxAge` is 30 days, `IncludeSubDomains` and
`Preload` are off, and `ExcludedHosts` contains `localhost`, `127.0.0.1` and
`[::1]`. The templates call `UseHsts` only outside Development, because the
header is "highly cacheable by browsers" and one run on `localhost` would
otherwise pin your other local projects to HTTPS.

Observed on the app above (`UseHsts` before the redirect middleware):

```text
https://localhost:5301/              (default ExcludedHosts)    -> no Strict-Transport-Security header
https://localhost:5301/              (ExcludedHosts.Clear())    -> strict-transport-security: max-age=2592000
http://localhost:5300/                                          -> 307, and no HSTS header on the HTTP response
```

`2592000` is 30 days in seconds. The header is only sent on HTTPS responses,
and browsers ignore it when it arrives over plain HTTP (RFC 6797).

Rolling it out is where the damage happens, because you cannot take the header
back. The docs recommend starting with a `MaxAge` of hours, a day at most, so
you can revert, and raising it (commonly to a year) once you are sure.
`IncludeSubDomains` commits every subdomain to HTTPS, including that forgotten
internal one. `Preload` is not part of RFC 6797; it opts you into the browser
preload lists, which is effectively permanent.

```csharp
builder.Services.AddHsts(o =>
{
    o.MaxAge = TimeSpan.FromHours(6);   // first rollout; raise later
    o.IncludeSubDomains = false;        // only when every subdomain serves HTTPS
});
```

### Redirect to a returnUrl: IsLocalUrl

A login page that does `Results.Redirect(returnUrl)` will happily redirect to
`https://evil.com/phish` if that is what the query string says. Observed:

```text
GET /go?returnUrl=https://evil.com/phish   (Results.Redirect)  -> 302, Location: https://evil.com/phish
```

ASP.NET Core 10 added `RedirectHttpResult.IsLocalUrl(url)` (documented in the
ASP.NET Core 10 release notes). A URL is local when it has no host or authority
section and has an absolute path; `~/` virtual paths count as local too. These
are real results of the helper:

```text
/home                -> True        /a/b?x=1             -> True
~/x                  -> True        //evil.com           -> False
/\evil.com           -> False       https://evil.com     -> False
http://localhost:5300/x -> False       "" and x/y           -> False
```

Notice that an absolute URL to your own host is `False` too: the check is about
shape, not about which site you are on. Use it as a guard:

```csharp
app.MapGet("/safe", (string? returnUrl) =>
    RedirectHttpResult.IsLocalUrl(returnUrl)
        ? Results.LocalRedirect(returnUrl!)
        : Results.Redirect("/"));
```

`/safe?returnUrl=https://evil.com/phish` answered `302` to `/`, and
`/safe?returnUrl=/dashboard` answered `302` to `/dashboard`. The related
`Results.LocalRedirect` already enforces the rule by throwing; given
`https://evil.com` it produced a `500` with
`InvalidOperationException: The supplied URL is not local.` That is safe but
ugly, so check first and fall back to a default page.

### APIs are different from websites

The docs say a web API should either not listen on HTTP at all or close the
connection with a `400` instead of serving the request. Redirecting an API
client is risky because clients may not follow the redirect, or may already have
sent the body over HTTP. The docs add that `UseHttpsRedirection` on an HTTP
endpoint causes `ERR_INVALID_REDIRECT` on CORS preflight requests, and that the
default API templates do not include HSTS because it is a browser-only
instruction. For a pure API, bind only HTTPS (`ASPNETCORE_URLS` or `--urls`).

### The development certificate

`dotnet dev-certs https` manages the development certificate. Per the docs, the
first run installs it in the user store as not trusted, `--trust` is the one-time
trust step on Windows and macOS (Linux trust is distribution specific),
`--clean` removes it, and `-ep <file> --format PEM` exports it. Do not create it
in images or VMs that get redistributed; set
`DOTNET_GENERATE_ASPNET_CERTIFICATE=false` before the first CLI call. These
commands change the user's certificate store, so the experiments above avoided
them and used a throwaway certificate with `curl -k`. The `-k` flag is for local
experiments only.

## Trade-offs

- **Redirect without a port is a silent no-op.** The app starts, serves HTTP,
  and only a log line tells you.
  ```csharp
  builder.Services.AddHttpsRedirection(o => o.HttpsPort = 443); // explicit behind a proxy
  ```
- **HSTS is a one-way door for `max-age` seconds.** A mistake cannot be rolled
  back from the server; start with hours and raise it once HTTPS is proven for
  every host under the domain.
- **`Preload` and `IncludeSubDomains` widen the commitment.** They are right for
  a finished site and wrong for one with legacy HTTP subdomains.
- **A redirect still lets the first request travel in clear text.** HSTS closes
  that window only after the browser has seen the header once; for APIs, refusing
  HTTP is stronger than redirecting.
- **`IsLocalUrl` checks shape, not intent.** It blocks external targets, but it
  will not stop a local path that leads to a page you did not want to expose;
  authorization still applies after the redirect.

## Documentation Links

- [Enforce HTTPS in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/enforcing-ssl) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer) (doc)
- [Prevent open redirect attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/preventing-open-redirects) (doc)
- [HTTP Strict Transport Security Protocol, RFC 6797](https://www.rfc-editor.org/rfc/rfc6797) (doc)
