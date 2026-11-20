---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Every `Azure.*` library for .NET (Blobs, Service Bus, Key Vault, App Configuration, Cosmos) is built to the same design: a client constructed from an endpoint, a `TokenCredential` and a `ClientOptions` subclass, one HTTP pipeline with a retry policy and a bearer-token policy, `Response<T>` for single results, `Pageable<T>` for lists, `RequestFailedException` for errors. Learn the shape once and every service reads the same. The other half is identity: `DefaultAzureCredential` is the one-liner that works on a laptop and in Azure, and also the line Microsoft's docs tell you to remove before production. This lesson measures both. There is no Azure tenant here, so I wrote a small fake HTTPS service and a fake Entra authority in C#, built a client in the SDK's own shape against it, and ran the real `Azure.Identity` 1.21.0 offline to see the real chain order, the real error messages and the real cost of failing. Anything that needs a real tenant (a real token, managed identity, a developer sign-in, sovereign clouds) is labelled docs only. The OAuth and managed identity mechanics live in other lessons; this one is the SDK side.
Versions (NuGet, resolved 2026-11-20): `Azure.Identity` 1.21.0 (MSAL 4.92.0 inside), `Azure.Core` 1.65.0, `Microsoft.Extensions.Azure` 1.14.1, `Azure.Storage.Blobs` 12.30.1 (only to register a client), `Microsoft.Extensions.Hosting` 10.0.15, TFM `net10.0`, SDK 10.0.100, one Apple M4 Max with macOS 27.2 (timings are from it).

## Use Cases

- Writing a service that talks to Azure with no connection string or key in configuration.
- Reading a `CredentialUnavailableException` that lists nine credentials and knowing which one you needed.
- Registering Azure clients with `AddAzureClients`, with per-client retry settings and named clients.
- Deciding when `DefaultAzureCredential` is fine (development) and what replaces it in production.
- Debugging an Azure call from its wire log (request id, retries, redacted `Authorization`).

## Deep Dive

### The shape of an Azure SDK client (measured against a fake service)

The Azure SDK design guidelines fix the pattern, and `Azure.Core` provides the parts: `ClientOptions` (retry, transport, diagnostics), `HttpPipelineBuilder` (builds the pipeline), `BearerTokenAuthenticationPolicy` (asks the credential for a token), `Response<T>`, `Page<T>` and `AsyncPageable<T>`. A reduced client of my own, in the same shape the real libraries use:

```csharp
public class WidgetClientOptions : ClientOptions { public enum ServiceVersion { V2026_01 = 1 } /* ... */ }
public class WidgetClient
{
    readonly HttpPipeline _pipeline; readonly Uri _endpoint;
    protected WidgetClient() { }                                   // for mocking, as the guidelines say
    public WidgetClient(Uri endpoint, TokenCredential credential, WidgetClientOptions? options = null)
    {
        options ??= new(); _endpoint = endpoint;
        _pipeline = HttpPipelineBuilder.Build(options, new BearerTokenAuthenticationPolicy(credential, "https://widgets.example/.default"));
    }
    public virtual async Task<Response<Widget>> GetWidgetAsync(string id, CancellationToken ct = default) { /* send, then */
        if (msg.Response.IsError) throw new RequestFailedException(msg.Response);
        return Response.FromValue(widget, msg.Response); }
    public virtual AsyncPageable<Widget> GetWidgetsAsync(CancellationToken ct = default) => new WidgetPager(this, ct);
}
```

Real libraries also route through `ClientDiagnostics`, which is `internal` to `Azure.Core` (my first build failed with CS0122 on it), so the sample skips it. The fake service (Kestrel, port 6990, self-signed certificate that the lab transport accepts, lab only) logs each request. A run of the client:

```text
  [fake] GetTokenAsync #1 scopes=[https://widgets.example/.default] tenant=null claims=null
Value=Widget { Id = 1, Name = widget-1 }  status=200  x-ms-request-id present=True
token calls after 3 requests: 1
widget-1 widget-2 widget-3 widget-4 widget-5
page of 2, continuation=?skip=2     page of 2, continuation=?skip=4     page of 1, continuation=null
http endpoint: InvalidOperationException: Bearer token authentication is not permitted for non TLS protected (https) endpoints.
```

What it shows. The policy asked the credential once for three requests: the pipeline caches the token until it nears expiry (the exact refresh margin is not measured), so the credential is not hit per request. `Response<T>` holds the value and `GetRawResponse()` (status, headers, the service's `x-ms-request-id`). `await foreach` over an `AsyncPageable<T>` flattens the pages; `.AsPages()` exposes them with a `ContinuationToken` so you can stop and resume. The bearer policy refuses plain HTTP before sending anything. An error becomes `RequestFailedException`, the full message of a 404 from the fake:

```text
No widget with id 404.
Status: 404 (Not Found)
ErrorCode: WidgetNotFound
Content: {"error":{"code":"WidgetNotFound","message":"No widget with id 404."}}
Headers: Date, Server, Transfer-Encoding, x-ms-request-id: 83ad0cd1-..., Content-Type
```

`Status` and `ErrorCode` are properties, and the `x-ms-request-id` is the value to quote to Azure support. Catch on `Status` or `ErrorCode`, never on the message text. The clients are thread-safe and meant to live as singletons (the guidelines say so; here only a single thread was exercised).

### Retry: the policy you get without asking

`ClientOptions.Retry` defaults, read from the options object: `Mode=Exponential`, `MaxRetries=3`, `Delay=0.8 s`, `MaxDelay=1 min`, `NetworkTimeout=100 s`. Against the fake (the log shows every attempt reusing one `x-ms-client-request-id`):

```text
400 (bad request)                         1 request, not retried, 0.1 s
503, 503, then 200, defaults              3 requests at +0, +0.85, +2.5 s: OK in 2.6 s
429 with Retry-After: 2, defaults         waited 2.0 s, then OK (the header wins over the backoff)
503 forever, defaults                     4 requests at +0, +0.7, +2.4, +5.1 s, then RequestFailedException after 5.1 s
503 forever, MaxRetries=1 Fixed 100 ms    2 requests, 0.1 s
503 forever, MaxRetries=0                 1 request
slow 6 s, NetworkTimeout=1 s, 1 retry     AggregateException "Retry failed after 2 tries ..." at 2.1 s, inner TaskCanceledException
```

4xx errors are not retried; 5xx, 429 (honouring `Retry-After`) and timeouts are. The exponential delay has jitter, so the gaps vary between runs. When retries run out on a status code you get `RequestFailedException`; when they run out on a network failure or timeout you get an `AggregateException` that wraps each attempt. Stack your own retry (the [resilience lesson](/dotnet-concepts/resilience-retries-timeouts-and-circuit-breakers)) over this and the attempts multiply: 4 x 4 here. Pick one layer, and for Azure clients that is usually this one.

### TokenCredential, scopes and the token request

A `TokenCredential` has one job: `GetTokenAsync(TokenRequestContext)` returns an `AccessToken` (the string and `ExpiresOn`). The context carries `Scopes`, optional `TenantId` and `Claims` (for continuous access evaluation challenges). The scope names the audience, the resource plus `/.default`: Key Vault is `https://vault.azure.net/.default` (the one the chain below asked for), Storage `https://storage.azure.com/.default`. The client library picks the scope; your code picks the credential. Everything that can answer, from a client secret to a managed identity to `az login`, is a subclass, so a test can pass a hand-written credential (mine counted its calls, as in the run above). The [Key Vault lesson](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity) measures the managed identity and workload identity credentials, including the per-credential token cache; the [OAuth lesson](/identity-concepts/oauth-2-roles-grants-and-tokens-from-first-principles) explains the `client_credentials` request a service principal ends up making.

### DefaultAzureCredential: the real chain, offline

`DefaultAzureCredential` is a preconfigured `ChainedTokenCredential`: try each credential in order, the first that returns a token wins. A `CredentialUnavailableException` from a link means "not configured, try the next"; an `AuthenticationFailedException` means "I was configured and it failed", which stops the chain (measured below). The doc table (checked 2026-11-20), and what 1.21.0 did on a machine with nothing configured (`az`, `pwsh` and `azd` removed from `PATH`, no Visual Studio, so it could not reach any real tenant):

```text
CredentialUnavailableException in 1116 ms
DefaultAzureCredential failed to retrieve a token from the included credentials. See the troubleshooting guide ...
- EnvironmentCredential authentication unavailable. Environment variables are not fully configured. ...
- WorkloadIdentityCredential authentication unavailable. The workload options are not fully configured. ...
- ManagedIdentityCredential authentication unavailable. No response received from the managed identity endpoint.
- VisualStudioCredential authentication failed: Visual Studio Token provider can't be accessed at ~/.IdentityService/AzureServiceAuth/tokenprovider.json
- VisualStudioCodeCredential requires the Azure.Identity.Broker package to be referenced from the project. ...
- AzureCliCredential authentication failed: Azure CLI not installed
- AzurePowerShellCredential authentication failed: PowerShell is not installed.
- AzureDeveloperCliCredential authentication failed: Azure Developer CLI could not be found.
- The BrokerCredential requires the Azure.Identity.Broker package to be referenced. ...
```

That is the default chain in 1.21.0, in order: Environment, Workload Identity, Managed Identity, Visual Studio, Visual Studio Code, Azure CLI, Azure PowerShell, Azure Developer CLI, Broker. The ninth in the doc table, `InteractiveBrowserCredential`, is off by default (`ExcludeInteractiveBrowserCredential` was `True`). The Visual Studio Code and Broker links are in the chain but need the separate `Azure.Identity.Broker` package. The exception is one aggregate message listing every link and why it passed, so read it from the bottom up when "it works on my laptop". Time to fail over five fresh processes: 1116, 1118, 104, 121 and 124 ms; the two slow ones were the first process after a pause, so the cost is not a constant (the Key Vault lesson measured 2.3 s on its own run). Budget about a second, not a millisecond. In Azure the third link answers, so this cost is mostly a development and misconfiguration cost.

`AZURE_TOKEN_CREDENTIALS` narrows the chain (the doc says single credential names need Azure.Identity 1.15.0 or later; 1.21.0 accepted all of these):

```text
prod                          Environment, WorkloadIdentity, ManagedIdentity                              51 ms
dev                           VisualStudio, VisualStudioCode, AzureCli, AzurePowerShell, AzureDeveloperCli, Broker   90 ms
visualstudiocredential        only that one                                                              21 ms
azureclicredential            only that one                                                              43 ms
bogus                         InvalidOperationException: Invalid value for environment variable AZURE_TOKEN_CREDENTIALS: bogus.
                              Valid values are 'dev', 'prod', 'visualstudiocredential', 'visualstudiocodecredential', 'azureclicredential', ...
```

`prod` keeps the three deployed-service credentials, `dev` the developer tools, a credential name keeps just that one, and a bad value fails loudly at construction. Per credential, `new DefaultAzureCredentialOptions { ExcludeAzureCliCredential = true }` (and the other `ExcludeXxxCredential`) removes links in code; excluding Environment, Workload Identity, Managed Identity, Visual Studio, PowerShell and Developer CLI left Azure CLI, VS Code and Broker, failing in 45 ms.

### EnvironmentCredential, and the credential that wins silently

The first link reads `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and one of `AZURE_CLIENT_SECRET`, a certificate path (`AZURE_CLIENT_CERTIFICATE_PATH`), or a username and password (docs). I pointed `DefaultAzureCredentialOptions.AuthorityHost` at the fake authority (it knows `app-A` with the fake secret `s3cr3t-demo`) and ran the chain with only those variables changed:

```text
tenant + client id only              EnvironmentCredential unavailable, chain went on (all nine tried), CredentialUnavailableException
tenant + id + right secret           OK in 162 ms, expiresIn=60min, authority saw grant_type=client_credentials client_id=app-A
tenant + id + WRONG secret           AuthenticationFailedException in 143 ms: "ClientSecretCredential authentication failed:"
                                     inner MsalServiceException ... See https://aka.ms/msal-net-invalid-client   (the log lists only EnvironmentCredential)
```

Once the three variables exist, `EnvironmentCredential` owns the request: when it fails, nothing else is tried, even on a host with a perfectly good managed identity. That is the risk the best-practices page describes: the chain picks whichever link answers first, and who sets machine-wide variables is not the application's decision. Its own example is a VM where managed identity starts failing and the chain quietly falls to a developer's `az login`, widening or narrowing privileges with no code change. The credential you meant is not the one you got, and nothing says so unless you log it.

### Why production should name its credential

The docs (checked 2026-11-20) ask for a specific `TokenCredential` in production, for two reasons the measurements back: which link served the token is not guaranteed (above), and failed links add latency (above; the credential-chains page lists "performance overhead" explicitly). Choose by environment, once, at the composition root:

```csharp
TokenCredential credential = builder.Environment.IsDevelopment()
    ? new ChainedTokenCredential(new AzureCliCredential(), new VisualStudioCredential())
    : new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(builder.Configuration["Azure:ClientId"]!));
// in Kubernetes with federation: new WorkloadIdentityCredential()
```

The cheap middle is `AZURE_TOKEN_CREDENTIALS=prod`, or the constructor overload `new DefaultAzureCredential(string, options)` that makes the variable mandatory (docs). The developer credentials are docs only here: `AzureCliCredential` runs `az` and reads its login (measured only the "not installed" message), `VisualStudioCredential` reads the account Visual Studio holds, `AzureDeveloperCliCredential` does the same for `azd`, and `InteractiveBrowserCredential` opens the system browser and needs an app registration. All use your own identity, so the permissions a service gets in production are not the ones you tested with: give the developer the same role as the workload to find a missing role assignment early.

### Registering clients with AddAzureClients

`Microsoft.Extensions.Azure` (1.14.1) wires clients into dependency injection. `AddClient` is the generic form; each service package adds its own (`AddBlobServiceClient`, `AddSecretClient`). Measured with my client and two `BlobServiceClient` registrations (the Blob ones are never called):

```csharp
services.AddAzureClients(b =>
{
    b.UseCredential(cred);                                          // one credential for every client
    b.ConfigureDefaults(o => o.Retry.MaxRetries = 5);               // or ConfigureDefaults(configuration.GetSection("AzureDefaults"))
    b.AddClient<WidgetClient, WidgetClientOptions>((o, c, sp) => new WidgetClient(url, c, o));
    b.AddClient<WidgetClient, WidgetClientOptions>((o, c, sp) => new WidgetClient(url, c, o)).WithName("eu").ConfigureOptions(o => o.Retry.MaxRetries = 1);
    b.AddClient<WidgetClient, WidgetClientOptions>(...).WithName("cfg").ConfigureOptions(config.GetSection("Azure:Widgets")); // Retry:MaxRetries=7, Mode=Fixed
    b.AddBlobServiceClient(new Uri("https://acct.blob.core.windows.net")).WithName("hot");
});
```

```text
unnamed WidgetClient injected, same instance on the second resolve: True; IAzureClientFactory.CreateClient("eu") cached: True
all three factories received the one credential passed to UseCredential: True
503 forever, time to fail:  default 27.9 s (5 retries from ConfigureDefaults)   eu 0.9 s (1 retry)   cfg 5.4 s (7 retries, Fixed 0.8 s, from configuration)
unnamed BlobServiceClient when only named ones exist: InvalidOperationException: Unable to find client registration with type 'BlobServiceClient' and name 'Default'.
```

The unnamed registration is injected directly (a singleton); named ones come from `IAzureClientFactory<T>.CreateClient(name)`. `ConfigureDefaults` applies to every client and a per-client `ConfigureOptions` overrides it; options can come from a configuration section, so retry tuning is a deploy-time setting. Credentials: with no `UseCredential` and no `WithCredential`, I measured a `DefaultAzureCredential` per registration, a different instance each (so each runs its own chain and keeps its own token cache); `WithCredential(new ManagedIdentityCredential(...))` replaced it for that client only. The doc says the default is `DefaultAzureCredential`, so a plain `AddAzureClients` still ships the chain to production: pass `UseCredential` with the credential from the previous section.

### Debugging with AzureEventSourceListener

`AzureEventSourceListener` (Azure.Core) turns the SDK's event sources on: `Azure-Core` for the pipeline, `Azure-Identity` for credentials. A client against the flaky route, `EventLevel.Verbose`, lines trimmed:

```text
[Informational] Request: Request [69cc7b19-...] GET https://localhost:6990/widgets/flaky/k9 | Accept:application/json | x-ms-client-request-id:69cc7b19-... | User-Agent:azsdk-net-sdk/1.0.0 (.NET 10.0.0; macOS 27.2.1) | Authorization:REDACTED | client assembly: sdk
[Warning]       ErrorResponse: Error response [69cc7b19-...] 503 Service Unavailable (00.0s) | ... | x-ms-request-id:836be86f-... |
[Informational] RequestRetrying: Request [69cc7b19-...] attempt number 1 took 00.1s
[Warning]       ErrorResponse: ... 503 ...     [Informational] RequestRetrying: ... attempt number 2 took 00.0s
[Informational] Response: Response [69cc7b19-...] 200 OK (00.0s) | ...
```

`Authorization` is redacted and the User-Agent carries the assembly name and OS. For credentials, the same listener on `Azure-Identity` prints `DefaultAzureCredential.GetToken invoked. Scopes: [ https://vault.azure.net/.default ]`, then `EnvironmentCredential.GetToken invoked`, then the MSAL lines (`Instance Discovery` skipped when disabled): this is how you find out which link won. Never leave content logging (`Diagnostics.IsLoggingContentEnabled`) on in production, and send these to a real logger with `AzureEventSourceListener.CreateConsoleLogger()` only in development. The listener is a general `EventListener`, so the same events can feed OpenTelemetry (see the [OpenTelemetry lesson](/dotnet-concepts/opentelemetry-logs-metrics-and-traces)).

### Authority hosts and sovereign clouds (constants measured, the rest docs only)

Credentials get tokens from `TokenCredentialOptions.AuthorityHost`, which defaults to `https://login.microsoftonline.com/`. `AzureAuthorityHosts` holds the constants: Public `login.microsoftonline.com`, China `login.chinacloudapi.cn`, Government `login.microsoftonline.us` (read from the type). A client for a national cloud needs the authority host on the credential and, for data-plane libraries, an `Audience` on the client options (docs only: no such tenant here). My fake authority was reached the same way, through `AuthorityHost` and `DisableInstanceDiscovery = true` (instance discovery otherwise calls a Microsoft host, which a non-Microsoft authority does not answer).

### Book vs today

Older books and posts use the first generation of Azure libraries: `WindowsAzure.Storage`, `Microsoft.Azure.Storage.Blob`, `Microsoft.Azure.KeyVault`, `Microsoft.Azure.ServiceBus`, each with its own retry, its own `Task`-based paging and its own auth, and `Microsoft.Azure.Services.AppAuthentication` (`AzureServiceTokenProvider`, connection string `RunAs=App`) for tokens. Measured from the NuGet registration (2026-11-20): all five are marked deprecated as "Legacy", with `Azure.Storage.Common`, `Azure.Storage.Blobs`, `Azure.Security.KeyVault.Certificates`, `Azure.Messaging.ServiceBus` and `Azure.Identity` named as the replacements. The older sign-in library, ADAL (`Microsoft.IdentityModel.Clients.ActiveDirectory`), had all support and security fixes end on 2023-06-30 per Microsoft Learn; MSAL replaced it, and `Azure.Identity` uses MSAL inside (the 4.92.0 above). Rule of thumb: package `Azure.*` plus `Azure.Identity` is current; `Microsoft.Azure.*` for data access and ADAL snippets are legacy.

## Trade-offs

- **`DefaultAzureCredential` is convenient and undeterministic.** One line for laptop and cloud, but a variable or a logged-in CLI on the host changes who you are. Use it in development; in production name the credential or at least set `AZURE_TOKEN_CREDENTIALS=prod`.
- **Failing links cost time.** About 0.1 to 1.1 s here for a chain with nothing available, and each `DefaultAzureCredential` instance runs its own chain. Without `UseCredential` each registration got its own instance (measured), so share one.
- **Built-in retry multiplies with yours.** Defaults mean up to 4 attempts, 0.8 s base delay, 100 s network timeout. A second retry layer gives 16, so tune `ClientOptions.Retry` and keep one layer.
  ```csharp
  b.ConfigureDefaults(o => { o.Retry.MaxRetries = 2; o.Retry.NetworkTimeout = TimeSpan.FromSeconds(10); });
  ```
- **A fake proves the client, not the permissions.** The fake authority accepted any scope and my service ignored the token's contents, so RBAC (403 `AuthorizationFailed`), consent and conditional access are untested here: docs only.
- **Named clients multiply credentials.** Each registration without `UseCredential` built a separate chain and token cache, so ten clients mean ten of each. Pass one credential.
- **Logging the wire exposes data.** Headers are redacted by default, bodies are not if you enable content logging; keep it for a local debug session.

## Documentation Links

- [Authenticate .NET apps to Azure services, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/) (doc)
- [Credential chains in the Azure Identity library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/credential-chains) (doc)
- [Authentication best practices with the Azure Identity library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/best-practices) (doc)
- [Dependency injection with the Azure SDK for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/dependency-injection) (doc)
- [Logging with the Azure SDK for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/logging) (doc)
- [Azure Identity client library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/identity-readme) (doc)
- [Microsoft.Extensions.Azure client library, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/microsoft.extensions.azure-readme) (doc)
- [DefaultAzureCredentialOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.defaultazurecredentialoptions) (doc)
- [RetryOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.core.retryoptions) (doc)
- [RequestFailedException class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.requestfailedexception) (doc)
- [AzureAuthorityHosts class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.azureauthorityhosts) (doc)
- [Azure SDK design guidelines for .NET, Azure SDK](https://azure.github.io/azure-sdk/dotnet_introduction.html) (doc)
- [Azure Identity troubleshooting guide, GitHub](https://github.com/Azure/azure-sdk-for-net/blob/main/sdk/identity/Azure.Identity/TROUBLESHOOTING.md) (doc)
- [Migrate applications to MSAL (ADAL retirement), Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/msal-migration) (doc)
