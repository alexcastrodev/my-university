---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A static SSR page forgets everything when the response leaves: no circuit, no
component instance, no fields. Yet a real page needs a "saved" message after a
redirect, a cart that survives a click, a filter that survives a reload. This
concept compares the five places that state can live in a static SSR Blazor app
(the query string, the posted form, TempData, the session and the output of a
cached block), and what .NET 11 added: `[SupplyParameterFromTempData]`,
`[SupplyParameterFromSession]`, `ITempData` and the `CacheView` component. Everything
below was run on the .NET 11.0.100 GA with `WebApplicationFactory`, reading the HTML
and the `Set-Cookie` headers. No browser was involved, so client-only behavior is
attributed to the documentation.

## Use Cases

- A "saved" message after Post/Redirect/Get, shown once and gone on refresh.
- A cart or a wizard step kept per visitor without a database row.
- A slow, shared fragment (a news box, a menu) rendered once and served from
  memory for the next requests.
- Choosing between a cookie and the server for state, and knowing what each costs.

## Deep Dive

### Five places, one question: who owns the value and for how long

| Mechanism | Lives in | Lifetime | Typical use |
|---|---|---|---|
| Query string, `[SupplyParameterFromQuery]` | the URL | as long as the link | filters, paging |
| Posted form, `[SupplyParameterFromForm]` | the request body | one request | the submit itself |
| TempData | a cookie (or the session) | until read once | flash message after a redirect |
| Session | server memory plus an id cookie | until it expires | cart, wizard |
| `CacheView` | server memory, shared | until it expires | an expensive fragment |

`[PersistentState]` is not in the table on purpose: it carries a value from the
prerender to the interactive instance of the same page, which is a different
problem. See `blazor-data-access-and-streaming-rendering`. The form and query rows
are covered in `blazor-static-ssr-and-enhanced-navigation` and
`blazor-routing-layouts-and-navigation`; the rest of this concept is about the three
new ones.

### TempData: a flash message across the redirect

The page below saves in the POST handler and redirects to itself. The property is
filled from TempData on the next GET:

```razor
@page "/flash"
@inject NavigationManager Nav

<p id="message">@Shown</p>

<EditForm Model="Model" FormName="flash" OnValidSubmit="Submit" Enhance>
    <InputText @bind-Value="Model.Text" />
    <button type="submit">Save</button>
</EditForm>

@code {
    [SupplyParameterFromTempData] private string? Message { get; set; }
    [SupplyParameterFromForm] private FlashModel Model { get; set; } = default!;
    private string? Shown;

    protected override void OnInitialized()
    {
        Model ??= new();
        Shown = Message;
        Message = null;          // consume it, see below
    }

    private void Submit()
    {
        Message = $"saved {Model.Text}";
        Nav.NavigateTo("flash");
    }
}
```

Posting `Text=hello` with `curl`-style requests through `WebApplicationFactory`:

```text
POST /flash        302  Location: /flash
                        Set-Cookie: .AspNetCore.Components.TempData=CfDJ8...; path=/; samesite=lax; httponly
GET  /flash        <p id="message">saved hello</p>
GET  /flash        <p id="message"></p>
```

The cookie is HttpOnly, SameSite=Lax and its value starts with `CfDJ8`, the prefix of
a Data Protection payload, so TempData rides on the key ring described in
`data-protection-key-ring-and-purposes` (in a farm, every node needs the same ring).
A second client, with its own cookie jar, saw an empty message: the value belongs to
one browser.

Two details cost me time. First, **reading the property does not delete the value**:
in my first version, without `Message = null`, three GETs in a row all showed
`saved a`. Assigning `null` after reading is what makes it one-shot with the
attribute. Second, the `ITempData` service (a cascading parameter) works the other
way around, and that is the API that has the one-shot rule built in:

```razor
[CascadingParameter] public ITempData? TempData { get; set; }
// Peek("flash")  reads without removing
// Get("flash")   reads and schedules the removal
// Keep() / Keep("flash")  keeps for one more request
```

Run: after the handler wrote `TempData["flash"] = "manual x"` and redirected, the
first GET read `manual x` with both `Peek` and `Get`, the second GET read nothing
and the response cleared the cookie (`expires=Thu, 01 Jan 1970`). Choose the
attribute for the simple case, `ITempData` when you need `Peek` or `Keep`.

Where TempData is stored is a setting: `RazorComponentsServiceOptions.TempDataProviderType`
accepts `Cookie` (the default) and `SessionStorage`, and `TempDataCookie` shapes the
cookie. I switched to `SessionStorage` and the POST response no longer carried the
TempData cookie; the value lived in the session under the key `__BlazorTempData` as
`{"flash":{"type":"System.String","value":"manual x"}}`. The cookie option keeps
the server stateless and is bounded by the browser's cookie size; the session
option needs a session store that every node can reach.

Also note the compiler warning I got while writing the page: `BL0008` says that
`[SupplyParameterFromForm]` plus a property initializer can be overwritten with
`null` on a post. Use `default!` and `Model ??= new()` in `OnInitialized`, as above.

### Session: the cart that survives

`[SupplyParameterFromSession]` reads and writes a value in `HttpContext.Session`. It
needs the session services and middleware, which are not part of
`AddRazorComponents()`:

```csharp
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession();
// ...
app.UseSession();
app.MapRazorComponents<App>();
```

```razor
[SupplyParameterFromSession] private string? Items { get; set; }
private void Add() { Items = string.IsNullOrEmpty(Items) ? Model.Item : $"{Items},{Model.Item}"; }
```

Two POSTs (`apple`, `pear`) and then two GETs showed `apple,pear` both times, and a
new client saw `empty`. What the attribute wrote into the session is not a plain
string:

```text
items={"type":"System.String","value":"apple"}
```

The key came out as `items`, in lower case, and the value is a small JSON envelope.
So `Session.SetString("Items", "manual")` in some other endpoint created a second,
unrelated key and the page still showed `apple`. If other code must share the
value, go through the same attribute or the same format, or read it with
`ISession` using the exact key and envelope you saw. The session itself is the
usual ASP.NET Core one: a cookie with an id, and the data in `IDistributedCache`.
`AddDistributedMemoryCache()` is per process, so more than one instance needs
a shared cache such as Redis (see `caching-imemorycache-hybridcache-and-distributed`).

### CacheView: cache a block of the page

`CacheView` renders its child content once and serves the stored HTML afterwards.
According to the reference documentation, on a hit the child components are not
instantiated or rendered at all. It varies by what you list:

```razor
<CacheView VaryByQuery="category" ExpiresAfter="TimeSpan.FromMinutes(5)">
    <p id="stamp">@DateTime.UtcNow.Ticks</p>
    <p id="category">@(Category ?? "all")</p>
</CacheView>
```

Requests with `DateTime.UtcNow.Ticks` as a probe:

```text
/news              639300741948323260  all
/news              639300741948323260  all      (same ticks: served from cache)
/news?category=a   639300741948368530  a
/news?category=a   639300741948368530  a        (cached)
/news?category=b   639300741948375460  b        (new entry)
```

The other `VaryBy*` properties in the 11.0.0 reference are `VaryByRoute`,
`VaryByHeader`, `VaryByCookie`, `VaryByUser`, `VaryByCulture` and a free `VaryBy`
string, plus `Enabled`, `CacheKey`, `ExpiresAfter`, `ExpiresOn` and `ExpiresSliding`.
The store is in memory by default, with a size limit (`CacheViewSizeLimit`, 100 MB
by default according to the docs); if a `HybridCache` is registered it is used
instead, and then sliding expiration is not supported. I did not exercise these
last points. It is a different tool from output caching (`output-caching-and-http-caching`):
that caches a whole response by policy, this one caches a part of a page inside the
component tree.

### Smaller additions, and the CSRF side of all this

`<BasePath />` renders `<base href="/" />` from the app's base path, replacing the
hand-written tag (run: the output was exactly `<base href="/" />`). The release
notes also list `EnvironmentView` and `DisplayName`; I did not run those two.

Every pattern here starts with a POST, so the CSRF rule matters. With no
`UseAntiforgery()` in the pipeline, a POST to a page behaved like this on the GA:

```text
no Sec-Fetch-Site, no Origin                       302
Sec-Fetch-Site: same-origin                        302
Sec-Fetch-Site: cross-site                         400
Origin: http://evil.example                        400
Sec-Fetch-Site: same-origin + Origin: http://localhost  302
```

That is the automatic check described in `csrf-protection-antiforgery-tokens-and-fetch-metadata`
and `whats-new-in-aspnet-core-11`, and it protects the flash and cart forms without
a token. A client that sends no browser headers at all (as my test client) passes.

## Trade-offs

- **A cookie is bounded and travels on every request.** TempData in a cookie is
  stateless on the server but limited by the cookie size, so keep messages short and
  keep objects out.
  ```csharp
  Message = "saved";   // an id or a short text, not a whole model
  ```
- **The attribute does not make TempData one-shot by itself.** Reading the property
  leaves the value in place; assign `null` after the read or use `ITempData.Get`.
  ```csharp
  Shown = Message; Message = null;
  ```
- **Session is per visitor but costs memory and a shared store.** It works out of the
  box on one instance with `AddDistributedMemoryCache`, and silently loses data on a
  second instance unless the cache is shared.
- **The session key and format belong to the attribute.** Code that writes the same
  key by hand with `SetString` will not be read back, and the other way around.
- **`CacheView` is shared across users unless you vary it.** A block that shows
  anything personal must vary by user (`VaryByUser`) or stay out of the cache, and
  stale data is the price of the expiration you chose.
  ```razor
  <CacheView VaryByUser="true" ExpiresAfter="TimeSpan.FromMinutes(1)">...</CacheView>
  ```
- **This is static SSR state.** Interactive components have the circuit for live
  state; these tools exist because static pages do not.

## Lab

In this lab you build a Blazor Web App that uses only static server-side rendering and keeps state across requests in three ways: a flash message through TempData after a Post/Redirect/Get, a cart in the session, and a news block cached by `CacheView` per query string value. The tests call the app in memory with `WebApplicationFactory`, keep one cookie jar per `HttpClient` (one browser each) and read the HTML and the `Set-Cookie` headers. No browser is involved. The lab targets `net11.0` and needs the .NET 11 SDK.

**What you will do, step by step**

1. **Flash message (TODO-00).** In `Flash.razor`, supply `Message` from TempData so `GET /flash` shows `saved hello` once after the POST.
2. **One browser, one message (TODO-01).** A second client must not see it.
3. **Cart in the session (TODO-02).** In `Cart.razor` supply `Items` from the session and register session in `Program.cs`.
4. **Cached block (TODO-03).** In `News.razor`, wrap the block in `CacheView` varying by `category`.
5. **Base path (TODO-04).** In `App.razor`, emit `<base href="/" />` with `BasePath`.
6. **Bonus.** Read `ShouldStoreTempDataInSessionWhenConfigured` and find the option that moves TempData to the session.

**How you know you are done:** `dotnet test` is green. **Prerequisites:** static SSR basics and the .NET 11 SDK (xUnit, `Microsoft.AspNetCore.Mvc.Testing` 11.0.0). **How to run it:** clone the repository, go into the lab folder and run `dotnet test`; use `--filter "Category!=Bonus"` for the required part.

## Documentation Links

- [What's new in ASP.NET Core 11, Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11?view=aspnetcore-11.0) (doc)
- [ASP.NET Core Blazor state management, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management/) (doc)
- [Session and state management in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/app-state) (doc)
- [ASP.NET Core Blazor forms overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/) (doc)
