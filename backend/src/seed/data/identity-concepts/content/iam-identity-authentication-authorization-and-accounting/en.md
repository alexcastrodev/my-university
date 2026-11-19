---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Identity and access management (IAM) answers four questions on every request:
who is this (identity), can they prove it (authentication), may they do this
(authorization), and what did they do (accounting). Every protocol in this
track, from MFA to OAuth, OIDC, SAML, LDAP and Kerberos, is one answer to one
of those questions. This lesson builds the map: the four A's run end to end in
a 58-line server, a JWT and a session cookie decoded byte by byte, an LDAP
directory answering "who is alice", then the roles (IdP, SP/RP, PEP, PDP), the
lifecycle, least privilege, Zero Trust, and which protocol solves what. Code is
Node 22 with no packages, because the point is the wire, not a framework.
Versions: Node 22.23.4, OpenSSL 4.0.3, curl, jq 1.7.1, the
`osixia/openldap:1.5.0` image with the macOS `ldapsearch` 2.4.28 client.

## Use Cases

- Reading a login or access bug and knowing which layer failed: 401 or 403.
- Choosing between a session cookie and a self-contained token for an API.
- Placing an IdP, an app and a policy engine on an architecture diagram.
- Recognizing SAML, LDAP or Kerberos in an enterprise and what replaces them.

## Deep Dive

### Four questions, four failures

| Question | Name | Failure | HTTP |
|---|---|---|---|
| Who claims to be here? | Identification | unknown subject | 401 |
| Can they prove it? | Authentication | bad credential | 401 |
| May they do this? | Authorization | policy says no | 403 |
| What happened? | Accounting (audit) | no evidence later | none |

An identity is a set of attributes about a subject (a person, a service, a
device) held by an identity store. An account is that identity inside one
system. Authentication binds a request to an identity; authorization decides
using that identity plus the action and the resource. The classic AAA
framework (RFC 2904, RADIUS and Diameter era) names the third A "accounting";
in application security it is the audit log. 401 means "I do not know who you
are", 403 means "I know, and the answer is no": mixing them up hides which
layer broke.

### The four A's in one server (measured)

One Node 22 file, no dependencies. Passwords are hashed with scrypt, a login
creates a random session id stored on the server, a PDP function decides, the
PEP calls it and writes one audit line per decision. The core:

```js
// PDP: a pure function of subject, action and resource. It knows nothing about HTTP.
function decide(user, action, report) {
  if (!report) return { allow: false, reason: 'no such resource' };
  if (action === 'read' && user.roles.some((r) => r === 'viewer' || r === 'editor'))
    return { allow: true, reason: 'role can read' };
  if (action === 'write' && user.roles.includes('editor') && user.dept === report.dept)
    return { allow: true, reason: 'editor of same dept' };
  return { allow: false, reason: `no rule allows ${action}` };
}
// PEP: intercept, ask, enforce, log
const d = decide(users[sub], action, reports[id]);
audit({ event: 'access', sub, action, resource: `report:${id}`,
        decision: d.allow ? 'permit' : 'deny', reason: d.reason });
return d.allow ? send(200, `${action} report ${id} ok`) : send(403, 'forbidden');
```

alice is an `editor` in `sales`, bob a `viewer` in `support`; report 7 belongs
to sales, report 9 to finance. Driven with curl:

```text
anonymous GET /reports/7      -> 401
alice, wrong password         -> 401
HTTP/1.1 204 No Content
Set-Cookie: sid=w0K7ID57akwEYMaqxuASs3xKUTWzdBCr3DtDmobhQ2Q; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600
alice GET /reports/7          -> 200
alice PUT /reports/7 (sales)  -> 200
alice PUT /reports/9 (finance)-> 403
bob   PUT /reports/7          -> 403
```

The audit trail the PEP and the login wrote (stdout, one JSON per line; the
second alice login and bob's login are cut here):

```text
{"ts":"2026-11-19T00:34:21.872Z","event":"login","sub":"alice","outcome":"failure","ip":"::1"}
{"ts":"2026-11-19T00:34:21.900Z","event":"login","sub":"alice","outcome":"success","ip":"::1"}
{"ts":"2026-11-19T00:34:21.960Z","event":"access","sub":"alice","action":"read","resource":"report:7","decision":"permit","reason":"role can read"}
{"ts":"2026-11-19T00:34:21.966Z","event":"access","sub":"alice","action":"write","resource":"report:7","decision":"permit","reason":"editor of same dept"}
{"ts":"2026-11-19T00:34:21.972Z","event":"access","sub":"alice","action":"write","resource":"report:9","decision":"deny","reason":"no rule allows write"}
{"ts":"2026-11-19T00:34:21.978Z","event":"access","sub":"bob","action":"write","resource":"report:7","decision":"deny","reason":"no rule allows write"}
```

The same role (`editor`) got 200 on one report and 403 on another: the rule
reads an attribute of the resource, which plain role checks cannot express
(Authorization Models covers RBAC versus ABAC versus ReBAC). Denials are logged
too: a failed login followed by a success is exactly what a credential-stuffing
detector looks for.

### Session cookie versus JWT, decoded (measured)

The `sid` above is 43 base64url characters: 32 random bytes (`c342 bb20 3e7b
6a4c ...`), a reference to state the server keeps. Logout deletes the entry.

The same server issues a JWT for an API at `/token`, signed with RS256. Split
on the dots and base64url-decode each part:

```text
parts: 56 + 158 + 342 chars
{"alg":"RS256","typ":"JWT","kid":"demo-1"}
{"iss":"http://localhost:6081","sub":"alice","aud":"reports-api","roles":["editor"],"iat":1795048461,"exp":1795048761}
signature bytes: 256
Verified OK
```

`Verified OK` is `openssl dgst -sha256 -verify pub.pem -signature sig.bin` over
`header.payload`; with the payload changed to `"roles":["admin"]` it prints
`Verification failure`. The payload is readable by any holder (signed, not
encrypted), tamper-evident, and verifiable without calling the issuer. The
price: it stays valid until `exp` even after logout.

| | Session cookie | JWT access token |
|---|---|---|
| Content | random id | claims + signature |
| Validation | server lookup | signature + `exp`, `aud`, `iss` |
| Revocation | delete the row | wait for `exp` or keep a deny list |
| Best for | browser to its own backend | API called by many clients |

### Roles in a federated login

- **IdP (identity provider)**: authenticates the user and issues assertions or
  tokens. Keycloak, Microsoft Entra ID, Okta, Auth0, Google.
- **SP (service provider, SAML) / RP (relying party, OIDC)**: the application
  that trusts the IdP instead of storing passwords.
- **Authorization server and resource server (OAuth)**: the first issues access
  tokens, the second (your API) validates them.
- **PEP (policy enforcement point)**: the code in the request path that blocks
  or allows: a middleware, a gateway, a sidecar.
- **PDP (policy decision point)**: answers permit or deny. In the server above
  it is a function; in production it can be OPA, Cedar, OpenFGA or SpiceDB.
  NIST SP 800-162 adds the PIP (attribute source) and the PAP (policy
  authoring). Kept apart from the PEP, the decision is testable data in, data out.

### A directory answering "who is alice" (measured)

LDAP is how enterprises store identities (OpenLDAP, Active Directory). Local
OpenLDAP in Docker, one user and one group, then the classic
"search, then bind" login that Spring and .NET LDAP providers perform:

```text
$ ldapsearch -x -LLL -H ldap://localhost:6089 -D cn=admin,dc=example,dc=org -w admin \
    -b dc=example,dc=org '(&(objectClass=inetOrgPerson)(uid=alice))' dn cn mail departmentNumber
dn: uid=alice,ou=people,dc=example,dc=org
cn: Alice Doe
mail: alice@example.org
departmentNumber: sales

$ ldapwhoami -x -H ldap://localhost:6089 -D uid=alice,ou=people,dc=example,dc=org -w 'correct horse'
dn:uid=alice,ou=people,dc=example,dc=org
$ ldapwhoami -x -H ldap://localhost:6089 -D uid=alice,ou=people,dc=example,dc=org -w 'nope'
ldap_bind: Invalid credentials (49)

$ ldapsearch ... -b ou=groups,dc=example,dc=org '(member=uid=alice,ou=people,dc=example,dc=org)' cn
dn: cn=editors,ou=groups,dc=example,dc=org
cn: editors
```

The service account finds the DN, the bind proves the password (authentication),
and the group lookup feeds roles to the PDP (authorization input). Searching as
alice herself returned `No such object (32)`: the image's default ACL hides the
tree from ordinary users, so apps search with a service account. Production uses
LDAPS or StartTLS: a simple bind over plain `ldap://` sends the password in clear.

### The identity lifecycle: joiner, mover, leaver

- **Joiner**: HR creates the person, the IdP creates the account, apps get it
  by provisioning (SCIM) or on first login (JIT).
- **Mover**: a department change must remove old access, not only add new.
  Skipping removal is privilege creep: after three moves, a user holds four
  jobs' worth of rights.
- **Leaver**: disable at the IdP, revoke sessions and refresh tokens, remove
  from every app that kept a local account. An unrevoked refresh token or a
  local password outlives the IdP account.

Access reviews (recertification) check periodically that all three happened.

### Least privilege and Zero Trust, in practice

Least privilege: each subject gets only the rights its task needs, for only as
long as it needs them. In practice: narrow OAuth scopes and audiences, roles
per job and not per person, no standing admin rights (just-in-time elevation),
service accounts per service. The Kubernetes concept on RBAC and least
privilege applies the same idea to a cluster.

Zero Trust (NIST SP 800-207, 2020) drops "inside the network means trusted".
Every request is authenticated and authorized on its own, using identity, device
state and context, through a PEP in front of each resource. Concretely: no VPN
as the access decision, mTLS or tokens between services, short-lived
credentials, phishing-resistant MFA, and logs on every decision. It is an
architecture, not a product you buy.

### Map of the protocols

| Protocol | Answers | Where you meet it | In this repo |
|---|---|---|---|
| Passwords + MFA (TOTP, WebAuthn/passkeys) | authentication | every login | next in this track |
| OAuth 2.0 | delegated authorization (tokens for APIs) | APIs, mobile, SPAs | Spring OAuth 2 Fundamentals and Grant Types; .NET JWT Bearer Tokens |
| OpenID Connect | authentication on top of OAuth (ID token) | "Sign in with...", SSO | .NET OpenID Connect, Entra ID and the BFF Pattern; Spring OAuth2 Client and SSO |
| SAML 2.0 | browser SSO with signed XML assertions | enterprise SaaS, universities | this track, Federation & SSO |
| LDAP / Active Directory | directory lookup and bind | corporate user stores | Spring Security JDBC and LDAP User Management |
| Kerberos | tickets for SSO inside a Windows or Unix domain | AD domains, Hadoop, databases | this track, Directory Services |
| SCIM 2.0 | provisioning (joiner, mover, leaver) | IdP to SaaS sync | this track, Provisioning & Lifecycle |

Book versus today: SAML, LDAP binds, Kerberos and NTLM still run most corporate
networks and are worth knowing well, but new applications integrate through
OIDC with an IdP that speaks the legacy protocols for them. SMS codes are
still common, but NIST SP 800-63-4 (July 2025) keeps them "restricted"; new
deployments choose passkeys or push with number matching.

### Where to go next

Spring and ASP.NET Core implementations live in the related concepts below.
Next in this track: passwords and credential attacks, then MFA factors (HOTP,
TOTP, push) measured against the RFC test vectors.

## Trade-offs

- **Session cookie versus JWT.** Cookies give instant revocation and keep
  claims private, but need shared session storage across instances. JWTs scale
  without a lookup, but logout does not end them; keep access tokens short
  (minutes) and pair them with revocable refresh tokens.
- **Central PDP versus checks in code.** An external engine (OPA, OpenFGA)
  gives one auditable policy for many services, at the cost of a network hop
  and a cache to invalidate. `if (user.isAdmin)` scattered in handlers is fast
  to write and impossible to review.
- **Federation versus local accounts.** An IdP gives SSO, MFA and one leaver
  switch, but becomes a single point of failure: plan break-glass accounts.
- **Audit detail versus privacy.** Log subject, action, resource, decision and
  reason; never log passwords, tokens or session ids (the demo logs none).
- **Least privilege versus friction.** Fine-grained roles multiply requests for
  access; just-in-time elevation with approval keeps the default narrow
  without blocking the on-call engineer.

## Documentation Links

- [SP 800-207, Zero Trust Architecture, NIST](https://csrc.nist.gov/pubs/sp/800/207/final) (doc)
- [SP 800-63-4, Digital Identity Guidelines, NIST](https://csrc.nist.gov/pubs/sp/800/63/4/final) (doc)
- [SP 800-162, Guide to Attribute Based Access Control, NIST](https://csrc.nist.gov/pubs/sp/800/162/upd2/final) (doc)
- [RFC 2904, AAA Authorization Framework, IETF](https://www.rfc-editor.org/rfc/rfc2904) (doc)
- [RFC 7519, JSON Web Token, IETF](https://www.rfc-editor.org/rfc/rfc7519) (doc)
- [RFC 6749, The OAuth 2.0 Authorization Framework, IETF](https://www.rfc-editor.org/rfc/rfc6749) (doc)
- [OpenID Connect Core 1.0, OpenID Foundation](https://openid.net/specs/openid-connect-core-1_0.html) (doc)
- [SAML V2.0 Technical Overview, OASIS](https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html) (doc)
- [RFC 4511, LDAP: The Protocol, IETF](https://www.rfc-editor.org/rfc/rfc4511) (doc)
- [Session Management Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) (doc)
- [Authorization Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (doc)
