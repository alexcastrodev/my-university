---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A feature flag separates deploying code from releasing it: the new checkout is in production, switched off, and a configuration change turns it on for 5% of users, then for everyone, and back off if the error rate climbs. In .NET the standard library for this is `Microsoft.FeatureManagement` (and `Microsoft.FeatureManagement.AspNetCore` for web apps). It reads flag definitions from `IConfiguration`, so they can live in `appsettings.json`, environment variables or a remote store, and it adds the parts you would otherwise write badly: filters (percentage, time window, targeting), `[FeatureGate]` for controllers, `WithFeatureGate` for Minimal APIs, and variants for experiments that need more than on or off. This concept runs all of it on .NET 10 and measures where it behaves in ways the names do not suggest: a percentage that is not sticky, a typo that silently turns a flag off, a snapshot that ignores a reload. Versions used: SDK 10.0.100, runtime 10.0.0, `Microsoft.FeatureManagement.AspNetCore` 4.8.0. The lab uses `WebApplicationFactory` and an in-memory JSON configuration per test, with no external service.

## Use Cases

- Merging unfinished work to the main branch behind a flag that is off, instead of keeping a long-lived branch.
- A gradual rollout: 1%, 10%, 50%, 100% of users, with a quick off switch.
- A time-boxed feature (a promotion, a launch at a fixed time) that opens and closes by itself.
- Letting internal users, a beta group or one customer see a feature first.
- An experiment with two or three versions of a banner or a price page.

## Deep Dive

### Defining flags in configuration

Flags are read from the `feature_management` section (the Microsoft feature management schema) by default. `AddFeatureManagement()` is all the registration a plain flag needs:

```json
{
  "feature_management": {
    "feature_flags": [
      { "id": "NewPricing", "enabled": true },
      { "id": "Reports", "enabled": false }
    ]
  }
}
```

```csharp
builder.Services.AddFeatureManagement();
app.MapGet("/pricing", async (IFeatureManager features) =>
    await features.IsEnabledAsync("NewPricing") ? "price v2" : "price v1");
```

The older `FeatureManagement` section (`"NewPricing": true`, or an `EnabledFor` array of filters) still works: I loaded `{"A": true, "B": false, "C": {"EnabledFor": [percentage 100]}}` and got `A=True B=False C=True`. But according to the docs, variants and telemetry are only supported in the newer schema from version 4.0.0 on, so new code should use `feature_management`. Because flags are ordinary configuration, every `IConfiguration` source works: files, environment variables, user secrets, Azure App Configuration.

Keep flag names in constants (`Flags.NewPricing`). A flag name is a string, and a wrong string is not an error:

```text
IsEnabledAsync("NewPriceing")   -> False     (typo, flag simply "off")
IgnoreMissingFeatures = false   -> FeatureManagementException: The feature definition for the feature 'NewPriceing' was not found.
```

Setting `IgnoreMissingFeatures` to `false` turns the typo into an exception, which is what you want in tests and probably not on the day a flag is deleted from production configuration before the code is. Also: `"enabled": false` wins over the filters. A flag with `enabled: false` and a percentage filter of 100 returned `False`, so a kill switch does not need the filters removed.

### Filters: percentage, time window, targeting

A flag with `enabled: true` and a list of `client_filters` is on when the filters say so. By default any filter turning on is enough; `"requirement_type": "All"` requires all of them. I put a 100% and a 0% percentage filter on one flag: `Any` gave `True`, `All` gave `False`.

```json
{ "id": "NewPricing", "enabled": true, "conditions": { "client_filters": [
    { "name": "Microsoft.Percentage", "parameters": { "Value": 50 } } ] } }
```

**Percentage** is random on every evaluation. The same caller asking 12 times in a row got `010001101100`, and 10000 calls gave 4995 on. It is a fair coin per call, which makes it fine for load shedding or "5% of requests use the new cache" and wrong for anything the user sees twice: the price changes between page loads.

**Time window** takes `Start` and/or `End`:

```json
{ "name": "Microsoft.TimeWindow", "parameters": { "Start": "Mon, 16 Nov 2026 09:00:00 GMT", "End": "Mon, 23 Nov 2026 09:00:00 GMT" } }
```

The lab shows a window around now is on, a future window is off and an expired window is off. The flag closes by itself, but the code and the entry stay: someone still has to delete them (see the cleanup section).

**Targeting** decides per user, and needs to know who the user is. The package asks an `ITargetingContextAccessor`; the lab implements one that reads the `X-User` and `X-Groups` headers, and a real app reads the authenticated user's claims (`WithTargeting<T>()` registers your own; the ASP.NET Core package also ships `DefaultHttpTargetingContextAccessor`, which the docs describe as reading the user from the request, and I did not run it):

```json
{ "name": "Microsoft.Targeting", "parameters": { "Audience": {
    "Users": [ "alice", "mallory" ],
    "Groups": [ { "Name": "beta", "RolloutPercentage": 100 } ],
    "DefaultRolloutPercentage": 0,
    "Exclusion": { "Users": [ "mallory" ], "Groups": [ "blocked" ] } } } }
```

```text
alice: True   mallory: False (excluded)   bob in [beta]: True   bob in [beta,blocked]: False   carol: False
```

Unlike the percentage filter, a targeting rollout is stable for a given user: with `DefaultRolloutPercentage` 10 and 50 over 1000 users, 104 and 534 were on, and no user changed between two calls. The buckets are also independent across flags: 97 users had flag F1 (10%), and 9 of them had F2 (10%) as well, about what independence predicts, so the same 10% of users do not get every experiment. Ramping up keeps the earlier group: of the 104 users on at 10%, none was off at 50%.

A filter that is not registered is an error, not a no: a flag using a filter named `My.Custom` threw `FeatureManagementException: The feature filter 'My.Custom' specified for feature 'Unknown' was not found.` You write your own filter with `IFeatureFilter` and `[FilterAlias]`, and register it with `AddFeatureFilter<T>()`; I did not run one in this concept, the lab leaves it as a bonus.

### `[FeatureGate]` and flags in Minimal APIs

For MVC controllers, `[FeatureGate("Reports")]` on a controller or action makes it answer 404 while the flag is off (the default `NotFoundDisabledFeaturesHandler`; `UseDisabledFeaturesHandler` changes it):

```csharp
[ApiController, Route("reports"), FeatureGate("Reports")]
public class ReportsController : ControllerBase { ... }
```

Minimal APIs do not use MVC filters. The ASP.NET Core package has an endpoint filter extension instead:

```csharp
app.MapGet("/checkout/express", () => "express checkout").WithFeatureGate("ExpressCheckout");
```

Both gave 404 with the flag off and 200 with it on in the lab tests. `WithFeatureGate` takes several names and a `RequirementType` (any or all),. A gated endpoint that answers 404 is invisible, which is usually right for an unreleased feature and wrong when a client needs to tell "not released" from "does not exist".

### Variants

A flag that is on or off is not enough for an experiment with three banners. A variant flag has named variants with a value each and an allocation that decides who gets which:

```json
{ "id": "Banner", "enabled": true,
  "variants": [ { "name": "Plain", "configuration_value": "Welcome" },
                { "name": "Bold", "configuration_value": "WELCOME BACK" },
                { "name": "Holiday", "configuration_value": "Happy holidays" } ],
  "allocation": {
    "user":  [ { "variant": "Bold", "users": [ "alice" ] } ],
    "group": [ { "variant": "Holiday", "groups": [ "staff" ] } ],
    "default_when_enabled": "Plain", "default_when_disabled": "Plain" } }
```

```csharp
var variant = await features.GetVariantAsync("Banner", ct);   // IVariantFeatureManager
return $"{variant?.Name}|{variant?.Configuration?.Value}";
```

```text
alice -> Bold|WELCOME BACK     bob in [staff] -> Holiday|Happy holidays     carol -> Plain|Welcome
```

A `percentile` allocation (`{ "variant": "A", "from": 0, "to": 50 }`, and `B` from 50 to 100) split 1000 users into 496 and 504, and no user changed variant between two calls, so it is sticky like targeting. For a disabled flag, `GetVariantAsync` returned the `default_when_disabled` variant (`Safe`), and for a flag that is not defined at all it returned `null`: check for it, as the code above does with `?.`.

### Reload and snapshots

`IFeatureManager` evaluates against the current configuration on every call. I edited the JSON file of a running app (with `reloadOnChange`) from `enabled: false` to `true`:

```text
before: manager=False snapshot=False
after edit (306 ms): manager=True snapshot(same scope)=False
new scope snapshot=True
```

The edit was visible in about 0.3 s without a restart. `IFeatureManagerSnapshot` caches the result per scope (per request in a web app), so inside one request a flag cannot flip halfway through. That is the safe choice for a handler that checks the same flag twice (once to render, once to authorize), and it is why the Razor `<feature>` tag helper takes the snapshot rather than the singleton manager.

### Testing by flag

The lab never touches `appsettings.json` in its tests. Each test builds a `WebApplicationFactory` and replaces the configuration with its own JSON in memory:

```csharp
new WebApplicationFactory<Program>().WithWebHostBuilder(host =>
    host.ConfigureAppConfiguration((_, config) =>
    {
        config.Sources.Clear();
        config.AddJsonStream(new MemoryStream(Encoding.UTF8.GetBytes(json)));
    }));
```

That gives each test exactly the flags it names, with no shared file and no test order. One test also loads the real `appsettings.json` and asserts that every flag ships off, which is a cheap guard against merging a flag that is on by accident. Test both branches of a flag while it exists; when the flag is removed, delete the losing branch and its tests with it.

### Old flags are debt

A flag that has been 100% on for months is dead weight: two code paths where one is dead, a configuration entry nobody dares to touch, and a combinatorial growth of states to test. Habits that keep it under control:

- Give every flag an owner and a removal date when you create it; the time window filter is a way to encode "this ends on".
- Separate short-lived release flags (remove after rollout) from long-lived ones (kill switches, permission flags), and name them differently.
- Keep names in one constants class and list what is defined: the lab's `/flags` endpoint enumerates `GetFeatureNamesAsync()` with each state, and a test (or a CI step) can compare that list with the constants to catch flags defined but never read and flags read but never defined.
- After a rollout reaches 100%, remove the check first, then the configuration entry, in that order: the other way round the code runs with a missing flag, which is silently `false` by default.

### What an external service adds

This part is from the documentation, not from my runs. The library reads from `IConfiguration`, so a remote store plugs in as one more configuration source. Azure App Configuration is the Microsoft option: flags live outside your deployment, can be changed from a portal by someone who does not deploy, refresh in running apps without a restart, and can be kept apart per environment with labels. Third-party services (LaunchDarkly, Unleash, Flagsmith and others) typically add a similar control plane, with SDKs in many languages, segment rules defined in a UI and experiment analytics. OpenFeature is a vendor-neutral API for evaluating flags, with providers for many of them. What you give up is a dependency on a service in the path of every start (a flag store outage must fall back to a safe default) and a cost per seat or per evaluation. For a few release flags in one app, configuration is enough; the moment non-developers must flip flags, or you need audit, per-environment control and experiment analysis across several services, a service pays for itself. The library can also emit telemetry about evaluations through `System.Diagnostics.Activity`, which is off by default and enabled per flag.

## Trade-offs

- **Flag names are strings that fail open to "off".** A typo is a silently disabled feature; keep constants and turn on `IgnoreMissingFeatures = false` in tests.
  ```csharp
  builder.Services.Configure<FeatureManagementOptions>(o => o.IgnoreMissingFeatures = false);
  ```
- **The percentage filter is not sticky.** The same caller flips from call to call. Use targeting with `DefaultRolloutPercentage` for anything a user sees more than once.
- **Every flag doubles the states you must test.** Test both branches while it lives, and schedule its removal when you create it.
- **A disabled gate looks like a missing endpoint.** `[FeatureGate]` and `WithFeatureGate` answer 404; if clients need a clear message, use `UseDisabledFeaturesHandler` or check the flag in code.
- **Filters need their dependencies.** Targeting needs an accessor that knows the user, and an unregistered filter throws instead of returning false.
- **Variant and telemetry need the new schema.** Per the docs, the `FeatureManagement` section from before 4.0 does not support them; start with `feature_management`.
- **Flags are runtime configuration, so they can break production.** A bad edit takes effect in about 0.3 s on a reloading source. Review flag changes like code, and give risky flags a kill switch.
- **A flag service moves the failure mode.** Decide what the app does when the store is unreachable at startup: a cached last-known state or a safe default, never an exception.

## Documentation Links

- [Feature management overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/feature-management-overview) (doc)
- [.NET feature management reference, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/feature-management-dotnet-reference) (doc)
- [Quickstart: add feature flags to an ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-feature-flags-dotnet-core) (doc)
- [Use variant feature flags in an ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-variant-feature-flags-aspnet-core) (doc)
- [Microsoft.FeatureManagement.AspNetCore, NuGet](https://www.nuget.org/packages/Microsoft.FeatureManagement.AspNetCore) (doc)
- [Feature Toggles, Martin Fowler](https://martinfowler.com/articles/feature-toggles.html) (doc)
- [OpenFeature](https://openfeature.dev/) (doc)
