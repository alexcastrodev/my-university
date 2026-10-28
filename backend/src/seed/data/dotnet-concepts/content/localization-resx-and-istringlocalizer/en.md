---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Localizing an app means two different things that .NET keeps in two different properties: formatting numbers, dates and currency the way a region expects (`CultureInfo.CurrentCulture`) and choosing which translated text to show (`CultureInfo.CurrentUICulture`). ASP.NET Core adds three pieces on top: `.resx` files compiled into satellite assemblies and read by `ResourceManager`, the `IStringLocalizer<T>` abstraction that turns a missing translation into the key instead of an exception, and `UseRequestLocalization`, a middleware that picks a culture per request from the query string, a cookie or `Accept-Language`. Most failures here are silent: a resource file with the wrong name, a neutral culture that cannot format currency, a header the middleware ignores, a container that forces invariant mode. This concept builds one Minimal API app plus a console harness and reports what each of those situations really printed. Versions used: SDK 10.0.100 (.NET and ASP.NET Core runtime 10.0.0; `Microsoft.Extensions.Localization` and the request localization middleware come with the shared framework, no extra package), on macOS (Apple Silicon).

## Use Cases

- Serving the same API or UI in Portuguese, English, German and Japanese, with prices and dates formatted per region.
- Letting a user pick a language once (cookie) and keep it, while still honoring the browser's `Accept-Language` on the first visit.
- Returning validation messages in the caller's language from MVC controllers.
- Deciding whether a container image can run in invariant mode, or needs ICU because the app formats or compares text per culture.

## Deep Dive

### Two cultures: one formats, the other translates

I formatted the same `decimal` (`1234567.89m`) and `DateTime` (2026-10-28 14:30) and asked a localizer for `"Hello"` with an argument, setting both cultures to each value:

```csharp
CultureInfo.CurrentCulture = new CultureInfo(c);    // numbers, dates, currency, sorting
CultureInfo.CurrentUICulture = new CultureInfo(c);  // which .resx is read
Console.WriteLine($"{amount:C} | {amount:N2} | {when:d} | {when:D} | {when:t} | {loc["Hello", "Ana"]}");
```

```text
pt-BR  | R$ 1.234.567,89 | 1.234.567,89 | 28/10/2026 | quarta-feira, 28 de outubro de 2026 | 14:30 | Olá, Ana!
en-US  | $1,234,567.89 | 1,234,567.89 | 10/28/2026 | Wednesday, October 28, 2026 | 2:30 PM | Hello, Ana!
de-DE  | 1.234.567,89 € | 1.234.567,89 | 28.10.2026 | Mittwoch, 28. Oktober 2026 | 14:30 | Hallo, Ana!
ja-JP  | ¥1,234,568 | 1,234,567.89 | 2026/10/28 | 2026年10月28日 水曜日 | 14:30 | こんにちは、Anaさん
```

Note `ja-JP`: the yen has no decimals, so `C` rounded the value to `¥1,234,568`. Then I split the two properties:

```text
Culture=de-DE, UICulture=pt-BR  ->  1.234.567,89 € | Mittwoch, 28. Oktober 2026 | Olá, Ana!
Culture=pt-BR, UICulture=en-US  ->  R$ 1.234.567,89 | quarta-feira, 28 de outubro de 2026 | Hello, Ana!
```

The resource lookup followed `CurrentUICulture` only. The .NET localization page describes its fallback example in terms of `CurrentCulture`; in my run the text ignored `CurrentCulture` completely.

### Culture is async-local

`CurrentCulture` lives in the execution context, which is how the middleware can set it per request without leaking it to other requests. I set `pt-BR` and probed:

```text
caller before: pt-BR
Task.Run sees: pt-BR
inside after await: ja-JP                         (a method that set ja-JP, then awaited)
caller after awaiting a method that set ja-JP: pt-BR
new Thread sees: pt-BR
UnsafeQueueUserWorkItem sees: en-US              (no context flow: the process default)
```

A change flows down into work started later, never back up to the caller. Code that does not flow the execution context sees the process default (`en-US` here, from `LANG=en_US.UTF-8`).

### .resx files, satellite assemblies and AddLocalization

I used one marker class in the root namespace and one file per culture:

```csharp
builder.Services.AddLocalization(o => o.ResourcesPath = "Resources");
namespace LocDemo { public class SharedResource { } }   // never instantiated
```

```text
Resources/SharedResource.resx         Hello="Hello, {0}!"  Farewell="Goodbye"  NameRequired=...
Resources/SharedResource.pt-BR.resx   Hello="Olá, {0}!"    NameRequired="O nome é obrigatório."
Resources/SharedResource.pt.resx      Farewell="Tchau"
Resources/SharedResource.de.resx      Hello="Hallo, {0}!"
Resources/SharedResource.ja.resx      Hello="こんにちは、{0}さん"
```

`dotnet build` embedded the neutral file in the main assembly and compiled every culture into its own satellite assembly in a folder named after the culture:

```text
bin/Debug/net10.0/de/LocDemo.resources.dll
bin/Debug/net10.0/ja/LocDemo.resources.dll
bin/Debug/net10.0/pt/LocDemo.resources.dll
bin/Debug/net10.0/pt-BR/LocDemo.resources.dll
manifest resources of LocDemo.dll: LocDemo.Resources.SharedResource.resources
```

The registered services were `ResourceManagerStringLocalizerFactory` and `ResourceManagerStringLocalizer`: `IStringLocalizer` is a thin layer over the classic `ResourceManager`. `IHtmlLocalizer` and `IViewLocalizer` serve MVC views; per the docs they HTML-encode the arguments but not the resource string. Views are out of scope here.

### The fallback chain and the missing key

`loc["Hello", "Ana"]` fills the `{0}` placeholder with the argument. I looked up keys under different UI cultures and printed the whole `LocalizedString`:

```text
pt-BR Hello:    Value="Olá, Ana!"   ResourceNotFound=False SearchedLocation=LocDemo.Resources.SharedResource
pt-BR Farewell: Value="Tchau"       ResourceNotFound=False   (found in pt)
pt-PT Hello:    Value="Hello, Ana!" ResourceNotFound=False   (pt has no Hello: neutral)
pt-PT Farewell: Value="Tchau"       ResourceNotFound=False
fr-FR Hello:    Value="Hello, Ana!" ResourceNotFound=False   (no fr at all: neutral)
pt-BR Missing:  Value="Missing"     ResourceNotFound=True
pt-BR "Total: {0}", 42: Value="Total: 42" ResourceNotFound=True
```

The chain is `pt-BR`, then its parent `pt` (`CultureInfo("pt-BR").Parent` printed `pt`, whose parent is the invariant culture), then the neutral `.resx`. A missing key returns the key itself, still formatted with the arguments, so a page shows English (or the key) instead of crashing. The only signal is `ResourceNotFound`. `GetAllStrings` shows what a culture really contributes: under `pt-BR` it returned `NameRequired, Hello` with `includeParentCultures: false`, and added `Farewell=Tchau` with `true`.

### Missing neutral resources: ResourceManager throws, IStringLocalizer does not

I created `NoNeutral.pt-BR.resx` with no neutral file and asked both `new ResourceManager("LocDemo.Resources.NoNeutral", assembly).GetString("Title", culture)` and an `IStringLocalizer`:

```text
raw ResourceManager, existing base, missing key: GetString returned null
NoNeutral pt-BR: Sem neutro
NoNeutral en-US: MissingManifestResourceException: Could not find the resource "LocDemo.Resources.NoNeutral.resources"
  among the resources "LocDemo.Resources.SharedResource.resources" embedded in the assembly "LocDemo", nor among the
  resources in any satellite assemblies for the specified culture. Perhaps the resources were embedded with an incorrect name.
IStringLocalizer NoNeutral en-US: Value="Title" ResourceNotFound=True SearchedLocation=LocDemo.Resources.NoNeutral
```

That is why the ASP.NET Core docs say you can skip the neutral `.resx` and use the default-language text as the key. A variant: with `[assembly: NeutralResourcesLanguage("en", UltimateResourceFallbackLocation.Satellite)]` and no `en` satellite, `ResourceManager` asked for `fr-FR` threw `MissingSatelliteAssemblyException: The satellite assembly named "Sat.resources.dll, PublicKeyToken=null" for fallback culture "en" either could not be found or could not be loaded.`

### Naming rules: the failure that prints the key

The factory computes the resource name from the type's full name minus the root namespace, prefixed by `ResourcesPath`. For `LocDemo.Endpoints.Orders` it looks for `Resources/Endpoints.Orders.pt-BR.resx` (or `Resources/Endpoints/Orders.pt-BR.resx`). I created `Resources/Orders.pt-BR.resx` instead, the classic mistake, next to a correctly named one for `Invoices`:

```text
Orders   (file Resources/Orders.pt-BR.resx):           Value="Title"   ResourceNotFound=True  SearchedLocation=LocDemo.Resources.Endpoints.Orders
Invoices (file Resources/Endpoints.Invoices.pt-BR.resx): Value="Faturas" ResourceNotFound=False SearchedLocation=LocDemo.Resources.Endpoints.Invoices
```

No exception, no log, no build warning: the page simply shows `Title`. `SearchedLocation` tells you the exact name it wanted. Two variants from the docs: a `SharedResource` class placed in the `Resources` folder (namespace `MyApp.Resources`) makes the factory look in `Resources/Resources/`, and a project whose `RootNamespace` differs from its assembly name (for example `my-project.csproj`) needs `[assembly: RootNamespace("...")]`.

### Picking the culture per request

```csharp
string[] supported = ["en", "pt-BR"];
app.UseRequestLocalization(o =>
{
    o.SetDefaultCulture("en").AddSupportedCultures(supported).AddSupportedUICultures(supported);
    o.ApplyCurrentCultureToResponseHeaders = true;   // adds Content-Language
});
```

The default `RequestCultureProviders` printed `QueryStringRequestCultureProvider, CookieRequestCultureProvider, AcceptLanguageHeaderRequestCultureProvider`, and the first one that yields a supported culture wins. My endpoint returned the cultures, the winning provider (`IRequestCultureFeature.Provider`), a localized string and `1234.5m.ToString("C")`:

```text
(nothing)                       Content-Language: en  {"culture":"en","uiCulture":"en","provider":null,"text":"Hello, Ana!","price":"¤1,234.50"}
?culture=pt-BR                  {"culture":"pt-BR","uiCulture":"pt-BR","provider":"QueryStringRequestCultureProvider","price":"R$ 1.234,50"}
?ui-culture=pt-BR               {"culture":"pt-BR","uiCulture":"pt-BR",...}   (one value sets both)
?culture=en&ui-culture=pt-BR    {"culture":"en","uiCulture":"pt-BR","text":"Olá, Ana!","price":"¤1,234.50"}
Cookie .AspNetCore.Culture=c=pt-BR|uic=pt-BR      provider CookieRequestCultureProvider, pt-BR
Accept-Language: pt-BR          Content-Language: pt-BR, provider AcceptLanguageHeaderRequestCultureProvider
?culture=en + pt-BR cookie      en (query wins)      pt-BR cookie + Accept-Language: en   pt-BR (cookie wins)
?culture=fr-FR + Accept-Language: pt-BR           pt-BR (unsupported query value skipped, next provider used)
```

Look at the price for `en`: `¤1,234.50`. `en` is a neutral culture with no region, so it has no currency symbol and prints the generic `¤`. Supported cultures used for formatting should be specific (`en-US`, `pt-BR`); neutral ones are fine as UI cultures.

### Accept-Language, fallback to parents, and what gets ignored

```text
Accept-Language: fr-FR                    -> en, provider null (default)
Accept-Language: en-GB                    -> en, provider AcceptLanguageHeaderRequestCultureProvider
Accept-Language: pt                       -> en, provider null
Accept-Language: pt-PT                    -> en, provider null
Accept-Language: fr-FR, pt-BR;q=0.8       -> pt-BR
Accept-Language: fr, de, es, pt-BR        -> en, provider null
```

`FallBackToParentCultures` and `FallBackToParentUICultures` (both `true` by default) walk up only: `en-GB` matched `en`, but `pt` did not match `pt-BR` and `pt-PT` did not either. In a branch with both set to `false`, `Accept-Language: en-GB` and `?culture=en-GB` fell to the default with `provider` null. The last line is `MaximumAcceptLanguageHeaderValuesToTry` (default 3): `pt-BR` was the fourth entry and was never tried, while `fr, de, pt-BR` resolved to `pt-BR`.

### The culture cookie and a route-segment provider

`CookieRequestCultureProvider.MakeCookieValue(new RequestCulture("pt-BR"))` builds the value; appending it from an endpoint sent `Set-Cookie: .AspNetCore.Culture=c%3Dpt-BR%7Cuic%3Dpt-BR; path=/` (URL-encoded, no expiry, so a session cookie unless you pass `CookieOptions`).

For URLs like `/pt-BR/hello`, a custom provider inserted first:

```csharp
o.AddInitialRequestCultureProvider(new CustomRequestCultureProvider(ctx =>
{
    var seg = ctx.Request.Path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
    return Task.FromResult(seg is not null && supported.Contains(seg, StringComparer.OrdinalIgnoreCase)
        ? new ProviderCultureResult(seg) : null);
}));
```

`/pt-BR/hello` answered in `pt-BR` with provider `CustomRequestCultureProvider`, and so did `/pt-BR/hello?culture=en`, because the inserted provider runs before the query string. The docs also mention `RouteDataRequestCultureProvider` for a `{culture}` route value.

### Localized validation messages

MVC localizes `ErrorMessage` as a resource key. I pointed every attribute at the shared resource:

```csharp
builder.Services.AddControllers().AddDataAnnotationsLocalization(o =>
    o.DataAnnotationLocalizerProvider = (type, factory) => factory.Create(typeof(SharedResource)));
public class PersonDto { [Required(ErrorMessage = "NameRequired")] public string? Name { get; set; } }
```

I posted `{}` to the controller and to a Minimal API endpoint validated by .NET 10's `AddValidation()`:

```text
MVC ?culture=pt-BR     400 {"title":"One or more validation errors occurred.","errors":{"Name":["O nome é obrigatório."]}}
MVC (en)               400 {... "errors":{"Name":["The name is required."]}}
Minimal ?culture=pt-BR 400 {"title":"One or more validation errors occurred.","errors":{"Name":["NameRequired"]}}
```

The message was localized, but the ProblemDetails `title` stayed in English. In .NET 10 the Minimal API validator printed the raw key; the ASP.NET Core docs list localization of Minimal API validation messages (through `Microsoft.Extensions.Validation`) under ASP.NET Core 11.

### Invariant globalization, ICU and chiseled images

The same console code under three settings:

```text
ICU (default)                       CurrentCulture.Name='en-US'
  new CultureInfo("pt-BR") ok: C=R$ 1.234.567,89 D=quarta-feira, 28 de outubro de 2026, compare("a","B") = -1
DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1    CurrentCulture.Name='' UICulture=''
  CultureNotFoundException: Only the invariant culture is supported in globalization-invariant mode.
  See https://aka.ms/GlobalizationInvariantMode for more information. (Parameter 'name') pt-BR is an invalid culture identifier.
plus DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY=false
  new CultureInfo("pt-BR") ok: Name=pt-BR C=¤1,234,567.89 D=Wednesday, 28 October 2026
  localizer["Hello"] under UI pt-BR: Olá, Ana!     compare("a","B") = 31
```

So in invariant mode creating `pt-BR` throws, and the web app did not even start: `SetDefaultCulture("en")` threw the same `CultureNotFoundException` (`en is an invalid culture identifier.`). With predefined-cultures-only off, the name is accepted, translations still load from the satellite assembly, but formatting is invariant and comparison becomes ordinal. That is what the chiseled images do to you: the `containerizing-dotnet-sdk-publish-dockerfile-chiseled` concept showed they set `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=true` and ship no ICU; a localized app needs the `-extra` variant or the full image.

Culture data is not part of .NET: the docs say it comes from ICU (maintained by CLDR, not the runtime), that .NET loads the ICU the platform provides, and that there is a `System.Globalization.AppLocalIcu` option to ship a specific ICU version with the app. On this Mac (macOS 27.0.1), `pt-BR` gave `ShortDatePattern=dd/MM/yyyy`, `LongDatePattern=dddd, d 'de' MMMM 'de' yyyy`, `ShortTimePattern=HH:mm`, group `.`, decimal `,`, and the separator in `R$ 1.234.567,89` was a plain U+0020 space. I did not run Linux; tests that compare formatted strings exactly can break when the ICU version changes.

### What localization is not

Time zones are a separate problem: `pt-BR` says how to print a date, not which offset it is in. Converting to the user's time zone is planned as its own lesson on dates, times and time zones. And `.resx` is just the default store: the docs describe `IStringLocalizerFactory` as the lowest level of the abstraction, which is the seam where a JSON-file or database-backed implementation would replace the registered `ResourceManagerStringLocalizerFactory` (I did not build one).

## Trade-offs

- **resx is compiled and safe, but redeploy-only.** Satellite assemblies are fast and versioned with the code; changing a translation needs a build. A database-backed factory gives live edits and adds a cache and an invalidation problem.
- **A missing translation is silent by design.** The key or the neutral text appears and `ResourceNotFound` is the only signal; log it or test it.
  ```csharp
  var s = loc["Checkout"]; if (s.ResourceNotFound) logger.LogWarning("Missing {Key} in {Location}", s.Name, s.SearchedLocation);
  ```
- **Neutral cultures cannot format money.** Use specific cultures (`en-US`) in `SupportedCultures`; `en` printed `¤1,234.50`.
- **Accept-Language is a hint.** Only the first 3 values are tried and fallback only goes from child to parent; offer an explicit choice (cookie or URL) as the docs recommend.
- **Invariant mode saves size and breaks cultures.** It throws on `new CultureInfo("pt-BR")`, or with predefined-cultures-only off it formats everything as invariant.
- **Culture is not a time zone and not a language preference store.** Keep the user's chosen culture and time zone as separate data.

## Documentation Links

- [Globalization and localization in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/localization?view=aspnetcore-10.0) (doc)
- [Strategies for selecting language and culture in a localized ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/localization/select-language-culture?view=aspnetcore-10.0) (doc)
- [Provide localized resources for languages and cultures in an ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/localization/provide-resources?view=aspnetcore-10.0) (doc)
- [Localization in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/localization) (doc)
- [.NET globalization and ICU, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/globalization-icu) (doc)
- [Globalization config settings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/globalization) (doc)
