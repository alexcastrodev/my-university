---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A .NET app needs secrets (a database password, a third-party API key) and, in Azure, a way to prove who it is to get them. The goal is to end with no secret in the repository and, ideally, none to bootstrap either. This lesson measures the ladder from `appsettings.json` to user-secrets and environment variables, then the Azure.Identity side: the `DefaultAzureCredential` chain and why docs say to leave it in production, `ManagedIdentityCredential` against a fake App Service identity endpoint I wrote (token request, cache, retries, 429), `WorkloadIdentityCredential` against a fake token endpoint that validates the `client_assertion` JWT, and Key Vault through the Lowkey Vault emulator (secret versions, soft delete, the configuration provider, rotation, vault down). There is no Azure tenant here: real Entra, real RBAC and the real managed identity service are docs only and labelled. The "secret zero" principle is in the [workload identity lesson](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe); this is the .NET side.
Versions (NuGet, checked 2026-11-19): `Azure.Identity` 1.21.0, `Azure.Security.KeyVault.Secrets` 4.12.0 (4.13.0-beta.1 exists), `Azure.Extensions.AspNetCore.Configuration.Secrets` 1.5.2, `Azure.Security.KeyVault.Keys` 4.10.2 (only in the project, not exercised), `Azure.Core` 1.64.0, `Microsoft.Identity.Client` 4.90.0, `Microsoft.Extensions.Hosting` 10.0.15, Lowkey Vault 7.4.0 (`nagyesta/lowkey-vault:7.4.0-ubi10-minimal`, the arm64 variant), Node 22.23.4, TFM `net10.0`, SDK 10.0.100.

## Use Cases

- Removing a connection string or API key from `appsettings.json` and from a CI variable.
- Deciding between `DefaultAzureCredential`, a specific credential and a `ChainedTokenCredential`.
- Reading secrets from Key Vault into `IConfiguration` and surviving a rotation.
- Debugging "it works on my laptop but `CredentialUnavailableException` in the cluster".

## Deep Dive

### The ladder, measured

A toy web project with `Payments:ApiKey` in a committed `appsettings.json` and a `UserSecretsId`. `GetDebugView()` prints which provider supplied the value:

```text
Development, nothing else   ApiKey=COMMITTED-IN-REPO (JsonConfigurationProvider for 'appsettings.json')
dotnet user-secrets set "Payments:ApiKey" "from-user-secrets"
Development + user-secrets  ApiKey=from-user-secrets (JsonConfigurationProvider for 'secrets.json')
Production  + user-secrets  ApiKey=COMMITTED-IN-REPO   (the secrets file is not even loaded)
Development + Payments__ApiKey=from-env          ->  from-env (EnvironmentVariablesConfigurationProvider)
... plus --Payments:ApiKey=from-cli              ->  from-cli (CommandLineConfigurationProvider)
```

That is the precedence from the [configuration lesson](configuration-and-the-options-pattern) (JSON, then user-secrets in Development only, then environment, then command line), observed. On disk the secret is `~/.microsoft/usersecrets/<UserSecretsId>/secrets.json`, mode `-rw-------`, and the content is plain text JSON. User-secrets keeps the value out of git; it is not encryption and not for production. The rungs:

1. `appsettings.json` in git: an anti-pattern for anything secret, because it lives forever in history.
2. User-secrets: development only, per user, plaintext in the profile.
3. Environment variables: fine for the process, but visible to anyone who can read `/proc/<pid>/environ` or a crash dump, and set by whoever writes the deployment.
4. A managed vault (Key Vault): central, audited, versioned, access by identity. The app still needs an identity to ask.
5. Workload identity: the platform proves who the app is, so nothing is stored to bootstrap.

### TokenCredential and the DefaultAzureCredential chain

Every Azure SDK client takes a `TokenCredential`, whose job is `GetTokenAsync(TokenRequestContext)` returning an `AccessToken` (token, `ExpiresOn`, `RefreshOn`). `DefaultAzureCredential` is a preconfigured `ChainedTokenCredential` that tries credentials in order until one answers. The docs (checked 2026-11-19) list: Environment, Workload Identity, Managed Identity, Visual Studio, Visual Studio Code, Azure CLI, Azure PowerShell, Azure Developer CLI, Interactive browser (off by default), Broker. `AzureEventSourceListener` on the `Azure-Identity` source shows the real walk. On this machine, logged into nothing:

```text
EnvironmentCredential ... WorkloadIdentityCredential ... ManagedIdentityCredential (source selected: DefaultToImds)
VisualStudioCredential ... AzureCliCredential ... AzurePowerShellCredential ... AzureDeveloperCliCredential
DefaultAzureCredential: CredentialUnavailableException after 2315 ms
```

Seven credentials were tried (the Visual Studio Code and Broker ones need `Azure.Identity.Broker` and did not appear). With `IDENTITY_ENDPOINT` set it stopped at the third: `DefaultAzureCredential credential selected: Azure.Identity.ManagedIdentityCredential`, 91 ms. `AZURE_TOKEN_CREDENTIALS` narrows the chain, measured:

```text
=prod                       Environment, WorkloadIdentity, ManagedIdentity           (CredentialUnavailable in 1045 ms)
=dev                        VisualStudio, AzureCli, AzurePowerShell, AzureDeveloperCli (280 ms)
=ManagedIdentityCredential  only ManagedIdentity (and it did not answer in 100 s: see retries below)
=bogus                      InvalidOperationException: Invalid value ... Valid values are 'dev', 'prod', 'visualstudiocredential', ...
```

The doc says single-credential names need Azure.Identity 1.15.0 or later. Why the docs tell you to replace `DefaultAzureCredential` once deployed: failures are hard to attribute (you need logging to see which link ran), failed links cost time (the one above spent most of 2.3 s on probes), and behaviour depends on environment variables anyone can set machine-wide ("unpredictable behavior"). The recommended production shape is a specific credential, picked by environment:

```csharp
TokenCredential credential = builder.Environment.IsDevelopment()
    ? new ChainedTokenCredential(new AzureCliCredential(), new VisualStudioCredential())
    : new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(clientId)); // or WorkloadIdentityCredential
```

### Managed identity and its token endpoint (fake IMDS, measured)

A managed identity is an Entra service principal whose credentials the platform holds. System-assigned: tied to one resource and deleted with it. User-assigned: a separate resource you attach to many (what you want when several apps or slots share one set of permissions). The app gets tokens from a local endpoint. On App Service and Functions the contract (docs) is two environment variables, `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` (rotated by the platform to mitigate SSRF), and `GET {IDENTITY_ENDPOINT}?resource=...&api-version=2019-08-01` with header `X-IDENTITY-HEADER`; optional `client_id`, `principal_id` or `mi_res_id` pick a user-assigned identity. On a VM the endpoint is IMDS, `http://169.254.169.254/metadata/identity/oauth2/token` (docs only). I wrote the App Service flavour in 25 lines of Node on port 6780 (it logs each request and can answer 200, 429, 500 or never) and pointed the real SDK at it:

```csharp
var mi = new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned);
var t  = await mi.GetTokenAsync(new TokenRequestContext(["https://vault.azure.net/.default"]), default);
```

```text
GET /MSI/token?api-version=2019-08-01&resource=https%3A%2F%2Fvault.azure.net   X-IDENTITY-HEADER=rotating-secret-1
system-assigned #1: expiresIn=24.0h refreshOn=12.0h in 58 ms     (the fake returns 24 h tokens)
system-assigned #2: in 2 ms                                      (no second request: cached)
user-assigned:   ...&client_id=11111111-2222-3333-4444-555555555555
new scope storage.azure.com: a third request, resource=https%3A%2F%2Fstorage.azure.com
wrong IDENTITY_HEADER: 400 from my endpoint, AuthenticationFailedException in 68 ms, one request, no retry
```

The `.default` suffix is stripped (the managed identity API takes a resource, not a scope), the cache is per identity and scope, and `RefreshOn` is half of the lifetime. Clients built by the Azure SDK refresh by `RefreshOn` themselves; code that calls a credential directly should call `GetTokenAsync` each time and let the cache decide, never store the string. Now failures, mode flipped from the test script:

```text
mode 429 (Retry-After: 1)   6 requests at +0, 1.0, 2.0, 3.7, 7.4, 16.6 s, then "Error Code: too_many_requests" after 16.7 s
mode 500                    6 requests over 23 s ... "Error Code: boom"
mode flaky (429 twice)      3 requests, token returned after 2.1 s
mode slow (never answers)   NetworkTimeout=2s: 6 requests over 18.8 s, then "Retry failed after 6 tries"
```

The Learn page describes a "resilient mode" for `ManagedIdentityCredential` (0.8 s start, up to five retries, backoff), which matches six attempts. What it does not match: I set `Retry = { MaxRetries = 3 }` and `MaxRetries = 0` and still got six requests against the App Service source on 1.21.0, so treat that option as unproven for this source. The practical point stands: a failing identity endpoint blocks the first token request for 20 seconds or more, so a startup that reads Key Vault stalls that long. In the chain it is the opposite: `DefaultAzureCredential` without `AZURE_TOKEN_CREDENTIALS=ManagedIdentityCredential` runs "fail fast" with no retries, which is why a laptop fails in 1 to 2 seconds and a standalone `ManagedIdentityCredential` against an absent IMDS sat for more than 100 s here.

### Workload identity federation (fake token endpoint, measured)

Kubernetes (AKS), GitHub Actions and other OIDC issuers can be trusted by an Entra app registration or user-assigned identity through a federated credential (issuer, subject, audience). The workload presents its own issuer's JWT as a `client_assertion`; no client secret exists. The flow measured: `mktoken.mjs` plays the kubelet and writes a short-lived JWT signed by a fake cluster key to a file (`iss`, `sub=system:serviceaccount:default:orders`, `aud=api://AzureADTokenExchange`, 1 h). `sts.mjs` (HTTPS, port 6783, self-signed) is a token endpoint that implements only `client_credentials` with a `client_assertion`, verifies signature, issuer, subject, audience and expiry, and returns an access token. The SDK side:

```csharp
var cred = new WorkloadIdentityCredential(new WorkloadIdentityCredentialOptions {
    TenantId = "tenant-1111", ClientId = "app-2222", TokenFilePath = "token-good",
    AuthorityHost = new Uri("https://localhost:6783"), DisableInstanceDiscovery = true });
```

```text
POST /tenant-1111/oauth2/v2.0/token grant_type=client_credentials scope=api://my-api/.default client_id=app-2222 assertion_type=jwt-bearer secret=none
  -> assertion OK iss=https://oidc.cluster.example sub=system:serviceaccount:default:orders aud=api://AzureADTokenExchange exp-in=3586s
explicit options #1: OK expiresIn=60min 103 ms     #2: OK 2 ms (cached)
```

The same worked with no options and the four variables the AKS webhook injects: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_FEDERATED_TOKEN_FILE`, `AZURE_AUTHORITY_HOST`. Failures, each with the STS log line (the SDK message is only "ClientAssertionCredential authentication failed"; the reason is on the server side, and each call hits the STS again because failures are not cached):

```text
sub of another ServiceAccount   401 AADSTS70021 no federated identity credential matches subject ...:billing
audience api://other            401 AADSTS700212 audience mismatch
expired assertion               401 AADSTS700024 assertion expired
other issuer                    401 AADSTS700211 issuer not trusted: https://evil.example
missing token file              "Could not find file ..." (client side, nothing sent)
no DisableInstanceDiscovery     no answer in 60 s and the STS saw no request (instance discovery for a non-Microsoft host)
```

The security sits in the federated credential's subject match, exactly as in the GitHub trust-condition lesson: a loose subject lets another workload in. The error codes above are my fake's, modelled on real AADSTS names (docs only: the real service text may differ). The file is re-read when a new assertion is needed (the kubelet refreshes it); I did not test a rotation of the file. Real Entra, the AKS webhook and `AZURE_AUTHORITY_HOST` for sovereign clouds are docs only.

### Key Vault: secrets, keys, certificates (docs) and the emulator (measured)

Key Vault holds three object types: secrets (opaque values you read back), keys (RSA, EC; the service signs, verifies, wraps and unwraps so the private key stays inside, docs) and certificates (a key and a secret plus lifecycle). Every change makes a new version. Deleted objects are soft deleted: on by default, cannot be disabled, retained 7 to 90 days (90 by default). Purge protection blocks purging inside the retention. Authorization for the data plane is Azure RBAC or the legacy access policies (docs only).

Lowkey Vault is an emulator, not Azure: it models the data-plane API and ignores the token value (its README says credentials are checked for presence only), so no permission test is possible. It serves HTTPS with its own certificate (here `--server.port=6781`, metadata on HTTP 6782, from `docker run`). Two things the SDK needed, in order:

```text
defaults                       RequestFailedException: The SSL connection could not be established
trust the emulator cert        InvalidOperationException: The challenge resource 'localhost' does not match the requested domain.
  (HttpClientHandler callback        Set DisableChallengeResourceVerification to true in your client options
   comparing the thumbprint of the
   cert from /metadata/default-cert/lowkey-vault.p12, password "changeit")
+ DisableChallengeResourceVerification = true        OK
```

A request with no `Authorization` header gets `401` and `WWW-Authenticate: Bearer resource="https://localhost:6781", authorization_uri=...`, the challenge the SDK answers by asking the credential for a token. Both settings are for emulators only: never disable certificate validation or challenge verification against the real vault. With that:

```csharp
var client = new SecretClient(vault, credential, options);       // options: Transport, DisableChallengeResourceVerification
await client.SetSecretAsync("Db--Password", "pw-1");  await client.SetSecretAsync("Db--Password", "pw-2");
await foreach (var v in client.GetPropertiesOfSecretVersionsAsync("Db--Password"))
    Console.WriteLine($"{v.Version[..8]} {(await client.GetSecretAsync("Db--Password", v.Version)).Value.Value}");
```

```text
latest: pw-2    versions: 3c5e595a=pw-1  bec7338f=pw-2     (a pinned version stays readable)
GetPropertiesOfSecretsAsync lists names only, no values
StartDeleteSecretAsync("Api--Key"): scheduledPurge=2027-02-17 (90 days) recoveryId=/deletedsecrets/Api--Key
GetSecretAsync after delete: 404     StartRecoverDeletedSecretAsync: value back
```

### The configuration provider and rotation

```csharp
builder.Configuration.AddAzureKeyVault(client, new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromSeconds(3) });
// or, in Azure: AddAzureKeyVault(new Uri(url), new ManagedIdentityCredential(...))
```

Secret names allow only letters, digits and `-`, so `Db--Password` becomes `Db:Password` (a custom `KeyVaultSecretManager` can change the mapping or load a subset by prefix: docs only). The provider is added after the in-memory source, so it wins:

```text
Db:Password=pw-2  Db:Host=from-memory  Api:Key=key-1
debugview: Password=pw-2 (AzureKeyVaultConfigurationProvider)   Host=from-memory (MemoryConfigurationProvider)
```

It loads at startup (it blocks the build) and then every `ReloadInterval` (default: never). I rotated `Db--Password` to `pw-3-rotated` while the host ran: with the write 2 seconds after the load the configuration changed in 1.0 s, `IOptionsMonitor<T>.OnChange` fired and `CurrentValue` held the new value. Writing it in the same second as the initial load was never seen in 20 s. My reading: the provider compares `UpdatedOn`, which has one-second resolution, so two writes in one second look the same. A rotation job that writes twice within a second can lose the second write. Failure of the vault:

```text
vault stopped while the app runs (reload every 2 s): after 6 s Db:Password still pw-1, process alive
startup with the vault down: AggregateException: Retry failed after 2 tries ... (Connection refused (localhost:6781))
```

A failed reload keeps the last value silently (log it yourself if you need to know), a failed start does not start. Both are measured against the emulator with the client's retry settings at 1 retry.

### Rotating without downtime

Two rules. The consumer must tolerate two valid secrets at once: the provider issues a new one while the old one is still accepted for a window, then the old one is revoked (database users `app_a` and `app_b` swapped, two API keys, Entra app registration with two client secrets). And the consumer must re-read: `IOptionsMonitor<T>` for options, and for things that cache a secret inside a connection (an `HttpClient` header, a connection pool) rebuild them on `OnChange`, for example with a named `HttpClient` whose handler is created from `CurrentValue` or an `IHttpClientFactory` with `SetHandlerLifetime`. `IOptions<T>` and `IOptionsSnapshot<T>` registered in singletons keep the old value. A rotation test that only restarts the app proves nothing about this.

### Not leaking

- Never log a secret or a whole options object. For structured logging, `Microsoft.Extensions.Compliance.Redaction` with `[LogProperties]` and a data classification replaces classified values before they reach the sink (docs only, not run here).
- `SecureString`: Microsoft recommends not using it for new development on .NET (Core) (analyzer DE0001), because it is not an OS concept even on Windows and the plain string appears in memory anyway. Treat memory as trusted and focus on lifetime and log hygiene.
- Config dumps and health pages: `GetDebugView()` prints values; do not expose it.

### Beyond Azure (principle only, docs only)

HashiCorp Vault is source-available: its repository LICENSE (checked 2026-11-19) is the Business Source License 1.1 from version 1.15.0, licensor IBM, with an additional use grant that forbids a competing hosted or embedded product. OpenBao is the community fork hosted under the Linux Foundation's OpenSSF, under an OSI-approved license. Both give dynamic secrets, leases and many auth methods (Kubernetes, JWT/OIDC, cloud IAM), which Key Vault, a store with versions, does not offer. AWS Secrets Manager and Parameter Store, and GCP Secret Manager, are the same idea with their cloud's IAM and managed rotation. Kubernetes Secrets are base64, not encryption: see the [Kubernetes Secrets lesson](/kubernetes-concepts/kubernetes-secrets-fundamentals); to keep them out of git use the External Secrets Operator (syncs from a vault into a Secret) or the Secrets Store CSI driver (mounts vault objects as files in the pod).

### Secrets in CI

Do not store a cloud key as a pipeline secret. GitHub Actions can request an OIDC token and exchange it with a federated credential, the same mechanism as the workload identity above, with the trust condition measured in the [workload identity lesson](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe). See the CI/CD for .NET lesson for the pipeline side.

### Where the secret lives

| Where | Who reads it | Rotation | What leaks it | Use when |
|---|---|---|---|---|
| `appsettings.json` in git | anyone with the repo | a commit, history stays | clones, forks, CI logs | never for secrets |
| User-secrets | your user, plain `secrets.json` | by hand | disk backup, shared profile | development only |
| Environment variable | the process, root, crash dumps | redeploy | `/proc`, dumps, `docker inspect`, logs | a few values, platform injected |
| Key Vault by `SecretClient` or provider | the app identity (RBAC) | new version, `ReloadInterval` | an over-broad role, logged values | Azure apps with secrets that cannot go away |
| Managed identity | the platform to the app | automatic, hours | SSRF to the endpoint, shared identity | any Azure call that accepts Entra |
| Workload identity federation | the issuer's JWT file | automatic, minutes to hours | loose federated subject | AKS, GitHub, multi-cloud |
| Vault/OpenBao | the app via its auth method | leases, dynamic secrets | root token, a broad policy | multi-cloud or dynamic database credentials |

## Trade-offs

- **`DefaultAzureCredential` is convenient and discussable.** One line works on a laptop and in Azure, but the chain cost 2.3 s to fail and hides which credential won. Use it in development, a named credential in production, `AZURE_TOKEN_CREDENTIALS=prod` as the cheap middle.
- **Resilient managed identity can stall startup.** Six attempts over about 17 to 25 s when the endpoint fails. Fail fast in development, and set a startup timeout in production rather than assume a quick error.
- **Provider reload means eventual consistency.** Between the write and the next `ReloadInterval` two instances hold different values, and a failed reload keeps the old one silently.
  ```csharp
  mon.OnChange(o => log.LogInformation("db credential reloaded")); // never log o.Password
  ```
- **Key Vault is a runtime dependency.** The provider blocks startup if the vault is down; decide whether you want the app to refuse to start, or load the vault in the background.
- **Emulators prove the client code, not the permissions.** Lowkey Vault ignored the token, so RBAC errors (403 `Forbidden`) are untested here; test them in a real subscription.
- **Federation moves the trust.** There is no secret to steal, but a wrong subject or issuer match is a way in, and the files the kubelet writes are readable by the whole pod.

## Documentation Links

- [Authenticate .NET apps to Azure services, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/) (doc)
- [Credential chains in the Azure Identity library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/credential-chains) (doc)
- [Authentication best practices with the Azure Identity library for .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/azure/sdk/authentication/best-practices) (doc)
- [What are managed identities for Azure resources, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) (doc)
- [Managed identities in App Service (REST endpoint reference), Microsoft Learn](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity) (doc)
- [Workload identity federation, Microsoft Learn](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) (doc)
- [Use Microsoft Entra Workload ID with AKS, Microsoft Learn](https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview) (doc)
- [WorkloadIdentityCredential class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.workloadidentitycredential) (doc)
- [Azure Key Vault overview, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/overview) (doc)
- [Soft-delete and purge protection, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview) (doc)
- [Azure RBAC for Key Vault data plane, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide) (doc)
- [AzureKeyVaultConfigurationOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/azure.extensions.aspnetcore.configuration.secrets.azurekeyvaultconfigurationoptions) (doc)
- [Safe storage of app secrets in development, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets) (doc)
- [Data redaction in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/data-redaction) (doc)
- [SecureString class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.securestring) (doc)
- [Lowkey Vault, GitHub](https://github.com/nagyesta/lowkey-vault) (doc)
- [Vault documentation, HashiCorp](https://developer.hashicorp.com/vault/docs) (doc)
- [OpenBao documentation, OpenBao](https://openbao.org/docs/) (doc)
- [What is AWS Secrets Manager, AWS](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) (doc)
- [Secret Manager overview, Google Cloud](https://cloud.google.com/secret-manager/docs/overview) (doc)
- [Secrets, Kubernetes](https://kubernetes.io/docs/concepts/configuration/secret/) (doc)
- [External Secrets Operator](https://external-secrets.io/latest/) (doc)
- [Secrets Store CSI Driver, Kubernetes SIGs](https://secrets-store-csi-driver.sigs.k8s.io/) (doc)
