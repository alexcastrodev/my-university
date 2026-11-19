---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Enterprise customers and corporate identity teams still hand you a SAML 2.0 identity provider, and ASP.NET Core has no SAML support of its own. This lesson adds single sign-on against a real IdP (Keycloak in Docker) to an ASP.NET Core app with a third-party library, and measures what happens on the wire and when someone attacks it: the AuthnRequest over the HTTP-Redirect and HTTP-POST bindings, the signed Response and Assertion decoded, signature, `Audience`, `InResponseTo`, `NotOnOrAfter` with the clock skew, replay, XML Signature Wrapping, an unsigned assertion, attribute-to-claim mapping, the cookie session after SSO, SP and IdP metadata, and Single Logout in both directions. The library state (versions, license, maintenance, net10 support) was checked on 2026-11-19 and is written down below, because for SAML on .NET that is half the decision. The protocol itself is in [SAML 2.0: assertions, bindings and SSO flows](/identity-concepts/saml-2-assertions-bindings-and-sso-flows); this lesson is the ASP.NET Core side. Every key and certificate is a throwaway made for the test.
Versions: `Sustainsys.Saml2.AspNetCore2` 2.11.1 (with `Sustainsys.Saml2` 2.11.1, `Microsoft.IdentityModel.Tokens.Saml` 5.7.0), `System.Security.Cryptography.Xml` 10.0.15 (test harness only), `net10.0`, SDK 10.0.100 (macOS arm64, runtime 10.0.0), Keycloak `quay.io/keycloak/keycloak:26.8.2` (digest `sha256:c68e286cacd8...`, `start-dev`, one container).

## Use Cases

- Letting employees of a customer company sign in with their own corporate IdP (Entra ID, ADFS, Okta, Keycloak, Shibboleth) when that IdP only offers SAML.
- Integrating a legacy or government federation that mandates SAML 2.0 and signed assertions.
- Reviewing a SAML integration: which checks the library does for you, which are options, and which failures are silent.
- Deciding between a SAML library, a broker (Keycloak, IdentityServer) in front of the app, or asking the customer for OpenID Connect.

## Deep Dive

### What ASP.NET Core ships, and what it does not

The shared framework `Microsoft.AspNetCore.App` 10.0.0 on disk has `Authentication.Abstractions`, `BearerToken`, `Cookies`, `Core` and `OAuth`, and no assembly with `Saml` in its name (`Authentication` is in 6 of the assemblies, `Saml` in none). The packages Microsoft publishes on NuGet (searched 2026-11-19, 11.0.0 line) include `OpenIdConnect`, `WsFederation`, `Negotiate`, `Certificate`, `JwtBearer` and the social providers, again with no SAML. `WsFederation` speaks the WS-Federation protocol, which can carry SAML tokens, but it is not the SAML 2.0 protocol (`AuthnRequest`, bindings, metadata) that an enterprise IdP offers. The Microsoft Learn authentication overview does not mention SAML. So a SAML 2.0 service provider (SP) in ASP.NET Core is always a third-party package or a broker.

### The libraries, checked on 2026-11-19

| | Sustainsys.Saml2 | ITfoxtec.Identity.Saml2 | Duende IdentityServer 8 |
|---|---|---|---|
| Latest | 2.11.1 (NuGet 2026-11-16) | 4.22.3 (2026-11-19) | 8.0.0 (NuGet; 8.1 previews) |
| Targets | `net8.0` (AspNetCore2 package) | `net10.0` and `net11.0` (added in 4.22.0, 2026-11-12) | `net10.0` |
| License | MIT (2.x), LGPL (1.x) | BSD-3-Clause | commercial, SAML in the Standard add-on, Advanced and Custom editions |
| Shape | `AuthenticationHandler` (`AddSaml2`), endpoints included | toolkit: you write the endpoints and call `Saml2AuthnRequest`, `Saml2PostBinding`, `Saml2AuthnResponse` | SAML IdP and SP inside IdentityServer (`AddSaml`, `AddSamlServiceProvider`) |
| Maintenance | 2.x security and critical fixes only, 3.x on `main` "not yet ready" (v3 plans paid tiers for advanced features); last feature release 2.11.0 on 2025-03-02 | frequent: 4.22.0, 4.22.2 and 4.22.3 in 7 days, the last two with security fixes | active, docs updated 2026-11-16 |
| Advisories | 4 published 2026-11-16, all fixed in 2.11.1; CVE-2023-41890 (issuer validation) fixed 2.9.2; CVE-2020-5261 (missing replay detection) fixed 2.5.0 | none listed on GitHub | not checked |

Sources: the NuGet registration API and `.nuspec` files, the GitHub repositories (README, `SECURITY.md`, releases, security advisories) and the Duende docs. The four November advisories on Sustainsys.Saml2 are `GHSA-h3wv-rf2m-mh72` (missing HTML output encoding, high), `GHSA-66qr-wxvc-jhg9` (denial of service from missing input validation, high), `GHSA-hpv7-q3w8-5hf2` (insufficient validation of LogoutRequests, low) and `GHSA-pfv2-f8g4-2w95` (incorrect RelayState integrity validation, low): anything below 2.11.1 is affected, so pin at least that. Duende's SAML and the Rock Solid Knowledge add-on `Rsk.Saml.DuendeIdentityServer` 12.1.0 are docs only here (not run): they fit when IdentityServer is already your broker. ComponentSpace also sells a SAML library (seen in the NuGet search, not evaluated). Entra ID and ADFS as the IdP are docs only too; only Keycloak was run.

Choice for the experiments: **Sustainsys.Saml2.AspNetCore2 2.11.1**. It is an `AuthenticationHandler`, so challenge, cookie sign-in and sign-out follow the same pipeline as any other scheme ([authentication and authorization fundamentals](authentication-and-authorization-fundamentals)), it is MIT, and it was patched three days before this check. The cost is real: security-only mode, a `net8.0` target (it runs on net10.0, measured below), and a Microsoft.IdentityModel 5.7.0 dependency tree that is old (`dotnet list package --vulnerable --include-transitive` reported nothing, 2026-11-19). If the library going quiet worries you, ITfoxtec is the active alternative and needs more code from you.

### The lab

Keycloak 26.8.2 (`KC_HOSTNAME=http://localhost:6901`, container port 6901) with realm `lab`, a SAML client whose clientId is the SP entity ID, users `alice` (role `app-user`) and `bob` (`app-user` and `app-admin`), the Response and the Assertion both signed, and the client requiring a signed AuthnRequest (the SP certificate is registered on the client). The SP is a minimal app on `http://localhost:6900`, the "browser" is an `HttpClient` that follows redirects, fills the Keycloak login form and POSTs the form Keycloak returns, so every message can be captured and altered. The SP (the lab switches, such as binding and clock skew, read from environment variables, are removed):

```csharp
builder.Services.AddAuthentication(o =>
{
    o.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;        // the session after SSO
    o.DefaultChallengeScheme = Saml2Defaults.Scheme;                             // 401 goes to the IdP
    o.DefaultForbidScheme = CookieAuthenticationDefaults.AuthenticationScheme;   // see the 500 below
})
.AddCookie(o => { o.Cookie.Name = "app.session"; o.ExpireTimeSpan = TimeSpan.FromMinutes(20);
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; }; })
.AddSaml2(o =>
{
    o.SPOptions.EntityId = new EntityId("http://localhost:6900/Saml2");
    o.SPOptions.ServiceCertificates.Add(new ServiceCertificate
        { Certificate = X509CertificateLoader.LoadPkcs12FromFile("sp.pfx", "lab"), Use = CertificateUse.Signing });
    o.SPOptions.ReturnUrl = new Uri("http://localhost:6900/me");
    o.IdentityProviders.Add(new IdentityProvider(new EntityId("http://localhost:6901/realms/lab"), o.SPOptions)
    {
        MetadataLocation = "http://localhost:6901/realms/lab/protocol/saml/descriptor", LoadMetadata = true,
        Binding = Saml2BindingType.HttpRedirect,   // or HttpPost
    });
});
app.MapGet("/me", (ClaimsPrincipal u) => u.Claims.Select(c => new { c.Type, c.Value })).RequireAuthorization();
app.MapGet("/logout", () => Results.SignOut(new() { RedirectUri = "/" }, [CookieAuthenticationDefaults.AuthenticationScheme, Saml2Defaults.Scheme]));
```

The handler serves `/Saml2` (SP metadata), `/Saml2/Acs` (the assertion consumer service) and `/Saml2/Logout` under `SPOptions.ModulePath`. The handler's own state cookie `Saml2.<relay state>` is `SameSite=None` and ASP.NET Core logged a warning that it must also be `Secure`: on plain `http://localhost` the lab ignores it, in production the SP must be HTTPS because the IdP posts to it from another site.

### SP-initiated SSO on the wire

`GET /me` without a session returns 303 to the IdP. With the Redirect binding the AuthnRequest is raw-deflated, base64 and URL-encoded in the query, with the signature as extra parameters (`SAMLRequest` 348 characters, `RelayState`, `SigAlg`, `Signature` 344). Decoded:

```xml
<saml2p:AuthnRequest ID="id09c24b33e3f8478e850697fd5596c0ff" Version="2.0" IssueInstant="2026-11-19T16:19:30Z"
    Destination="http://localhost:6901/realms/lab/protocol/saml" AssertionConsumerServiceURL="http://localhost:6900/Saml2/Acs">
  <saml2:Issuer>http://localhost:6900/Saml2</saml2:Issuer>
</saml2p:AuthnRequest>
```

With `Binding = HttpPost` the same request is not deflated and the signature moves inside the XML: the SP answers 200 with an auto-submit form (`SAMLRequest` 3360 characters, `RelayState`) and the XML carries an enveloped `<Signature>` with the SP certificate in `KeyInfo`. Both bindings ended in the same session. After login the IdP returns a form that the browser POSTs to the ACS. The Response (signatures and certificates abridged), as Keycloak 26.8.2 issued it:

```xml
<samlp:Response Destination="http://localhost:6900/Saml2/Acs" ID="ID_f0c44d26-..." InResponseTo="id75c94342842e40b6a5c4c11a1021b930" IssueInstant="2026-11-19T16:17:57.004Z">
  <saml:Issuer>http://localhost:6901/realms/lab</saml:Issuer>
  <dsig:Signature>...Reference URI="#ID_f0c44d26-..." (enveloped-signature, exc-c14n, rsa-sha256)...</dsig:Signature>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success" /></samlp:Status>
  <saml:Assertion ID="ID_dd663da0-..." IssueInstant="2026-11-19T16:17:57.001Z">
    <dsig:Signature>...Reference URI="#ID_dd663da0-..."...</dsig:Signature>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">alice@lab.test</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="id75c94..." NotOnOrAfter="2026-11-19T16:22:55.001Z" Recipient="http://localhost:6900/Saml2/Acs" />
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-11-19T16:17:55.001Z" NotOnOrAfter="2026-11-19T16:18:55.001Z">
      <saml:AudienceRestriction><saml:Audience>http://localhost:6900/Saml2</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="..." SessionIndex="Nt_vQ0NA...::8dafb9ce-..." SessionNotOnOrAfter="2026-11-20T02:17:57.005Z">...</saml:AuthnStatement>
    <saml:AttributeStatement>... given_name, family_name, email, Role (x7) ...</saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>
```

Everything the SP must check is on that page: who signed (`Issuer` and the key), for whom (`Audience`, `Recipient`, `Destination`), in answer to what (`InResponseTo`), when (`NotBefore`, both `NotOnOrAfter`), and the identity (`NameID`, attributes). Keycloak's defaults here: Conditions valid 60 s, `SubjectConfirmationData` 5 minutes, `SessionNotOnOrAfter` 10 hours. The ACS answers 303 to the `ReturnUrl` and sets `app.session` (the ASP.NET Core cookie) and clears the `Saml2.*` state cookie. After that the SAML Response is no longer used: the session is the cookie, 20 minutes sliding by the cookie options, independent of the IdP session.

### Attributes to claims, and the session cookie

`GET /me` as `alice` (abridged to the claim types): `nameidentifier` = `alice@lab.test` (the NameID), `authenticationmethod`, `authenticationinstant`, then two library claims, `http://Sustainsys.se/Saml2/LogoutNameIdentifier` and `.../SessionIndex` (both needed for logout), then one claim per attribute whose type is the SAML `Name` (`given_name`, `family_name`, `email`, `Role`). Mapping to what your code uses is yours: the lab copies each `Role` value that starts with `app-` into `ClaimTypes.Role` in `Notifications.AcsCommandResultCreated`, and `RequireRole("app-admin")` then gave `/admin` 403 for alice and 200 for bob.

Two measured surprises. Keycloak's `role_list` mapper sent 7 `Role` values for alice, not just `app-user`: `offline_access`, `uma_authorization`, `view-profile`, `default-roles-lab` and others, so whitelist what you map instead of trusting every attribute. And the claims plus the 7 duplicated roles made the session cookie 4017 + 177 bytes, chunked into `app.sessionC1` and `C2`; dropping the raw `Role` claims gave one cookie of 2407 bytes. The second one: `/admin` as alice answered **500**, not 403, with `NotImplementedException` from `Saml2Handler.ForbidAsync`, because the Forbid scheme defaults to the challenge scheme. `DefaultForbidScheme` set to the cookie scheme (as in the code above) fixed it. The `Saml2.*` state cookie and the session are protected by Data Protection, so the key ring has to be shared across instances ([data protection key ring and purposes](data-protection-key-ring-and-purposes)).

### Metadata, both directions

`GET /Saml2` is the SP metadata, itself signed with the service certificate: `EntityDescriptor` with `entityID`, one `KeyDescriptor use="signing"`, `SingleLogoutService` (HTTP-Redirect only), and `AssertionConsumerService` for HTTP-POST (index 0, default) and HTTP-Artifact. It said `AuthnRequestsSigned="false"` and `WantAssertionsSigned="false"` while the requests were in fact signed, because the default `AuthenticateRequestSigningBehavior` is `IfIdpWantAuthnRequestsSigned`; set it to `Always` and `WantAssertionsSigned` explicitly if the IdP team reads the metadata. The IdP metadata (`/realms/lab/protocol/saml/descriptor`) has `WantAuthnRequestsSigned="true"`, the signing certificate, `SingleSignOnService` for POST, Redirect, SOAP and Artifact, `SingleLogoutService` for the same four, and four NameID formats. `LoadMetadata = true` makes the library fetch it and trust its signing keys; that is the trust anchor, so the metadata URL must be HTTPS in production and its key rollover handled (rotation of the IdP key was not measured; after I recreated Keycloak with a new key I restarted the SP).

### What the library rejects (measured)

Each row is a fresh login, then the captured Response is altered and POSTed to `/Saml2/Acs` as the browser would. Results with 2.11.1 on net10.0:

```text
0  untouched Response                                ACCEPTED (303, session cookie set, GET /me 200)
1  edit a Role value in the signed assertion         REJECTED InvalidSignatureException: Signature didn't verify. Have the contents been tampered with?
2  edit the NameID                                   REJECTED InvalidSignatureException (same)
3  strip every Signature                             REJECTED Saml2ResponseFailedValidationException: The SAML Response is not signed and contains unsigned Assertions.
4  strip only the Response signature (control)       ACCEPTED (the assertion's own signature is enough)
5  strip Response signature + edit the assertion     REJECTED InvalidSignatureException
6  XSW: forged assertion first, signed one second    REJECTED ...is not signed and contains unsigned Assertions
7  XSW: signed original moved into Extensions        REJECTED (same)
8  XSW: signed original nested in forged Advice      REJECTED (same)
9  forged assertion keeps the original ID            REJECTED (same)
10 forged assertion signed with an attacker's key    REJECTED InvalidSignatureException: The signature verified correctly with the key contained in the signature, but that key is not t[rusted]...
```

Row 4 is a control: a Response whose Response-level signature is gone but whose Assertion is signed is valid SAML, and the library accepts it. The wrapping rows are meaningful only if the altered document really does fool a weak verifier, so the harness also contains one (an authorization test of my own SP, never pointed at anything else). It checks "there is a valid `<Signature>` in the document" with `SignedXml.CheckSignature` and then reads the first `<Assertion>`, the classic mistake, on the document of row 6:

```text
naive: signature valid = True
naive: first Assertion NameID = bob@lab.test
naive: first Assertion Role   = app-admin,app-user
same document sent to the real SP              REJECTED ...is not signed and contains unsigned Assertions
```

The signature is genuine (it covers the second assertion by `ID`), the identity read is the attacker's. The library's defense is structural: every assertion must be signed (or the whole Response must be), so an unsigned extra assertion fails whatever else is valid. Row 10 shows the second half: the signature may verify against the certificate carried in `KeyInfo`, and it is still rejected because that key is not among the IdP's keys from the metadata. A `KeyInfo` is a hint, never trust. Cases 6 to 9 are the standard XSW shapes, not an exhaustive list: re-run them after every library upgrade, the November 2026 advisories show these libraries still get validation bugs. Every rejection above surfaced as an **HTTP 500** with the exception in the log, not a 4xx, so map it (exception handling around the ACS that logs the reason and returns a generic 400) or you page yourself on attacker traffic.

### Audience, InResponseTo, time window and replay

```text
Response for another SP (SP entityId changed)     REJECTED SecurityTokenInvalidAudienceException: IDX10214: Audience validation failed
Response 3 posted with the state cookie of request 4  REJECTED Saml2ResponseFailedValidationException: InResponseTo Id "id02158..." in received response does not match...
Response posted from another browser (no state)   REJECTED UnexpectedInResponseToException
IdP-initiated Response, default settings          REJECTED Unsolicited responses are not allowed for idp "http://localhost:6901/realms/lab"
IdP-initiated with AllowUnsolicitedAuthnResponse  ACCEPTED (303, session, /me 200)
same Response POSTed a second time                REJECTED SecurityTokenReplayDetectedException: IDX10228: The securityToken has previously been validated
same Response after restarting the SP process     ACCEPTED (session cookie set)
```

`Audience` and `InResponseTo` are on by default. Unsolicited (IdP-initiated) responses are off by default and turning them on removes the `InResponseTo` protection, which is why replay matters there. The replay rejection came from the library's in-memory `ITokenReplayCache` (`SPOptions.TokenReplayCache`): it fired even though `TokenValidationParametersTemplate.ValidateTokenReplay` was left at `false`, and it **forgot everything on restart**, so after a restart (and, by the same logic, on a second node that never saw the Response) a captured Response is accepted again until its `NotOnOrAfter` plus the skew. With a farm, give `SPOptions.TokenReplayCache` a shared implementation (Redis, a database) or keep IdP-initiated off. A solicited Response posted from a browser without the state cookie failed on `InResponseTo` first. `Destination` and `Recipient` checks were not measured (the altered values break the signature before any check can be isolated); read the library source before relying on them.

The time window: I set the Keycloak client's assertion lifespan to 10 s so `Conditions NotOnOrAfter` is issue + 10 s, then POSTed one captured Response per delay (each with its own state cookie):

```text
default skew (TokenValidationParametersTemplate.ClockSkew = 5 min)   +20s ACCEPTED   +300s ACCEPTED   +320s REJECTED
ClockSkew = 0                                                        +1s  ACCEPTED   +20s  REJECTED
```

The default 5-minute skew makes a 10-second assertion usable for about 310 seconds, and a Keycloak default of 60 s for about 6 minutes. Set `ClockSkew` to what your NTP actually guarantees (30 seconds is common); the replay cache entry should live at least that long.

### Single Logout

SP-initiated, measured end to end with the Redirect binding: `GET /logout` clears the app cookie and returns 303 to Keycloak with `SAMLRequest`, `RelayState`, `SigAlg` and `Signature`; the request is signed with the SP service certificate and carries the NameID and the `SessionIndex` the library kept in claims:

```xml
<saml2p:LogoutRequest ID="id29d48..." Destination="http://localhost:6901/realms/lab/protocol/saml">
  <saml2:Issuer>http://localhost:6900/Saml2</saml2:Issuer>
  <saml2:NameID Format="...emailAddress">alice@lab.test</saml2:NameID>
  <saml2p:SessionIndex>qPFJuQkB...</saml2p:SessionIndex>
</saml2p:LogoutRequest>
```

Keycloak answered 200 with an auto-post form whose `SAMLResponse` is a signed `LogoutResponse` with `StatusCode Success`; the SP accepted that POST at `/Saml2/Logout` (303 to `/`), `/me` then redirected to login again, and a new SP request with the same IdP browser got the Keycloak login form, so the IdP session had ended. It works, but only through the browser (front channel).

IdP-initiated logout did **not** work. I ended alice's sessions from the Keycloak admin API with the client set to back-channel logout. Keycloak posted a `LogoutRequest` to the SP (the lab needed `host.docker.internal` and the SP bound to all interfaces for this, a Docker-only artifact) and the SP threw:

```text
System.InvalidOperationException: Received a LogoutRequest from "http://localhost:6901/realms/lab" for SessionIndex "8aasz23D...::1b5aa595-...", but the current session has SessionIndex "".
GET /me with the old cookie afterwards: 200
```

A server-to-server POST has no cookie, so the handler cannot find the user's session and the cookie stays valid until it expires. To honor an IdP logout you need a server-side session store keyed by `SessionIndex` (`CookieAuthenticationOptions.SessionStore` or your own check in `OnValidatePrincipal`) and a way to revoke it; I did not build that (docs only). Until then treat SAML logout as "log out of my app, and ask the IdP to end its session", and keep the app session short. Sustainsys advertises only the Redirect binding for logout in its metadata; the POSTed `LogoutResponse` and the back-channel POSTed `LogoutRequest` both reached the handler with default settings. `Compatibility.EnableLogoutOverPost` also exists (not exercised).

### Who owns what

The IdP owns authentication and MFA ([MFA with TOTP](mfa-totp-and-recovery-codes-with-aspnet-core-identity) belongs to it, not to this SP). The SP owns validation, the session and authorization. If the app is going to speak OpenID Connect too, put a broker in front and give the app one protocol ([OpenID Connect, Entra ID and BFF](openid-connect-entra-id-and-bff), [choosing a federation protocol](/identity-concepts/choosing-a-federation-protocol-saml-oidc-kerberos-and-ldap)). For APIs behind the session, tokens from [JWT bearer](jwt-bearer-and-aspnet-core-identity) or an [authorization server](building-an-authorization-server-with-openiddict) are the usual follow-up; SAML assertions are not API tokens.

## Trade-offs

- **Library choice.** Sustainsys fits the ASP.NET Core pipeline and is MIT, but 2.x is in security-only mode, targets `net8.0`, and v3 has an unfinished open-core plan. ITfoxtec is active and targets net10 and net11, but you write and secure the endpoints. A broker removes the library from your app and adds a service to run.
- **Pin and watch advisories.** Four advisories landed on 2026-11-16 (two high). Subscribe to the repository's advisories, pin at least 2.11.1, and re-run the tamper table (wrapping, unsigned, wrong key, replay) as an integration test after each upgrade.
- **Signature policy.** Row 4 shows the library accepts a Response signed only at the assertion level, which is valid SAML. Know which of the two your IdP signs, and keep the unsigned-assertion rows of the tamper table as a regression test.
- **Clock skew.** The 5-minute default turns a 60-second assertion into a 6-minute one. Lower it to your real clock accuracy; too low breaks logins on drifting hosts.
- **Replay cache.** In memory, so per process: restart or a second node accepts a replay. Share it, or accept IdP-initiated only if you can.
- **IdP-initiated SSO.** Convenient for portals, but there is no `InResponseTo` and no state cookie. Leave `AllowUnsolicitedAuthnResponse` off unless a customer demands it.
- **Logout.** Front-channel SP-initiated logout worked; back-channel IdP logout did not end the app session. A stateless cookie cannot be revoked remotely: shorten the session or add a server-side store.
- **Errors as 500.** Every validation failure is an unhandled exception. Handle it, log the reason server side, return a generic 400 or a login page to the user.
- **Attribute trust.** Map a whitelist of attributes to claims. Unfiltered `Role` attributes brought `offline_access` and `manage-account` into the principal and bloated the cookie.
- **Lab limits.** One IdP (Keycloak), HTTP on localhost, one library, one platform. Entra ID, ADFS, Okta and encrypted assertions were not run, and neither was IdP key rollover or a multi-node farm.

## Documentation Links

- [Authentication handlers in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/) (doc)
- [Use cookie authentication without ASP.NET Core Identity, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie) (doc)
- [WS-Federation authentication in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/ws-federation) (doc)
- [ASP.NET Core Data Protection overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction) (doc)
- [ASP.NET Core handler, Sustainsys.Saml2 documentation](https://saml2.sustainsys.com/en/v2/asp.net-core.html) (doc)
- [Configuration in code, Sustainsys.Saml2 documentation](https://saml2.sustainsys.com/en/v2/code-configuration.html) (doc)
- [Sustainsys.Saml2 repository, README and SECURITY.md, GitHub](https://github.com/Sustainsys/Saml2) (doc)
- [Sustainsys.Saml2 security advisories, GitHub](https://github.com/Sustainsys/Saml2/security/advisories) (doc)
- [ITfoxtec.Identity.Saml2 repository, GitHub](https://github.com/ITfoxtec/ITfoxtec.Identity.Saml2) (doc)
- [SAML 2.0 in IdentityServer, Duende documentation](https://docs.duendesoftware.com/identityserver/saml/) (doc)
- [SAML 2.0 external provider, Duende documentation](https://docs.duendesoftware.com/identityserver/ui/login/saml-provider/) (doc)
- [SAML Security Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html) (doc)
- [Assertions and Protocols for SAML V2.0, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf) (doc)
- [Bindings for SAML V2.0, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf) (doc)
- [Profiles for SAML V2.0, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf) (doc)
- [Metadata for SAML V2.0, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-metadata-2.0-os.pdf) (doc)
- [XML Signature Syntax and Processing Version 1.1, W3C](https://www.w3.org/TR/xmldsig-core1/) (doc)
- [Server Administration Guide, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [SAML protocol reference, Microsoft Entra ID, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/saml-protocol-reference) (doc)
