---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Static server-side rendering (static SSR) is the Blazor mode with no circuit and
no WebAssembly: a request comes in, the Razor component tree renders to HTML, the
response goes out and the server forgets the page. It is the right default for
most pages, and with three additions it feels much less like the 2005 version of
the web: enhanced navigation (links that do not reload the page), enhanced forms
(posts that do not reload the page) and streaming rendering (a page that shows
placeholders now and the real data when it is ready). This concept explains how
each of the three works on the wire, what the antiforgery token has to do with
form binding, and which mistakes produce a silent `400`.

## Use Cases

- Building a content, admin or CRUD site as server-rendered pages with
  `EditForm`, without shipping a WebAssembly runtime or holding a circuit open.
- Making page-to-page navigation feel instant without turning every page
  interactive.
- Showing a page shell immediately while a slow query or API call finishes, using
  `[StreamRendering]`.
- Debugging a form that posts but never binds, or a post that returns
  `400 Bad Request` with no stack trace.

## Deep Dive

### What static SSR needs

The project created with `dotnet new blazor -int None` (SDK 10.0.100) shows the
whole setup. There is no `AddInteractiveServerComponents` and no
`AddInteractiveWebAssemblyComponents`:

```csharp
builder.Services.AddRazorComponents();
// ...
app.UseAntiforgery();
app.MapStaticAssets();
app.MapRazorComponents<App>();
```

`@page` components become endpoints, a request runs the component tree once, and
the output is HTML. `UseAntiforgery()` is part of the pipeline because forms are
a first-class feature here, and the template places it right before the
endpoints. Events like `@onclick`
do nothing on a static page, because nothing is listening in the browser.

### Enhanced navigation

`blazor.web.js` intercepts a click on an in-app link and runs a `fetch` for the
target instead of letting the browser load a new document. The server returns the
complete page, and the script patches the differences into the current DOM. I
confirmed it in a browser on two pages that link to each other:

| Check after clicking the link | Enhanced link | Link with `data-enhance-nav="false"` |
|---|---|---|
| URL changed | yes | yes |
| Content updated (a render timestamp) | yes | yes |
| A `window` variable set before the click | still there | gone |
| An expando property on the `<h1>` element | still there (same element) | gone (new element) |
| Network | one `GET` for the page | page, CSS, scripts and favicon requested again |

The request carries `Accept: text/html; blazor-enhanced-nav=on`, and the response
has a `blazor-enhanced-nav: allow` header (plus an `ssr-framing` header). A
`curl` of the same URL with and without that `Accept` returns the same page: a
`diff` of the two shows only the render timestamp and a trailing HTML comment
with the Blazor initializers, which the enhanced response leaves out (8156 against
8367 bytes). So enhanced navigation is a client-side optimization over normal
server rendering, and without the header the page still works with a full load.

Opt out per link or per subtree with `data-enhance-nav="false"`. According to the
documentation, a destination that is not a Blazor endpoint makes the script retry
as a normal page load, and a hand-built DOM change that the server does not
render can be protected from patching with `data-permanent`.
`NavigationManager.NavigateTo` behaves the same way: with `forceLoad: false` it
uses enhanced navigation when available, and `Refresh()` re-fetches the current
page through the same path.

### Forms: binding and the antiforgery token

An `EditForm` on a static page needs a name, a model that is bound from the
posted fields, and `Enhance` if you want the no-reload behavior:

```razor
@page "/ssr/form"
<EditForm Model="Model" FormName="contact" OnValidSubmit="Submit" Enhance>
    <DataAnnotationsValidator />
    <InputText @bind-Value="Model.Name" />
    <ValidationMessage For="() => Model.Name" />
    <button type="submit">Send</button>
</EditForm>

@code {
    [SupplyParameterFromForm] private Contact? Model { get; set; }
    protected override void OnInitialized() => Model ??= new();
    private string? result;
    private void Submit() => result = $"Hello {Model!.Name}";
}
```

`[SupplyParameterFromForm]` is empty on the first GET and filled from the request
body on the POST, which is why the `??=` is needed. The markup the server
produced shows what makes a post work:

```text
<form method="post" data-enhance="" action="/ssr/form">
  <input type="hidden" name="_handler" value="contact" />
  <input type="hidden" name="__RequestVerificationToken" value="..." />
  <input name="Model.Name" class="valid" />
```

`_handler` is the `FormName`, `__RequestVerificationToken` is the antiforgery
token (with a matching cookie), and the field name `Model.Name` is the property
path used for binding. Posting to that URL with `curl` gave:

| POST | Status | Outcome |
|---|---|---|
| Token and cookie, `Name=Ana` | 200 | `Hello Ana` rendered |
| Token and cookie, `Name=A` | 200 | validation message, no result |
| No token field | 400 | "A valid antiforgery token was not provided with the request" |
| Token but no cookie | 400 | same message |
| Unknown `_handler` | 400 | "Cannot submit the form 'other' because no form on the page currently has that name." |

`EditForm` renders the token for you. A plain `<form method="post">` does not:
it needs `<AntiforgeryToken />` inside it and `@formname` on it, otherwise the
post is rejected with the same `400`. On a second test page a post to the form
with `<AntiforgeryToken />` bound `Q=hello`, and a post to the form without it
failed with `400`.

### Enhanced forms and redirects

With `Enhance` (or `data-enhance` on a plain `<form>`) the script posts with
`fetch` and patches the response. In the browser an invalid submit and then a
valid one kept the same `<input>` element and a `window` variable, left the URL
at `/ssr/form`, and updated the validation message and the result in place.
Setting `data-enhance` on a wrapper element does not enable it for the form
inside, the documentation says it must be on the form.

The usual post-redirect-get works through `NavigationManager.NavigateTo`. In my
run a handler that called `NavigateTo("/ssr/nav/a")` answered the post with
`302 Found` and a `Location` header, and with the enhanced header the response
also carried `blazor-enhanced-nav: allow`. In .NET 10 the Blazor Web App template
sets `BlazorDisableThrowNavigationException` to true in the `.csproj`, which the
documentation says changes static SSR redirects so that code after `NavigateTo`
now keeps running. Put the `NavigateTo` last, or `return` after it.

### Streaming rendering

Normally the response is sent after `OnInitializedAsync` finishes. With
`@attribute [StreamRendering]` (`[StreamRendering(true)]` in .NET 8) the first
render, with placeholders, is flushed first and the finished render follows on
the same response. Two pages with `await Task.Delay(2000)` and a chunk log from
`curl -N`:

```text
/ssr/nostream   +2.0s  8100 bytes  "Loaded ok"
/ssr/stream     +0.0s  5696 bytes  "Loading..."
                +2.0s   145 bytes  <blazor-ssr><template blazor-component-id="16">
                                   <h1>Stream</h1><p id="data">Loaded ok</p></template>...
```

The second chunk is a `<template>` that `blazor.web.js` moves into place. So the
page shell arrives immediately, and the cost is that the status code and headers
were already sent: an error after the first flush can no longer become a
different status. The documentation adds that the host must not buffer the
output, and that where a proxy buffers, the page degrades gracefully to a normal
load.

## Trade-offs

- **Static SSR gives up in-page state.** Every interaction is a post and a
  render, so a widget with local state (a live filter, a counter) needs an
  interactive island.
  ```razor
  <Counter @rendermode="InteractiveServer" /> @* one island on an otherwise static page *@
  ```
- **Enhanced navigation can hide stale state.** The script and the DOM survive
  a click, so a script that initialises on page load runs once, not per page.
  Use `data-enhance-nav="false"` on links to pages that need a clean load.
- **A binding mismatch fails quietly.** If the property name or `FormName` does
  not match the posted fields, the model stays empty and you see a blank form or
  a `400`, not an exception in your code.
  ```razor
  <EditForm Model="Model" FormName="contact" Enhance> @* the name must be unique on the page *@
  ```
- **Antiforgery depends on a cookie.** Posts from another origin, or from a
  client that drops cookies, fail with `400`. That is the protection working, but
  it surprises API-style clients that post to a page.
- **Streaming trades layout stability for speed.** Placeholders shift when the
  real content arrives, which is why the attribute is opt-in, and error handling
  after the first chunk is limited to what you can render into the page.
- **`NavigateTo` in a handler used to throw.** Code that relied on the
  exception to stop execution changes behavior when the new property is true.
  ```csharp
  Nav.NavigateTo("/done");
  return; // do not rely on an exception to end the handler
  ```

## Lab

In this lab you build a Blazor Web App that uses only static server-side rendering (no circuit, no WebAssembly) and see exactly what the server sends: plain HTML pages, a route parameter with a type constraint, a query string bound into a component, and an enhanced `EditForm` that posts with an antiforgery token, validates and follows Post/Redirect/Get. You receive the `BlazorSsrLab` project with five pages, and `Program.cs` registers only `AddRazorComponents()`, with no interactive render mode. The core idea is that plain HTML already works on its own and that the `blazor.web.js` script only adds enhanced navigation and forms on top.

**The scenario**

Today the home page is empty, the layout does not load the Blazor script, the order route has no constraint, the search page ignores the query string and the contact page is a plain form that Blazor does not handle.

- `Home.razor`, `Orders.razor`, `Search.razor`, `Contact.razor`, `Thanks.razor`: the pages, wrapped by `MainLayout.razor` and `App.razor`.
- `ContactModel.cs`: the form model, with `[Required(ErrorMessage = "Name is required")]` on `Name`.
- `Program.cs`: `AddRazorComponents`, `UseAntiforgery` and `MapRazorComponents<App>`.
- `SsrTests.cs`: calls the app in memory with `WebApplicationFactory` and checks the HTML, status codes and headers. No browser is involved.

**What you will do, step by step**

1. **Home as plain HTML (TODO-00).** In `Home.razor`, render `<h1>Home</h1>` and a paragraph with the render time (`<span id="stamp">` holding `DateTime.UtcNow.Ticks`). The test checks `text/html` and that the page references neither `blazor.server.js` nor `blazor.webassembly.js`.
2. **Load the script (TODO-01).** In `App.razor`, load `_framework/blazor.web.js`. The `<base href="/" />` is already there and the test checks both.
3. **Route constraint (TODO-02).** In `Orders.razor`, constrain the route to an integer: `/orders/42` shows `Order 42` and `/orders/abc` must return `404`.
4. **Query string (TODO-03).** In `Search.razor`, bind the `term` query string value into the `Term` parameter. `/search?term=blazor` shows `Results for: blazor`, and a value like `<b>` must come out encoded (`&lt;b&gt;`).
5. **Enhanced form (TODO-04).** In `Contact.razor`, replace the plain form with an `EditForm` with `FormName` `contact` and `Enhance`. The HTML must have `method="post"`, `data-enhance`, the hidden `_handler` field with value `contact`, the antiforgery token and an input `Model.Name`. Keep `DataAnnotationsValidator` and a `ValidationMessage`, and call `Submit` on a valid post.
6. **Bind the post and redirect (TODO-05).** Bind the posted form into `Model` with `[SupplyParameterFromForm]`. An empty name re-renders the page with `200` and `Name is required`. A valid name answers `302` to `/thanks?name=Ana` (Post/Redirect/Get), and that page shows `Thanks, Ana`.

**How you know you are done**

`dotnet test` is green. You should be able to explain what the server returns for each route and why the `EditForm` adds the antiforgery token by itself. The tests never execute `blazor.web.js`, so to see enhanced navigation and forms in the browser run `dotnet run --project src/BlazorSsrLab`, open the printed URL and watch the Network tab (one `fetch` per navigation instead of a full document reload).

**Optional challenges**

- **TODO-06:** the test `ShouldRejectPostWithoutAntiforgeryToken` (category `Bonus`) posts to `/contact` with the cookie but without the token field and expects `400`. There is no code to write: read `Program.cs`, find the line that makes the server reject that post and explain why the `EditForm` from TODO-04 adds the token for you.

**Prerequisites:** ASP.NET Core basics (routing, middleware, `WebApplicationFactory`), Razor components basics (`@page`, `[Parameter]`, `@code`) and the .NET 10 SDK (the tests use xUnit and `Microsoft.AspNetCore.Mvc.Testing`, restored from nuget.org).

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. To run only the required work, use `dotnet test --filter "Category!=Bonus"`. Each TODO is marked in a comment in the matching `.razor` file, and the red tests show what is still missing.

## Documentation Links

- [ASP.NET Core Blazor navigation, enhanced navigation and form handling, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/fundamentals/navigation) (doc)
- [ASP.NET Core Razor component rendering, streaming rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering) (doc)
- [ASP.NET Core Blazor forms overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/forms/) (doc)
- [ASP.NET Core Blazor render modes, static SSR, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes) (doc)
- [ASP.NET Core Blazor JavaScript with static server-side rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/javascript-interoperability/static-server-rendering) (doc)
