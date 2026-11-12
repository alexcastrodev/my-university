---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

The most common screen of a business app is a table with sorting and pages, and
the second most common is a list too long to render. Blazor ships a component for
each: `QuickGrid` (the `Microsoft.AspNetCore.Components.QuickGrid` package) and
`Virtualize` (in the framework). This concept builds both, shows the HTML the grid
produces, the difference between giving it an `IQueryable` and an `ItemsProvider`,
and what changed in .NET 11: the grid keeps its page and sort in the URL, so it
works in static SSR, and `Virtualize` gained anchoring and a new analyzer warning.
Everything marked as run was run on the .NET 11.0.100 GA with
`WebApplicationFactory` and bUnit 2.15.2. There was no browser, so scrolling
behavior is attributed to the documentation.

## Use Cases

- An admin or report page with sortable columns and a pager, in static SSR, with
  links that can be shared and bookmarked.
- A grid over a large table where only the visible page should be queried
  (`ItemsProvider`).
- A feed or log of thousands of rows rendered as a window (`Virtualize`).
- Testing such a page without a browser, with `WebApplicationFactory` for the HTML
  and bUnit for the component.

## Deep Dive

### QuickGrid over an IQueryable

```razor
@page "/products"

<QuickGrid Items="Catalog.All" Pagination="pagination">
    <PropertyColumn Property="p => p.Name" Sortable="true" IsDefaultSortColumn="true" />
    <PropertyColumn Property="p => p.Price" Sortable="true" />
</QuickGrid>
<Paginator State="pagination" />

@code {
    private readonly PaginationState pagination = new() { ItemsPerPage = 5 };
}
```

`Items` takes an `IQueryable<T>`; `PropertyColumn` binds a column to a property,
`Sortable` makes it sortable, and `PaginationState` plus `Paginator` provide the
pager. With 23 in-memory products, a plain `GET /products` returned the first five
rows sorted by `Name` (`Name01` to `Name05`) and the pager read `Page 1 of 5`
with `23 items`. With an Entity Framework Core `IQueryable` the documentation points to an
adapter package for async queries (the package has an `IAsyncQueryExecutor` seam;
I did not run EF here); see `blazor-data-access-and-streaming-rendering` for why the `DbContext` lifetime
matters here.

### What .NET 11 changed: state in the URL, controls as links

The request `/products?page=2&sort=Name&direction=desc` returned `Name18` to `Name14`,
and the markup shows why this works without a circuit:

```text
<th class="col-sort-desc" aria-sort="descending">
  <a class="col-title" href="http://localhost/products?page=1&amp;sort=Name&amp;direction=asc">Name ...
<a class="go-first"    href=".../products?sort=Name&amp;direction=desc" aria-disabled="true">
<a class="go-next"     href=".../products?page=2&amp;sort=Name&amp;direction=desc">
<a class="go-last"     href=".../products?page=5&amp;sort=Name&amp;direction=desc">
```

The column headers and the pager are plain anchors, and the page, the sort column
and the direction come from the query string. Things to notice, all from that run:

- The page number in the URL is **1-based** (`page=2` is the second page), while
  `PaginationState.CurrentPageIndex` is zero-based.
- The link to the first page omits `page`, and the disabled controls still carry an
  `href` with `aria-disabled="true"`.
- With `page=1` in the URL the header links kept `page=1`; I did not check what
  they do from page 3, so test the combination you ship instead of assuming.
- A test or a stylesheet that expects buttons in the header will break. The
  release notes and the breaking change page for QuickGrid describe controls
  rendering as links in 11.

The parameter names are configurable. `QuickGrid.QueryParameterNameOptions` takes a
prefix (the constructor is `QueryParameterNameOptions(string prefix)`), so that two
grids on one page do not fight over `page` and `sort`. I confirmed the type and the
defaults (`page`, `sort`, `direction`) in the reference; I did not render two grids.
`OnRowClick` also exists on the grid in 11; its behavior in the browser was not
tested.

### ItemsProvider: ask only for the slice

With `Items` the grid slices an `IQueryable`. With `ItemsProvider` you receive a
request and return one page plus the total, which is the shape for an API or a
database call:

```razor
<QuickGrid ItemsProvider="provider" Pagination="pagination"> ... </QuickGrid>

provider = async request =>
{
    var page = await Service.QueryAsync(request.StartIndex, request.Count ?? 5,
                                        request.GetSortByProperties());
    return GridItemsProviderResult.From(page.Items, page.Total);
};
```

`request.GetSortByProperties()` returns `(PropertyName, Direction)` pairs. For
`/remote?page=3&sort=Price&direction=desc` the service saw `Start=10, Count=5,
sort "Price Descending"` and the page showed `Name13` down to `Name09`, so the work
that left the server was one slice, not 23 rows. Two rules worth testing:
`TotalItemCount` must be the total after filtering (it feeds the pager), and
a provider is called with a `CancellationToken` that you should pass on.

### Virtualize: render a window, not the list

```razor
<div style="height: 200px; overflow-y: auto">
  <Virtualize Context="item" ItemsProvider="LoadAsync" ItemSize="20"
              OverscanCount="3" ItemComparer="StringComparer.Ordinal">
    <ItemContent><div class="row">@item</div></ItemContent>
    <Placeholder><div class="row placeholder">...</div></Placeholder>
  </Virtualize>
</div>
```

`Virtualize` needs a scroll container with a bounded height, an item height
(`ItemSize`, default 50 px per the reference) and a provider returning the items
of a requested range plus the total (`ItemsProviderResult<T>`). In bUnit, with the
JS runtime in loose mode and no real layout, a list of 10,000 items rendered 106
rows, the first being `Item 0`, and the provider was asked for ranges of at most
a few hundred items. The 106 is consistent with the documented `MaxItemCount`
default of 100 plus the overscan, but I did not isolate the two. What bUnit cannot
show is the scrolling: the browser side (an `IntersectionObserver`) decides which
window to request next, and that is documented, not tested here.

What 11 adds, per the release notes and the reference:

- **Anchoring.** `AnchorMode` (the enum is `VirtualizeAnchorMode`, flags that can be
  combined) controls what the viewport does at the edges when items arrive, so a
  chat or log can stay pinned to the end. The release note's example writes
  `AnchorMode="Start"`; the type exists in the GA reference, behavior not run.
- **`ScrollToItemAsync(index)`** scrolls the viewport to an item (last call wins).
- **`ItemComparer`** lets the component tell prepended items from appended ones when
  provider windows overlap.
- **Overscan.** The release notes say the default `OverscanCount` went from 3 to 15.
  I set it explicitly and did not measure the default.
- **A new analyzer warning.** Building the page without `ItemComparer` on a
  `Virtualize` with an `ItemsProvider` gave `BL0011: Virtualize uses 'ItemsProvider'
  without 'ItemComparer'. Set ItemComparer to an IEqualityComparer that identifies
  items by a unique key.` Adding the comparer silenced it. For records and types
  with value equality the reference says the default is fine.

`QuickGrid` also exposes `AnchorMode` and, when virtualized, the same machinery.

### Testing it

Two layers, as in the lab. `WebApplicationFactory` for the static page: read the
HTML, assert the rows and the hrefs. bUnit for the component: a grid loads its data
asynchronously, so the first `Markup` has no rows yet and a test must wait.

```csharp
using var ctx = new BunitContext();
ctx.JSInterop.Mode = JSRuntimeMode.Loose;          // QuickGrid and Virtualize import JS
var cut = ctx.Render<Products>();
cut.WaitForAssertion(() => Assert.Equal(5, cut.FindAll("tbody tr").Count));
```

bUnit 2 renamed things: `TestContext` is now `BunitContext` and `RenderComponent<T>`
is `Render<T>` (the old names compile with a warning or an error, depending on the
member). It ran on `net11.0` with 2.15.2.

## Trade-offs

- **`Items` is the easy path and loads through the `IQueryable`.** Fine for
  in-memory or EF Core data, but with `ItemsProvider` you own the paging and the
  total.
  ```csharp
  return GridItemsProviderResult.From(slice, totalAfterFilter);
  ```
- **State in the URL is shareable and testable, and it is also input.** `page` and
  `sort` come from the user; a sort column your provider does not know must not
  become an `OrderBy` on a string.
- **Links, not buttons, change styling and tests.** They also give working
  middle-click and back button in static SSR, at the price of a full navigation
  (or an enhanced one) per click.
- **`Virtualize` needs a fixed item height to be accurate.** With variable rows
  the scrollbar estimates, and the placeholder must have a similar height.
- **Virtualization hides the rest of the list from search and accessibility tools.**
  Content outside the window is not in the DOM, so in-page find and some screen
  reader flows will not see it.
- **Version note.** `QuickGrid` is a separate package: pin it to the same major as the
  framework (`11.0.0` here).

## Lab

In this lab you build a Blazor Web App page with `QuickGrid` (paging and sorting kept in the URL, over an `IQueryable` and over an `ItemsProvider`) and a `Virtualize` feed. The tests use `WebApplicationFactory` for the HTML of the static pages (rows and links) and bUnit 2.15.2 for the components. The lab targets `net11.0` and needs the .NET 11 SDK.

**What you will do, step by step**

1. **Paginated, sortable grid (TODO-00).** In `Products.razor`, add 5 items per page, a `Paginator`, sortable columns and a default sort by name.
2. **Page and sort from the URL (TODO-01).** `?page=2&sort=Name&direction=desc` shows `Name18` to `Name14`.
3. **Links (TODO-02).** Headers and pager are anchors with the expected hrefs.
4. **ItemsProvider (TODO-03).** In `Remote.razor`, ask the service for the requested slice only.
5. **Virtualize (TODO-04).** In `Feed.razor`, render a window of 10,000 items.
6. **bUnit (TODO-05).** The grid test needs `WaitForAssertion`; read why.

**How you know you are done:** `dotnet test` is green. **Prerequisites:** Blazor components and static SSR basics, xUnit, bUnit and the .NET 11 SDK. **How to run it:** clone the repository, go into the lab folder and run `dotnet test`.

## Documentation Links

- [ASP.NET Core Blazor QuickGrid component, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/quickgrid) (doc)
- [ASP.NET Core Razor component virtualization, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/virtualization) (doc)
- [What's new in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11?view=aspnetcore-11.0) (doc)
- [Breaking change: QuickGrid controls render as links, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/11/quickgrid-controls-render-as-links) (doc)
- [bUnit documentation](https://bunit.dev/docs/getting-started/) (doc)
