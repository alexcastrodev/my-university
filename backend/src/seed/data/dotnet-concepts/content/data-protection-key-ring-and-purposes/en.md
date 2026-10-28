---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Every ASP.NET Core app already uses Data Protection, even if nobody on the team has heard of it: the authentication cookie, the antiforgery token, TempData and the OIDC `state`/nonce cookies are all encrypted and signed with keys from a key ring that the framework creates on its own. On a laptop that just works. In production, with two replicas or a container that is replaced on every deploy, the ring is not shared and users get logged out at random or all at once, with nothing at warning level in the logs. This concept runs the consumer API (`IDataProtectionProvider`, `CreateProtector`, `Protect`/`Unprotect`, purposes, time-limited payloads), reads the key ring on disk and its options, forces a key roll, and then runs the key experiment: two real cookie-auth instances on two ports with separate rings and with a shared ring, plus a simulated redeploy. Versions used: SDK 10.0.100 (ASP.NET Core runtime 10.0.0 for the web app), `Microsoft.AspNetCore.DataProtection.Extensions` 10.0.14, `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore` 10.0.14, `Microsoft.EntityFrameworkCore.Sqlite` 10.0.14.

## Use Cases

- Running two or more replicas behind a load balancer without users bouncing between "signed in" and "401" depending on which replica answers.
- Keeping users signed in across deploys of a containerized app whose filesystem is thrown away each time.
- Round-tripping server state through the client (a reset link, a "return to" URL, a wizard step) with tamper detection and an expiry, without inventing your own crypto.
- Letting two different apps (a main site and an admin site) read the same cookie on purpose, or making sure they cannot.

## Deep Dive

### Where the key ring lives by default

I started a minimal web app with the `Microsoft.AspNetCore.DataProtection` log category at `Information` (the template's `"Microsoft.AspNetCore": "Warning"` hides these lines). On macOS, with `HOME` pointed at a scratch folder so my real ring stayed untouched:

```text
info: Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager[62]
      User profile is available. Using '/.../a8/home/.aspnet/DataProtection-Keys' as key repository; keys will not be encrypted at rest.
warn: Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager[35]
      No XML encryptor configured. Key {b68cd791-f722-4e74-94b9-cca381e367f9} may be persisted to storage in unencrypted form.
```

On Linux and macOS the folder is `$HOME/.aspnet/DataProtection-Keys` (or `$LOCALAPPDATA/ASP.NET/DataProtection-Keys` when that variable is set); the docs list `%LOCALAPPDATA%\ASP.NET\DataProtection-Keys` with DPAPI encryption on Windows, the registry under IIS, and `%HOME%\ASP.NET\DataProtection-Keys` on Azure App Service (shared by all instances of one deployment slot, but not between slots). Unsetting `HOME` did not change anything: .NET still found my profile directory. To reach the last fallback I pointed `LOCALAPPDATA` at a folder that cannot be created:

```text
warn: Microsoft.AspNetCore.DataProtection.Repositories.EphemeralXmlRepository[50]
      Using an in-memory repository. Keys will not be persisted to storage.
warn: Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager[59]
      Neither user profile nor HKLM registry available. Using an ephemeral key repository. Protected data will be unavailable when application exits.
```

Inside a container the profile usually exists (the home of `root` or of the image's app user), so you get the first message, not this one, and the keys land in the container's writable layer. That looks persistent and is not: the next deploy starts a new container with an empty folder. The docs say that in Docker the keys must go to a volume that outlives the container or to an external provider. Note the timing too: in .NET 10 the key ring was loaded at startup (`Key ring with default key {...} was loaded during application startup.`), not on the first request.

### IDataProtector: Protect, Unprotect and the output format

I used the API directly from a console app with a file repository:

```csharp
services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dir))
    .SetApplicationName("lab");

var p = sp.GetRequiredService<IDataProtectionProvider>().CreateProtector("Orders.v1");
var t = p.Protect("order=42;user=alice");
var raw = Base64Url.DecodeFromChars(t);
Console.WriteLine($"magic={Convert.ToHexString(raw, 0, 4)} keyId={new Guid(raw.AsSpan(4, 16))}");
```

```text
protected (155 chars): CfDJ8BOS2G9bgk5CgBe0FAUpNBqIiVPt3iBkcvmAh-eRD4tdy4YQ6wGVbbiLhpktSYBClUZSWp5PIp9sKs1Ni0N08D2ksspoxTtponMqBH_6Vbcpvsshv3KWsaM2ZFBUBu1eNV3TWrSwZq37CfcruHxmxPE
bytes=116 magic=09F0C9F0 keyId=6fd89213-825b-424e-8017-b4140529341a
twice same? False
unprotect: order=42;user=alice
key files: key-6fd89213-825b-424e-8017-b4140529341a.xml
```

The string overload returns base64url. The payload starts with a 4-byte magic header (`09F0C9F0`, which is why every protected value, including auth cookies, begins with `CfDJ8`), then the 16-byte id of the key that protected it, then the encrypted and authenticated data. A 19-character input became 116 bytes, and protecting the same text twice gave two different outputs. Because the key id travels in the clear, a reader that does not have that key knows exactly what is missing (see the next section). The docs state the defaults: AES-256-CBC for confidentiality and HMACSHA256 for authenticity, with subkeys derived per payload from a 512-bit master key.

### Purposes isolate consumers

`CreateProtector(purpose)` derives a different subkey per purpose chain from the same master key. I tried to read the `Orders.v1` payload in other ways:

```csharp
prov.CreateProtector("Invoices.v1").Unprotect(t);
prov.CreateProtector("a", "b").Unprotect(prov.CreateProtector("a").CreateProtector("b").Protect("x"));
prov.CreateProtector("b", "a").Unprotect(prov.CreateProtector("a", "b").Protect("x"));
```

```text
purpose Invoices.v1:    CryptographicException: The payload was invalid. For more information go to https://aka.ms/aspnet/dataprotectionwarning
chain a->b vs (a,b):    OK 'x'
chain (a,b) vs (b,a):   CryptographicException: The payload was invalid. ...
purpose case Orders.V1: CryptographicException: The payload was invalid. ...
tampered last byte:     CryptographicException: The payload was invalid. ...
unknown key id:         CryptographicException: The key {6fd89313-825b-424e-8017-b4140529341a} was not found in the key ring. ...
```

`CreateProtector("a").CreateProtector("b")` is the same as `CreateProtector("a", "b")`; order and case matter (the docs say ordinal comparison). A wrong purpose and a tampered payload give the same message, so an attacker learns nothing. The "key not found" message is the one you will see in production when rings are not shared. The docs suggest namespace-plus-type purposes with a version (`Contoso.Security.BearerToken.v1`) and warn never to let user input be the whole purpose chain: use `CreateProtector("Contoso.Messaging.SecureMessage", $"User: {username}")` instead of `CreateProtector(username)`.

### Time-limited payloads

`ToTimeLimitedDataProtector()` (package `Microsoft.AspNetCore.DataProtection.Extensions`, already in the shared framework) embeds an expiration:

```csharp
var p = provider.CreateProtector("ResetPassword.v1").ToTimeLimitedDataProtector();
var t = p.Protect("user=alice", TimeSpan.FromSeconds(2));
p.Unprotect(t, out var expires);
Thread.Sleep(2500);
p.Unprotect(t);
```

```text
unprotect: user=alice expires=2026-10-28T15:37:55.6932190+00:00
after 2.5 s: CryptographicException: The payload expired at 10/28/2026 3:37:55 PM +00:00.
plain protector on time-limited payload: CryptographicException: The payload was invalid. ...
```

The expiry is checked against the server clock, and a plain protector with the same purpose cannot read the payload: the time-limited wrapper adds its own purpose. The docs warn against using these APIs for "payloads which require long-term or indefinite persistence" and suggest the rule of thumb: "Can I afford for the protected payloads to be permanently unrecoverable after a month?"

### The key file, its dates and the options

The key file `PersistKeysToFileSystem` wrote:

```text
<key id="6fd89213-825b-424e-8017-b4140529341a" version="1">
  <creationDate>2026-10-28T15:37:48.59539Z</creationDate>
  <activationDate>2026-10-28T15:37:48.59539Z</activationDate>
  <expirationDate>2027-01-26T15:37:48.59539Z</expirationDate>
  <descriptor ...>
    <descriptor>
      <encryption algorithm="AES_256_CBC" />
      <validation algorithm="HMACSHA256" />
      <masterKey p4:requiresEncryption="true" ...>
        <!-- Warning: the key below is in an unencrypted form. -->
        <value>6gkqAxUwt2+UqdAEQ1Vf9JWj4oRu...</value>
```

The master key sits in plain base64: anyone who can read that folder can forge your auth cookies. I read the options back and tried the lifetime limits:

```text
NewKeyLifetime=90.00:00:00 AutoGenerateKeys=True XmlEncryptor=null XmlRepository=FileSystemXmlRepository
ApplicationDiscriminator=lab
SetDefaultKeyLifetime(6 days): ArgumentOutOfRangeException: The new key lifetime must be at least one week. ... (Parameter 'value')
SetDefaultKeyLifetime(7 days): key expiration=2026-11-04T15:37:56Z
```

With `DisableAutomaticKeyGeneration()` on an empty ring, `Protect` failed: the log said `The key ring does not contain a valid default protection key. The data protection system cannot create a new key because auto-generation of keys is disabled.` and the caller got `CryptographicException: An error occurred while trying to encrypt the provided data.` That option is for read-only secondaries next to one primary that manages keys, per the docs.

### Key rolling and the activation delay

The first key of an empty ring is activated immediately (creation, activation and expiration above: now, now, now + 90 days). Data Protection reads `DateTime.UtcNow` directly (a `TimeProvider` registered in DI was ignored), so to see a roll I seeded rings with `IKeyManager.CreateNewKey(activation, expiration)` and started a new provider:

```text
--- seeded one key that expires in 1 day:
Protect used the OLD key 7a51f05d-4772-4020-9d56-d8d66fa5aaab
  key-140c71c1-... created=2026-10-28T15:38:18Z activation=2026-10-29T15:38:17Z expiration=2027-01-26T15:38:18Z
  key-7a51f05d-... created=2026-07-31T15:38:17Z activation=2026-07-31T15:38:17Z expiration=2026-10-29T15:38:17Z
--- seeded one key that expired yesterday:
Protect used the NEW key 9a6e0fc7-e7ea-4962-ba42-5fea726addc5
  key-9a6e0fc7-... created=2026-10-28T15:38:18Z activation=2026-10-28T15:38:18Z expiration=2027-01-26T15:38:18Z
```

That matches the docs: when the default key expires within 2 days, a new key is written with `activationDate` equal to the old key's expiration, so every instance has time to read it before anyone uses it; if every key has already expired, the new key is activated immediately. Old keys stay in the ring and keep decrypting old payloads. The docs say instances re-read the ring about every 24 hours, and that deleting a key file makes everything protected with it permanently unreadable.

### SetApplicationName: same ring is not enough

Three providers on one shared folder:

```text
same ring, app 'shop' -> 'shop':  OK 'hi'
same ring, app 'shop' -> 'admin': CryptographicException: The payload was invalid. ...
key files in shared dir: 1
```

The application name is mixed into every purpose chain. Under an ASP.NET Core host the default is the content root path, so two copies deployed to different paths do not share payloads unless you set the same name; two different apps sharing a ring stay isolated as long as their names differ. The docs add that a compromise of one app on a shared repository is a compromise of all of them.

### The key experiment: two instances, one cookie

A cookie-auth app with antiforgery, started twice from the same build on ports 5664 and 5665, with an optional shared folder:

```csharp
if (Environment.GetEnvironmentVariable("KEYS_DIR") is { } dir)
    builder.Services.AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dir)).SetApplicationName("shop");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(...);
app.MapGet("/login", ...);                              // SignInAsync as alice
app.MapGet("/me", ...).RequireAuthorization();
app.MapGet("/form", (IAntiforgery af, HttpContext c) => af.GetAndStoreTokens(c).RequestToken!);
app.MapPost("/form", ...);                              // af.ValidateRequestAsync
```

I signed in on A and replayed the same cookie jar against B:

```text
### (a) separate rings (ringA, ringB)
A /login: signed in on localhost:5664
A /me:    200 alice on localhost:5664
B /me:    401
B POST /form with A's antiforgery token: "The antiforgery token could not be decrypted." 400
### (b) shared ring
B /me:    alice on localhost:5665 200
B POST /form with A's antiforgery token: "antiforgery valid on localhost:5665" 200
### restart both on the same shared ring
A /me after restart: alice on localhost:5664 200
B /me after restart: alice on localhost:5665 200
### redeploy: new container, fresh ring dir
A /me after redeploy: 401
```

Case (a) is what a load balancer without sticky sessions produces: every other request is a 401 and every other form post a 400. With an in-memory (ephemeral) provider, even two providers in one process could not read each other. Case (b) fixed both, and restarts kept users signed in. The redeploy line is the "every deploy logs everyone out" bug. The worst part is the log: B wrote `Cookies was not authenticated. Failure message: Unprotect ticket failed` at `Information`, which the default template filters out, so production shows nothing.

Two instances starting at the same instant on an empty shared folder each wrote a key (2 files), but both then chose the same default key and read each other's payloads, so that race is harmless.

### Storing and protecting the ring

- **File system on a volume**: `PersistKeysToFileSystem` on a shared or mounted volume. The docs warn that once you choose the location, keys are no longer encrypted at rest automatically.
- **EF Core**: `PersistKeysToDbContext<KeysDb>()` with a context implementing `IDataProtectionKeyContext`. With SQLite I got one row per key: `row Id=1 FriendlyName=key-97b31eed-ba02-46c4-9256-12b8b2c9d1e1 XmlLength=884`, the same XML as the file.
- **Certificate**: `ProtectKeysWithCertificate(cert)` with a self-signed certificate made in-process replaced `<masterKey>` with an `<encryptedSecret>` (XML Encryption, `aes256-cbc`) and removed the "No XML encryptor" warning. Then I opened the same folder from an instance without the certificate: 11 `fail` lines `Unable to retrieve the decryption key.`, the key was marked ineligible, the instance wrote a new unencrypted key into the shared folder, and `Unprotect` threw `CryptographicException: Unable to retrieve the decryption key.` Every instance needs the certificate, and a misconfigured one pollutes the ring.
- **Not run here (docs only)**: DPAPI (`ProtectKeysWithDpapi`, Windows), Azure Blob Storage (`Azure.Extensions.AspNetCore.DataProtection.Blobs`) with `ProtectKeysWithAzureKeyVault`, and Redis (`Microsoft.AspNetCore.DataProtection.StackExchangeRedis`). The docs say only Redis with data persistence should hold keys.

### Not a vault for long-lived secrets

The overview says the APIs "aren't primarily intended for indefinite persistence of confidential payloads" and points to DPAPI or Azure Rights Management for that, while admitting they "can be used" for it. Keys expire (still decrypting, but only while kept), can be revoked (then unreadable by default) and can be lost with a folder. Protect cookies, tokens and short-lived state; encrypt data at rest with a key you manage explicitly.

## Trade-offs

- **Zero config is a single-machine default.** It is right for development and wrong for any scale-out or container deploy; configure a shared repository and an application name on day one.
  ```csharp
  builder.Services.AddDataProtection()
      .PersistKeysToFileSystem(new DirectoryInfo("/keys"))   // a mounted volume
      .SetApplicationName("shop");
  ```
- **A shared ring is a shared secret.** Whoever reads the folder or table can forge cookies for every app on it; restrict access to the app identity and encrypt at rest.
- **Encryption at rest adds an operational dependency.** Every instance needs the certificate or Key Vault access, including old certificates while old keys exist (`UnprotectKeysWithAnyCertificate`).
- **Failures are silent by default.** A missing key turns into a 401 or 400 with an `Information` log; raise `Microsoft.AspNetCore.Authentication` and `Microsoft.AspNetCore.DataProtection` to `Information` in production or watch for 401 spikes after deploys.
- **Purposes are cheap isolation, not access control.** Use a fixed, versioned purpose per feature and never a purpose built only from user input.
- **Time-limited payloads are not token revocation.** Until the expiry passes, a leaked payload works; for one-time links keep server-side state too.

## Documentation Links

- [ASP.NET Core Data Protection overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction?view=aspnetcore-10.0) (doc)
- [Configure ASP.NET Core Data Protection, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-10.0) (doc)
- [Data Protection key management and lifetime in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/default-settings?view=aspnetcore-10.0) (doc)
- [Key storage providers in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/implementation/key-storage-providers?view=aspnetcore-10.0) (doc)
- [Purpose strings in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/consumer-apis/purpose-strings?view=aspnetcore-10.0) (doc)
- [Limit the lifetime of protected payloads in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/consumer-apis/limited-lifetime-payloads?view=aspnetcore-10.0) (doc)
