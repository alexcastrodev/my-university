---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Razor Pages is the page-based way to render HTML on the server in ASP.NET Core: a `.cshtml` file plus a `PageModel` with `OnGet`/`OnPost` handlers, Tag Helpers that turn `asp-*` attributes into real HTML, and view components for reusable chunks with their own logic. The previous MVC lesson covered controllers, filters and binding; this one runs one Razor Pages app and records what each request returned: handler selection, what the Tag Helpers emit compared with HTML Helpers, the antiforgery 400, a custom Tag Helper with tests, view component rules, the client validation scripts that `dotnet new webapp` ships, and what views cost at build time and on the first request. Versions: SDK 10.0.100, `net10.0`, runtime `Microsoft.AspNetCore.App` 10.0.0 (Razor Pages, MVC and the built-in Tag Helpers are in the shared framework, no package). Tests: `xunit` 2.9.3, `Microsoft.AspNetCore.Mvc.Testing` 10.0.0. Template libraries: jQuery 3.7.1, jquery-validation 1.21.0, jquery-validation-unobtrusive 4.0.0.

## Use Cases

- Server-rendered back offices, admin areas and form-heavy sites where one page equals one URL and one form flow.
- Maintaining an existing Razor Pages or MVC site: reading `asp-*` attributes, `_ViewImports` and layouts without guessing.
- Extracting a repeated block (cart badge, menu, widget) into a Tag Helper, a partial or a view component, and knowing which one.
- Estimating whether a thousand-page site pays a price for precompiled views.

## Deep Dive

### The page model, handlers and what `[BindProperty]` binds

```csharp
public class IndexModel(Store store) : PageModel            // constructor DI works
{
    [BindProperty] public ItemInput Input { get; set; } = new();
    [BindProperty(SupportsGet = true)] public string? Filter { get; set; }

    public void OnGet(int? id) => Trace = $"OnGet id={id} Filter={Filter} Input.Name={Input.Name}";
    public IActionResult OnPost()
    {
        if (!ModelState.IsValid) return Page();                 // re-render with errors
        store.Items.Add(Input);
        return RedirectToPage(new { id = Input.Id });           // post-redirect-get
    }
    public async Task<IActionResult> OnPostDeleteAsync(int id)  // named handler "Delete"
    { store.Items.RemoveAll(i => i.Id == id); return RedirectToPage(); }
}
```

```text
@page "{id:int?}"   (Items/Index.cshtml)
GET  /Items/5                      -> OnGet id=5 Filter= Input.Name=
GET  /Items?Filter=Key             -> OnGet id= Filter=Key Input.Name=
GET  /Items?Input.Name=hello       -> Input.Name= (empty: no SupportsGet)
GET  /Items/abc                    -> 404 (the :int constraint)
POST /Items (invalid)              -> 200, same page, input-validation-error classes
POST /Items (valid)                -> 302 Location: /Items/4
POST /Items/1?handler=Delete       -> 302 Location: /Items/1
POST /Items?handler=Nope (valid)   -> 302, OnPost ran
PUT  /Items (with token)           -> 200, page rendered (no OnPut)
```

`[BindProperty]` binds on POST only; `SupportsGet = true` is the opt-in for GET, which is why `Filter` bound and `Input.Name` did not. Three results surprised me. `RedirectToPage()` with no arguments reused the ambient route value `id=1` of the current request, so after Delete the browser went to `/Items/1`; pass `new { id = (int?)null }` or another page name when that is not what you want. An unknown `?handler=Nope` did not fail: it fell through to `OnPost`. And a verb with no handler renders the page with 200 instead of 405. Handler names come from the method (`OnPostDeleteAsync` is `Delete`), and `asp-page-handler="Delete"` writes `?handler=Delete` into the form action.

### Tag Helpers against HTML Helpers: the same HTML

`<input asp-for="Input.Name" class="form-control" />` and `@Html.TextBoxFor(m => m.Input.Name, new { @class = "form-control" })` on a `[Required, StringLength(20, MinimumLength = 3)]` property, rendered by the same page:

```text
TAG:  <input class="form-control" type="text" data-val="true" data-val-length="The field Name must be a string with a minimum length of 3 and a maximum length of 20." data-val-length-max="20" data-val-length-min="3" data-val-required="The Name field is required." id="Input_Name" maxlength="20" name="Input.Name" value="" />
HTML: <input class="form-control" data-val="true" data-val-length="The field Name ..." data-val-length-max="20" data-val-length-min="3" data-val-required="The Name field is required." id="Input_Name" maxlength="20" name="Input.Name" type="text" value="" />
```

Same attributes, different order, so the browser sees no difference; the gain is that the Tag Helper looks like HTML in the file (a designer can open it) and gets IntelliSense on `asp-*`. Both emit the `data-val-*` attributes from the validation attributes, and a `number` property also gets a hidden `<input name="__Invariant" type="hidden" value="Input.Quantity">`. `asp-validation-for` rendered `<span class="field-validation-valid" data-valmsg-for="Input.Name" ...>`, which after a failed POST became `field-validation-error` with the message inside. Other built-ins measured: `asp-page="/Items/Index" asp-route-filter="kb"` gave `href="/Items?filter=kb"`, and `<form method="get" asp-page=...>` gave `action="/Items"` and no token.

`<environment>` is a Tag Helper over `IHostEnvironment`: with `ASPNETCORE_ENVIRONMENT=Development` the page emitted `href="/css/site.css?v=zeR5PHeeHbxfGkL8WV86OzdoF6UnjuCmnagaocD-cbo"` (from `asp-append-version`) and with `Staging` the other branch, `href="/css/site.css"`. `<cache>` and `<distributed-cache>` over three requests: the block was rendered at request 1 and the next four served the cached text, `vary-by-query="id"` rendered again for `?id=1` (request 3) and `?id=2` (request 5) only; `<distributed-cache>` used the registered `AddDistributedMemoryCache()`. Their details are in the CacheView lesson. `<component>` (Razor components inside a page) and the `<partial>` options are docs only here.

### Antiforgery: 400 without the token

Every `<form method="post">` without an `action` got a hidden `__RequestVerificationToken` field, plus the response set `.AspNetCore.Antiforgery.<hash>=...; samesite=strict; httponly`, `Cache-Control: no-cache, no-store` and `X-Frame-Options: SAMEORIGIN`. Posting to `/Items` with `curl`:

```text
no token, no cookie        400
cookie only                400
token only (no cookie)     400
cookie + form token        302
cookie + RequestVerificationToken header   302
POST /Ping (page with only OnGet), no token  400   (with token: 200)
POST /Webhook, [IgnoreAntiforgeryToken] on the PageModel class  200 "webhook accepted"
POST /Items?handler=Open, [IgnoreAntiforgeryToken] on the handler method  400
```

Razor Pages validate the token on every non-safe verb by default (the Learn page says Razor Pages are automatically protected), unlike the MVC controller in the previous lesson, where a bare `[HttpPost]` got 200 with no token. `[IgnoreAntiforgeryToken]` works on the `PageModel` class or globally; on a handler method the compiler printed `warning MVC1001: 'IgnoreAntiforgeryTokenAttribute' cannot be applied to Razor Page handler methods` and the request still got 400. A handwritten `<form method="post" action="/Items">` got no token at all (the docs: it is generated when `action` is empty or absent), so it would 400 on submit; `asp-antiforgery="true"` forced it, and `Html.BeginForm` emitted it too. For `fetch`, send the `RequestVerificationToken` header. The attack and the Fetch Metadata layer are in the CSRF lesson.

### `_ViewImports`, `_ViewStart`, layouts and sections

`_ViewImports.cshtml` holds `@using`, `@namespace` and `@addTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers`; `_ViewStart.cshtml` runs before each page and sets `Layout`. Both apply to their folder and below. The failures I hit:

```text
@removeTagHelper on a page   <badge status="ok">Paid</badge> and <input asp-for="Input.Name" />
                             came out literally, no error, the browser ignored the attributes
Areas/Admin/Pages/Dashboard  <a asp-page="/Dashboard"> printed raw: Pages/_ViewImports does not apply
                             to an area; after adding Areas/Admin/Pages/_ViewImports.cshtml: href="/Admin/Dashboard"
section "Footer" in page, layout lacks RenderSection  500 InvalidOperationException: The following
                             sections have been defined but have not been rendered by the page at
                             '/Pages/Shared/_Layout.cshtml': 'Footer'. To ignore an unrendered section call IgnoreSection("sectionName").
layout RenderSection("Scripts", required: true), page lacks it  500 The layout page '/Pages/Shared/_Layout2.cshtml'
                             cannot find the section 'Scripts' in the content page '/Pages/NeedSection.cshtml'.
```

A Tag Helper that is not imported is plain markup, which is the most common "my asp-for does nothing" cause. In the template's pages, the validation scripts go in the `Scripts` section as `<partial name="_ValidationScriptsPartial" />`; `<partial>` is the tag form of `Html.PartialAsync`, with `model="..."` passing the model (`model='"from partial"'` rendered `<i>from partial</i>`).

### A custom Tag Helper and its tests

```csharp
[HtmlTargetElement("badge")]                                  // <badge status="ok">Paid</badge>
public class BadgeTagHelper : TagHelper
{
    public string Status { get; set; } = "info";              // attribute "status"
    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        output.TagName = "span";
        output.Attributes.SetAttribute("class", $"badge badge-{Status}");
    }
}
[HtmlTargetElement("a", Attributes = "external")]             // only <a ... external>
public class ExternalLinkTagHelper : TagHelper
{
    public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        output.Attributes.RemoveAll("external");
        output.Attributes.SetAttribute("rel", "noopener noreferrer");
        output.Attributes.SetAttribute("target", "_blank");
        output.Content.SetHtmlContent((await output.GetChildContentAsync()).GetContent() + " (external)");
    }
}
```

With `@addTagHelper *, Lab` in `_ViewImports`: `<span class="badge badge-ok">Paid</span>` and `<a href="https://learn.microsoft.com" rel="noopener noreferrer" target="_blank">docs (external)</a>`. The class must be public, `Status` maps to `status` (PascalCase to kebab-case), and a Tag Helper that does not match its `Attributes` filter never runs. Unit tests need only the framework types, no host; the page test goes through `WebApplicationFactory<Program>` (`public partial class Program;` in `Program.cs`):

```csharp
var ctx = new TagHelperContext("badge", [], new Dictionary<object, object>(), "id");
var output = new TagHelperOutput("badge", [], (_, _) => Task.FromResult<TagHelperContent>(new DefaultTagHelperContent()));
new BadgeTagHelper { Status = "ok" }.Process(ctx, output);   // TagName "span", class "badge badge-ok"
// WebApplicationFactory: POST /Items without a token => 400; GET /Compare contains the <span class="badge badge-ok">
```

```text
Passed!  - Failed: 0, Passed: 3, Skipped: 0, Total: 3, Duration: 262 ms - Lab.Tests.dll (net10.0)
```

### View components, and when to use which

```csharp
public class CartSummaryViewComponent(ICart cart) : ViewComponent        // constructor DI
{ public IViewComponentResult Invoke(string label = "items") => View(new CartSummaryModel(cart.Count, label)); }
// view: Pages/Shared/Components/CartSummary/Default.cshtml
```

```text
[tag]     <vc:cart-summary label="tag" />                                          <span class="cart">3 tag</span>
[invoke]  @await Component.InvokeAsync("CartSummary", new { label = "invoke" })    <span class="cart">3 invoke</span>
[typed]   @await Component.InvokeAsync(typeof(CartSummaryViewComponent), ...)      <span class="cart">3 typed</span>
[default] <vc:cart-summary />                                                      <span class="cart">3 items</span>
GET /Items?label=hack     -> <span class="cart">3 in cart   (the query string did not reach the component)
GET /Components/CartSummary, GET /CartSummary -> 404, 404
InvokeAsync("CartSummary", new { lable = "typo" }) -> 200, silently used the default "items"
<vc:cart-summary lable="x" />                      -> 200, same
InvokeAsync("CartSummary", new { label = 5 })      -> 500 InvalidCastException: Int32 to String
InvokeAsync("Nope") -> 500 A view component named 'Nope' could not be found. ...
```

The Learn page states the rule: view components "don't use model binding", parameters come from the invocation, and a view component never directly handles a request. A typo in an anonymous-object property or in the tag attribute is ignored without a warning, so test the call site. The name is the class minus the `ViewComponent` suffix, kebab-cased for `<vc:...>`, which needs `@addTagHelper *, Lab`.

| Need | Use |
| --- | --- |
| Reusable markup, data comes from the page's model | partial view (`<partial>`) |
| Markup plus its own logic or services (cart count, menu from a database) | view component |
| Change or extend an HTML element or attribute, no new markup of your own | Tag Helper |
| Interactive widget inside a server page | Razor component via `<component>` (docs only) |

### Client validation: is `jquery-validation-unobtrusive` still the default?

Yes, with a catch. `dotnet new webapp` on SDK 10.0.100 creates `wwwroot/lib/` with bootstrap 5.3.3, jQuery 3.7.1, jquery-validation 1.21.0 (`jquery.validate.min.js` 25,308 bytes) and jquery-validation-unobtrusive 4.0.0 (5,824 bytes), and `Pages/Shared/_ValidationScriptsPartial.cshtml` with the two script tags. `_Layout` loads `jquery.min.js` (87,533 bytes) and the Bootstrap bundle but not the validation scripts, and the template's three pages (Index, Privacy, Error) have no form, so nothing references the partial until you add a form page and include it in `@section Scripts`. The `data-val-*` attributes are the contract: with `AddViewOptions(o => o.HtmlHelperOptions.ClientValidationEnabled = false)` the same input rendered `id="Input_Name" maxlength="20" name="Input.Name"` with zero `data-val` attributes, so the server still validates and the browser does not. The Learn validation page still shows the unobtrusive scripts, with older CDN versions than the template's (jQuery 3.6.0, validate 1.19.3).

### What a Razor view costs

Views compile into the app assembly at build; `RazorCompileOnBuild` defaults to true. Same app (20 `.cshtml`) plus copies of the Items page with a form, Release, clean build, 5 cold starts each (median), on this machine; "listening" is the time until a Minimal API `/ping` answers:

| Variant | `.cshtml` | `Lab.dll` | build | listening | first `GET /Items` | warm `GET /Items` |
| --- | --- | --- | --- | --- | --- | --- |
| precompiled | 20 | 98,816 B | 2.0 s | 185 ms | 48 ms | 0.5 ms |
| precompiled | 219 | 2,907,648 B | 3.3 s | 215 ms | 49 ms | 0.5 ms |
| precompiled | 1,019 | 14,319,616 B | 8.8 s | 334 ms | 53 ms | 0.5 ms |
| `RazorCompileOnBuild=false` | 20 | 18,432 B | 2.0 s | n/a | `/Items` 404 | n/a |
| runtime compilation package | 20 | 18,944 B | 2.0 s | 770 ms | 540 ms | 0.5 ms |

About 14 KB of IL per page with a form, and the cost shows up at startup (+150 ms for 1,000 pages, the endpoint table) rather than per request: warm requests stayed at 0.5 ms. Turning the property off removed the views from the DLL and `/Items` returned 404, as the SDK docs warn. With `Microsoft.AspNetCore.Mvc.Razor.RuntimeCompilation` 10.0.0 and `AddRazorRuntimeCompilation()`, Roslyn compiled on the first request (540 ms against 48 ms); an edit to the `.cshtml` was served without rebuilding once the file watcher saw it (within 2 s here) and the first request after the edit took 112 ms. The Learn page says runtime compilation "was obsoleted starting in .NET 10", disables Hot Reload and is not recommended for production: referencing the extension class by name gave warning `ASPDEPR003` ("For development scenarios, use Hot Reload instead"), while the `.AddRazorRuntimeCompilation()` call in `Program.cs` built without a warning. Use `dotnet watch` and keep build-time compilation.

### Book vs today, and where Razor Pages stands

Compared with WebForms, there is no ViewState, no control tree and no page lifecycle events: a handler runs, returns a result, and the response is HTML you can read. Compared with MVC (exam 70-486), the same Razor engine, Tag Helpers and filters work, but the unit of code is the page: Learn lists page code kept with the page, and view-specific logic and view models kept together in their own namespace and directory, as the benefit. On the market side the current Learn guide "Choose an ASP.NET Core web UI" says: "For new project development, we recommend ASP.NET Core Blazor", and lists Razor Pages as a page-based model "built on ASP.NET Core MVC". So read Razor Pages as the model for the large installed base and for server-rendered sites that need no component interactivity; Blazor static SSR gives the same server-rendered flow with components (see the static SSR and forms lessons), and the two share a host through the Component Tag Helper.

## Trade-offs

- **Razor Pages vs MVC views.** Pages keep a form flow in two files and suit CRUD sites; MVC suits many actions over one resource and shared APIs. Both use the same Tag Helpers and `_ViewImports`, and they coexist in one app.
- **Tag Helpers vs HTML Helpers.** Same HTML output; Tag Helpers read like markup but fail silently when not imported (`@addTagHelper`), so keep it in `_ViewImports` and test the rendered HTML.
- **Partial, view component or Tag Helper.** A view component pays for its own class and invocation but can use DI and own its data; do not use it when a partial and the page's model suffice, and remember the call site is not checked at compile time.
- **Antiforgery is on, keep it on.** The 400 is the feature; put `[IgnoreAntiforgeryToken]` on a webhook's `PageModel` class, never on a browser form, and remember that a hand-written `action` attribute drops the token unless you add `asp-antiforgery="true"`.
- **Precompiled views.** Cost is startup and DLL size (14 KB per page here), not request time; runtime compilation buys edit-and-refresh with a 540 ms first request and an obsolete API.
- **jQuery validation.** The template still ships it and the `data-val-*` contract makes it free to use, but it is a jQuery dependency; turning `ClientValidationEnabled` off keeps only server validation.
- **New projects.** Microsoft recommends Blazor for new UI; choose Razor Pages when the team, the existing site or a form-first back office already fits it, and avoid mixing in a third model without a reason.

## Documentation Links

- [Introduction to Razor Pages in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/razor-pages/?view=aspnetcore-10.0) (doc)
- [Tag Helpers in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/tag-helpers/intro?view=aspnetcore-10.0) (doc)
- [Author Tag Helpers in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/tag-helpers/authoring?view=aspnetcore-10.0) (doc)
- [View components in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/view-components?view=aspnetcore-10.0) (doc)
- [Partial views in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/partial?view=aspnetcore-10.0) (doc)
- [Layout in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/layout?view=aspnetcore-10.0) (doc)
- [Prevent Cross-Site Request Forgery (XSRF/CSRF) attacks in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery?view=aspnetcore-10.0) (doc)
- [Razor file compilation in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/view-compilation?view=aspnetcore-10.0) (doc)
- [ASP.NET Core Razor SDK, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/razor-pages/sdk?view=aspnetcore-10.0) (doc)
- [Choose an ASP.NET Core web UI, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/tutorials/choose-web-ui?view=aspnetcore-10.0) (doc)
- [Model validation in ASP.NET Core MVC and Razor Pages, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/models/validation?view=aspnetcore-10.0) (doc)
