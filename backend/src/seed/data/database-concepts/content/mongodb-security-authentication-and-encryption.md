---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand the layer of MongoDB security that sits below the newer field-level encryption features: verifying *who* is connecting (authentication — SCRAM by default, x.509 certificates for stronger identity guarantees), controlling *what* an authenticated connection may do (authorization via role-based access control), and protecting data *in transit* between clients, `mongod`, and `mongos` processes (TLS/SSL). The book's security chapter is explicit that these are three separate concerns — "enable authorization and enforce authentication," "encrypt communication," "encrypt data" — and walks through the first two in depth with a hands-on x.509 tutorial: standing up a certificate authority, signing member and client certificates, and using them to secure a three-member replica set. This concept is the older, broader layer that everything else in MongoDB's security story sits on top of — it predates and is orthogonal to **Queryable Encryption** (MongoDB 6.0, 2022), which is a narrower, newer feature for encrypting *specific fields* end-to-end so even the server never sees their plaintext, covered separately in `mongodb-atlas-search-and-vector-search`. Nothing here replaces that; a cluster can (and typically should) have both a solid auth/RBAC/TLS foundation *and* field-level encryption for its most sensitive fields.

## Use Cases

- Standing up a production replica set where every member proves its identity to the others with a certificate signed by a trusted CA (`clusterAuthMode x509`), rather than trusting a shared keyfile that grants full membership to anyone who has a copy of it.
- Granting an application's service account exactly `readWrite` on its own database via a built-in role, instead of handing out `root` or `dbOwner` just because the app needs to write — the difference between a scoped credential and a blank check.
- Creating a narrow user-defined role for a reporting or BI tool that only needs `find` on a handful of collections, instead of reaching for `readAnyDatabase` because it's the closest built-in role that "basically works."
- Bootstrapping a brand-new cluster correctly: creating the first admin user *before* turning on `--auth`, because MongoDB never creates a default root or admin account for you, with or without x.509.
- Encrypting client-to-cluster and member-to-member traffic with TLS on a self-managed deployment that crosses a network boundary — a multi-region replica set, or application servers reaching MongoDB over anything less trusted than a private VPC — since self-managed MongoDB ships with TLS off by default.
- Deciding whether a managed platform's enforced transport encryption (Atlas requires TLS and won't let you turn it off) is enough on its own, or whether specific columns — SSNs, payment tokens — still need field-level protection on top of it via Queryable Encryption.
- Restricting network exposure with `--bind_ip` and firewall rules as the first line of defense, before authentication ever enters the picture — the book's own ordering: "restrict access as tightly as possible between the outside world and MongoDB" comes before the authentication chapter, not after.

## Deep Dive

### Authentication is not authorization

The book draws the line precisely: "the purpose of authentication is to verify the identity of a user, while authorization determines the verified user's access to resources and operations." Enabling authorization on a cluster is what *enforces* authentication in practice — once it's on, every connection has to prove who it is before its role-based permissions mean anything. Community MongoDB supports **SCRAM** (Salted Challenge Response Authentication Mechanism) and **x.509 certificate authentication** out of the box; Enterprise adds Kerberos and LDAP proxy authentication. Neither authentication nor authorization is on by default — you enable both explicitly with `--auth` on the command line or `security.authorization: enabled` in a config file.

### x.509: authenticating members and clients with certificates

The book focuses its tutorial on x.509 because it's the mechanism that secures not just client connections but the replica set's own internal traffic — every member has to authenticate with every other member to exchange data. For that, "it's necessary that a trusted certification authority (CA) sign all certificates," acting as a trusted third party against man-in-the-middle attacks.

The tutorial's structure, condensed:

1. **Establish a CA hierarchy.** Generate a self-signed root CA (`openssl genrsa` + `openssl req -x509`), then an intermediate *signing* CA signed by the root. Best practice signs server and client certificates with the intermediate, not the root — "if the intermediate CA is compromised and the certificate needs to be revoked, only a portion of the trust tree is affected instead of all certificates."
2. **Sign member certificates** (one per `mongod`/`mongos`) and **client certificates** (one per human or application connecting) using the signing CA. The book is explicit about what distinguishes the two categories: they must differ in their Distinguished Name — specifically in the Organization (O), Organizational Unit (OU), or Domain Component (DC) — which is why the tutorial uses `OU=MyServers` for member certs and `OU=MyClients` for client certs. All certificates from members of the same cluster must share the same O/OU/DC, and each certificate's Common Name or Subject Alternative Name must match the hostname it's issued for.
3. **Bring up the replica set without auth first**, initiate it, and only then create the first admin user — because there is no default admin account, x.509 or otherwise.
4. **Create the admin user in the `$external` database.** Each x.509 client certificate maps to exactly one MongoDB user; you can't reuse one certificate for two identities. The user is created with the certificate's *subject* as the username:

   ```javascript
   db.getSiblingDB("$external").runCommand({
     createUser: "CN=client1,OU=MyClients,O=MongoDB,L=New York,ST=NY,C=US",
     roles: [
       { role: "readWrite", db: "test" },
       { role: "userAdminAnyDatabase", db: "admin" },
       { role: "clusterAdmin", db: "admin" }
     ],
     writeConcern: { w: "majority", wtimeout: 5000 }
   });
   ```

5. **Restart every member with auth and TLS enabled**, pointing at the certificates: `--tlsMode requireTLS --clusterAuthMode x509 --tlsCAFile root-ca.pem --tlsCertificateKeyFile <host>.pem --tlsClusterFile <host>.pem`. The CA file establishes a trust chain — the server trusts anything signed by the certificates it contains.
6. **Connect with a client certificate** instead of a password: `mongo --tls --tlsCertificateKeyFile client1.pem --tlsCAFile root-ca.pem --authenticationDatabase '$external' --authenticationMechanism MONGODB-X509`. Connecting with a *different* certificate whose subject was never registered as a user fails outright — the book shows the exact error, `Could not find user "CN=client2,..." for db "$external"`.

The book's own closing caveats are worth keeping: the directories holding the CA and signing keys need to be protected from unauthorized access, and in the tutorial the keys are deliberately left unpassword-protected for simplicity — "in production it is necessary to use passwords to protect the key from unauthorized use."

### Authorization: built-in roles and the admin bootstrap problem

Creating a user always happens *in* a specific database — that database becomes the user's authentication database, but a user's privileges are **not** limited to it. When you create a user you grant a set of roles, each scoped to whichever database it targets. MongoDB ships a long list of built-in roles so you rarely need to hand-assemble privilege documents from scratch:

| Role | Grants |
|---|---|
| `read` | Read all nonsystem collections (plus a few system ones) |
| `readWrite` | `read`, plus write to nonsystem collections |
| `dbAdmin` | Schema tasks, indexing, statistics — not user/role management |
| `userAdmin` | Create and modify roles and users on the current database |
| `dbOwner` | `readWrite` + `dbAdmin` + `userAdmin` combined |
| `clusterManager` | Cluster management and monitoring actions |
| `clusterMonitor` | Read-only access to monitoring tools |
| `hostManager` | Monitor and manage servers |
| `clusterAdmin` | `clusterManager` + `clusterMonitor` + `hostManager` + `dropDatabase` |
| `backup` | Enough to back up an entire `mongod` instance |
| `restore` | Restore from backups (excluding `system.profile` data) |
| `readAnyDatabase` | `read` on every database except `local`/`config`, plus `listDatabases` |
| `readWriteAnyDatabase` | `readWrite` on every database except `local`/`config`, plus `listDatabases` |
| `userAdminAnyDatabase` | `userAdmin` on every database except `local`/`config` — effectively superuser |
| `dbAdminAnyDatabase` | `dbAdmin` on every database except `local`/`config`, plus `listDatabases` |
| `root` | `readWriteAnyDatabase` + `dbAdminAnyDatabase` + `userAdminAnyDatabase` + `clusterAdmin` + `restore` + `backup`, combined |

Beyond these, **user-defined roles** let you group a specific set of permitted operations under a name and hand that set out to multiple users at once — the tool for "this role needs exactly these five actions and nothing else" when no built-in role fits.

One operational gotcha the book flags directly and that trips people up on a fresh cluster: **MongoDB does not create a default root or admin user when you enable authentication and authorization** — not with SCRAM, not with x.509. The correct sequence is always: bring the cluster up without auth, create the admin user, then restart with auth enabled. Starting with `--auth` on a brand-new, userless cluster locks you out of your own database.

### Network-level containment, ahead of authentication

The book's production security section puts network restriction *before* auth in its list of priorities: "do not set up publicly addressable MongoDB servers... restrict access as tightly as possible." The relevant options:

- `--bind_ip` — which interfaces `mongod`/`mongos` listen on. Since MongoDB 3.6, both bind to `localhost` **by default**, accepting only same-machine connections unless you explicitly widen it — a deliberate hardening of the previous default, which used to bind to all interfaces.
- `--nounixsocket` — disables the UNIX domain socket if you're never connecting to it locally.
- `--noscripting` — disables server-side JavaScript execution, closing off a class of reported MongoDB security issues, at the cost of breaking shell helpers like `sh.status()` that assume it's available.

### Encryption in transit: TLS/SSL

TLS/SSL transport encryption is available in **every** MongoDB edition (Community included) and uses the native TLS libraries of the host OS. It is configured with `--tlsMode` and friends — `disabled`, `allowTLS`, `preferTLS`, `requireTLS` — plus `--tlsCAFile` and `--tlsCertificateKeyFile` for the trust chain and the server's own certificate. The book states the self-managed default plainly: "by default, connections to MongoDB transfer data unencrypted." TLS on self-managed MongoDB is something you turn on, not something you opt out of.

### Encryption at rest: Enterprise only, and distinct from Queryable Encryption

The book is equally direct that this feature is Enterprise-gated: "data encryption is available in MongoDB Enterprise. These options are not supported in the Community version of MongoDB." The mechanism is a standard key hierarchy — generate a master key, generate a key per database, encrypt the data with the database keys, encrypt the database keys with the master key — implemented inside the WiredTiger storage engine via `--enableEncryption`, `--encryptionCipherMode` (`AES256-CBC` or `AES256-GCM`), and `--encryptionKeyFile` (or KMIP for centralized key management). Data is encrypted at rest and decrypted only in memory and during transmission — which is exactly why it's paired with TLS rather than a substitute for it.

This whole-database, storage-layer encryption is a different feature from **Queryable Encryption**, introduced years after this book's 3rd edition, which encrypts individual *fields* client-side so the server itself never handles their plaintext, even in memory — see `mongodb-atlas-search-and-vector-search` for that mechanism. The two are complementary: encryption at rest protects the whole data file if a disk is stolen; Queryable Encryption protects specific sensitive fields even from the database server operator itself.

### Book vs today

> **SCRAM-SHA-256 is the modern default, and the book's chapter doesn't need it corrected so much as filled in.** The book's authentication chapter focuses entirely on x.509 and only names SCRAM in passing. Current MongoDB `db.createUser()` picks **SCRAM-SHA-256** as the default authentication mechanism when none is specified (as long as the driver and deployment support it), with the older **SCRAM-SHA-1** still available for compatibility and required in some FIPS configurations to be paired with SCRAM-SHA-256, Kerberos, LDAP, or x.509 instead of SHA-1 alone. Nothing in the book is wrong here — it just never went deep enough into SCRAM specifically for there to be a version-drift gap.

> **Atlas enforces TLS by default; self-managed MongoDB still doesn't.** This is the one place "book vs today" actually splits by *deployment target* rather than by version. Everything the book says about self-managed MongoDB shipping with TLS off (`net.tls.mode` defaults to `disabled`) remains accurate for a self-hosted `mongod` today — you still have to opt in with `requireTLS` or similar, exactly as the tutorial's CA-building exercise implies. MongoDB Atlas, which didn't exist as the book's primary deployment target and predates its focus, enforces TLS on every client connection and gives you no way to turn it off — a `mongodb+srv://` connection string implies TLS automatically. The book's world (TLS as something you build yourself) and Atlas's world (TLS as a mandatory platform guarantee) are both true today, for different deployment models.

> **`clusterAuthMode` and keyfile auth are still there, and x.509 remains the stronger option the book presents it as.** Nothing about the tutorial's mechanics is deprecated — replica sets and sharded clusters still support `x509` as a `clusterAuthMode` today, and the certificate-signing workflow (root CA, intermediate signing CA, member vs. client OU distinction) is unchanged. The simpler keyfile-based internal auth the book mentions only in passing remains the lower-friction default for many deployments; x.509 is what you reach for when keyfile auth's "anyone with the file is a full member" model isn't strong enough.

## Trade-offs

- **x.509 buys strong per-identity authentication and a real PKI operations burden.** Every certificate has an expiry, every CA needs its private key protected (the book's own tutorial deliberately skips password-protecting the signing keys "for simplicity" and flags that as unacceptable in production), and rotating a compromised intermediate CA means re-issuing every certificate signed under it. SCRAM's shared-secret model is simpler to operate day to day; x.509 is what you take on when you specifically need cryptographic proof of identity for cluster members, not just a password.
- **Built-in roles are convenient and an easy path to over-privilege.** `root` or `dbOwner` "basically works" for almost any task, which is exactly the problem — the book lists a dozen more targeted roles precisely because reaching for the broadest one that fits is the default failure mode. A user-defined role costs more to design but doesn't hand an application service account cluster-admin powers it will never use.
- **The no-default-admin-user rule is a safety feature that is also an easy way to lock yourself out.** MongoDB refusing to create a default root account means there's no factory-set credential for an attacker to guess — but it also means enabling `--auth` on a cluster before creating any user is unrecoverable without restarting without auth again. The book's bring-up-without-auth-first sequence exists because there's no other way in.
- **Network restriction is necessary but was never meant to be sufficient on its own.** `--bind_ip` defaulting to localhost since 3.6 and firewalling off the outside world stops opportunistic scanning, but it does nothing once a connection is already inside the trusted network — which is exactly the gap authentication and authorization exist to close. The book's own chapter ordering (network security, then auth, then encryption) reads as defense in depth, not as any one layer being enough by itself.
- **Encryption at rest is Enterprise-only, which pushes Community users onto filesystem-level alternatives.** If the built-in WiredTiger encryption isn't available on your license tier, the fallback is disk- or volume-level encryption (LUKS, cloud provider EBS/disk encryption) managed entirely outside MongoDB — it protects the same threat (a stolen disk), but with none of the per-database key granularity or KMIP integration the book describes.
- **TLS protects data in motion and says nothing about what a compromised server can see.** A cluster with `requireTLS`, x.509 client auth, and tightly scoped RBAC still has one property in common with the pre-encryption-at-rest, pre-Queryable-Encryption world: any operation that queries the database sees plaintext. Where that's unacceptable — a field an attacker with database access, or even a curious admin, must never see — is precisely the case Queryable Encryption exists for, layered on top of everything in this concept rather than replacing any of it.

## Documentation Links

- Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020) — Chapter 19, "An Introduction to MongoDB Security", p. 389-404 — doc
- Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020) — Chapter 21, "Setting Up MongoDB in Production" (Security, Data Encryption, SSL Connections), p. 415-424 — doc
- [MongoDB Documentation — SCRAM](https://www.mongodb.com/docs/manual/core/security-scram/) — doc
- [MongoDB Documentation — Use x.509 Certificates to Authenticate Clients](https://www.mongodb.com/docs/manual/tutorial/configure-x509-client-authentication/) — doc
- [MongoDB Documentation — Built-In Roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/) — doc
- [MongoDB Documentation — Configure TLS/SSL](https://www.mongodb.com/docs/manual/tutorial/configure-ssl/) — doc
- [MongoDB Documentation — Encryption at Rest](https://www.mongodb.com/docs/manual/core/security-encryption-at-rest/) — doc
- [MongoDB Atlas Documentation — Security FAQ (TLS enforcement)](https://www.mongodb.com/docs/atlas/reference/faq/security/) — doc
