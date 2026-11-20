---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

A .NET app on Azure usually reads two kinds of external settings: secrets (a database password, an API key) and ordinary configuration (a feature flag, a timeout, a message). Azure splits them into two services with two .NET integrations: Key Vault, read through `SecretClient` or as an `IConfiguration` provider, and App Configuration, a configuration provider with its own refresh model that can also point at Key Vault. This lesson measures how those clients behave on the wire: `SecretClient` calls, the `--` to `:` name mapping, `ReloadInterval`, `Select` with key and label filters, sentinel refresh, the middleware, Key Vault references, feature flags and the failure modes. There is no Azure subscription here and no official emulator for either service, so every run is against a fake of both data planes that I wrote in C# (Kestrel, a self-signed certificate, about 150 lines, `Fake.cs` in the lab). It answers the minimum REST the real SDKs ask for. It is a test double, not Azure: it proves what the client code does, not what the services return. Everything that needs the real service (RBAC enforcement, soft delete, purge protection, real throttling, real error text) is docs only and labelled. The identity side (`DefaultAzureCredential`, managed identity, workload identity) is in the [credential lesson](/azure-dotnet-concepts/azure-sdk-clients-and-defaultazurecredential) and in the [secrets and managed identities lesson](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity), which measured Key Vault against the Lowkey Vault emulator; this one goes further on the configuration side and on App Configuration.
Versions (NuGet, checked 2026-11-20): `Azure.Security.KeyVault.Secrets` 4.12.0 (4.13.0-beta.1 exists), `Azure.Security.KeyVault.Keys` 4.10.2, `Azure.Security.KeyVault.Certificates` 4.10.0 (the last two only constructed, not exercised), `Azure.Extensions.AspNetCore.Configuration.Secrets` 1.5.2, `Microsoft.Extensions.Configuration.AzureAppConfiguration` 8.6.1 (8.7.0-preview exists), `Microsoft.Azure.AppConfiguration.AspNetCore` 8.6.1, `Microsoft.FeatureManagement.AspNetCore` 4.8.0, `Azure.Core` 1.64.0, TFM `net10.0`, SDK 10.0.100, runtime 10.0.0, Apple M4 Max, macOS 27.2.1. Timings are from that machine.

## Use Cases

- Moving a connection string or API key out of `appsettings.json` into a vault the app reads by identity.
- Centralizing non-secret settings and feature flags for many services, with per-environment labels, and changing them without a deploy.
- Debugging "the value changed in the portal but my app still shows the old one" or "the secret rotated and the app broke".
- Reviewing the permissions an app needs (RBAC role per service) and how much traffic its refresh settings send.

## Deep Dive

### Secret, key or certificate

Key Vault stores three object types, each with its own client package (`Azure.Security.KeyVault.Secrets`, `.Keys`, `.Certificates`):

- A **secret** is an opaque value you read back (password, token, connection string). `SecretClient` is what applications use.
- A **key** is cryptographic material the service uses for you: sign, verify, wrap, unwrap, encrypt, decrypt through `CryptographyClient`, so the private key does not leave the service (docs).
- A **certificate** is a key plus a secret plus lifecycle (issuer, renewal). Reading the secret half of a certificate returns the private key, which is why the `Key Vault Secrets User` role description says "including secret portion of a certificate with private key" (rbac-guide, 2026-06-16).

Ordinary settings are not secrets: they go to App Configuration, whose FAQ (2026-08-28) says Key Vault is "still the best place for storing application secrets" and the two "should be used side by side". A key-value there is limited to 10 KB including its attributes.

### `SecretClient` on the wire (fake vault, measured)

```csharp
var client = new SecretClient(vaultUri, credential, options);
await client.SetSecretAsync("Db--Password", "pw-1");
await client.SetSecretAsync("Db--Password", "pw-2");
KeyVaultSecret s = (await client.GetSecretAsync("Db--Password")).Value;   // latest version
```

```text
PUT /secrets/Db--Password?api-version=2026-04-01  (no Authorization)   <- the SDK first sends no token and reads the 401 challenge
PUT /secrets/Db--Password?api-version=2026-04-01                       <- then asks the credential once, scope https://vault.azure.net/.default
latest: Name=Db--Password Value=pw-2 Version=dae22229 Enabled=True Id=https://localhost:7040/secrets/Db--Password/dae22229fbd2...
GetPropertiesOfSecretVersionsAsync: 95a8d028 -> pw-1, dae22229 -> pw-2    (a pinned version stays readable)
GetPropertiesOfSecretsAsync lists names only: SecretProperties has no Value
token requests after about 8 calls: 1 (the credential result was cached)
```

Each `SetSecretAsync` makes a new version, never an overwrite, and `GetSecretAsync(name)` without a version means the latest. The default service version the 4.12.0 client sent here was `2026-04-01`. A token credential refuses plain HTTP: `InvalidOperationException: Bearer token authentication is not permitted for non TLS protected (https) endpoints.` The fake has a self-signed certificate, so the lab passes an `HttpClientTransport` that trusts only that thumbprint and sets `DisableChallengeResourceVerification = true`. Both are for test doubles only: the real vault has a public certificate and you never disable them.

Failures arrive as `RequestFailedException` with `Status`, `ErrorCode` and the body. Against the fake:

```text
GetSecretAsync("Nope")  -> Status=404 ErrorCode=SecretNotFound   "A secret with (name/id) Nope was not found in this key vault. ..."
reader role calls Set   -> Status=403 ErrorCode=Forbidden        inner code ForbiddenByRbac, "Caller is not authorized to perform action on resource. Action: 'Microsoft.KeyVault/vaults/secrets/setSecret/action' ..."
access policy vault     -> Status=403 ErrorCode=Forbidden        inner code AccessDenied, "The user, group or application 'appid=...;oid=...' does not have secrets get permission on key vault ..."
```

Each of these was sent exactly once (no retry on 403 or 404). The message texts are MY fake's, modelled on text quoted in public support threads, not copied from an official page: the real wording may differ, so catch on `Status` (and `ErrorCode`), not on the message. The practical reading of the two 403 shapes (docs plus those threads): `ForbiddenByRbac` means the vault uses Azure RBAC and the caller has no data-plane role at that scope; `AccessDenied` means a vault on the access policy model. Real RBAC enforcement, and the delay before a new role assignment takes effect (the rbac-guide says to allow several minutes), are docs only.

### `AddAzureKeyVault` as a configuration provider (measured)

```csharp
builder.Configuration.AddAzureKeyVault(client, new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromSeconds(1) });
// in Azure: AddAzureKeyVault(new Uri(url), new ManagedIdentityCredential(...))
```

Secret names cannot contain `:`, so the provider's default manager turns `--` into the configuration delimiter. Seeded: `Db--Password`, `Db--Host`, `Api--Key`, a DISABLED `Old--Secret`, and `app1-Smtp--Password`, with an environment variable `Db__Password=from-env` added before the vault source:

```text
Db:Password=pw-1  Db:Host=db.internal  Api:Key=key-1  Old:Secret=(null)  app1-Smtp:Password=smtp-1
GetDebugView: Password=pw-1 (AzureKeyVaultConfigurationProvider)         <- the vault source, added last, beat the environment variable
startup requests: 1 list, then 1 GET per ENABLED secret (none for Old--Secret)
```

The provider needs the `list` and `get` permissions on secrets, and its startup cost is one request per secret. A custom `KeyVaultSecretManager` decides which secrets load (`Load`) and how names map (`GetKey`). The doc's prefix example, used by an app that loads only its own secrets:

```csharp
class PrefixManager(string prefix) : KeyVaultSecretManager {
    public override bool Load(SecretProperties p) => p.Name.StartsWith(prefix + "-");
    public override string GetKey(KeyVaultSecret s) => s.Name[(prefix.Length + 1)..].Replace("--", ConfigurationPath.KeyDelimiter);
}
```

With `PrefixManager("app1")`: `Smtp:Password=smtp-1`, `Db:Host=(null)`, and the fake saw one list and one GET (only the matching secret is fetched). Prefixes are a way to share one vault between apps, but the rbac-guide recommends "a vault per application per environment" with roles at vault scope, because per-secret role assignments do not isolate teams (its FAQ says so).

`ReloadInterval` defaults to `null`: no reload. With 1 second:

```text
3.2 s with nothing changed:   3 requests, all GET /secrets (the list), no secret GET, 0 change callbacks
Db--Password rotated:         1 list + 1 GET /secrets/Db--Password, Db:Password=pw-2-rotated, 1 change callback
```

Every interval costs one list request, and only a secret whose metadata changed is fetched again. This is the same reload the [other lesson](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity) measured with `IOptionsMonitor<T>.OnChange` and with the one-second `UpdatedOn` resolution that can hide two writes in the same second. Startup with a 403 throws `RequestFailedException` out of `Build()`, so the app does not start.

### Why one read at startup is a risk

The provider loads at startup and then never, by default, so a rotated secret stays in memory until the process restarts. Reading with `SecretClient` once into a `static` string has the same problem. The failure is not at rotation time but later: the old credential is revoked after the overlap window and the app fails with auth errors at some random moment. The Key Vault throttling page (2026-07-15) says to cache secrets in memory and "re-read from Azure Key Vault only when the cached copy stops working (for example, because it got rotated at the source)". The two good shapes: a short `ReloadInterval` together with `IOptionsMonitor<T>` (never `IOptions<T>` in a singleton, see the [configuration lesson](/dotnet-concepts/configuration-and-the-options-pattern)), or a retry on authentication failure that re-reads the secret once. A rotation scheme must also keep two secrets valid during a window.

### App Configuration: `Select`, labels and JSON (measured)

```csharp
builder.Configuration.AddAzureAppConfiguration(o => {
    o.Connect(new Uri(endpoint), new DefaultAzureCredential())
     .Select("TestApp:*")            // no label (the default label filter is the null label)
     .Select("TestApp:*", "Prod")    // later Select wins on overlapping keys
     .TrimKeyPrefix("TestApp:");
});
```

Seeded keys: `TestApp:Settings:Message=base`, the same key with label `Prod` and value `from-Prod`, `TestApp:Settings:Color`, `Other:Thing`, and `TestApp:Json` with content type `application/json`:

```text
Json:a = 1   Json:b:c = 2   Settings:Color = white   Settings:Message = from-Prod      (Other:Thing not loaded)
requests: GET /kv?...&key=TestApp%3A%2A&label=%00      GET /kv?...&key=TestApp%3A%2A&label=Prod       (one per Select)
```

Labels: with no label filter only the null-label values load (`label=%00`), the quickstart says it loads "all key-values that have no label". A JSON content type is flattened into keys. The FAQ's advice on environments: a separate store per environment when you need permission isolation, labels only when you do not. The provider has `Map` for rewriting keys (for instance `__` to `:`), `SelectSnapshot` and tag filters (docs only). Startup failure, store unreachable with `Timeout = 3 s` (one run each):

```text
default            TimeoutException: The provider timed out while attempting to load.   (thrown after 5.0 s)
optional: true     built after 3.0 s, configuration["TestApp:Settings:Message"] is null
```

`AddAzureAppConfiguration(..., optional: true)` lets the app start without the store, with nothing from it: decide that on purpose, because an empty value is a worse bug than a crash for most settings. I did not investigate why the throwing variant took longer than the timeout. As with Key Vault, bearer authentication over `http://` throws the same `InvalidOperationException`.

### Refresh: sentinel, `RegisterAll` and the middleware (measured)

Key-values are not watched unless you say so ("Key-values are not automatically registered for refresh monitoring", provider reference, 2026-08-28). Two ways:

```csharp
o.ConfigureRefresh(r => r.Register("Sentinel", refreshAll: true).SetRefreshInterval(TimeSpan.FromSeconds(1)));  // watch one key
o.ConfigureRefresh(r => r.RegisterAll().SetRefreshInterval(TimeSpan.FromSeconds(1)));                          // watch all selected keys
```

The provider never refreshes by itself: your code calls `IConfigurationRefresher.TryRefreshAsync()`, or `app.UseAzureAppConfiguration()` does it per request. Sentinel run, interval 1 s:

```text
load                              GET /kv?key=TestApp:*   +   GET /kv/Sentinel
TryRefreshAsync inside interval   no request at all
after 1.1 s, nothing changed      GET /kv/Sentinel  If-None-Match="de6e6e84..."        (a conditional request, the etag)
changed TestApp:A, sentinel not   same single GET /kv/Sentinel, A still a1               <- the sentinel hides the change
sentinel bumped                   GET /kv/Sentinel, then the full GET /kv?key=TestApp:*, A=a2
RegisterAll, nothing changed      GET /kv?key=TestApp:*  If-None-Match="30d9cf67..."   (one conditional request for the whole page)
RegisterAll, B changed            the same conditional request, then an unconditional one, B=b2
```

The sentinel makes a multi-key change atomic (write everything, bump the sentinel last, the app reloads once) and keeps the polling to one tiny request. The cost is that a change without a sentinel bump is invisible. `SetRefreshInterval` below one second throws `ArgumentOutOfRangeException: The refresh interval cannot be less than 1000 milliseconds`; the default is 30 seconds (docs). The FAQ's quota arithmetic says that frequent unchanged checks mostly do not count against the hourly quota of a Standard store.

When the store answers 429 (my fake: 429 plus `retry-after-ms: 500` on everything):

```text
TryRefreshAsync returned False after 2.3 s, 3 requests, the configuration kept the last value (A=a2)
store healthy again, interval 1 s: the new value (a3) showed up only after 31 s and 28 TryRefreshAsync calls
```

A failed refresh keeps the cache, as the docs say, and the provider then waits before trying again: here it was about 31 s even though the interval was 1 s (the reason is not documented in what I read, so treat 31 s as this run). Do not tune the interval to react faster than your outages recover.

The middleware (`Microsoft.Azure.AppConfiguration.AspNetCore`), with `AddAzureAppConfiguration()` in services, `app.UseAzureAppConfiguration()` early in the pipeline, `IOptionsSnapshot<Settings>` in the handler and a 2 s interval. The store changes (message to `hello v2`, flag `Beta` on):

```text
immediately                       /msg -> hello v1    /beta -> 404
after 2.2 s, FIRST request        /msg -> hello v1    /beta -> 404      <- this request triggered the refresh and still saw the old value
the NEXT request                  /msg -> hello v2    /beta -> 200 beta page    /flag -> True
```

The refresh is started by a request but does not delay it, so a change reaches clients one request later than the interval. For background services there are no requests, so inject `IConfigurationRefresherProvider` and call `TryRefreshAsync` in the loop (docs only).

### Key Vault references (measured with the fake)

A key-value with content type `application/vnd.microsoft.appconfig.keyvaultref+json` holds `{"uri":"https://<vault>/secrets/<name>"}`. The provider resolves it with the APP's identity, so the app needs `Key Vault Secrets User` on the vault and App Configuration never stores the secret:

```csharp
o.ConfigureKeyVault(kv => kv.Register(secretClient));      // or kv.SetCredential(credential), or kv.SetSecretResolver(...)
```

```text
no ConfigureKeyVault   KeyVaultReferenceException: No key vault credential or secret resolver callback configured, and no matching secret client could be found. ... Key:'TestApp:Db:Password' ... SecretIdentifier:'https://localhost:7040/secrets/Db--Password'
with Register(client)  Db:Password = pw-1  (the fake vault saw GET /secrets/Db--Password from the provider)
```

A reference without configuration fails the start. Rotation is the trap. After I wrote `pw-2-rotated` in the vault and a refresh tick passed, the value stayed `pw-1`. After I bumped the sentinel with `refreshAll`, the key-values reloaded and the value STILL stayed `pw-1`: the fake saw no secret request. The reference key-value itself had not changed, so the resolved secret was kept. Only `SetSecretRefreshInterval` re-reads it:

```text
kv.SetSecretRefreshInterval(TimeSpan.FromSeconds(5))  -> ArgumentOutOfRangeException: The secret refresh interval cannot be less than 60000 milliseconds.
kv.SetSecretRefreshInterval(TimeSpan.FromMinutes(1)), rotated at t=0, TryRefreshAsync every 2.1 s:  seen as pw-3-rotated after 61 s
```

The secret was fetched again only after the minute, during a refresh call (the docs say a refresh call is also required). So a Key Vault reference without `SetSecretRefreshInterval` is a startup-only read, the same risk as above. The minimum is one minute "to prevent excessive secret reloads which may induce Key Vault throttling".

### Feature flags from the store (measured)

`o.UseFeatureFlags(f => f.SetRefreshInterval(...))` loads the keys under `.appconfig.featureflag/` (request `key=.appconfig.featureflag%2F*`), and the flags refresh on their own interval with no `ConfigureRefresh` ("Different from key-values, feature flags are automatically registered for refresh", docs; default 30 s). `AddFeatureManagement()` plus `IFeatureManager` and `.WithFeatureGate("Beta")` on a minimal API endpoint, or `[FeatureGate]` on MVC, are the same API as in the [feature flags lesson](/dotnet-concepts/feature-flags-with-microsoft-featuremanagement) (4.8.0): the library reads flags from `IConfiguration`, the store is just another source. In the run above the flag flipped on the same request boundary as the message: `/beta` went from 404 to 200 and `/flag` from `False` to `True`. Telemetry, variants and targeting are docs only here.

### Permissions: RBAC against access policies (docs only, dated)

Data-plane roles for applications (rbac-guide, 2026-06-16; App Configuration quickstart, updated 2026-06-30):

| Need | Role | Scope |
|---|---|---|
| Read secret values (`SecretClient`, provider, Key Vault references) | `Key Vault Secrets User` | the vault |
| Create and rotate secrets from a job | `Key Vault Secrets Officer` | the vault |
| Read key-values and feature flags | `App Configuration Data Reader` | the store |
| Manage the vault resource, not its data | `Key Vault Contributor` (control plane only) | resource group or vault |

A subtle one from the same page: someone with `Contributor` on the control plane can grant themselves data access through an access policy, so restrict who holds it. The model: access policies are the older vault-level list of permissions per principal; Azure RBAC is the recommended one. `API version 2026-02-01 and later` makes RBAC the default for NEW vaults only (access-control-default, 2026-09-16): existing vaults keep their model, and both models remain supported. Switching a vault to RBAC invalidates its access policies, so assign the roles first. Separately, "All Key Vault control plane API versions before 2026-02-01 retire on February 27, 2027" (same page), which concerns templates and CLI versions (Azure CLI 2.90.0 or later), not your `SecretClient` code.

### Cache, throttling and limits (docs only)

Key Vault (service-limits, 2026-11-17): 4,000 transactions per 10 seconds per vault per region for "all other" secret operations and 300 for secret creation, with a subscription-wide limit five times that, and `429` above it. The throttling page tells you to honor exponential backoff, cache in memory, avoid immediate retries, and to use one vault per security or availability domain. Its sample configures `SecretClientOptions.Retry` (`Delay` 2 s, `MaxDelay` 16 s, `MaxRetries` 5, `Mode = Exponential`), and the Key Vault tutorial uses the same block. App Configuration (FAQ, 2026-08-28) limits by tier: Free 1,000 requests per day, Developer 6,000 per hour, Standard 30,000 per hour, Premium no request quota, with throughput limits in requests per second and `429` plus a `retry-after-ms` header. Its estimate for 50 instances polling a sentinel every 30 s is 6,000 requests per hour, most of them unchanged and not counted against the Standard quota. The providers "have built-in retry and caching": use them instead of a hand-written client.

### Secrets in development, and in Kubernetes

Do not put a secret in `appsettings.json`: the file is committed (see the [user-secrets ladder](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity) measured in the other lesson). The quickstarts themselves keep only the ENDPOINT of the store in user-secrets (`dotnet user-secrets set Endpoints:AppConfiguration "<endpoint>"`), and authenticate with an identity, so nothing secret is needed to reach the secrets. In Kubernetes the app reads the same stores with workload identity (see the [workload identity lesson](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe)); a different route is the Secrets Store CSI driver, which mounts vault objects as files in the pod (not run here, mentioned in the other lesson), and the Kubernetes side of Secrets is in [Kubernetes Secrets Fundamentals](/kubernetes-concepts/kubernetes-secrets-fundamentals) and [Secrets as Environment Variables vs Mounted Files](/kubernetes-concepts/secrets-as-env-vars-vs-mounted-files). With a mounted file or an environment variable you lose the in-process reload unless the app watches the file.

### Book vs today

- `Microsoft.Azure.KeyVault` (3.0.x, last published 2020-02-03) is the older client, with a token callback that, in the samples of that era, used ADAL (`Microsoft.IdentityModel.Clients.ActiveDirectory`; from memory, not rechecked in a doc here). NuGet marks it deprecated (reason "Legacy", message "obsolete as of 3/31/2023 and is no longer maintained or monitored") with `Azure.Security.KeyVault.Secrets`, `.Keys` and `.Certificates` as replacements. The ADAL package is also deprecated in favor of `Microsoft.Identity.Client` (checked in the NuGet registry, 2026-11-20). Today: `SecretClient` plus a `TokenCredential` from `Azure.Identity`.
- `Microsoft.Extensions.Configuration.AzureKeyVault` 3.1.x (last published 2022-04-11) is deprecated in favor of `Azure.Extensions.AspNetCore.Configuration.Secrets` (the `AddAzureKeyVault` extension used here).
- Older material builds the vault client in `ConfigureAppConfiguration` of `Program.Main` and configures access policies per principal. Today: `builder.Configuration`, a managed identity, and Azure RBAC as the default model for new vaults (API 2026-02-01).
- The App Configuration quickstart still installs `Microsoft.Azure.AppConfiguration.AspNetCore`, while the provider reference installs `Microsoft.Extensions.Configuration.AzureAppConfiguration`: the first adds the middleware on top of the second, both at 8.6.1 here.

## Trade-offs

- **The provider is a snapshot unless you reload it.** `AddAzureKeyVault` without `ReloadInterval` and a Key Vault reference without `SetSecretRefreshInterval` read once. A rotation then breaks the app later, not at rotation time.
  ```csharp
  builder.Configuration.AddAzureKeyVault(uri, credential, new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromMinutes(5) });
  ```
- **A sentinel is consistent and fragile.** One small request and an atomic reload, but a change without a sentinel bump is invisible. `RegisterAll` has no such trap and costs one conditional request for the whole page.
- **The middleware refresh is one request late.** The request that starts the refresh sees the old value. Fine for settings, surprising in a test that changes a flag and asserts at once.
- **`optional: true` trades a crash for a silent default.** The app starts without the store and every key is missing. Prefer failing, unless every setting has a safe default.
- **Per-secret roles do not isolate teams.** Use a vault per app and environment with roles at vault scope; prefixes in one shared vault are naming, not security.
- **Two stores, two permission sets.** An App Configuration key-value with a Key Vault reference needs the app to hold both `App Configuration Data Reader` and `Key Vault Secrets User`; a missing one fails at startup (the reference) or later (the role).
- **A fake proves client behavior, not the service.** The 403 and 404 texts, the real RBAC delay and the real 429 shape are docs only here: test permissions in a real subscription.

## Documentation Links

- [Quickstart: Azure App Configuration with ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/quickstart-aspnet-core-app) (doc)
- [.NET configuration provider reference, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/reference-dotnet-provider) (doc)
- [Azure App Configuration FAQ, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/faq) (doc)
- [Tutorial: use Azure Key Vault with an Azure web app in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/tutorial-net-create-vault-azure-web-app) (doc)
- [Azure Key Vault configuration provider, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/key-vault-configuration) (doc)
- [Grant permission to applications to access a key vault using Azure RBAC, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide) (doc)
- [Plan for Azure RBAC as the default access control model in Key Vault, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/access-control-default) (doc)
- [Azure Key Vault service limits, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/service-limits) (doc)
- [Azure Key Vault throttling guidance, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/overview-throttling) (doc)
- [Azure Key Vault secret client library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/security.keyvault.secrets-readme) (doc)
- [Feature management overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/feature-management-overview) (doc)
- [Use Key Vault references in an ASP.NET Core app, Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-app-configuration/use-key-vault-references-dotnet-core) (doc)
- [Migration guide from Microsoft.Azure.KeyVault, Azure SDK for .NET](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/keyvault/Azure.Security.KeyVault.Secrets/MigrationGuide.md) (doc)
