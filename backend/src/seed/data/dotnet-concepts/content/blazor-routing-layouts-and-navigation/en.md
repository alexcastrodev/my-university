---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A Blazor page is a component with a URL. Everything around that URL is a small
set of mechanisms that are easy to use and easy to misread: the route template
and its constraints, the query string, the `NavLink` that highlights the current
page, the layouts that wrap it, the `NavigationManager` that moves between pages,
and, new to .NET 10, what happens when nothing matches. This concept follows a
request through those mechanisms in a running Blazor Web App and records what
each one actually did, including the cases that return `404` or `500`.

## Use Cases

- Designing URLs for a page: required, optional and catch-all parameters, and
  constraints that reject bad values before your code runs.
- Reading filters and paging from the query string without parsing it by hand.
- Highlighting the active menu entry correctly, including when the URL has a
  query string.
- Giving a section of the site its own chrome with nested layouts, without
  repeating markup in each page.
- Returning a proper "not found" page, with a `404` status, when an id does not
  exist.

## Deep Dive

### From `@page` to a route

A component with an `@page` directive is compiled into a class that carries a
`RouteAttribute`. The `Router` in `Routes.razor` scans the assembly you give it
and hands the matching component to `RouteView`. This is the template's file for a
Blazor Web App on SDK 10.0.100:

```razor
<Router AppAssembly="typeof(Program).Assembly"
        AdditionalAssemblies="new[] { typeof(Client._Imports).Assembly }"
        NotFoundPage="typeof(Pages.NotFound)">
    <Found Context="routeData">
        <RouteView RouteData="routeData" DefaultLayout="typeof(Layout.MainLayout)" />
        <FocusOnNavigate RouteData="routeData" Selector="h1" />
    </Found>
</Router>
```

`AdditionalAssemblies` is how routable components in the `.Client` project are
found. `DefaultLayout` is the layout for pages that do not choose one, and
`FocusOnNavigate` moves focus to the first `<h1>` after a navigation so screen
readers announce the new page. The documentation distinguishes two routers. When
the page is rendered statically, the router uses endpoint routing and the HTTP
path. If you give `Routes` an interactive render mode, the router becomes
interactive and follows the document URL without a request to the server.

### Route templates and constraints

One component can have several `@page` lines, and parameters are matched to
`[Parameter]` properties by name, case-insensitively. A component with these
routes was requested with `curl` in a running app:

```razor
@page "/rt/products/{Id:int}"
@page "/rt/p/{Id:int}"
@page "/rt/opt/{Name?}"
@page "/rt/files/{*Path}"
```

| Request | Status | Result |
|---|---|---|
| `/rt/products/42` | 200 | `Id=42` |
| `/rt/p/7` | 200 | `Id=7` (second route of the same component) |
| `/RT/Products/42` | 200 | `Id=42`, the URL keeps the casing the client sent |
| `/rt/products/abc` and `/rt/products/1.5` | 404 | the `int` constraint rejected the segment |
| `/rt/opt` and `/rt/opt/ana` | 200 | `Name` is null, then `ana` |
| `/rt/files/a/b/c.txt` | 200 | `Path=a/b/c.txt` (catch-all keeps the slashes) |
| `/rt/guid/3f2504e0-...` and `/rt/guid/zzz` | 200 and 404 | `guid` constraint |

A failed constraint is not an error in your code: the route simply does not match
and the request ends in the not-found path described below. The documentation
lists `bool`, `datetime`, `decimal`, `double`, `float`, `guid`, `int`, `long` and
`nonfile`. The numeric and date constraints parse with the invariant culture, so
they assume a non-localized URL. `nonfile` matters for a root-level optional
parameter such as `@page "/{optional:nonfile?}"`, which without it can capture the
URL of a stylesheet. The catch-all parameter is always a `string` and must be
last.

### Query strings

Route parameters do not read the query string. Use `[SupplyParameterFromQuery]`:

```razor
@page "/rt/q"
@code {
    [SupplyParameterFromQuery] public int Page { get; set; }
    [SupplyParameterFromQuery(Name = "t")] public string? Tag { get; set; }
}
```

| Request | Result |
|---|---|
| `/rt/q` | `Page=0 Tag=(null)` |
| `/rt/q?Page=3&t=x` | `Page=3 Tag=x` |
| `/rt/q?page=4` | `Page=4` (name matching is case-insensitive) |
| `/rt/q?Page=abc` | 500 |

The last row is the one to remember. The server log shows
`InvalidOperationException: Cannot parse the value 'abc' as type 'System.Int32'
for 'Page'`, so a typed query parameter turns a malformed URL into a server error
and not into a default. For input that users can edit by hand, take a `string?`
and parse it with `int.TryParse`.

### NavigationManager

The injected `NavigationManager` knows where you are and builds URLs without
string concatenation. On `/rt/q?Page=3&t=x` it printed:

```text
Uri         http://localhost:5320/rt/q?Page=3&t=x
BaseUri     http://localhost:5320/
Relative    rt/q?Page=3&t=x                  (ToBaseRelativePath(Uri))
Next        http://localhost:5320/rt/q?Page=4&t=x   (GetUriWithQueryParameter("Page", Page + 1))
```

`GetUriWithQueryParameter` replaces one parameter and keeps the others.
`NavigateTo(url)` moves to another page, using enhanced navigation when it is
available unless you pass `forceLoad: true`, and `Refresh()` reloads the current
one. Relative `href` values resolve against the `<base href="/">` in `App.razor`,
which is why the template's links have no leading slash.

### NavLink

`NavLink` renders an `<a>` and adds the `active` class (and
`aria-current="page"`) when its `href` matches the current URL. `Match` controls
the rule. Three links on `/rt/q`, with `rt/q` as `NavLinkMatch.All`, `rt` as
`NavLinkMatch.Prefix` and `rt/other` with the default:

```text
<a id="all"    href="rt/q"     class="active" aria-current="page">
<a id="prefix" href="rt"       class="active" aria-current="page">
<a id="other"  href="rt/other">
```

The same output came back for `/rt/q?Page=2` and `/rt/q#frag`. That is the .NET
10 behavior listed in the release notes: with `NavLinkMatch.All` the query string
and fragment are now ignored, and an `AppContext` switch restores the old rule.
Use `Prefix` for a section link ("Products" active on any product page) and `All`
for the home link, otherwise `/` matches everything.

### Layouts, nested and per folder

A layout is a component that inherits `LayoutComponentBase` and renders `@Body`.
A layout can itself declare a layout, which is how nesting works. With
`InnerLayout` declaring `@layout OuterLayout` and `OuterLayout` declaring
`@layout MainLayout`, a page with `@layout InnerLayout` rendered, from the
outside in:

```text
MainLayout (sidebar, content area)
  OuterLayout   <div data-layout="Outer"><h2>Outer layout</h2>
    InnerLayout <div data-layout="Inner"><h3>Inner layout</h3>
      page      <h1>Nested page</h1>
```

A page without `@layout` got `MainLayout` from `DefaultLayout`. Putting
`@layout InnerLayout` in a folder's `_Imports.razor` applied it to every page
under that folder: a page with no `@layout` of its own rendered inside both inner
and outer layouts. That is the cheap way to give `/admin/*` its own frame.

### Handling "not found" in .NET 10

Three different situations ended the same way in the template app: a URL that
matches no route (`/does-not-exist`), a constraint that fails
(`/rt/products/abc`) and a page that calls `NavigationManager.NotFound()`
(`/rt/missing/500`). Each returned `404` with the body of the `/not-found` page,
because the template calls `UseStatusCodePagesWithReExecute("/not-found")` and
sets `NotFoundPage` on the router. Requesting `/not-found` directly returns
`200`, since it is an ordinary page.

`NotFound()` also works when the router is interactive. With `Routes` set to
`InteractiveServer` and prerendering off, a button that called `NotFound()`
replaced the page content with the Not Found page, left the URL unchanged and did
not reload the page. The same button in an interactive island, with the
template's static `Routes`, did nothing visible, because no interactive router
existed to react. `NotFoundPage`, `NavigationManager.NotFound()` and the
`OnNotFound` event are in the ASP.NET Core 10 release notes, which also say the
old `<NotFound>` fragment is not supported when `NotFoundPage` is used.

## Trade-offs

- **A failed constraint looks like a missing page.** Debugging "why does this URL
  404" means checking the constraint before the data, and the constraint's culture
  is invariant.
  ```razor
  @page "/orders/{Id:int}"   @* /orders/abc is a 404, not an exception *@
  ```
- **Typed query parameters can throw.** `[SupplyParameterFromQuery]` with an
  `int` returns `500` on `?Page=abc`.
  ```csharp
  [SupplyParameterFromQuery(Name = "page")] public string? PageText { get; set; }
  private int Page => int.TryParse(PageText, out var p) && p > 0 ? p : 1;
  ```
- **`OnInitialized` does not rerun when only the parameters change.** The
  documentation warns that navigating from `/user/1` to `/user/2` reuses the
  component instance, so load data in `OnParametersSetAsync`.
- **Nested layouts multiply the markup you have to keep consistent.** Each level
  is another wrapper `div` and another place a CSS rule can leak, so keep the
  chain short and put shared chrome in one layout.
- **`NotFound()` needs a router that can hear it.** In static SSR it becomes a
  `404` plus the re-executed page, in interactive mode it needs an interactive
  `Routes`. Test both paths if your site mixes them.
- **Relative `href` depends on `<base>`.** A link like `href="rt/q"` breaks if the
  `<base href>` is missing or wrong, for example behind a path prefix.

## Documentation Links

- [ASP.NET Core Blazor routing and navigation, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/routing) (doc)
- [ASP.NET Core Blazor navigation, NavigationManager and NavLink, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/navigation) (doc)
- [ASP.NET Core Blazor layouts, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/layouts) (doc)
- [What's new in ASP.NET Core 10, Blazor NotFound handling, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [Handle errors in ASP.NET Core, status code pages re-execution, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling) (doc)
