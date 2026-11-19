---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Authorization is one function: `decision = f(subject, action, resource, context)`. The access models (ACL, RBAC, ABAC, ReBAC) differ in what they put in the subject, the resource and the context, and the policy engines (OPA, Cedar, OpenFGA) are three implementations of that function. This lesson runs one scenario (documents, folders, teams; owner edits, team reads, admin does everything, a confidential document needs clearance) through all three, asks the same 12 questions, and compares expressiveness, where the policy lives, local latency and testing. It also shows the mistake that matters more than the engine: authorizing the function but not the object (IDOR/BOLA), measured on a toy API.
Versions: `openpolicyagent/opa:1.22.4` (Rego v1), Cedar CLI 4.15.0 (GitHub release binary), `openfga/openfga:v1.22.1` with `openfga/cli:v0.9.0` (memory store), Node 22.23.4, curl, jq 1.7.1. These were the latest stable tags on 2026-11-19.

## Use Cases

- Choosing between roles, attributes and relations for a new product, and knowing which one will hurt later.
- Replacing `if (user.isAdmin)` scattered across handlers with a policy that can be tested and audited.
- Fixing "403 only in the UI" (the API answers anyone who skips the button) and reading an OPA, Cedar or OpenFGA integration.

## Deep Dive

### The function and the models

The IAM lesson named the PEP (enforces) and the PDP (decides). This one is about what the PDP knows:

| Model | The decision uses | Example rule |
|---|---|---|
| ACL | a list stored on the resource | `d1: alice rw, bob r` |
| RBAC | the subject's roles | `editor` may edit documents |
| ABAC | attributes of subject, resource, environment | clearance >= document level, office hours |
| ReBAC | a path in a graph of relations | editor of the folder that contains the document |

**ACL** is the oldest and does not scale to "everyone in engineering": you edit every list. **RBAC** (the NIST model, ANSI INCITS 359-2004) puts a role between users and permissions: core RBAC, hierarchical RBAC (`admin` inherits `editor`), and static and dynamic separation of duty (nobody holds both `requester` and `approver`). Its failure mode is role explosion: if a rule depends on team, action and clearance, the roles you need are their product. With 20 teams, 2 actions and 4 clearance levels that is 160 roles for one document type (arithmetic, not measured), and the role name starts encoding attributes. **ABAC** (NIST SP 800-162) keeps few roles and evaluates attributes at request time, so "clearance at least the document level" is one line. Its cost: attributes must be fresh and trustworthy, and "who can reach this?" means reading rules. **ReBAC** stores relationships as data and derives access by walking them, which suits sharing (Drive, GitHub): "viewer of the folder" implies "viewer of every document inside".

### XACML: the architecture stayed, the language did not (docs only)

OASIS XACML 3.0 (2013) named the roles every engine still uses: the **PEP** intercepts, the **PDP** evaluates, the **PIP** (information point) fetches attributes the request did not carry, the **PAP** (administration point) authors and stores policies. The language was XML: verbose, far from the code, hard to test. The industry kept the boxes and replaced the language with code (Rego), a small typed language (Cedar) or data (OpenFGA tuples). XACML survives in some enterprise suites; new work rarely starts there.

### The scenario, defined once

Users: `alice` (team eng, clearance 2), `bob` (eng, 0), `carol` (admin, 0), `dave` (sales, 3). Documents: `d1` (owner alice, eng, open), `d2` (owner alice, eng, confidential, level 2), `d3` (owner dave, sales, open). Rules: the owner reads and edits; the owner's team reads; an admin reads and edits; a confidential document needs `clearance >= level` for everyone, admin included. The 12 questions are in the result table further down.

### Engine 1: OPA and Rego

A policy plus data loaded into `opa run -s`; the caller sends `input` and gets JSON back:

```rego
package authz
default allow := false
user := data.users[input.sub]
doc := data.docs[input.doc]
is_owner if doc.owner == input.sub
is_admin if user.admin
in_team if doc.team in user.teams
default cleared := false
cleared if doc.confidential == false
cleared if user.clearance >= doc.level
grants contains "owner" if is_owner
grants contains "team" if { input.action == "read"; in_team }
grants contains "admin" if is_admin
allow if { count(grants) > 0; cleared }
decision := {"allow": allow, "grants": grants, "cleared": cleared}
```

```text
$ docker run -d -p 6560:8181 -v $PWD/opa:/p openpolicyagent/opa:1.22.4 run -s -a 0.0.0.0:8181 --set decision_logs.console=true /p
$ curl -s localhost:6560/v1/data/authz/decision -d '{"input":{"sub":"bob","action":"read","doc":"d2"}}' | jq -c .result
{"allow":false,"cleared":false,"grants":["team"]}
# carol read d2 -> {"allow":false,"cleared":false,"grants":["admin"]}
```

The reason travels with the decision: `grants` says why access was given, and the denied cases show a valid role with a failed clearance. Three real gotchas while writing it. (1) A package named `docs` next to `data.docs` made OPA refuse to compile (`rego_recursion_error`): keep policy and data under different names. (2) Without `default cleared := false`, `decision` became undefined and the HTTP body came back with only a `decision_id` and no `result`: in Rego an undefined value silently removes the whole answer, so give every rule the decision depends on a default. (3) `not doc.confidential` is true when the document does not exist, which fails open; `doc.confidential == false` is undefined for a missing document, which fails closed. Tests are Rego too (`opa test`, each overriding `input` with `with input as {...}`):

```text
$ opa test /p -v   # owner_edits, team_reads, team_cannot_edit, admin_blocked_by_clearance, unknown_user_denied
PASS: 5/5
```

The decision log is one JSON line per decision (console here, a collector in production): `{"decision_id":"5fcf5970-...","input":{"action":"read","doc":"d1","sub":"mallory"},"path":"authz/allow","result":false,...}`. Partial evaluation (`/v1/compile` with `"unknowns":["input.doc"]`) returned residual queries over `data.partial.authz` (ran, output not shown): it turns the policy into a filter you can push into a database query instead of checking rows one by one.

### Engine 2: Cedar

Cedar has a fixed request shape: principal, action, resource, context. Policies are `permit` or `forbid`; the algorithm is default deny, any satisfied `forbid` wins, and a policy that errors is skipped. Entities (attributes plus parents) are passed as JSON. Four policies, the release CLI binary, local:

```cedar
permit (principal, action in [Action::"read", Action::"edit"], resource)
  when { resource.owner == principal };
permit (principal, action == Action::"read", resource)
  when { principal in resource.team };      // team membership is an entity parent
permit (principal, action, resource) when { principal.admin };
forbid (principal, action, resource)
  when { resource.confidential && principal.clearance < resource.level };
```

```text
$ cedar authorize --policies policies.cedar --entities entities.json \
    -l 'User::"carol"' -a 'Action::"read"' -r 'Doc::"d2"' -c ctx.json --verbose
DENY
note: this decision was due to the following policies:
  policy3
```

`policy3` (0-based: the `forbid`) beat carol's admin `permit`: a guardrail written once cannot be undone by a later permit. The schema catches typos before deploy: `resource.ownr` fails `validate` with `attribute ownr on entity type Doc not found, did you mean owner?`. The dangerous case is skip-on-error. With the typo in the `forbid` (`principal.clearence`) and validation not run:

```text
$ cedar authorize ... -l 'User::"carol"' -a 'Action::"read"' -r 'Doc::"d2"' --verbose
ALLOW
error while evaluating policy `policy3`: `User::"carol"` does not have the attribute `clearence`
note: this decision was due to the following policies:
  policy2
```

The error is only in the diagnostics, and the guardrail silently stopped: carol got into a confidential document. Run `validate` in CI and alert on non-empty errors in production. Cedar's other strength is formal analysis (an SMT-based tool can prove "this change widens no access"); not run here (docs only).

### Engine 3: OpenFGA (ReBAC)

OpenFGA implements the Zanzibar model (below). You declare types and relations in a DSL, write tuples `user relation object`, and `check`. Same scenario, but clearance has to become a relation:

```text
# header: model / schema 1.1
type user
type org
  relations
    define admin: [user]
type team
  relations
    define member: [user]
type folder
  relations
    define parent: [folder]
    define viewer: [user, team#member] or viewer from parent
type document
  relations
    define org: [org]
    define parent: [folder]
    define owner: [user]
    define open: [user:*]
    define cleared: [user]
    define viewer: [user, team#member] or owner or viewer from parent or admin from org
    define editor: owner or admin from org
    define clearance_ok: open or cleared
    define can_read: viewer and clearance_ok
    define can_edit: editor and clearance_ok
```

The data is 18 tuples: team membership, `team:eng#member` as viewer of `folder:f-eng`, each document's `parent`, `owner` and `org`, and a `user:*` `open` tuple on d1 and d3. `d2` has only a `cleared` tuple for alice: clearance is data the application must write, not an expression the engine evaluates.

```text
$ fga query check user:bob can_read document:d1        -> {"allowed":true}
$ fga query check user:bob can_read document:d2        -> {"allowed":false}
$ fga query list-objects user:bob   can_read document  -> {"objects":["document:d1"]}
$ fga query list-objects user:alice can_read document  -> {"objects":["document:d1","document:d2"]}
$ fga query expand viewer document:d1   # union: direct users, owner, folder:f-eng#viewer, org:acme#admin
```

The graph does the inheritance. A new `document:d4` got an owner, an `open` tuple and `parent folder:f-eng`, with no team tuple of its own: bob could read it (`true`). Deleting only the `parent` tuple made it `false`. `list-objects` answers "what can bob see?", the question a document list page needs and RBAC engines answer badly; `expand` shows why a check succeeded, the counterpart of OPA's `grants`.

### Zanzibar, the new enemy problem and consistency

Pang et al., "Zanzibar: Google's Consistent, Global Authorization System" (USENIX ATC 2019), describes the system behind access control in Drive, Photos and YouTube: one tuple model (`object#relation@user`) with usersets and rewrites such as `viewer from parent`. The authors report trillions of ACLs, millions of checks per second, 95th percentile under 10 ms and availability above 99.999%. OpenFGA and SpiceDB follow the model. The hard problem is the **new enemy problem**: Alice removes Bob from a document's ACL, then adds secret content; if the check used an ACL copy from before the removal, Bob reads content he should never see. Zanzibar's answer is a consistency token (the "zookie") issued with content changes, so a check evaluates at or after that moment. OpenFGA exposes a `consistency` parameter (`MINIMIZE_LATENCY` by default, `HIGHER_CONSISTENCY` for stronger reads at a performance cost, per its docs). A single-node memory store cannot show the race (docs only). The lesson for any engine with a cache: a revoked right is revoked only when the decision cache expires.

### Scopes, roles and permissions are different things

An OAuth scope (`documents:write`) says what the **client** may ask the API to do for the user, a ceiling the user consented to. It does not say what the **user** may do on `d2`: alice's token with `documents:write` must still fail on bob's document. Roles group permissions for people; permissions are domain facts ("edit this document"). Keep coarse scopes in the token and the object-level decision in the PDP. RFC 9396 (RAR) can carry finer grants inside the token.

### Comparison, measured

The 12 questions through each engine (OPA REST, Cedar CLI, OpenFGA REST):

```text
subject action doc | opa   cedar fga        subject action doc | opa   cedar fga
alice  read d1     | allow allow allow      carol  read d2     | deny  deny  deny
alice  edit d1     | allow allow allow      carol  read d3     | allow allow allow
bob    read d1     | allow allow allow      dave   edit d3     | allow allow allow
bob    edit d1     | deny  deny  deny       dave   read d1     | deny  deny  deny
carol  edit d1     | allow allow allow      alice  read d2     | allow allow allow
bob    read d2     | deny  deny  deny       alice  read d3     | deny  deny  deny
```

No mismatch. Latency per call, 1000 sequential requests from Node 22 over a keep-alive loopback connection after 50 warm-ups. This is local Docker on one laptop, no real network, no TLS, three small documents: it shows engine overhead here, not production behavior.

```text
OPA REST /v1/data      n=1000 median 0.44 ms  p95 0.62 ms
OpenFGA REST /check    n=1000 median 0.54 ms  p95 0.76 ms
Cedar CLI (process)    n=200  median 3.41 ms  p95 3.93 ms
```

Cedar's number is a new process per call (parse, load entities, exit): process start, not the engine. Cedar is meant to run as a library in your process, which needs no hop; that was not measured. With a real network add the round trip; in OpenFGA the cost grows with graph depth and fan-out, which this scenario barely exercises.

| | OPA / Rego | Cedar | OpenFGA |
|---|---|---|---|
| Model | rules over JSON | policies over entities | relation graph |
| Policy lives | `.rego` files, bundles | `.cedar` files + schema | model + tuples in a store |
| Data lives | pushed `data` or in `input` | entities passed per request | the tuple store |
| Attributes | native | native | awkward (tuple or condition) |
| Hierarchies | write them yourself | `in` on entity parents | native, the point |
| "What can X see?" | partial evaluation | not built in | `list-objects` |
| Why allowed | your own `grants` | determining policy ids | `expand` |
| Test | `opa test` | `validate` + `authorize` in CI | `fga model test` |

### Where the engine sits, and what it costs

- **Embedded library**: lowest latency, no new service; each language needs a binding and policy changes ride your deploys. Cedar's natural place.
- **Sidecar**: policy updated through bundles without redeploying the app, one loopback hop. OPA's classic place (Envoy, Kubernetes admission).
- **Central PDP**: one authoritative graph or policy set, needed when decisions depend on shared data (sharing across apps). It becomes a hard dependency: decide what happens when it is down (fail closed for writes, a short cache for low-risk reads) and watch its p95.

Cost grows with centralization: a library is a dependency, a sidecar a fleet to update, a central store a database to run and keep in sync with your own data (team membership lives in your IdP and in the tuple store). Every decision cache needs an expiry you can state.

### The trap: hiding the button, and IDOR/BOLA

Authorization in the client is a display hint; the API must decide. A toy API (Node 22, `X-User` stands in for a verified token) has two routes that differ in one `if`: `/v1` checks only that the caller is logged in (function level), `/v2` also checks that the document belongs to the caller (object level):

```text
v1 as alice GET /v1/docs/1 -> {"owner":"alice","text":"alice: Q3 plan"} [200]
v1 as alice GET /v1/docs/2 -> {"owner":"bob","text":"bob: salary table"} [200]
v2 as alice GET /v2/docs/1 -> {"owner":"alice","text":"alice: Q3 plan"} [200]
v2 as alice GET /v2/docs/2 -> {"error":"forbidden"} [403]
```

`/v1` is Broken Object Level Authorization (OWASP API Security Top 10, API1:2023), the old IDOR: change `2` to `1` in the URL and read another user's data. The UI never showed alice a link to `2`, which protected nothing. Authorize every object access on every route, using the id from the URL; unguessable ids are defense in depth, never the control. Log each decision with subject, action, object and reason (`grants`, the determining policy ids, the `expand` result): denials are the signal.

### Where each model fits

| Model | Expresses well | Expresses badly | Typical engine | Trap |
|---|---|---|---|---|
| ACL | per-object exceptions | groups, bulk change | database table, bucket ACL | list drift, no review |
| RBAC | job functions, SoD, audits | per-object and context rules | framework roles, Keycloak | role explosion |
| ABAC | context, clearance, time, tenant | "who can reach X?" | OPA, Cedar | stale or forgeable attributes |
| ReBAC | sharing, nesting, hierarchies | numeric or time conditions | OpenFGA, SpiceDB | stale cache, new enemy, tuple drift |

Real systems combine them: coarse roles from the IdP, relations for sharing, attributes for guardrails. A Cedar `forbid` or an OPA deny rule is the natural home for "never, whatever the roles say".

### Where to go next

Token exchange carries a downscoped, audience-restricted grant to the next service (`OAuth Token Exchange: Delegation and On-Behalf-Of`), and session management (next in this track) decides how fast a revoked right takes effect. The system design concept on authentication and authorization at scale places the same PEP and PDP at fleet level (gateways, mTLS, zero trust); Spring method security and .NET policies are the in-process PEPs.

## Trade-offs

- **RBAC versus ABAC.** Roles are easy to audit; attributes remove role explosion but make "who can do X" a query over rules. Roles for job functions, attributes for guardrails (clearance, tenant, time).
- **Policy in code versus in an engine.** An `if` in a handler is fast and unreviewable; an engine gives one policy and one audit trail, at the cost of a data-sync problem: the engine needs the facts (teams, attributes) and they drift.
- **Fail open versus fail closed.** Rego with no default returned no answer; a Cedar typo was skipped and let carol in. Default deny, validate in CI, alert on evaluation errors.
- **Fresh versus fast.** Caching a check turns a revoked right into a window of exposure (the new enemy problem at small scale); choose a TTL per resource sensitivity.
- **Central graph versus local rules.** OpenFGA gives `list-objects` and cross-app sharing, but attributes become tuples you keep updated (the `cleared` tuple); OPA and Cedar evaluate attributes natively but cannot list accessible objects cheaply.
- **Scope versus object permission.** A scope is a ceiling on the client, not a grant on the object: check both, in the API.

## Documentation Links

- [Role Based Access Control, NIST](https://csrc.nist.gov/projects/role-based-access-control) (doc)
- [SP 800-162, Guide to Attribute Based Access Control, NIST](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-162.pdf) (doc)
- [eXtensible Access Control Markup Language (XACML) 3.0, OASIS](https://docs.oasis-open.org/xacml/3.0/) (doc)
- [Open Policy Agent Documentation, OPA](https://www.openpolicyagent.org/docs) (doc)
- [Policy Language (Rego), OPA](https://www.openpolicyagent.org/docs/policy-language) (doc)
- [Policy Testing, OPA](https://www.openpolicyagent.org/docs/policy-testing) (doc)
- [Decision Logs, OPA](https://www.openpolicyagent.org/docs/management-decision-logs) (doc)
- [Cedar Policy Language Reference Guide, Cedar](https://docs.cedarpolicy.com/) (doc)
- [How Cedar authorization works, Cedar](https://docs.cedarpolicy.com/auth/authorization.html) (doc)
- [OpenFGA Documentation, OpenFGA](https://openfga.dev/docs) (doc)
- [Getting started with modeling, OpenFGA](https://openfga.dev/docs/modeling/getting-started) (doc)
- [Query consistency, OpenFGA](https://openfga.dev/docs/interacting/consistency) (doc)
- [Zanzibar: Google's Consistent, Global Authorization System, USENIX ATC 2019](https://www.usenix.org/conference/atc19/presentation/pang) (paper)
- [API1:2023 Broken Object Level Authorization, OWASP](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) (doc)
- [Authorization Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) (doc)
- [RFC 9396, OAuth 2.0 Rich Authorization Requests, IETF](https://www.rfc-editor.org/rfc/rfc9396) (doc)
