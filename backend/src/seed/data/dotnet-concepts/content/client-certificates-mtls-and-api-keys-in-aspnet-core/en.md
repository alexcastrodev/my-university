---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Service-to-service callers have no browser and no user, so the credential is something they hold: a client certificate proven during the TLS handshake (mutual TLS), an API key in a header, or a token that is tied to one of those. This lesson builds all three in ASP.NET Core and measures where each one breaks: Kestrel's `ClientCertificateMode` values over TLS 1.2, TLS 1.3 and HTTP/2, the `AddCertificate` validation (trust, usage, expiry, revocation by CRL and OCSP), a certificate forwarded in a header (and how to forge it), client-side certificate APIs, API key hashing, rotation and constant-time comparison, and a certificate-bound token (RFC 8705). Every key and certificate comes from a throwaway test CA made with `openssl`; nothing here is a real credential.
Versions: `Microsoft.AspNetCore.Authentication.Certificate` 10.0.15 and `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.15, `net10.0`, SDK 10.0.100 (macOS arm64, runtime 10.0.0, OpenSSL 4.0.3) and, for the Linux-only results, the `mcr.microsoft.com/dotnet/sdk:10.0` container (Ubuntu 24.04, runtime 10.0.14, OpenSSL 3.0.13). The `AddCertificate` package is also on NuGet as 11.0.0, not measured here.

## Use Cases

- Authenticating an internal service to another one with its own certificate instead of a shared secret.
- Putting a partner or a device behind mutual TLS and mapping its certificate to claims.
- Reading a client certificate that a reverse proxy or load balancer terminated, safely.
- Issuing API keys to integrators (hashed at rest, rotatable, revocable) and making a stolen access token useless by binding it to a certificate.

## Deep Dive

### The lab

A script builds `Lab Root CA`, an intermediate under it, and leaf certificates (EC P-256): `billing` (SAN `DNS:billing.lab`, `URI:spiffe://lab/billing`, EKU clientAuth), `expired` (valid Jan to Feb 2026), `serveronly` (EKU serverAuth), `rogue-client` (CN=billing, signed by an unrelated CA), `selfsigned`, and a `localhost` server certificate. One Kestrel app (HTTPS on 6820, plain HTTP on 6822) and one client console app drive every case; the macOS host and the Linux container run the same code.

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout root.key -out root.crt \
  -days 30 -subj "/CN=Lab Root CA (test only)" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
# intermediate: basicConstraints=critical,CA:TRUE,pathlen:0 ; leaf: -extfile with subjectAltName, extendedKeyUsage=clientAuth
openssl x509 -req -in billing.csr -CA int.crt -CAkey int.key -CAcreateserial -out billing.crt -days 10 -extfile billing.ext
```

### Kestrel decides when the certificate is asked, AddCertificate decides if it is good

Two layers are involved. Kestrel's `ClientCertificateMode` controls the TLS handshake. The `AddCertificate` handler validates what Kestrel hands over and turns it into a `ClaimsPrincipal`.

```csharp
builder.WebHost.ConfigureKestrel(k => k.ListenLocalhost(6820, lo => lo.UseHttps(h =>
{
    h.ServerCertificate = X509CertificateLoader.LoadPkcs12FromFile("server.pfx", "test");
    h.ClientCertificateMode = ClientCertificateMode.RequireCertificate;
    h.AllowAnyClientCertificate();   // TLS accepts any cert; AddCertificate does the real validation
})));
builder.Services.AddAuthentication(CertificateAuthenticationDefaults.AuthenticationScheme)
  .AddCertificate(o => { o.ChainTrustValidationMode = X509ChainTrustMode.CustomRootTrust;
                         o.CustomTrustStore = roots; o.RevocationMode = X509RevocationMode.NoCheck; });
```

Without `AllowAnyClientCertificate()` Kestrel validates the chain against the operating system store during the handshake: with the private CA, `RequireCertificate` and the right certificate the client got `SocketException: Connection reset by peer` and the handler never ran. Framework defaults of `CertificateAuthenticationOptions`, read from `IOptionsMonitor`: `AllowedCertificateTypes` Chained, `ChainTrustValidationMode` System, `RevocationMode` Online, `RevocationFlag` ExcludeRoot, `ValidateCertificateUse` and `ValidateValidityPeriod` true.

`GET /whoami` (needs the Certificate scheme), macOS, TLS 1.2 (macOS did not negotiate TLS 1.3 with Kestrel in any run):

```text
mode                no certificate                         certificate "billing"
NoCertificate       403                                    403 (the certificate is never requested)
AllowCertificate    403                                    200 ["issuer=CN=Lab Intermediate CA (test only)","thumbprint=3FC6...","dns=billing.lab","name=billing","uri=spiffe://lab/billing",...]
RequireCertificate  connection reset, no HTTP response      200
```

`RequireCertificate` fails below HTTP, so the caller sees a socket error and the handler never runs. `AllowCertificate` reaches your code and gets a 403, which is what you want when only some routes need the certificate. The default claims include issuer, thumbprint, subject, serial number, and one claim per SAN (`dns`, `uri`), plus `name` from the subject.

Rejections (the log shows the reason, the client only sees 403):

```text
rogue-client (CN=billing, unknown CA)  PartialChain One or more certificates required to validate this certificate cannot be found.
selfsigned                             Options do not allow self signed certificates.
expired                                NotTimeValid An expired certificate was detected.
serveronly (EKU serverAuth)            NotValidForUsage The key usage is incorrect.
```

### Trust: System, CustomRootTrust and the intermediate

`ChainTrustValidationMode.System` fails for a private CA (`PartialChain`, measured). `CustomRootTrust` with `CustomTrustStore` fixes that, with a catch that was measured on macOS and Linux: with only the root in the store, `billing` was rejected with `PartialChain` even when the client sent the intermediate in its handshake (`SslStreamCertificateContext` with the intermediate). The server did not use the chain the client sent. With root and intermediate both in `CustomTrustStore` the same certificate got 200. Consequence: the intermediate sits in the store as an anchor, so the handler trusts everything it signs, and a revoked or replaced intermediate means redeploying the store.

### OnCertificateValidated: your own rules and claims

The chain says "a CA I trust signed it". Which service is it, and is it allowed here? That is yours to decide in the event, and `Fail` or a custom `Principal` replaces the default mapping:

```csharp
o.Events = new CertificateAuthenticationEvents { OnCertificateValidated = c =>
{
    var cert = c.ClientCertificate;
    if (!registry.TryGetValue(cert.Thumbprint, out var service)) { c.Fail("thumbprint not in registry"); return Task.CompletedTask; }
    if (cert.GetNameInfo(X509NameType.DnsName, false) != "billing.lab") { c.Fail("SAN DNS mismatch"); return Task.CompletedTask; }
    c.Principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, service), new Claim("role", "payer")], c.Scheme.Name));
    c.Success(); return Task.CompletedTask;
} };
```

```text
billing       200 ["name=billing-service","role=payer","x5t#S256=133BC488..."]
rogue-client  403 (never reaches the event: chain validation failed first)
```

The event only runs after the chain, usage, validity and revocation checks passed, so it is where an allowlist (thumbprint, SAN, SPIFFE ID) belongs, not a replacement for them. A thumbprint allowlist also makes a rotation a deploy: keep two thumbprints per service during the swap, or match the SAN or issuer plus SAN instead.

### DelayCertificate: renegotiation depends on the OS, TLS version and HTTP version

`DelayCertificate` means "do not ask during the handshake, ask later with `GetClientCertificateAsync`". Measured with an endpoint that reads `Connection.ClientCertificate` and then awaits `GetClientCertificateAsync()` (Linux container, client with and without a certificate, `DelayCertificate`):

```text
client          TLS   HTTP    result
no certificate  1.2   1.1     200, cert (none)
no certificate  1.2   2       200, cert (none)
no certificate  1.3   1.1     500  SslException: Operation failed with error - 0.  (at RenegotiateAsync)
no certificate  1.3   2       200, cert (none)
billing         1.2   1.1     200, cert CN=billing
billing         1.3   1.1     200, cert CN=billing
billing         1.2   2       200, cert (none)   <- the certificate the client holds is never delivered
billing         1.3   2       200, cert (none)
```

With `AllowCertificate` the same `billing` client got `CN=billing` on all four rows, including HTTP/2. So with `DelayCertificate` over HTTP/2 a client that does have a certificate looks anonymous, without an error, because HTTP/2 forbids renegotiation. On macOS the same endpoint threw `PlatformNotSupportedException` from `SslStreamPal.Renegotiate` for every request, with the server pinned to TLS 1.2 as well. The docs (read, not run) say renegotiation is not recommended, buffer or drain the request body first (otherwise `InvalidOperationException: Client stream needs to be drained before renegotiation`), and prefer separate host names with per-SNI certificate settings. A cheap alternative: `AllowCertificate` on the whole listener and a 403 where the certificate is required.

### Revocation: fail closed, measured on Linux

`RevocationMode` `Online` fetches the CRL or asks OCSP, `Offline` only uses what is already cached, `NoCheck` skips it. The test CA publishes a CRL on a local HTTP server and an OCSP responder (`openssl ocsp`); `RevocationFlag.EndCertificateOnly` for the lines below:

```text
OCSP responder up:         good 200, revoked 403 "Revoked certificate revoked" (the responder log shows the GET requests)
CRL up, cold cache:        good 200, revoked 403 "Revoked certificate revoked"
CRL down, CRL cached:      good 200, revoked 403 (the cached CRL is used; nextUpdate was 7 days)
CRL down, cold cache:      Online 403, Offline 403: RevocationStatusUnknown unable to get certificate CRL, OfflineRevocation ...
                           NoCheck 200
CRL URL pointing nowhere:  Online 403, Offline 403 (same message)
OCSP URL pointing nowhere: Online 403, Offline 403
```

A revocation source that is unreachable makes the handler reject the certificate (fail closed), and `NoCheck` is the only mode that ignores it. A cached CRL keeps both the good and the revoked answers working for its whole validity. A certificate that carried both OCSP and a CRL URL stayed good with the CRL server down and an empty CRL cache, which points to OCSP answering first (inferred from the result, not traced). Two gotchas: with the default `ExcludeRoot` the intermediate is checked too, and my intermediate had no CRL distribution point, so every certificate failed with `unable to get certificate CRL` until I used `EndCertificateOnly` (or published a root CRL and put its URL in the intermediate). On macOS with this private CA and an HTTP CRL every certificate, including the good one, failed with `RevocationStatusUnknown` in `Online` and `Offline` alike, so a Mac laptop does not predict production behavior. Windows behavior was not tested (docs only).

### A certificate forwarded in a header

Behind a proxy that terminates TLS, the app never sees the handshake. `AddCertificateForwarding` plus `UseCertificateForwarding()` (before `UseAuthentication()`) read the certificate from a header, `X-ARR-ClientCert` here, base64 DER by default; other formats need a `HeaderConverter` (the nginx and IIS/Azure header formats are docs only, no proxy was run). The handler ignores plain HTTP (`Not https, skipping certificate authentication.`), so a request has to look like HTTPS, either because the hop is TLS or because `UseForwardedHeaders` accepted `X-Forwarded-Proto`.

A client certificate is public information, so the header alone proves nothing. Attacker requests below carry only the public `billing.crt` in the header (no private key, no client certificate in the TLS session):

```text
A. TLS hop, no guard, billing.crt in the header      200 as billing
   same with the self-signed cert in the header      403 (the chain is still validated)
B. same with the thumbprint allowlist                200 as "billing-service" (the thumbprint is public too)
C. plain HTTP hop                                    403 (Not https)
D. plain HTTP + forwarded headers trusted for all, attacker adds X-Forwarded-Proto: https      200 as billing
E. guard: header kept only from the proxy address
   attacker 127.0.0.1                                403
   proxy 127.0.0.2                                   200
```

What closes it: the header must be accepted only from the proxy, and the proxy must overwrite or strip the same header on every request, because a proxy that merely adds it forwards the attacker's copy as well. The guard in the lab:

```csharp
app.Use((ctx, next) => {   // before UseCertificateForwarding
    if (ctx.Connection.RemoteIpAddress?.MapToIPv4().ToString() != trustedProxy) ctx.Request.Headers.Remove("X-ARR-ClientCert");
    return next(); });
```

Also bind the app so only the proxy can reach it (network policy, private interface), and configure `UseForwardedHeaders` with `KnownProxies` instead of clearing them, as many container samples do (D).

### The client side

```csharp
// older, shorter
var h1 = new HttpClientHandler(); h1.ClientCertificates.Add(cert);
// SocketsHttpHandler: TLS options in one place; send the intermediate along with the leaf
var h2 = new SocketsHttpHandler { SslOptions = new() {
    ClientCertificateContext = SslStreamCertificateContext.Create(leaf, [intermediate], offline: true) } };
```

Both worked against the lab (`ClientCertificates` and `ClientCertificateContext`). The `.pfx` must contain the private key: passing only the public `.crt` through `SslOptions.ClientCertificates` ended with `Connection reset by peer`, the client could not sign the handshake. Load PKCS#12 with `X509CertificateLoader.LoadPkcs12FromFile` (the `X509Certificate2` constructors are obsolete in .NET 9+). With `IHttpClientFactory` configure the handler in `ConfigurePrimaryHttpMessageHandler`.

### API keys: hash, compare in constant time, rotate with overlap

A key is a credential with no expiry and no proof of possession, so keep the damage small: random 256-bit secret, an identifiable prefix, only a hash stored, two valid keys per integrator while rotating.

```csharp
// "dk_<id>_<secret>": dk_ marks it for secret scanners, <id> finds the record without scanning every hash
public string? Validate(string presented)
{
    var parts = presented.Split('_', 3);
    if (parts.Length != 3 || parts[0] != "dk" || !_byId.TryGetValue(parts[1], out var recs)) return null;
    var h = SHA256.HashData(Encoding.UTF8.GetBytes(parts[2]));
    string? ok = null;
    foreach (var r in recs)    // no early exit: every candidate hash is compared
        if (CryptographicOperations.FixedTimeEquals(h, r.Hash) && (r.NotAfter is null || r.NotAfter > DateTimeOffset.UtcNow)) ok = r.Id;
    return ok;
}
// AuthenticationHandler<AuthenticationSchemeOptions>.HandleAuthenticateAsync: read X-Api-Key, NoResult() when absent, Fail("invalid api key"), else Success(ticket)
```

Rotation, driven over HTTP against the lab:

```text
issue key 1                       -> GET /key with it: 200 "hello billing"; wrong key 401; no header 401
issue key 2 (overlap)             -> key 1: 200, key 2: 200
revoke key 1                      -> key 1: 401, key 2: 200
```

A fast hash is right here (the secret is random, not a password), and the bench shows why it does not matter for cost, plus what a naive comparison would leak (arm64, 2,000,000 iterations):

```text
SHA-256(key) + FixedTimeEquals                              203 ns
HMAC-SHA256(key) + FixedTimeEquals                          325 ns
PBKDF2-SHA256, 100000 iterations (for contrast)      14.2 ms (14,229,785 ns)

string == against a 4096-char constant: matching prefix 0 -> 3.22 ns, 2048 -> 84.25 ns, 4095 -> 151.14 ns
FixedTimeEquals, same inputs:           matching prefix 0 -> 8968 ns, 2048 -> 8893 ns, 4095 -> 8876 ns
44-char key, string ==: 40 chars right 4.33 ns, 0 chars right 2.97 ns
```

The ordinary `==` does leak the prefix length (about 47x on a 4096-char input), and `FixedTimeEquals` is flat. On a 44-character key the whole difference is about 1.4 ns, far below network jitter, so over the internet the practical risk is small; the habit is free, and hashing first (compare two 32-byte digests) also removes the length leak. `FixedTimeEquals` on equal-length spans only: it returns false at once for different lengths, which is why you compare the fixed-size hashes. Use HMAC with a server-side key (from [secrets and managed identities](secrets-and-managed-identities-key-vault-and-workload-identity)) when the stored value should be useless without a server-side key. A password hash (PBKDF2, 14 ms per check here) would put a 14 ms CPU cost on every request for no gain with a 256-bit random secret.

### A token tied to a certificate (RFC 8705)

A bearer token works for whoever holds it. RFC 8705 adds a confirmation claim: the access token carries `cnf` with `x5t#S256`, the base64url SHA-256 of the DER client certificate, and the API accepts the token only on a TLS connection that presents that certificate. The lab signs a test JWT (HS256, lab key) with the `cnf` of `billing.crt` and checks the binding in an authorization handler:

```csharp
var cnf = ctx.User.FindFirstValue("cnf");                               // {"x5t#S256":"..."}, JwtBearer with MapInboundClaims = false
var cert = await http.Connection.GetClientCertificateAsync();            // listener in AllowCertificate mode
var actual = Base64UrlEncoder.Encode(SHA256.HashData(cert.RawData));
if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actual), Encoding.ASCII.GetBytes(thumb ?? ""))) ctx.Succeed(r);
```

```text
GET /bound   client cert      token bound to    result
             billing          billing           200 "bound token ok for billing-service"
             billing          (no cnf)          403
             rogue-client     billing           403   (stolen token, other certificate)
             selfsigned       billing           403
             (none)           billing           403
             billing          rogue-client      403
GET /plain   (none)           billing           200   (the same stolen token on a plain JwtBearer endpoint)
```

The certificate here is not an identity, it is proof of possession: the TLS handshake proves the private key, the token says who. So the chain validation of `AddCertificate` is not needed on this route (the lab listener accepted any certificate at TLS level), and the token has to be bound or the route has to refuse it. The authorization server must put `cnf` in the token: the OpenIddict assemblies in [building an authorization server with OpenIddict](building-an-authorization-server-with-openiddict) expose certificate-bound tokens (docs only here, not run). The protocol view is in [OAuth security: BCP, DPoP, mTLS, PAR, RAR](/identity-concepts/oauth-security-bcp-dpop-mtls-par-rar-and-resource-indicators), and the workload-identity side (SPIFFE, short-lived certificates) in [workload identity, service accounts, mTLS and SPIFFE](/identity-concepts/workload-identity-service-accounts-mtls-and-spiffe).

### Which credential for which caller

Internal services you control: mTLS with short-lived certificates and an allowlist on SAN or SPIFFE ID. Partners and devices: mTLS if they can manage certificates, otherwise an API key per integrator with an overlap window. A delegated or user-facing call: a token ([JWT bearer and ASP.NET Core Identity](jwt-bearer-and-aspnet-core-identity), [OAuth clients](oauth-2-clients-in-dotnet-code-pkce-client-credentials-and-device-flow)), bound to a certificate when it is worth the extra handshake rules. The model is in [authentication and authorization fundamentals](authentication-and-authorization-fundamentals).

## Trade-offs

- **mTLS versus API key.** A certificate proves possession of a private key that never travels and expires by itself; a key is a shared secret that leaks in logs and tickets. The price is a CA, issuance, rotation and revocation infrastructure, and callers (browsers, some SDKs) that cannot present certificates.
- **Require versus Allow.** `RequireCertificate` rejects below HTTP (a socket reset, the handler never runs); `AllowCertificate` lets one listener serve routes with and without certificates and gives readable 403s. Pick `Allow` unless the whole listener is mTLS.
- **DelayCertificate.** Renegotiation threw on macOS, failed on Linux TLS 1.3 over HTTP/1.1 without a certificate, and silently returned nothing over HTTP/2. Prefer separate hosts (SNI) or `Allow`.
- **Revocation.** `Online` fails closed when the CRL or OCSP source is down, so an outage of your CA's endpoint becomes an outage of every caller; `NoCheck` fails open. Short-lived certificates (days) reduce the need for revocation at all.
- **Forwarded certificates.** Convenient and dangerous: the header is a bearer-style credential unless the proxy overwrites it and the app trusts only that proxy. Prefer re-establishing mTLS to the app, or a signed token from the proxy.
- **Hash choice for keys.** SHA-256 or HMAC for random keys; PBKDF2 or Argon2 only for human-chosen secrets. A constant-time compare is cheap insurance even if a timing attack over the network is hard to land.
- **Bound tokens.** They remove replay of a stolen token, but only where every resource server checks `cnf`, and they need mTLS between the client and the API (or at the proxy that forwards the check).
- **Lab limits.** One platform pair (macOS arm64 and Ubuntu in Docker), a test CA, HTTP/1.1 and HTTP/2 only, no Windows, no IIS, no real proxy, no HSM or Key Vault. Re-measure revocation and renegotiation on your target OS before relying on them.

## Documentation Links

- [Configure certificate authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/certauth) (doc)
- [Kestrel endpoints and HTTPS configuration, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/endpoints) (doc)
- [ClientCertificateMode enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.server.kestrel.https.clientcertificatemode) (doc)
- [CertificateAuthenticationOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authentication.certificate.certificateauthenticationoptions) (doc)
- [Configure ASP.NET Core to work with proxy servers and load balancers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer) (doc)
- [X509ChainPolicy.CustomTrustStore, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.x509certificates.x509chainpolicy.customtruststore) (doc)
- [SocketsHttpHandler.SslOptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.socketshttphandler.ssloptions) (doc)
- [HttpClientHandler.ClientCertificates, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.http.httpclienthandler.clientcertificates) (doc)
- [CryptographicOperations.FixedTimeEquals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.cryptographicoperations.fixedtimeequals) (doc)
- [RFC 8705, OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc8705) (doc)
- [RFC 5280, Internet X.509 PKI Certificate and CRL Profile, IETF](https://datatracker.ietf.org/doc/html/rfc5280) (doc)
- [RFC 6960, Online Certificate Status Protocol, IETF](https://datatracker.ietf.org/doc/html/rfc6960) (doc)
