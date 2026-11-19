---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

LDAP, Kerberos, SAML, OIDC and SCIM each answer a different question, and most real systems use three of them at once. This lesson is the decision layer over the protocol lessons of this track: a matrix of when to pick which, then the pattern that makes mixing them survivable, identity brokering. Three Keycloak containers on one Docker network are measured: a hub realm that stores no passwords and delegates to one upstream over OIDC and another over SAML. The app sees a single OIDC token whatever the upstream was. Measured: the wire flow, claim mapping from both upstreams, `kc_idp_hint`, home realm discovery by e-mail domain, the first-login account-linking takeover (and which setting closes it), and what logout does to the sessions on each side. B2B, B2C, workforce and inter-organization patterns are prose, with the Entra docs read only.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`, three containers of 500 to 650 MiB each, Docker VM with 7.7 GiB), curl 8.7.1, jq 1.7.1, Python 3 for decoding, `javap` on the Keycloak jar (JDK 25).

## Use Cases

- Picking the protocol for a new integration without defaulting to whatever the last project used.
- Giving one app a single login contract while customers bring Entra, Okta, Google or a SAML-only partner IdP.
- Reviewing a "link accounts by e-mail" setting before it becomes an account-takeover path.
- Planning a SAML to OIDC migration where both must coexist for a year.

## Deep Dive

### What each protocol is for

Read the five by the question they answer, not by age. **LDAP**: where the identities live and how a bind checks a password; it is a directory, not SSO. **Kerberos**: passwordless SSO inside a domain, via tickets, for clients that can talk to the KDC. **SAML 2.0**: browser SSO between organizations over signed XML. **OIDC (on OAuth 2.0)**: the same job with JSON, JWT and plain HTTPS, plus APIs, mobile and SPAs. **SCIM**: not login at all, the provisioning channel that creates and disables the accounts the other four authenticate. The tempting error is comparing them as alternatives; LDAP or Kerberos usually sits behind an IdP, and the IdP speaks SAML or OIDC to the apps.

### Decision matrix

| Criterion | LDAP | Kerberos | SAML 2.0 | OIDC / OAuth 2.0 | SCIM 2.0 |
|---|---|---|---|---|---|
| Client type | any process that can bind | domain-joined OS, GSSAPI libraries | browser only | browser, SPA, native, service | server to server |
| Where it runs | intranet | intranet or VPN to the KDC | internet, B2B | internet and intranet | internet |
| Who is the IdP | the directory itself | the KDC (often Active Directory) | enterprise or university IdP | Keycloak, Entra, Okta, Google | the IdP is the client |
| Partner requires it | legacy apps | Windows shops | many SaaS, public sector | most new SaaS | enterprise tiers |
| Logout | none (connection close) | ticket lifetime only | SLO, fragile | RP-initiated, back-channel | deprovision, `active:false` |
| Attributes | schema entries | PAC (AD groups) | `AttributeStatement` | ID token, UserInfo | full resource model |
| Integration cost | low, but the app handles passwords | high (SPNs, keytabs, clock) | medium to high (XML, metadata) | low to medium | medium (endpoint plus mapping) |
| Attack surface | password in the app, injection | Kerberoasting, delegation | XML wrapping, replay | redirect, PKCE, token theft | privilege escalation by API |
| Library maturity | very high | high, platform-bound | uneven, patch often | high, widely audited | uneven |

Decide in this order: (1) the partner's hard requirement (SaaS that speaks only SAML ends the debate for that edge); (2) the client (a SPA or mobile app cannot do SAML or Kerberos well); (3) the network (Kerberos needs line of sight to the KDC); (4) who owns identity (do not make the app a password store); (5) logout and attribute needs. When two edges disagree, put a broker between them instead of picking one for the whole company.

### The lab: a hub that stores nobody (measured)

One Docker network `idn-fed-net`, three containers named for their role, each published on its own port: `idn-fed-hub` (6620), `idn-fed-idp-oidc` (6621, realm `acme`, user `alice`, `alice@acme.example`, attributes `department=finance`, `groups=[approvers, staff]`) and `idn-fed-idp-saml` (6622, realm `partner`, user `carol`, `carol@partner.example`, `orgUnit=legal`, `memberOf=[contracts, reviewers]`). `KC_HOSTNAME=http://idn-fed-<name>:<port>` plus `curl --resolve` makes the browser-facing and server-to-server URLs identical, so no host tricks. Three Keycloaks fit on this Mac without trouble: 577, 633 and 497 MiB resident. On a small machine run the hub plus one upstream at a time; the flows below do not change.

The hub realm is created empty. Each upstream is added from its own metadata, so the endpoints and keys are never typed:

```text
POST /admin/realms/hub/identity-provider/import-config {"providerId":"oidc","fromUrl":".../realms/acme/.well-known/openid-configuration"}
  -> authorizationUrl, tokenUrl, jwksUrl, userInfoUrl, issuer, logoutUrl
POST /admin/realms/hub/identity-provider/import-config {"providerId":"saml","fromUrl":".../realms/partner/protocol/saml/descriptor"}
  -> singleSignOnServiceUrl, singleLogoutServiceUrl, signingCertificate, idpEntityId
POST /admin/realms/hub/identity-provider/instances  (alias acme-oidc / partner-saml, config = imported + clientId, secret, PKCE S256)
```

The imported SAML defaults needed three corrections, each a real failure first: `wantAuthnRequestsSigned` came back `true` from the descriptor (the hub does not sign), the NameID format was `persistent` (opaque id as username; switched to `emailAddress`), and the upstream sent no `firstName`/`lastName`, so the hub's first login stopped on an "Update Account Information" form until both were mapped.

### What the app sees: one protocol (measured)

The app is a single confidential OIDC client `app` at the hub, authorization code with PKCE. With `kc_idp_hint=acme-oidc` the hub redirects the browser upstream, and the app only ever talks to the hub:

```text
303 GET hub/realms/hub/protocol/openid-connect/auth?...&kc_idp_hint=acme-oidc
303 GET hub/realms/hub/broker/acme-oidc/login
200 GET idp-oidc/realms/acme/protocol/openid-connect/auth      (the upstream login form)
302 POST idp-oidc/realms/acme/login-actions/authenticate
302 GET hub/realms/hub/broker/acme-oidc/endpoint               (upstream code redeemed server to server)
302 GET hub/realms/hub/login-actions/first-broker-login        (shadow user created)
302 GET hub/realms/hub/broker/after-first-broker-login  -> http://localhost:6623/callback?code=...
```

The hub's request to the OIDC upstream is itself a code flow with its own `state`, `nonce` and `code_challenge` (`S256`): the hub is an OIDC client of `acme` and an OIDC server for `app` at the same time. For the SAML upstream the hop is an HTML form posted to `.../protocol/saml`, and the decoded `AuthnRequest` is short: `Issuer` = `http://idn-fed-hub:6620/realms/hub`, `AssertionConsumerServiceURL` = the hub's `/broker/partner-saml/endpoint`, `ProtocolBinding` = HTTP-POST, `NameIDPolicy` = `emailAddress`. The `Response` carried the signed assertion and the hub validated it against the certificate pinned from the descriptor (details in the SAML lesson). What the app receives after redeeming its own code:

```text
alice  via OIDC: {"iss":"http://idn-fed-hub:6620/realms/hub","aud":"app","sub":"a94367a8-...","preferred_username":"alice",
                  "email":"alice@acme.example","email_verified":false,"dept":"finance","groups":["approvers","staff"],
                  "source":"acme","identity_provider":"acme-oidc"}
carol  via SAML: {"iss":"http://idn-fed-hub:6620/realms/hub","aud":"app","sub":"624133cc-...","preferred_username":"carol@partner.example",
                  "email":"carol@partner.example","email_verified":false,"dept":"legal","groups":["contracts","reviewers"],
                  "source":"partner","identity_provider":"partner-saml"}
```

Same issuer, same signing keys, same claim names, different upstream protocols. The `sub` is the hub's own id, not the upstream's, and the hub realm now holds two users with no password. `GET /users/{id}/federated-identity` shows the link: `acme-oidc` with userId `f53ea021-...` (upstream `sub`) and `partner-saml` with userId `carol@partner.example` (the NameID). The app keys users by (`iss` of the hub, `sub`) and never learns what Acme or the partner use. `email_verified` is `false` for both because `trustEmail` is off on both upstreams, which is the safe default and matters in the linking section.

### Claim mapping: identity provider mappers (measured)

Normalization happens in two hops, both configuration. Upstream to hub, an IdP mapper per attribute; hub to app, a protocol mapper on the client:

| App claim | From OIDC upstream (`acme`) | From SAML upstream (`partner`) | Hub mapper type |
|---|---|---|---|
| `dept` | claim `dept` | attribute `OrgUnit` | `oidc-user-attribute-idp-mapper` / `saml-user-attribute-idp-mapper` to user attribute `department` |
| `groups` | claim `groups` (array) | attribute `MemberOf` (2 `AttributeValue`) | same, to multivalued attribute `groups` |
| `source` | constant `acme` | constant `partner` | `hardcoded-attribute-idp-mapper` |
| `identity_provider` | none | none | session note mapper on the `app` client |
| name, e-mail | standard claims | `firstName`, `lastName`, `email` attributes | built in, plus two SAML mappers added |

Two traps measured here. The SAML IdP also emitted six `Role` attributes (the default realm roles of the upstream, e.g. `uma_authorization`, `offline_access`): an IdP mapper that copied `Role` blindly would hand the partner's internal roles to the hub, so map only what you named. And an IdP mapper has a sync mode: `IMPORT` copies at first login, `INHERIT` follows the realm default, `FORCE` rewrites on every login. For group-driven access use `FORCE`, otherwise a user removed from `approvers` upstream keeps it at the hub until someone notices.

### kc_idp_hint and home realm discovery (measured)

Without a hint the hub login page lists both upstream buttons (`id="social-acme-oidc"`, `id="social-partner-saml"`). That is fine for two partners and wrong for 200. Two mechanisms pick the upstream for the user:

- **`kc_idp_hint=<alias>`** on the authorization request, set by the app that already knows the tenant (a subdomain, a path, an invite). It is an authorize-request parameter, so a client can only skip the hub chooser, never force a choice the hub refuses.
- **Home realm discovery (HRD) by e-mail domain**: the user types an address and the hub decides. In Keycloak 26 this is the Organizations feature: one organization per customer, a domain, a linked IdP, and auto-redirect. The rule is data, set through the admin API (`PUT /organizations/{id}` with `domains:[{name, verified:true, identityProviderAlias, autoRedirect:true}]`, plus `POST /organizations/{id}/identity-providers`). The browser flow's "Organization Identity-First Login" then asks for the address first. Measured, by posting the username to the first form:

```text
alice@acme.example      -> 303 Location: .../broker/acme-oidc/login          (OIDC upstream)
carol@partner.example   -> 303 Location: .../broker/partner-saml/login       (SAML upstream)
dave@other.example      -> 200, the password form (no organization matches, local login)
```

Two lessons from getting it to work. Domain and IdP link alone did nothing: until the domain row carried `identityProviderAlias` and `autoRedirect:true` the identity-first form kept asking for a password, so a half-configured HRD fails open into local login. And the domain is a routing key, not proof of ownership: the app that picks the IdP by `@acme.example` must also require the IdP to be allowed to assert that domain (the "domain gate" in the Keycloak docs), or a tenant can claim someone else's addresses.

### First broker login and account linking (measured)

The first time a federated identity arrives, the hub runs the **first broker login flow**: review the profile, then either create a new local user or link to an existing one. The question is what proves that "this upstream identity is the same person as that existing hub account". E-mail is the tempting, unsafe answer. Setup: the hub already has a local user `bob` (`bob@hub.example`, department `treasury`). In the `acme` upstream, anyone can register, and `mallory` registered with e-mail `bob@hub.example`, never verified: the upstream token carries `"email":"bob@hub.example","email_verified":false`. Mallory authenticates upstream with her own password and arrives at the hub. Each row below is a real run, with the federated link removed between runs:

| Hub first login flow | `trustEmail` | Upstream `email_verified` | Result |
|---|---|---|---|
| default (`first broker login`) | off | false | "Account already exists" page; "Add to existing account" asks for **bob's password** (re-authentication). No takeover |
| default, SMTP configured | off | false | "Verify existing account by e-mail" fires; with a dead SMTP host: "Failed to send email". Still no takeover |
| custom: Create User If Unique + Automatically Set Existing User | off | false | refused, generic "Invalid username or password", event `IDENTITY_PROVIDER_FIRST_LOGIN_ERROR` |
| same custom flow | **on** | false | **takeover**: token `sub` = bob's id, `preferred_username` bob, `dept` treasury |
| same custom flow | off | **true** | **takeover**, same token |
| same custom flow | on | true | **takeover**, same token |

Mallory ends up holding a token for bob: same `sub`, bob's attributes, `email_verified:true`, and the app has no way to see the difference. Two findings correct common beliefs. First, `trustEmail` overrides an upstream that says the address is unverified (row 4); the Keycloak guide says the claim is honored, but on 26.8.2 the auto-link guard let it through. Second, the guard exists and is narrow: reading `IdpAutoLinkAuthenticator` in the 26.8.2 jar with `javap` shows three refusals (email or username edited in review profile, broker e-mail not equal to the existing user's, neither trusted nor verified) and nothing about who controls the upstream. With a Review Profile step placed before auto-link the same attack was refused; I did not isolate why, so do not rely on it.

The defense is structural, not a flag:

1. Keep the default flow (re-authenticate with the existing account's credentials, or verify by e-mail through a working SMTP) for any upstream whose users can pick their own address.
2. Use Automatically Set Existing User only on a flow bound to an upstream you control and whose address assertions you trust (your own corporate IdP), never on open registration or on a tenant-admin-editable e-mail. Per-IdP flows make this a property of the IdP, not the realm.
3. Link on the immutable pair (`iss`, `sub`). Entra's claims reference says the `email` claim is mutable and must never be used for authorization (docs only, Microsoft Learn).
4. Never set `trustEmail` on an upstream that accepts unverified addresses; turn on mapper `FORCE` only for claims the upstream owns.

### Logout across the hub and the upstream (measured)

Two sessions exist: the hub's and each upstream's. App to hub is the OIDC lesson's RP-initiated logout; the hub then has to reach the upstream. Hub logout with `id_token_hint`, from a browser jar:

```text
OIDC upstream:  302 hub logout -> 302 idp-oidc/.../openid-connect/logout -> 302 hub/.../broker/acme-oidc/endpoint/logout_response -> app
                upstream sessions for alice 1 -> 0, hub prompt=none -> login_required
SAML upstream:  200 hub logout (HTML form) -> POST SAMLRequest (LogoutRequest) to idp-saml/protocol/saml -> POST SAMLResponse to hub -> app
                upstream sessions for carol 1 -> 0, hub prompt=none -> login_required
```

The hub, an OIDC provider for the app, becomes an RP-initiated-logout client toward `acme` and a SAML SP issuing a `LogoutRequest` toward `partner`. Two details bit: the upstream rejected the hub's `post_logout_redirect_uri` with "Invalid redirect uri" until the upstream client registered `.../broker/acme-oidc/endpoint/logout_response`, and the chain is browser-mediated, so it only completes if the browser carries all three sessions' cookies. The reverse direction is the weak edge: ending the upstream session directly (admin logout) left the hub's session count at 1, and a hub refresh token still refreshed (`expires_in` 300) because no back-channel logout was configured from `acme` to the hub. Ending the upstream session never revokes what the hub already issued. Back-channel logout and token lifetimes are in the OIDC lesson; the session model is I18.

### Architecture patterns (prose, not measured)

- **Workforce.** One corporate IdP (Entra, Okta, Keycloak), every internal and SaaS app behind it by OIDC or SAML, joiners and leavers by SCIM, Kerberos or LDAP kept only for the Windows and legacy tail behind that IdP. The goal is that an HR termination ends access in one place.
- **B2B (customers' employees).** One tenant of your product per customer organization, each with its own upstream (the customer's IdP) and its own domain: exactly the organization and HRD model above. Per-tenant claim mapping, per-tenant `hint`. Entra's B2B and External ID documentation (docs only) cover the Microsoft variant where the guest stays in the customer's directory. The hard parts are onboarding (a metadata exchange per customer) and tenant isolation in authorization, not the login.
- **B2C and CIAM (consumers).** The identity is yours: password plus passkeys, social login as federated upstreams, adaptive MFA on risk signals, consent and privacy (GDPR, deletion, preference centers). Account linking is the central risk, so the previous section applies at scale; recovery is the weak link (I19). Passkeys are the factor to lead with (see the WebAuthn and passkeys lesson of this track).
- **Federation between organizations.** Universities and research networks (InCommon, eduGAIN) run thousands of SAML IdPs and SPs by publishing signed metadata aggregates that each side consumes. Nobody exchanges certificates by hand; the trust is the federation operator's signature on the aggregate. Cited, not measured here.
- **Gateways and BFF.** Put the protocol in one place (a gateway, a BFF, the hub) and give the application a session cookie or a single token format. The app then changes IdPs without redeploying. Spring and .NET implementations are in the related concepts.
- **Migrating SAML to OIDC.** Do not flip a switch per app. Put the hub in front, point each app at it with OIDC while the legacy SAML upstream keeps working behind it (that is the lab above, with `partner` as the SAML IdP), move apps one at a time, then replace the upstream protocol when the partner is ready. The hub is the translator, so apps migrate on their schedule and the partner migrates on theirs. Cost: the hub is now critical infrastructure and its claim mapping is a contract to test.

### The book versus today

Older texts present SAML as "the enterprise SSO" and OIDC as the consumer alternative. Today: new applications start with OIDC with PKCE; SAML survives because enterprise IdPs, SaaS catalogs and federations standardized on it and migrations are slow; Kerberos and LDAP persist inside Windows estates and directories, but as backends behind an IdP, not as protocols exposed to new web apps; NTLM is a fallback to be removed. SCIM has become the lifecycle standard for B2B SaaS. Passwords are giving way to passkeys as the primary factor, and a passkey changes the login step, not the federation protocol around it.

### Decision table

| Scenario | Recommended protocol | Why | Pitfall |
|---|---|---|---|
| New web app, customers log in with their own IdP | OIDC through a hub, HRD by domain | one contract for the app, any upstream | trusting e-mail to link accounts |
| SPA or mobile app | OIDC code with PKCE, via BFF for SPAs | native support, no XML | tokens in browser storage |
| SaaS partner that only speaks SAML | SAML at that edge, a hub behind it | partner's requirement wins | `Destination`/`Recipient` unchecked, XSW |
| Windows intranet app, domain-joined users | Kerberos (Negotiate), or OIDC from the AD-backed IdP | passwordless, no prompt | SPN and keytab drift, clock skew |
| Legacy app that must check passwords | LDAP bind to the directory, LDAPS | smallest change | the app now handles passwords, injection |
| Service-to-service API | OAuth client credentials, or workload identity (I17) | no user involved | long-lived shared secrets |
| Customer wants automatic offboarding | SCIM 2.0 from their IdP | account lifecycle, not login | deprovisioning that only blocks login |
| Consumers, public sign-up | own IdP with passkeys plus social upstreams | you own the lifecycle | recovery and linking abuse |
| Academic federation | SAML with federation metadata | the community runs on it | stale metadata, entity attributes |

### Where to go next

Provisioning is the other half of federation: SCIM 2.0 (I16) creates and disables the accounts that the hub now logs in. What a signed-in user may do is authorization (I15), and mapped groups and roles are inputs to it, not decisions. Session, refresh rotation and revocation across hub, app and upstream is I18.

## Trade-offs

- **Hub versus direct integration.** A hub gives apps one protocol and lets IdPs change without app work (measured). It is also a single point of failure, a claim-mapping contract to test, and an extra session to log out. One IdP and a few apps rarely justify it; many tenants or mixed protocols do.
- **HRD by e-mail domain versus an explicit hint.** HRD needs no app knowledge but fails open to local login when a domain is mapped wrong (measured). `kc_idp_hint` is exact but only works when the app knows the tenant. Use both: a hint when known, HRD otherwise.
- **Auto-linking versus asking.** Automatic linking is seamless and, with an upstream that does not control its e-mails, a takeover (measured, three of six rows). Asking for the existing credentials adds a click once and is safe.
- **Mapped claims versus raw upstream claims.** Mapping gives the app a stable contract; copying upstream attributes blindly imports their internal roles (six `Role` values measured). Map only what the app needs, and prefer `FORCE` sync for authorization-relevant attributes.
- **Back-channel logout versus short sessions.** Chaining logout through the browser is brittle; killing the upstream session left the hub session alive (measured). Short hub sessions are blunt but reliable.

## Documentation Links

- [Server Administration Guide: identity brokering, first login flow, organizations, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [Securing applications and services with OpenID Connect, Keycloak](https://www.keycloak.org/securing-apps/oidc-layers) (doc)
- [OpenID Connect Core 1.0 incorporating errata set 2, OpenID Foundation](https://openid.net/specs/openid-connect-core-1_0.html) (doc)
- [OpenID Connect Back-Channel Logout 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-backchannel-1_0.html) (doc)
- [SAML Core 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf) (doc)
- [RFC 9700, Best Current Practice for OAuth 2.0 Security, IETF](https://www.rfc-editor.org/rfc/rfc9700) (doc)
- [RFC 7644, SCIM Protocol, IETF](https://www.rfc-editor.org/rfc/rfc7644) (doc)
- [RFC 4120, The Kerberos Network Authentication Service (V5), IETF](https://www.rfc-editor.org/rfc/rfc4120) (doc)
- [RFC 4511, Lightweight Directory Access Protocol (LDAP): The Protocol, IETF](https://www.rfc-editor.org/rfc/rfc4511) (doc)
- [NIST SP 800-63C Digital Identity Guidelines: Federation and Assertions, NIST](https://pages.nist.gov/800-63-4/sp800-63c.html) (doc)
- [Microsoft Entra External ID overview, Microsoft Learn](https://learn.microsoft.com/en-us/entra/external-id/external-identities-overview) (doc)
- [B2B collaboration overview, Microsoft Entra External ID, Microsoft Learn](https://learn.microsoft.com/en-us/entra/external-id/what-is-b2b) (doc)
- [Secure applications and APIs by validating claims, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation) (doc)
- [ID token claims reference, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference) (doc)
