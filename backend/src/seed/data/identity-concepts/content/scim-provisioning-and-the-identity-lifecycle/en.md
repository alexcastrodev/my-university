---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

SCIM 2.0 is the HTTP and JSON contract an identity source (an HR system, an IdP
such as Entra ID or Okta) uses to create, change and disable accounts inside
applications, so joiner, mover and leaver stop being tickets and CSV files. This
lesson builds a 200-line SCIM server in Node 22 (no framework, in memory) and
drives it with curl: discovery, create, filters, pagination, PUT against PATCH,
`active:false` against DELETE, the `scimType` errors, ETag, token rotation,
groups, a reconciler that finds orphan accounts, and the validations that keep
the endpoint from becoming a privilege-escalation API. Entra ID, Okta and
Keycloak are read from their official docs only (nothing run against them).
Versions: Node 22.23.4, curl, jq 1.7.1, RFC 7643 and RFC 7644 (September 2015).

## Use Cases

- Building the "SCIM endpoint" an enterprise customer asks for.
- Debugging an IdP that duplicates, loses attributes or never disables.

## Deep Dive

### Where SCIM sits

RFC 7643 defines the model (User, Group, extensions), RFC 7644 the protocol
(verbs, filters, PATCH, bulk, ETag), RFC 7642 the use cases. The IdP is the SCIM
client, the application the service provider. Signing in is OIDC or SAML; SCIM
only decides which accounts exist and what they carry. The server mounts
`/scim/v2` on port 6580.

### Discovery (measured)

```text
$ curl -s -H "$AUTH" $B/ServiceProviderConfig | jq -c '{patch,bulk,filter,etag,sort}'
{"patch":{"supported":true},"bulk":{"supported":false,...},"filter":{"supported":true,"maxResults":100},"etag":{"supported":true},"sort":{"supported":false}}
$ curl -s -H "$AUTH" $B/ResourceTypes | jq -c '.Resources[]|{id,endpoint}'
{"id":"User","endpoint":"/Users"}  {"id":"Group","endpoint":"/Groups"}   # User lists the enterprise extension
```

Every body names its `schemas`; attributes outside the core (enterprise
`department`, `manager`) live under their own URN key. Bulk (RFC 7644 section
3.7, many operations per request) is optional: this server says `supported:false`
and the Entra and Okta pages read here list no Bulk requirement.

### Create, read, uniqueness (measured)

```text
POST /Users {userName alice@example.org, externalId hr-1001, emails[work]} -> 201
  Location: http://localhost:6580/scim/v2/Users/a0b7435f-e49b-4675-a8af-1706f6a70f76
  ETag: W/"1"
POST /Users {userName ALICE@example.org} -> 409 {"scimType":"uniqueness","detail":"userName ALICE@example.org already exists"}
```

The server assigns `id` and fills `meta` (`created`, `lastModified`, `version`,
`location`). `userName` is unique and case-insensitive (RFC 7643: `caseExact`
false), so the upper-case duplicate is a 409. `externalId` is the client's own
key (the HR id), stored verbatim: matching by `externalId` and not by e-mail is
what survives a name change.

### Filters and pagination (measured)

```text
GET /Users?filter=userName eq "alice@example.org"            -> 200 totalResults 1
GET /Users?filter=userName sw "user" and externalId co "03"  -> 200 ["user3@example.org"]
GET /Users?filter=userName eq "nobody"                       -> 200 totalResults 0 (not 404)
GET /Users?filter=userName like "x"                          -> 400 invalidFilter
GET /Users?startIndex=1&count=2 -> totalResults 6, itemsPerPage 2 [alice, user1]
GET /Users?startIndex=5&count=2 -> [user4, user5]    startIndex=99 -> 200 itemsPerPage 0
```

`startIndex` is 1-based; `totalResults` counts all matches, `itemsPerPage` the
page. Zero matches is a 200 with an empty list: the IdP asks "does this user exist?"
and 0 means "create". My filter is 20 lines (`eq`, `co`, `sw`, `pr`, joined by
`and`); `or`, `not` and grouping are missing on purpose.

### PUT against PATCH (measured)

```text
PATCH replace emails[type eq "work"].value        -> emails [{alice.doe@example.org, work}]
PATCH add emails [{a@home.example, home}]         -> both emails (add appends)
PATCH replace (no path) {name, enterprise:{department:finance}} -> 200; "op":"Replace" -> 200
PATCH replace emails[type eq "work2"].value       -> 400 noTarget
PUT /Users/<id> {userName alice@example.org}      -> 200 {"emails":null,"name":null,"externalId":null}
```

A selector that matches nothing is `noTarget` (RFC 7644 section 3.5.2). PUT
replaces the whole resource: everything the body omits is gone, `externalId` and
the enterprise `department` included. An IdP that PUTs "the fields I mapped"
wipes the rest; the reconciler below found alice's lost department as drift.
Prefer PATCH, document PUT as a full replace, and support both pathless object
values and explicit paths, since clients differ.

### Errors, ETag and mutability (measured)

```text
PATCH replace active "False"  -> 400 invalidValue  "active must be a boolean"
POST  {id: 1111...}           -> 400 mutability    "id is readOnly"
PATCH {groups:[...]}          -> 400 mutability    "groups is readOnly"
GET -> ETag W/"7"; PATCH If-Match W/"1" -> 412 invalidVers; If-Match W/"7" -> 200, ETag W/"8"
GET /Users without a token    -> 401 + WWW-Authenticate: Bearer realm="scim"
```

Errors are `application/scim+json` with `schemas`, `status` (a string) and
`scimType` from a closed list (`invalidFilter`, `uniqueness`, `mutability`,
`invalidSyntax`, `invalidPath`, `noTarget`, `invalidValue`, `invalidVers`,
`sensitive`, `tooMany`). Clients branch on it: no retry on 400, reconcile on 409.
`meta.version` is a weak ETag; `If-Match` is an optimistic lock, so two syncs
cannot overwrite each other. It is optional and most IdPs skip it.

### Authenticating the endpoint

The IdP is the client, so this is a machine-to-machine API, usually a static
bearer token the admin pastes into the IdP. Mine accepts two at once (measured:
`Bearer tok-next` 200, `Bearer tok-old` rotated out 401). Rotation: add the new token, update the IdP, remove the old one (both work in
between, no outage). Scope it to SCIM only, keep it out of logs, require HTTPS.
It can create admins: treat it like a root key.

### Groups and the race between group and user

```text
POST /Groups {displayName sales} -> 201     PATCH add members [alice] -> 200; repeat -> still 1 (idempotent)
PATCH add members [ghost-id]     -> 400 invalidValue "member ghost-id does not exist"
```

`members[].value` is the user's SCIM `id`, not the userName. The race: an IdP that
pushes a group before its user exists gets `invalidValue`. The cure is order
(users first, then groups) plus retry on that error; conversely a DELETE of a
user must drop it from every group (the server does). RFC 7643 does not make
`displayName` unique, but Entra requires it (doc). If HR and an app admin both
edit membership, the next sync reverts one of them.

### Deprovisioning: active:false against DELETE (measured)

Two alice sessions are open (session table count 2). Then:
```text
PATCH replace active false -> 200 {"active":false}   sessions after: count 0
new SSO login of the disabled user -> 403
GET /Users?filter=active eq false -> [alice]          (record kept)
repeat PATCH active false -> 200 (idempotent)
DELETE /Users/<id> -> 204;  DELETE again -> 404;  GET -> 404
```

`active:false` is the soft delete: record, history and references stay, the
person cannot sign in. DELETE removes it; the second DELETE is a 404 a retrying
IdP must treat as success. Disabling is not enough: the `onDeactivate` hook also
killed the sessions, since a live session or refresh token still has access (see
the bridge). Also revoke API keys, reassign owned resources, apply retention to
personal data. The Entra doc says to return the user whether active or not.

### JIT provisioning against SCIM

JIT creates the account at the first SSO login from the token's claims. The toy
`/sso/login` does it for `bob@example.org`: no HR id, no `externalId`. It needs no
endpoint and no sync, but it never removes anyone: when the person leaves nobody
logs in, nobody tells the app, and the account stays active (orphan) with its
local data, password or API key. SCIM adds accounts before first login, attribute
and group updates, and the leaver signal. JIT as safety net, SCIM as lifecycle.

### Reconciliation: source against target (measured)

Events get lost (outage, quarantine, a manual edit). The reconciler pages the
target, matches by `externalId` and compares with HR, the source of truth: 6
people, `hr-2003` and `hr-2004` terminated. The target has alice disabled by
mistake, a dropped user1, `user5` (not in HR) and the JIT bob. Report, then
`--apply` (fixes the first six), then the report again:

```text
HR: 6  target: 6  findings: 8
  WRONGLY INACTIVE                         alice@example.org
  MISSING                                  user1@example.org
  DRIFT department (none) -> sales         user2@example.org
  LEAVER STILL ACTIVE                      user3@example.org
  LEAVER STILL ACTIVE                      user4@example.org
  MISSING                                  newbie@example.org
  ORPHAN (not in HR)                       user5@example.org
  ORPHAN (no externalId, JIT or manual)    bob@example.org
HR: 6  target: 8  findings: 2      (after --apply: only the two orphans remain)
```

The fixes reuse the SCIM calls. Orphans are only reported: disabling an account
HR does not know can be an outage (service accounts, contractors, break-glass),
so a human decides. Run it nightly and alert on orphans: the count measures how
much the event flow leaks.

### Security: SCIM is a privileged write API

```text
POST  {userName eve, isAdmin:true, roles:[admin]}  -> 400 invalidValue "unknown attribute isAdmin"
PATCH (no path) {roles:[{value:admin}]}            -> 400 invalidValue "unknown attribute roles"
PATCH add alice to group "admins"                  -> 403 "membership of admins is managed outside SCIM"
```

A token that can create users can create an admin, so the server decides what is
writable. Allow-list attributes (reject unknown keys; never copy the body into the
model, pathless PATCH included: mass assignment); never turn `roles` into privilege
without a decision; make privileged groups non-writable or approval-gated; validate
types; cap `count`; one audit line per change with the token identity; normalize
`userName` before the uniqueness check (case-variant duplicates are a takeover pattern).

### How real IdPs speak SCIM (docs only, not run)

- **Entra ID** (Microsoft Learn, page dated 2026-09-15): sends PATCH `op` as `Add`,
  `Replace`, `Remove`, so do not match case-sensitively. Deprovisioning is PATCH
  `Replace`, `path: "active"`, `value: false`. It matches users on `userName` or
  `externalId`, groups on `displayName`, and uses only `eq` and `and` in filters.
  Bearer token, HTTPS, `/Schemas` expected; groups optional but need PATCH;
  entitlements unsupported. A SCIM Validator tool tests an endpoint.
- **Okta** (developer.okta.com): SCIM 2.0 and 1.1, 2.0 recommended and required
  for Okta Integration Network apps. Auth by OAuth 2.0 authorization code, Basic
  or an HTTP Authorization header; the app must support `active` and assign the
  `id` (the client may not). Its test suite checks username case sensitivity.
- **Keycloak**: the 26.8.0 release notes (October 2026) promote the SCIM API from
  preview to supported: an interface for managing users and groups in a realm,
  that is, Keycloak as SCIM target. I found no official outbound client there.
  Before 26.8 it was preview: check the version before promising SCIM.

### Lifecycle events: what is sent and what can break

| Event | The IdP sends (SCIM) | The server must | What goes wrong |
|---|---|---|---|
| Joiner | lookup by matching attribute (`GET ...filter=userName eq`), then `POST /Users` | 201, unique `userName`, `Location`, safe on retry | duplicate (409 ignored), lost `externalId` |
| Mover | `PATCH` attributes, `PATCH` groups add and remove | apply by path, drop old groups, version the change | PUT wipes fields, group race, old access kept (privilege creep) |
| Leaver | `PATCH active false` (or `DELETE`) | disable, kill sessions and tokens, keep data per policy | live session or refresh token, local password, retried DELETE is 404 |
| Lost event or rehire | nothing, or `PATCH active true` | reconcile on a schedule, find the old account by `externalId` | orphans, drift, a second account for a rehire |

Market: SCIM is the standard for SaaS provisioning from an IdP; LDAP or AD sync
and custom HR scripts still run much of the legacy, with SCIM on top of the IdP.
### Where to go next

This is the protocol behind the joiner-mover-leaver loop of the IAM overview; the
source is often a directory (the LDAP lesson). SCIM cannot end a live session or
refresh token: that is session management and revocation.

## Trade-offs

- **SCIM against JIT.** SCIM gives lifecycle control but needs an endpoint, a
  token and a sync to run; JIT needs nothing and leaves orphans. Choose by risk.
- **Soft against hard delete.** `active:false` keeps audit and references, and
  personal data: retention needs a second step (anonymize after 90 days).
- **PUT against PATCH.** PUT is easy to build and dangerous to receive; PATCH is
  where vendors differ. Support the common subset and test with the real IdP.
- **Strict against permissive validation.** Rejecting unknown attributes breaks
  clients that send extras; accepting them is mass assignment. Reject and log.
- **Sync against reconcile.** Events are cheap and drift silently; a full scan
  costs reads and finds what sync lost. Run both and watch the diff count.

## Documentation Links

- [RFC 7642, SCIM: Definitions, Overview, Concepts and Requirements, IETF](https://datatracker.ietf.org/doc/html/rfc7642) (doc)
- [RFC 7643, SCIM: Core Schema, IETF](https://datatracker.ietf.org/doc/html/rfc7643) (doc)
- [RFC 7644, SCIM: Protocol, IETF](https://datatracker.ietf.org/doc/html/rfc7644) (doc)
- [Tutorial: Develop a SCIM endpoint for user provisioning, Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups) (doc)
- [Build a SCIM provisioning integration, overview, Okta Developer](https://developer.okta.com/docs/guides/scim-provisioning-integration-overview/) (doc)
- [Prepare your SCIM API, Okta Developer](https://developer.okta.com/docs/guides/scim-provisioning-integration-prepare/main/) (doc)
- [Keycloak 26.8.0 released (SCIM API supported), Keycloak](https://www.keycloak.org/2026/10/keycloak-2680-released) (doc)
