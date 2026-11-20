---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

Every environment ends up with a few credentials that can do anything: the domain or cloud administrator, the database owner, the root token, the deploy key. The question of this lesson is how long those credentials exist, who can hold them, and what remains in the log afterward. Privileged access management (PAM) answers with an inventory of privileged accounts, a vault that hands credentials out and takes them back, recorded sessions, and just-in-time (JIT) elevation toward zero standing privilege. Secrets management answers the same question for applications: no static password, but a lease that expires. This lesson runs HashiCorp Vault in dev mode in Docker and measures the operation: KV v2 versions, policies, token TTL and expiry, dynamic Postgres credentials (issued, expired, revoked, and an open session that survives revocation), static rotation, AppRole with response wrapping against secret zero, a JIT elevation approved by a second person, signed SSH certificates, seal and unseal, the audit log with masked values, and a break-glass read that raises an alert. Entra PIM, break-glass guidance, AWS Secrets Manager, Azure Key Vault, CyberArk and BeyondTrust are docs only here (no tenant, no cloud account, no licence). Tools: `curl`, `jq`, the `vault` CLI inside the container, `psql`, `ssh-keygen`; the protocol is the point, not the stack.
Versions: `hashicorp/vault:2.2.2` (arm64 build, community edition, `enterprise:false` in `/sys/health`), `postgres:16` (16.15), curl 8.7.1, jq 1.7.1, OpenSSH 10.5p1. Measured on an Apple M4 Max (14 cores), Docker 29.9.2. Docs read on 2026-11-20. Docs only: Entra PIM, AWS, Azure, CyberArk, BeyondTrust, OpenBao, sshd acceptance of the SSH certificate, multi-share Shamir init.

## Use Cases

- Replacing a shared admin password and a "root" database login with a lease that expires and a log that names the person.
- Designing break-glass accounts without locking the whole tenant out (the failure this lesson explains).
- Choosing between a PAM product, a secrets vault and the cloud's own store, and knowing what an auditor will ask.
- Reading a Vault audit log or an access policy during a review and knowing what each line proves.

## Deep Dive

### The problem: standing privilege and the blast radius

A permanent administrator account is a standing target: it works at 3 a.m. for whoever holds it, phished or not (the threats lesson lists admin roles first among the accounts attackers prefer). A credential shared by a team is worse: the log says "admin" and nobody can say who. Blast radius is the sum of what the credential can reach times how long it stays valid. Three levers shrink it: fewer accounts with the privilege, a shorter life for each grant, and a record of every use. NIST SP 800-53 Rev. 5 states the principle as control AC-6: allow "only authorized accesses for users (or processes acting on behalf of users) that are necessary to accomplish assigned organizational tasks". Zero standing privilege is the strict form: nobody holds the privilege until a request is approved, and it disappears by itself.

### PAM in four parts

1. **Inventory.** You cannot vault what you have not found: domain admins, local administrators, service accounts, database owners, network device logins, cloud root users, API keys with write scope. The identity lifecycle lesson showed reconciliation finding orphans; the same exercise for privileged accounts is the first PAM project.
2. **Vault with check-out and check-in.** The credential lives in the vault, the user asks for it with a reason, gets it for a bounded time, and the vault changes it afterward so the copy in a clipboard is worthless. CyberArk's architecture page describes this as a Vault plus a Central Policy Manager (CPM) that rotates passwords on the targets "with no human intervention". BeyondTrust Password Safe has a request with a reason, and a Privileged Remote Access credential check-out shows the password for a short time and asks for a check-in afterward (docs only).
3. **Session recording.** The user connects through a proxy that injects the credential, so the human never sees it, and the session is recorded. CyberArk's Privileged Session Manager and BeyondTrust's recorded-session reviewers do this (docs only). Entra PIM lists Azure Bastion Premium session recordings as a preview and says its session analytics show role lifecycle and Bastion activity, not the commands run inside the VM.
4. **JIT and just-enough access.** The role is eligible, not active. Activation needs a justification, often an approval and MFA, lasts a limited time and ends alone. Entra PIM: "time-based and approval-based role activation", with an activation maximum between 1 and 24 hours, notifications and access reviews; it needs licences (Entra ID Governance licensing fundamentals). Just enough means the role is the smallest one for the task, not Global Administrator for a password reset.

### The lab: Vault in dev mode (measured)

```bash
docker run -d --rm --name idn-pam-vault -p 127.0.0.1:7090:8200 --cap-add=IPC_LOCK \
  -e VAULT_DEV_ROOT_TOKEN_ID=dev-only-root-token -e VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200 hashicorp/vault:2.2.2
curl -s localhost:7090/v1/sys/seal-status | jq -c '{type,sealed,t,n,storage_type}'
{"type":"shamir","sealed":false,"t":1,"n":1,"storage_type":"inmem"}
```

The image has an arm64 build and the container logs `tls: "disabled"`. The docs say "Never, ever, ever run a dev mode server in production": in-memory storage, one key share, an auto-unsealed server and a root token you chose. Licence, as the repository says today: Vault 1.15.0 and later is under the Business Source License 1.1, licensor IBM, with an additional use grant that allows production use except offering it to third parties on a hosted or embedded basis to compete with the vendor's paid version, and internal use is not competitive; each version converts to MPL 2.0 four years after publication. Running it in a company is allowed; building a competing hosted product is not. OpenBao is the MPL-2.0 fork hosted by the Linux Foundation's OpenSSF (docs only, not run here). The DB container is `idn-pam-db` (`postgres:16`, private Docker network, port 7091), mine and ephemeral. Both were removed at the end. Helper used below: `v` is `curl -s -H "X-Vault-Token: $T"`.

### KV v2: versions and metadata (measured)

```text
POST secret/data/billing/db {"data":{...}}                     -> version 1
POST ... {"options":{"cas":1}}                                 -> version 2
POST ... {"options":{"cas":1}} again                           -> 400 check-and-set parameter did not match the current version
GET  secret/data/billing/db        -> data of v2, "lease_duration":0,"renewable":false   (KV has no lease)
GET  secret/data/billing/db?version=1                          -> data of v1
DELETE secret/data/billing/db      -> 204; GET -> 404 with metadata.deletion_time set     (soft delete)
POST secret/undelete/billing/db {"versions":[2]} -> 204; GET -> data back
POST secret/destroy/billing/db {"versions":[1]}  -> 204; GET ?version=1 -> 404, "destroyed":true
POST secret/metadata/billing/db {"max_versions":2}; then 3 more writes -> current_version 5, versions kept ["4","5"]
```

Delete is reversible, destroy is not, and `max_versions` prunes the oldest silently (the API doc: 0 or unset keeps 10). Metadata lists `created_time` and who created each version (`created_by.client_id`). `cas` makes a write fail if someone else changed the secret meanwhile, which is how two operators avoid overwriting each other. KV is a versioned store like Key Vault or Secrets Manager: it is the least interesting part of Vault, and where most teams stop.

### Policies: least privilege in HCL (measured)

```text
path "secret/data/billing/*"     { capabilities = ["read"] }
path "secret/metadata/billing/*" { capabilities = ["list", "read"] }
```

A token with this policy (`vault policy write billing-read`): read `billing/db` 200, read `reports/db` 403, write `billing/db` 403, list `secret/metadata/billing` returns `["api","db"]`, `sys/policies/acl` 403; `sys/capabilities-self` answers `["read"]` and `["deny"]` for the two paths. Three traps, each measured with a token without the `default` policy: a policy on `secret/billing/*` (no `/data/`, the KV v1 habit) gives 403 on KV v2 reads; `secret/data/billing/*` does not match `secret/data/billing` itself (403); an explicit `deny` on `billing/db` beats the glob (api 200, db 403). Policies are deny by default, they are attached to tokens, and a token also gets `default` unless `no_default_policy` is set. This is the authorization lesson in one engine: a policy engine over paths and capabilities, owned by whoever administers the vault.

### Tokens, TTL and leases (measured)

A token is a credential with a policy list and a lifetime. Created with `policies=billing-read, ttl=2m, explicit_max_ttl=10m`, `lookup-self` shows `ttl:120, creation_ttl:120, explicit_max_ttl:600, renewable:true`. The expiry test (ttl 6 s, explicit max 14 s):

```text
t+0   lookup ttl 5, read secret -> 200
t+4   renew-self +6s            -> lease_duration 6
t+8   renew-self +60s           -> lease_duration 6, warning: TTL of "1m" exceeded the effective max_ttl of "6s"; capped
t+14  read secret -> 403 {"errors":["permission denied","invalid token"]}; lookup-self and renew-self -> 403 too
```

An expired token is not a 401: Vault answers 403 with "invalid token", so a client that treats 403 only as "no policy" will loop on it. Renewal cannot pass the maximum, which is the point of `explicit_max_ttl`: a stolen token cannot be renewed forever. Other measured behaviors: `num_uses=2` allows two requests and the third is 403; revoking a parent by its accessor (`auth/token/revoke-accessor`, which does not reveal the token) also kills the child it created (both 403), while an `orphan` token created beside them survives (200); `revoke-self` ends the token at once; a `period` token (1 h) can be renewed indefinitely, for a long-running service that must still be revocable. Secrets from dynamic engines carry a lease with the same model: look up, renew, revoke, revoke by prefix.

### Dynamic secrets: the database engine (measured)

Instead of storing the password, Vault holds an admin connection and creates a user per request. Setup, with `postgresql-database-plugin`, the connection `postgresql://{{username}}:{{password}}@idn-pam-db:5432/appdb`, and a role:

```json
{"db_name":"appdb","default_ttl":"20s","max_ttl":"60s",
 "creation_statements":["CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';",
                        "GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";"],
 "revocation_statements":["REVOKE ALL ON ALL TABLES IN SCHEMA public FROM \"{{name}}\";","DROP ROLE IF EXISTS \"{{name}}\";"]}
```

```text
GET database/creds/app-readonly -> {"lease_duration":20,"renewable":true,"data":{"username":"v-token-app-read-qAp389rukJlr8m9h0n4S-1795197370","password":<20 chars>}}
pg_roles: that role, rolvaliduntil 17:56:35 (issued 17:56:10: 25 s for a 20 s lease)
as that user: select count(*) from invoices -> 2;  insert -> ERROR: permission denied for table invoices
a second GET -> a different user
```

One catch in my own lab: connecting with `-h 127.0.0.1` inside the Postgres container accepted any password, because the official image's `pg_hba.conf` has `host ... 127.0.0.1/32 trust`. My first "login works" checks proved nothing. Connecting by the container's network name (`-h idn-pam-db`, rule `scram-sha-256`) gave the real result, used below: right password works, `wrong` gives `password authentication failed`. Expiry, polled every 3 s from issue:

```text
t+0 ... t+18  login ok
t+21          FATAL: password authentication failed        (Vault log: "expiration: revoked lease" at t+20.0 s)
```

The role is dropped when the lease ends, and Postgres answers the same message for a dropped role and a wrong password (no enumeration). `VALID UNTIL` (25 s here) is the backstop if Vault is down. Renewal: `sys/leases/renew` with `increment:30` gives 30 s; asking for 300 s gives `52` with the same capped-TTL warning (max 60 s minus the 8 s already elapsed). Early revoke: `sys/leases/revoke` drops the role, and `revoke-prefix` on `database/creds/app-readonly` removed 3 outstanding roles (3 to 0).

The finding that matters: an open session survives revocation. I held a connection with `select pg_sleep(40)`, revoked the lease, and `pg_stat_activity` still showed pid 267 as `active`, with the role already dropped (`usename` null), still running 13 s later. Adding `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{{name}}';` as the first revocation statement fixed it: same test, the backend was gone 1 s after the revoke. "Revoked" only means what your revocation statements do.

Static roles and root rotation. A role mapped to an existing user (`static_app`) with `rotation_period: 15s`: the first read returned a password and the original one stopped working (Vault rotates at creation); the second read, 9 s later, had the same password and `ttl:6`; the third, 18 s after the first, a new one, `last_vault_rotation` 16.4 s after the first. `database/rotate-root/appdb` changed the admin password to a value no human knows: the old one gave `password authentication failed`, and Vault kept issuing credentials. Issuing 30 credentials took 11.8 ms each, a KV read 9.6 ms (both include the `curl` process start, so the engine adds little on this machine).

Static against dynamic: static rotation fits an account an application owns and a legacy system that cannot create users (one identity, attribution blurred, a window while consumers pick up the new value); dynamic gives each consumer its own credential, unique in the database log and revoked by lease, at the cost of the vault being in the request path at startup and of the revocation statements being yours to get right. Docs only: the same engine covers MySQL, MongoDB, MSSQL and others; the LDAP engine offers a service-account check-out library (the docs list it in the feature summary), which is the PAM check-out and check-in model.

### Secret zero: AppRole and response wrapping (measured)

The vault protects secrets, and something must authenticate the application to the vault without a stored secret: secret zero (the workload identity lesson's term). AppRole splits the credential in two: a `role_id` (an identifier, safe in the image) and a `secret_id` that the platform delivers at start. Role `billing`: `token_policies billing-read`, `token_ttl 1m`, `secret_id_ttl 2m`, `secret_id_num_uses 1`. The orchestrator asks for a wrapped secret id, with a 30 s wrap TTL:

```text
POST auth/approle/role/billing/secret-id  -H "X-Vault-Wrap-TTL: 30s"  -> response has wrap_info (ttl 30, creation_path ...), data:null, auth:null
POST sys/wrapping/lookup {"token": wrapping token}                    -> creation_path, creation_time, creation_ttl (no secret)
POST sys/wrapping/unwrap, token = the wrapping token only             -> secret_id, secret_id_ttl 120, secret_id_num_uses 1
the same unwrap again                                                 -> 400 wrapping token is not valid or does not exist
POST auth/approle/login {role_id, secret_id}  -> policies billing-read,default, lease_duration 60, renewable
the same login again (num_uses 1)             -> 400 invalid role or secret ID
```

The orchestrator never sees the secret id, only a single-use token in a cubbyhole, and a wrapping token unwrapped twice is evidence of interception: when I played the attacker and unwrapped first (200), the legitimate application got the 400. Treat that 400 as an alert. A wrap TTL of 3 s was also gone after 4 s (400). The honest limit: AppRole moves secret zero to whoever may request the wrapped secret id (the CI job, the orchestrator). The better answer is an auth method where the platform vouches: Vault's Kubernetes auth and JWT/OIDC auth (docs only; a GitHub Actions or Kubernetes token is exchanged for a Vault token, the trust condition measured in the workload identity lesson), or cloud IAM. SPIFFE and projected tokens are the same idea.

### JIT with Vault OSS: approval as a second person (measured)

Vault's native approval is Control Groups, which the docs place under Vault Enterprise (docs only). In the community edition the pattern still works with a token role and wrapping: `alice` has only `engineer` (reads `secret/data/dev/*`); `bob` has only `approver`, which can write to `auth/token/create/jit-prod`; the token role `jit-prod` allows policy `prod-admin`, is non-renewable, `token_explicit_max_ttl 20s`, orphan, no default policy.

```text
alice reads prod/payments: 403   alice mints jit-prod: 403   bob reads prod/payments: 403      (zero standing privilege)
bob POST auth/token/create/jit-prod  -H "X-Vault-Wrap-TTL: 60s"  {"display_name":"jit-alice-INC-4711"}  -> wrapped token
alice unwraps it -> a token with prod-admin;  reads at 18:01:36, :43, :50 -> 200;  at :57 -> 403 (expired at 20 s)
audit: "token-jit-alice-INC-4711" three reads, and bob's create of the token, with the same time
```

Nobody held prod access before the approval, nobody holds it after 20 s, and the log ties the grant (bob) to the use (the JIT token). The ticket id went in `display_name`, not in `meta`, because audit hashes `meta` values and leaves `display_name` readable. A real flow adds the ticket check, an MFA step for the approver and a chat bot; the vault supplies the mechanism: expiry, scope and the trail. This is Entra PIM's model (eligible, approve, expire) built from parts.

### SSH certificates with a short life (measured, partly)

The SSH engine as a CA replaces long-lived `authorized_keys`: servers trust the CA key (`TrustedUserCAKeys`), Vault signs a user's public key for minutes.

```text
POST ssh/config/ca {"generate_signing_key":true,"key_type":"ssh-ed25519"}
POST ssh/roles/ops {"key_type":"ca","allow_user_certificates":true,"allowed_users":"alice,ops","default_user":"ops","ttl":"30s","max_ttl":"5m"}
sign alice.pub for principal alice -> ssh-keygen -L:  Type: ssh-ed25519-cert-v01@openssh.com user certificate
   Valid: from 2026-11-20T18:00:27 to 2026-11-20T18:01:27     Principals: alice     Extensions: permit-pty
principal root -> 400 root is not a valid value for valid_principals       ttl 1h -> 400 ttl is larger than maximum allowed 300
```

The 30 s TTL shows a 60 s window because the role backdates `ValidAfter` by `not_before_duration` (default 30 s) for clock skew, the same trade as the SPIRE SVID. Docs only: a real `sshd` accepting the certificate. Expiry replaces revocation here too.

### Seal, unseal and Shamir

Vault encrypts everything with a key it does not keep in the clear. A sealed server knows nothing: measured, `operator seal` gave `/sys/health` 503 and `{"errors":["Vault is sealed"]}` on every read; `operator unseal` with the dev key and the same token read the secret again (200). The docs describe the default: the unseal key is split with Shamir's Secret Sharing, and a threshold of shares (for example 3 of 5, `operator init -key-shares=5 -key-threshold=3`, docs only here; dev mode is 1 of 1) must be entered to reconstruct it, so no single operator can unseal. Auto-unseal with a cloud KMS or HSM is the usual production answer, docs only. The point for PAM: the unseal shares are themselves privileged credentials, held by different people.

### Audit device and masked values (measured)

```bash
vault audit enable file file_path=/tmp/vault-audit.log
```

After 3 requests the log had 6 request and 6 response lines. The secret `fake-audit-pass-123` written to KV does not appear (0 matches); `data.data.password` is `hmac-sha256:acddc274...`. `POST sys/audit-hash/file {"input":"fake-audit-pass-123"}` returns the same hash, so you can check whether a known value was used without the log holding it. The root and billing tokens are hashed too (`client_token`, accessor). A denied read has `error: permission denied`, `auth.display_name`, `policies` and `policy_results.allowed:false`, and the entry is written for the failed request, which is the signal. With `log_raw=true` the same write appeared in clear (2 matches against 0): never in production. Docs: audit logs the request and response to every enabled device, and if Vault cannot write to at least one, it refuses to service the request, so enable at least two. Audit says who, when, what path and what outcome. It does not make the policy right.

### Break-glass accounts

Break-glass (emergency access) accounts exist because the access system can fail you. The Entra guidance lists cases: federation unavailable, administrators whose only MFA devices or phone networks are down, the last Global Administrator leaving, and all privileged roles eligible with approval required but no approver left, so "no one can approve activation and tenant administration is effectively locked". How to keep them, from that page: two or more cloud-only accounts on the `*.onmicrosoft.com` domain, not tied to a person, using a passwordless phishing-resistant method (FIDO2 recommended, or certificates) different from the daily admins; excluded from Conditional Access policies that block or restrict sign-in (a policy requiring a compliant device can block the account during the very emergency); active permanent in PIM, not eligible; credentials in safes in separate places; sign-in monitoring with alerts to other administrators; a review after every use and a validation drill at least every 90 days. NIST AC-2(2) names the same idea: "temporary and emergency accounts" disabled automatically after a set time.

Three lessons from the failures. A policy that requires MFA for everyone and no exception takes out the account you need when MFA is down. Break-glass credentials must not depend on the system that is broken (a vault behind the same IdP is circular). And an unmonitored break-glass login is an invisible administrator. A Vault version, measured: the credential in `secret/breakglass/idp-admin`, a token with `breakglass-read`, `num_uses=1`, `display_name oncall-carol-INC-5000`, and a 4-line watcher over the audit log:

```bash
jq -c 'select(.type=="request" and (.request.path|startswith("secret/data/breakglass/")) and .request.operation=="read")
  | {alert:"breakglass_read", at:.time, path:.request.path, who:.auth.display_name}' audit.log
{"alert":"breakglass_read","at":"2026-11-20T18:02:13.33Z","path":"secret/data/breakglass/idp-admin","who":"token-oncall-carol-INC-5000"}
{"alert":"breakglass_read","at":"2026-11-20T18:02:13.34Z","path":"secret/data/breakglass/idp-admin","who":null}   <- the second read, refused
```

The second read is blocked by `num_uses`, and the audit log still records it. The password itself is not in the log (0 matches). Vault's own break-glass is the root token: `operator generate-root` creates one only with a quorum of unseal keys and a one-time password; measured with the dev key: `-init`, the key, `-decode` gave a `root` token with `ttl:0`, and `revoke-self` ended it (next lookup 403). The attempt and its updates are in the audit log. Revoke root tokens right after use.

### Comparison: stores and what each gives (docs only)

| | Azure Key Vault | AWS Secrets Manager | Kubernetes Secret | HashiCorp Vault (measured) |
|---|---|---|---|---|
| Holds | secrets, keys, certificates | secrets such as DB credentials, API keys | small key/value objects | KV, plus dynamic engines |
| Versions | yes (secret versions) | labels AWSCURRENT, AWSPREVIOUS, AWSPENDING | none | KV v2 versions |
| Rotation | Event Grid "near expiry" 30 days before, a function you write | managed rotation, or a Lambda function | none built in | static rotation, or dynamic per request |
| Per-request credentials | not in the docs I read | not in the docs I read | no | leases, revoke by lease or prefix |
| Audit | diagnostic logs through Azure Monitor | CloudTrail records its API calls | cluster audit logging, not specific to Secrets | audit devices, values hashed |
| Trap | read at startup, one shared secret | rotation function permissions | unencrypted in etcd by default, any Pod creator can read | you run it: seal, backup, upgrade |

Sources are in the links. The Kubernetes page says Secrets are "by default, stored unencrypted" in etcd and that anyone who can create a Pod in a namespace can read its Secrets (see the [Kubernetes Secrets lesson](/kubernetes-concepts/kubernetes-secrets-fundamentals) and [secrets as environment variables or mounted files](/kubernetes-concepts/secrets-as-env-vars-vs-mounted-files)). The .NET side, with `DefaultAzureCredential` and the configuration provider, is in [secrets and managed identities](/dotnet-concepts/secrets-and-managed-identities-key-vault-and-workload-identity) and [Key Vault and App Configuration in .NET](/azure-dotnet-concepts/key-vault-and-app-configuration-in-dotnet). A cloud store that you reach with the workload's cloud identity is the lowest-effort choice on that cloud; Vault pays off when you need dynamic credentials, several clouds, or one policy and audit model.

### Market, audits and book vs today

Two products share the word "vault" and answer different questions. **PAM suites** (CyberArk, BeyondTrust) target people and privileged accounts on servers, databases and network devices: credential check-out with a reason, rotation, session recording and reports for auditors. Palo Alto Networks announced the completion of its CyberArk acquisition on 11 February 2026 and said the Identity Security platform stays available standalone (check current packaging before buying). **Secrets managers** (Vault, OpenBao, the cloud stores) target applications, pipelines and platform teams: API-first, leases, short TTL. A mature shop runs both, plus the IdP's JIT (Entra PIM) for cloud roles.

Book vs today. The older recipe is a shared administrator password in a vault, rotated after each check-out, reached from a jump host: still alive in enterprises, and fine for systems that cannot do better. Today the target is no standing role (eligible roles with expiry), per-session certificates or dynamic credentials instead of a stored password, phishing-resistant MFA for admins, and workload identity for the machines. What audits ask: I could read only NIST SP 800-53 Rev. 5 (the OSCAL catalog), which has least privilege (AC-6), authorizing access to security functions (AC-6(1)), non-privileged accounts for non-security tasks (AC-6(2)), restricting privileged accounts (AC-6(5)), periodic review of privileges (AC-6(7)), logging the execution of privileged functions (AC-6(9)) and automated temporary and emergency account management (AC-2(2)). PCI DSS and ISO 27001 ask similar things, but the PCI standard PDF answered 403 here and ISO is paywalled, so I do not quote them. The Entra emergency-access page maps break-glass to HIPAA emergency access procedures.

### Where to go next

The workload identity lesson removes secrets from services; this one handles what remains and the human administrators. The threats lesson names privileged accounts and break-glass sign-ins as signals; the authorization lesson models the policy side; the identity lifecycle lesson (SCIM) covers leavers and orphaned accounts, including service accounts the HR source does not know. The next step is access reviews and an inventory job that compares vault contents with what the directory says.

## Trade-offs

- **Dynamic against static secrets.** Per-consumer credentials with a lease are attributable and expire alone (measured: role gone 20 s after issue), but need the vault on the startup path and revocation statements that also kill open sessions (the `pg_terminate_backend` finding). Static rotation fits legacy accounts.
- **JIT against availability.** A 20 s or 8 h grant removes standing privilege and adds a step at 3 a.m. Keep break-glass for the day the approval path is down, and make it cheaper to use correctly than to bypass.
- **Short TTL against churn.** Short tokens limit theft (measured: 403 at expiry) and force every client to renew and handle 403 as "expired". Use `period` tokens for long services.
- **Vault against cloud stores.** Vault gives dynamic secrets, one policy language and audit devices; you operate seal, storage and upgrades. A cloud store is less work on one cloud. Example: Vault's BSL licence allows internal use, so the question is operations, not the licence.
- **Audit completeness against availability.** Vault refuses requests when no audit device can be written: two devices keep it up. Hashed values keep secrets out of logs, and `log_raw` undoes that.
- **PAM suite against homegrown.** Suites bring session recording and auditor reports; the 60 lines of jq and policy here show the mechanism, not a replacement for recording and reviews.

## Documentation Links

- [Vault documentation: key concepts, dev server, HashiCorp](https://developer.hashicorp.com/vault/docs/concepts/dev-server) (doc)
- [KV version 2, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2) (doc)
- [KV v2 API, HashiCorp Vault](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2) (doc)
- [Policies, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/policies) (doc)
- [Tokens, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/tokens) (doc)
- [Lease, renew and revoke, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/lease) (doc)
- [Database secrets engine, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/secrets/databases) (doc)
- [Database secrets engine API (roles, static roles, rotate-root), HashiCorp Vault](https://developer.hashicorp.com/vault/api-docs/secret/databases) (doc)
- [LDAP secrets engine (service account check-out), HashiCorp Vault](https://developer.hashicorp.com/vault/docs/secrets/ldap) (doc)
- [AppRole auth method, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/auth/approle) (doc)
- [Response wrapping, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/response-wrapping) (doc)
- [Kubernetes auth method, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/auth/kubernetes) (doc)
- [JWT/OIDC auth method, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/auth/jwt) (doc)
- [Signed SSH certificates, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/secrets/ssh/signed-ssh-certificates) (doc)
- [SSH secrets engine API, HashiCorp Vault](https://developer.hashicorp.com/vault/api-docs/secret/ssh) (doc)
- [Seal and unseal, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/concepts/seal) (doc)
- [operator generate-root, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/commands/operator/generate-root) (doc)
- [Audit devices, HashiCorp Vault](https://developer.hashicorp.com/vault/docs/audit) (doc)
- [Control groups (Enterprise), HashiCorp Vault](https://developer.hashicorp.com/vault/docs/enterprise/control-groups) (doc)
- [Vault LICENSE (BSL 1.1), HashiCorp, GitHub](https://github.com/hashicorp/vault/blob/main/LICENSE) (doc)
- [OpenBao documentation, OpenBao](https://openbao.org/docs/) (doc)
- [What is Privileged Identity Management, Microsoft Entra](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) (doc)
- [Manage emergency access accounts, Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access) (doc)
- [Automate secret rotation with Event Grid, Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/secrets/tutorial-rotation) (doc)
- [Monitor Azure Key Vault, Microsoft Learn](https://learn.microsoft.com/en-us/azure/key-vault/general/monitor-key-vault) (doc)
- [Rotate AWS Secrets Manager secrets, AWS](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html) (doc)
- [Secret versions and staging labels, AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html) (doc)
- [Log Secrets Manager events with CloudTrail, AWS](https://docs.aws.amazon.com/secretsmanager/latest/userguide/monitoring-cloudtrail.html) (doc)
- [Secrets, Kubernetes](https://kubernetes.io/docs/concepts/configuration/secret/) (doc)
- [Encrypting confidential data at rest, Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) (doc)
- [Auditing, Kubernetes](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/) (doc)
- [Check out credentials, BeyondTrust Privileged Remote Access](https://docs.beyondtrust.com/pra/v24.3/docs/check-out) (doc)
- [Privileged Access Manager architecture (Vault, CPM, PSM), CyberArk Docs](https://docs.cyberark.com/pam-self-hosted/latest/en/content/pasimp/privileged-account-security-solution-architecture.htm) (doc)
- [Password Safe sessions, BeyondTrust Docs](https://docs.beyondtrust.com/bips/docs/ps-sessions) (doc)
- [Palo Alto Networks completes acquisition of CyberArk, Palo Alto Networks](https://www.paloaltonetworks.com/company/press/2026/palo-alto-networks-completes-acquisition-of-cyberark-to-secure-the-ai-era) (doc)
- [NIST SP 800-53 Rev. 5, Security and Privacy Controls, NIST](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) (doc)
- [NIST SP 800-53 Rev. 5 OSCAL catalog (AC-6, AC-2), NIST on GitHub](https://github.com/usnistgov/oscal-content/blob/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json) (doc)
