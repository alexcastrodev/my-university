---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Inside a company with Active Directory, users expect to open an internal app and just be signed in, with no password prompt and no redirect: that is Windows authentication, HTTP `Negotiate` carrying Kerberos (or NTLM), and ASP.NET Core does it with `Microsoft.AspNetCore.Authentication.Negotiate`, also on Linux. This lesson builds it against a real MIT Kerberos KDC and a real OpenLDAP in Docker and measures what the handler does on the wire, what breaks (SPN, clock, keytab, key version, HTTP/2, proxies, NTLM) and how it looks from the client, how group roles reach `User.IsInRole` on Linux through `EnableLdap`, a security advisory trail that started as LDAP injection inside the handler itself, and what to do instead with `System.DirectoryServices.Protocols` (binds, GSSAPI, LDAPS, StartTLS, paging, filter escaping). `System.DirectoryServices.AccountManagement` is Windows-only (shown). IIS, HTTP.sys and delegation are docs only (no Windows here). The protocols themselves are in [Kerberos: tickets, TGT, delegation and NTLM](/identity-concepts/kerberos-tickets-tgt-delegation-and-ntlm) and [LDAP: directories, DN, schema and binds](/identity-concepts/ldap-directories-dn-schema-and-binds); this lesson is the .NET side.
Versions: `Microsoft.AspNetCore.Authentication.Negotiate` 10.0.15 (latest 10.0.x on 2026-11-19, also measured 10.0.8 to 10.0.10), `System.DirectoryServices.Protocols` 10.0.15, `System.DirectoryServices.AccountManagement` 10.0.15, `net10.0`, SDK 10.0.100 on macOS arm64 to build; run in `mcr.microsoft.com/dotnet/sdk:10.0` (Ubuntu 24.04, ASP.NET Core runtime 10.0.14) with MIT krb5 1.20.1-6ubuntu2.10, OpenLDAP slapd and libldap 2.6.10, curl 8.5.0, gss-ntlmssp 1.2.0; Docker 29.9.2. Package 11.0.0 also exists (GA 2026-11-10), not measured.

## Use Cases

- An intranet app (HR portal, reporting, admin UI) for domain users: single sign-on with no extra IdP, hosted on Linux containers.
- Reading a 401 loop, a 500 on login or a missing role claim and knowing whether it is the SPN, the keytab, the clock, the protocol or LDAP.
- Looking up users and groups in an LDAP directory (AD or OpenLDAP) from .NET on any OS, safely.
- Deciding between Kerberos, OIDC and SAML for a new app.

## Deep Dive

### The lab

Four containers on a private network from one image (`dnkrb-kdc`, `dnkrb-ldap`, `dnkrb-app` on port 6960, `dnkrb-client`). Realm `EXAMPLE.TEST`, AES keys only, `rdns = false`; principals `alice`, `bob`, `svc-app`, and the service keys `HTTP/app.example.test` and `ldap/example.test` exported with `ktadd` to keytabs. The app is the whole setup:

```csharp
builder.Services.AddAuthentication(NegotiateDefaults.AuthenticationScheme).AddNegotiate();
builder.Services.AddAuthorization(o => o.FallbackPolicy = o.DefaultPolicy);   // every endpoint needs a user
app.UseAuthentication(); app.UseAuthorization();
app.MapGet("/open", [AllowAnonymous] (ClaimsPrincipal u) => new { u.Identity!.IsAuthenticated, u.Identity.Name });
app.MapGet("/whoami", (ClaimsPrincipal u) => new { u.Identity!.Name, u.Identity.AuthenticationType,
    Roles = u.Claims.Where(c => c.Type == ClaimTypes.Role).Select(c => c.Value) });
```

The process gets `KRB5_KTNAME=/shared/app.keytab` and `KRB5_CONFIG=/shared/krb5.conf` (an MIT library reads both, no .NET option). `docker exec dnkrb-client` runs everything below.

### What the handler does on the wire

```text
$ curl -si http://app.example.test:6960/whoami            # no ticket
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Negotiate
$ echo alicepw | kinit alice; curl -si --negotiate -u : http://app.example.test:6960/whoami
HTTP/1.1 200 OK
WWW-Authenticate: Negotiate oYG3MIG0oAMKAQChCwYJKoZIhvcSAQICooGfBIGcYIGZBgkqhkiG9xIBAgIC...
{"name":"alice@EXAMPLE.TEST","authenticationType":"Kerberos","roles":[],"claims":["name=alice@EXAMPLE.TEST"]}
$ klist | tail -2
krbtgt/EXAMPLE.TEST@EXAMPLE.TEST
HTTP/app.example.test@EXAMPLE.TEST
```

The challenge is the bare word `Negotiate`. The client asked the KDC for `HTTP/app.example.test`: the SPN comes from the host in the URL, without the port. The `WWW-Authenticate: Negotiate <token>` on the 200 is the server's AP-REP (mutual authentication). The only claim is the name, `alice@EXAMPLE.TEST`: on Linux Kerberos carries no groups, that is the LDAP section. A .NET client works the same: `HttpClientHandler.UseDefaultCredentials = true` reads the ticket cache (empty cache: 401), and `Credentials = new NetworkCredential("alice", "alicepw", "EXAMPLE.TEST")` got a 200 with no `kinit` at all, the Kerberos library asked the KDC itself.

### Connection state: Kerberos does not keep it by default, NTLM does

I captured alice's token and replayed it on raw HTTP/1.1 connections, with `PersistKerberosCredentials` off (default) and on:

```text
                                         default (false)              PersistKerberosCredentials = true
connection A, Authorization: Negotiate   200 alice                    200 alice
connection A, same socket, no header     401 + WWW-Authenticate       200 alice  (even /open sees alice)
connection B (new), no header            401                          401
```

So the claim "Kestrel keeps the authenticated user per connection" is true only for NTLM (`PersistNtlmCredentials`, default true) or when you opt in. A .NET `HttpClient` over one connection with Kerberos did two legs for every request (`none` then `Negotiate`, 401 then 200); with NTLM and three requests the first took three legs (401, 401, 200) and the next two went out with no header and got 200 as alice; with `PersistNtlmCredentials = false` every request repeated the three legs. `curl` resent the token on each of three requests. The risk of persistence is documented: never enable it where one connection can carry several users, such as behind a proxy that pools connections (the docs: Negotiate must not be used with proxies unless the connection is 1:1). Kerberos and NTLM are connection-oriented handshakes, so a load balancer or YARP in the middle needs affinity or must handle authentication itself, see [Load Balancing Strategies](/system-design/system-design-concepts/load-balancing-strategies) and [Reverse Proxy and API Gateway with YARP](/dotnet-concepts/reverse-proxy-and-api-gateway-with-yarp).

HTTP/2: the handler only handles HTTP/1.x. On an h2c listener `curl --http2-prior-knowledge --negotiate -u :` sent the token and still got `401` (`http_version=2`), the same request on HTTP/1.1 got 200; `HttpClient` pinned to HTTP/2 got 401. Browsers downgrade after the challenge, `HttpClient` does not; the docs say the same.

### Failures, as the client and the server see them

Each row was reproduced; the server log is Kestrel's with the Negotiate category at Debug, and `KRB5_TRACE` on the app for the keytab cases.

| Cause | Client | Server |
| --- | --- | --- |
| no ticket (`curl --negotiate -u :`) | 401 `Negotiate` | no `Authorization` header |
| URL by IP, or a DNS alias with no SPN | 401, `klist` shows no new ticket | no `Authorization` header: the client never got a ticket |
| client clock +4 min | 200 | normal |
| client clock +6 or -6 min (`faketime`) | 500 | `Negotiate error code: Other`, `AuthenticationFailureException: GenericFailure` |
| keytab without the `HTTP/` key | 500 | trace: `HTTP/app.example.test@EXAMPLE.TEST not found in keytab (ticket kvno 2)` |
| `kadmin cpw -randkey` (kvno 3, keytab has 2) | 500 | `GenericFailure` |
| keytab file missing | 500 | `AuthenticationFailureException: Unsupported` |

Three lessons. A name problem never reaches the server, only the client's ticket step fails, so look at the client (`klist`, `KRB5_TRACE`). Every server-side Kerberos problem is a **500** by default with an exception that hides the GSS reason: the handler maps only credential errors to 401 and client errors to 400, and rethrows the rest. And exporting a keytab rotates the key: `ktadd` made kvno 4 and then 6 while old entries stayed, and the app accepted the new keytab with no restart (the MIT library reads it on every accept; the client needed a fresh ticket). Turn the 500 into a 401 and keep the log:

```csharp
.AddNegotiate(o => o.Events = new NegotiateEvents {
    OnAuthenticationFailed = c => { logger.LogWarning(c.Exception, "negotiate failed"); c.SkipHandler(); return Task.CompletedTask; } })
```

Measured on the skew and kvno cases: 401 with `WWW-Authenticate: Negotiate`, the same as "no ticket", so keep the log if you need to tell them apart. `RequireAuthenticatedSignIn` is not a Negotiate option: it is `AuthenticationOptions.RequireAuthenticatedSignIn` (default `true`, checked by reflection) for sign-in handlers such as cookies, and `NegotiateHandler` implements only `IAuthenticationHandler` and `IAuthenticationRequestHandler`, so it never signs in anything. `NegotiateOptions` itself has three members (`Events`, `PersistKerberosCredentials`, `PersistNtlmCredentials`) plus `EnableLdap`.

### NTLM on Linux: fallback that needs a package and a validator

With a Kerberos-capable URL everything above is Kerberos. When Kerberos cannot be used (the IP URL, no ticket and explicit credentials), a .NET client falls to NTLM inside the same `Negotiate` header. On the Linux server that needs the `gss-ntlmssp` mechanism:

```text
server without the gss-ntlmssp mech (file moved out of /etc/gss/mech.d)   401, AuthenticationFailureException: Unsupported
server with gss-ntlmssp, nothing to verify against                         handshake starts (401), final leg GenericFailure, 401
server with gss-ntlmssp and NTLM_USER_FILE=/shared/ntlm.users              200 {"name":"EXAMPLE.TEST\\alice","authenticationType":"NTLM"}
```

The user file (`EXAMPLE.TEST:alice:alicepw`) is a test fixture of gss-ntlmssp; a real server validates NTLM through winbind or `ntlm_auth` against a domain controller (docs only, not run). Note the name: `EXAMPLE.TEST\alice` for NTLM, `alice@EXAMPLE.TEST` for Kerberos, one person with two spellings: role mapping and audit logs must handle both. NTLM is the downgrade path an attacker wants (relay and pass-the-hash, see the Kerberos lesson): on Linux, not installing `gss-ntlmssp` turns it off.

### Roles on Linux: `EnableLdap`, measured

Windows builds a `WindowsPrincipal` with the group SIDs from the token; on Linux the handler can query LDAP for them. I made OpenLDAP look like the AD attributes the handler reads (object classes `user` and `group`, attributes `sAMAccountName` and `memberOf`; alice is in `Editors`, which is in `Staff`; bob in `Readers`).

```csharp
.AddNegotiate(o => o.EnableLdap("example.test"));          // domain = LDAP server name AND base DN dc=example,dc=test
.AddNegotiate(o => o.EnableLdap(s => { s.Domain = "example.test"; s.IgnoreNestedGroups = true; /* s.LdapConnection = ... */ }));
```

```text
EnableLdap("example.test"), service ticket cache of svc-app   alice roles ["Editors","Staff"]   bob ["Readers"]
GET /admin with RequireRole("Editors")                          alice 200   bob 403
IgnoreNestedGroups = true                                       alice ["Editors"]
```

How it works (source of v10.0.15, matched by the logs): the handler calls `new LdapConnection` to the server named by `Domain` and calls `Bind()` **when the options are first built, at app startup**, using the process's own Kerberos ticket (`KRB5CCNAME`, here a `kinit` of `svc-app`). Per user it searches `(&(objectClass=user)(sAMAccountName=<name before @>))` below the base DN, reads `memberOf`, takes the first `CN=` value of each DN as a role, optionally walks the groups, and caches the roles per user (sliding 10 min, absolute 60 min, size limited). Things that bit:

- `MachineAccountName` and `MachineAccountPassword` do not work on Linux: the app dies at startup with `LdapException: The feature is not supported` (a Negotiate bind with a `NetworkCredential` gets error 92 in libldap, also shown below). Use the ticket cache, or your own `LdapSettings.LdapConnection` with `AuthType.Basic` over LDAPS (measured: same roles). The docs add: protect that connection with TLS and set `ReferralChasing = None`.
- LDAP down at startup: the process exits (exit 134, `LdapException: The LDAP server is unavailable`).
- The cache hides changes: alice got a second group in the directory and kept `["Editors","Staff"]`; with LDAP stopped she was still served from the cache (200) but bob, never seen before, got 500.
- There is no reconnect. After restarting slapd the first uncached lookup gave 500, and the next request **killed the process** (SIGSEGV, exit 139, in 4 of 4 runs) with the default Kerberos-bound connection; with the custom Basic/LDAPS connection it stayed up but answered 500 for every uncached user until the app restarted (3 tries in a row).
- A user with no `memberOf` (a new account, or alice after I removed her only group) is a `NullReferenceException` and a 500 on 10.0.9 and on 10.0.15 (dotnet/aspnetcore issue 70090, open). A user missing from LDAP gets 200 with no roles and a warning.
- An NTLM-style name has no `@`: on 10.0.9 the whole `EXAMPLE.TEST\alice` went into the filter (`The search filter is invalid`, 500); on 10.0.15 the lookup is skipped, so NTLM users get no roles.

The robust shape on Linux is your own lookup in an `IClaimsTransformation`: one short-lived `LdapConnection` per cache miss, an escaped filter, a tolerant `memberOf` read:

```csharp
using var c = new LdapConnection(new LdapDirectoryIdentifier("example.test")) { AuthType = AuthType.Negotiate };
c.SessionOptions.ProtocolVersion = 3; c.Bind();                       // the process ticket cache, as before
var r = (SearchResponse)c.SendRequest(new SearchRequest("dc=example,dc=test",
    $"(&(objectClass=user)(sAMAccountName={Esc(uid)}))", SearchScope.Subtree, "memberOf"));   // Esc: see below
var groups = r.Entries.Count == 1 && r.Entries[0].Attributes["memberOf"] is { } a
    ? a.GetValues(typeof(string)).Cast<string>().Select(dn => dn.Split(',')[0][3..]).ToArray() : [];
// cache `groups` per user in IMemoryCache for a few minutes, then add one ClaimTypes.Role claim each
```

Measured: alice `["Editors"]` (this version does not walk nested groups), svc-app `[]` with no crash, and bob fine right after a slapd restart.

### The handler's own LDAP injection (CVE-2026-47303)

Up to 10.0.9 the handler put the authenticated name into the filter with no escaping. A Kerberos name is whatever the KDC issues: MIT accepted `bo*`, `*` and `*)(|(sAMAccountName=alice)` as principals. With `EnableLdap` and those principals:

```text
                                        10.0.9                      10.0.15 (logged filter)
bo*                                     roles ["Readers"]           [] (sAMAccountName=bo\2a)
*                                       ["Editors","Staff"]         [] (sAMAccountName=\2a)
*)(|(sAMAccountName=alice)              ["Editors","Staff"]         [] (...\2a\29\28|\28sAMAccountName=alice\29)
```

A principal got another user's groups. NuGet audit flags it at restore: `NU1903` on 10.0.8 and 10.0.9 for GHSA-2p3q-h3hg-jcqq (CVE-2026-47303, CWE-90 listed, fixed in 10.0.10), GHSA-8prm-248r-h957 (CVE-2026-47300, validation, only apps that fetch roles from LDAP) and GHSA-vrrp-6v32-2p8g (CVE-2026-70179, LDAP result tied to the wrong principal, fixed in 10.0.13; 10.0.10 still warned). Whether an attacker can create such a principal depends on your KDC: MIT lets an admin do it, I did not check which characters AD allows, so the practical risk is unverified. The lesson is general: if Microsoft's own handler missed the escape, yours can too, and `EnableLdap` users must be on at least 10.0.13.

### LDAP directly with `System.DirectoryServices.Protocols`

The package is cross-platform and wraps libldap on Linux. The `System.DirectoryServices.AccountManagement` package (`PrincipalContext`, `UserPrincipal`) is not: it restores and builds on net10.0 with only warning CA1416, ships a `runtimes/win` asset, and at run time in the Linux container `new PrincipalContext(ContextType.Domain, "example.test")` throws `PlatformNotSupportedException: System.DirectoryServices.AccountManagement is not supported on this platform.` Binds measured against slapd (`WhoAmI` is the RFC 4532 extended operation):

| Bind | Result |
| --- | --- |
| simple, `uid=alice,...` and the right password | `dn:uid=alice,ou=People,dc=example,dc=test`, slapd log `mech=SIMPLE bind_ssf=0` |
| simple, wrong password | `LdapException 49 "The supplied credential is invalid."` |
| simple, DN with empty password | `DirectoryOperationException "The server cannot handle directory requests."` (slapd: err=53 unauthenticated bind disallowed) |
| no credential | anonymous bind succeeds, `WhoAmI` is empty; my ACL then refuses the search (50) |
| `AuthType.Negotiate` or `Kerberos`, ticket cache | bound as `dn:uid=alice,...`, `mech=GSSAPI bind_ssf=256 ssf=256` (encrypted over plain `ldap://`) |
| the same with a `NetworkCredential` | `LdapException 92 "The feature is not supported."` |
| `Negotiate` to the server by IP | `LdapException 82 "A local error occurred."` (SPN `ldap/<host>` mismatch) |

On Linux, Kerberos binds need a ticket obtained outside .NET and a server name that matches the SPN. A bind that returns without error is not a login unless the password is not empty: some servers accept an empty-password simple bind as anonymous (RFC 4513 section 5.1.2), this one refused it.

```text
LDAPS 636, CA in ldap.conf TLS_CACERT          bound as dn:uid=alice,...       (slapd: TLS1.3 AES-256-GCM)
LDAPS with only the system CA bundle           LdapException 81 "The LDAP server is unavailable."
LDAPS to the server by IP                      81 (certificate has DNS names only)
LDAPS + VerifyServerCertificate (accept all)   81 (slapd sees TLS established, then the client closes)
StartTransportLayerSecurity before any Bind    81, and no STARTTLS reaches slapd
anonymous Bind(), then StartTransportLayerSecurity(null), then a simple bind    bound, slapd bind_ssf=0 ssf=256
```

TLS trust comes from libldap config (`TLS_CACERT` in `ldap.conf` or `LDAPTLS_CACERT`), not from .NET, and the `VerifyServerCertificate` callback was unusable here. StartTLS works only on an already open connection, so open it with an anonymous `Bind()` first; and the error 81 hides the reason, so a failed StartTLS must stop the program, never continue in clear text. `SslInformation` also threw 81.

Paging with 600 entries below `ou=Bulk` and OpenLDAP's default `sizelimit` of 500:

```csharp
var cookie = Array.Empty<byte>();
do {
    var req = new SearchRequest("ou=Bulk,dc=example,dc=test", "(objectClass=*)", SearchScope.OneLevel, "uid");
    req.Controls.Add(new PageResultRequestControl(200) { Cookie = cookie });
    var resp = (SearchResponse)conn.SendRequest(req);
    cookie = ((PageResultResponseControl)resp.Controls[0]).Cookie;      // empty cookie = last page
} while (cookie.Length > 0);
```

```text
no paging                                             DirectoryOperationException 4 SizeLimitExceeded
paged, 200 per page, slapd defaults                   page 1: 200, page 2: 200, page 3: SizeLimitExceeded after 400
sizelimit size.prtotal=unlimited in slapd.conf        200 + 200 + 200 = 600 entries, 3 pages
```

Paging does not lift the server's total cap (OpenLDAP counts it across pages by default; AD uses `MaxPageSize` per page). The library does not escape filters. A reflection scan of the public API for `Escape|Encode|Sanitiz|Quote` found only `BerConverter.Encode`, so there is no `LdapFilterEncoder` or equivalent: write the RFC 4515 escape yourself (the handler's own is internal). With the filter `(&(uid={name})(sAMAccountName=*))` below `ou=People` (3 users):

```csharp
static string Esc(string s) => s.Replace("\\", "\\5c").Replace("*", "\\2a").Replace("(", "\\28").Replace(")", "\\29").Replace("\0", "\\00");
```

```text
input        interpolated                                    escaped
alice        (&(uid=alice)(sAMAccountName=*))   1 entry      1 entry
bo*          (&(uid=bo*)(...))                  1 (bob)      0
*            (&(uid=*)(...))                    3 entries    0
*)(uid=*     (&(uid=*)(uid=*)(...))             3 entries    0   (escaped: uid=\2a\29\28uid=\2a)
```

The interpolated form returned every user for `*`, and an input that closes the clause adds a second one (the library rejects only unbalanced filters: `The search filter is invalid`). Escape values in filters (RFC 4515) and DN components (RFC 4514, a different rule), use a read-only account with a narrow ACL, and prefer search-then-bind over building a DN from input.

### Windows hosting and delegation (docs only)

Not run here. On Windows the same package works with Kestrel through SSPI and yields a `WindowsPrincipal`. Under IIS or HTTP.sys, Windows authentication is enabled in the server (`web.config`, `HttpSysOptions.Authentication`) and the handler defers to it (`PostConfigureNegotiateOptions` sets `DeferToServer` when the server reports integrated auth, and throws if the server supports it but it is off). HTTP.sys authenticates in kernel mode and decrypts the ticket with the machine account, so the SPN goes on the host. Impersonation is not implemented: `WindowsIdentity.RunImpersonated` is Windows only. Calling a downstream service as the user needs Kerberos delegation (constrained delegation or resource-based constrained delegation in AD), configured in the directory and not in the app: see the Kerberos lesson and the Microsoft overview. The docs for .NET 11 add channel binding to the TLS endpoint for Negotiate over HTTPS against NTLM relay, not measured here.

### Kerberos against OIDC and SAML

Kerberos fits domain-joined clients inside one AD forest: no tokens, no redirects, mutual authentication, a browser that already has a ticket, and an app that never sees a password. It fails where there is no domain (Internet users, mobile apps, partners), where a proxy pools connections, where HTTP/2 must be end to end, and where a container has no keytab story. For a new app today the market default is OIDC against Entra ID or Keycloak, with the directory behind it ([OpenID Connect, Entra ID and the BFF Pattern](/dotnet-concepts/openid-connect-entra-id-and-bff)); SAML covers customer IdPs ([SAML 2.0 Single Sign-On in ASP.NET Core](/dotnet-concepts/saml-2-single-sign-on-in-aspnet-core)); Kerberos remains the right answer for existing AD intranet apps, often as the first hop of a broker. [Choosing a Federation Protocol](/identity-concepts/choosing-a-federation-protocol-saml-oidc-kerberos-and-ldap) compares the four.

## Trade-offs

- **Single sign-on vs reach.** Zero prompts for domain machines, nothing for anyone else. A hybrid app can offer Negotiate on an internal host and OIDC on the public one; the same user then has two identifiers (`alice@EXAMPLE.TEST` and an OIDC `sub`).
- **Linux means ownership.** You manage the keytab (a secret, readable only by the app user, rotated together with the KDC), the clock, the DNS name that matches the SPN and the ticket cache of the LDAP account. On Windows the domain does it. Example: `ktadd` rotated the key and the next client with an old ticket got 500 until it asked for a new one.
- **`EnableLdap` vs your own lookup.** The built-in one is two lines, but it binds at startup, never reconnects, can crash the process after an LDAP restart on the Kerberos path, 500s on a user with no groups and has had three advisories in 2026. Your own transformation costs 20 lines and the failure modes are yours to choose. Cache either way: the default 10 minute cache is also your role-revocation delay.
- **Default 500s.** Turn on `OnAuthenticationFailed` with `SkipHandler` so a bad keytab does not look like a server bug to users, and alert on the log line.
- **NTLM.** Leaving `gss-ntlmssp` out of a Linux image removes the downgrade; on Windows servers restrict NTLM by policy instead.
- **Persist credentials.** `PersistKerberosCredentials = true` saves a round trip per request and is only safe with 1:1 connections.

## Documentation Links

- [Configure Windows Authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/windowsauth) (doc)
- [NegotiateOptions Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authentication.negotiate.negotiateoptions) (doc)
- [LdapSettings Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authentication.negotiate.ldapsettings) (doc)
- [Negotiate handler source (v10.0.15), GitHub](https://github.com/dotnet/aspnetcore/tree/v10.0.15/src/Security/Authentication/Negotiate/src) (doc)
- [Negotiate: handle missing memberOf during LDAP claim resolution, issue 70090, GitHub](https://github.com/dotnet/aspnetcore/issues/70090) (doc)
- [CVE-2026-47303 advisory GHSA-2p3q-h3hg-jcqq, GitHub](https://github.com/advisories/GHSA-2p3q-h3hg-jcqq) (doc)
- [CVE-2026-47300 advisory GHSA-8prm-248r-h957, GitHub](https://github.com/advisories/GHSA-8prm-248r-h957) (doc)
- [CVE-2026-70179 advisory GHSA-vrrp-6v32-2p8g, GitHub](https://github.com/advisories/GHSA-vrrp-6v32-2p8g) (doc)
- [LdapConnection Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.directoryservices.protocols.ldapconnection) (doc)
- [PageResultRequestControl Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.directoryservices.protocols.pageresultrequestcontrol) (doc)
- [PrincipalContext Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.directoryservices.accountmanagement.principalcontext) (doc)
- [HTTP.sys web server implementation in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/httpsys) (doc)
- [Host ASP.NET Core on Windows with IIS, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/iis/) (doc)
- [Kerberos constrained delegation overview, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/security/kerberos/kerberos-constrained-delegation-overview) (doc)
- [Keytabs and application servers, MIT Kerberos documentation](https://web.mit.edu/kerberos/krb5-1.20/doc/admin/appl_servers.html) (doc)
- [Size and time limits, OpenLDAP Administrator's Guide](https://www.openldap.org/doc/admin26/limits.html) (doc)
- [Using SASL, OpenLDAP Administrator's Guide](https://www.openldap.org/doc/admin26/sasl.html) (doc)
- [RFC 4559, SPNEGO-based Kerberos and NTLM HTTP Authentication](https://www.rfc-editor.org/rfc/rfc4559) (doc)
- [RFC 4515, LDAP String Representation of Search Filters](https://www.rfc-editor.org/rfc/rfc4515) (doc)
- [RFC 4513, LDAP Authentication Methods and Security Mechanisms](https://www.rfc-editor.org/rfc/rfc4513) (doc)
- [RFC 2696, LDAP Control Extension for Simple Paged Results](https://www.rfc-editor.org/rfc/rfc2696) (doc)
- [LDAP Injection Prevention Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.html) (doc)
