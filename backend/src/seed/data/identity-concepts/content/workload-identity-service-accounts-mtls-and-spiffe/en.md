---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Services need identities too, and the usual one is a secret: an API key in an environment variable, a client secret in CI, a password in a config map. It leaks, nobody rotates it, and it says nothing about which workload used it. Workload identity replaces it with a different question: what proves WHO this process is, and can that proof be short lived and issued without a human? This lesson measures the answers you can run locally: your own CA and mTLS (what the server really reads from a certificate), then SPIFFE/SPIRE in Docker (SVIDs, attestation by selector, two workloads doing mTLS with an ID check, rotation, and what "revocation" really is). Kubernetes projected ServiceAccount tokens, GitHub Actions OIDC federation, cloud managed identities and service meshes are docs only here (no cluster, no cloud account), with the trust condition of the CI case tested in code. Tools: openssl, curl, jq, Node 22 (the protocol is the point, not the stack).
Versions: SPIRE server and agent 1.16.0 (`ghcr.io/spiffe/spire-server:1.16.0`, `spire-agent:1.16.0`), OpenSSL 4.0.3, curl 8.7.1 (LibreSSL), jq 1.7.1, Node 22.23.4. Docs only: Kubernetes (no `kind` or `minikube` here), GitHub Actions, AWS, Azure, GCP, Istio, Linkerd.

## Use Cases

- Replacing a static API key or client secret between two internal services.
- Reviewing a pipeline that deploys to a cloud with a long-lived key stored as a CI secret.
- Deciding between mTLS from your own CA, SPIFFE/SPIRE, a mesh, or a platform feature (Kubernetes, managed identity).
- Reading an audit log and answering "which workload called this", not only "which user".

## Deep Dive

### The problem: secret zero

A static credential has three flaws. It is copied (repo, image layer, log, laptop), so a leak is silent. It rarely rotates, since rotation means coordinating every holder. And it identifies the key, not the caller: two services sharing it are indistinguishable. Whatever replaces it hits a bootstrap question, "secret zero": to get a credential you must already prove something. The answer of every modern scheme is the same: prove it with something the platform vouches for (the node, the Pod, the CI run), not with something you carry. In the OAuth lesson this is the client credentials grant, where the `client_secret` is exactly what workload identity removes; the token exchange lesson used `a-secret` for service A and flagged it as what not to ship.

### Option 1: a certificate from your own CA, and mTLS (measured)

A certificate is a public key signed by a CA that the peer trusts. With mTLS both sides present one, so the connection itself authenticates the caller, with no secret on the wire. A throwaway CA and three service certificates, EC P-256, valid 1 day:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ca.key -out ca.crt -days 30 \
  -subj "/CN=Lab Internal CA" -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout billing.key -out billing.csr -subj "/CN=billing"
printf "subjectAltName=DNS:billing.lab\nextendedKeyUsage=clientAuth,serverAuth\nkeyUsage=digitalSignature\nbasicConstraints=CA:FALSE\n" > billing.ext
openssl x509 -req -in billing.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out billing.crt -days 1 -extfile billing.ext
```

```text
subject=CN=billing        issuer=CN=Lab Internal CA
notBefore=Nov 19 09:08:36 2026 GMT   notAfter=Nov 20 09:08:36 2026 GMT
X509v3 Subject Alternative Name: DNS:billing.lab      Extended Key Usage: TLS Web Client Authentication, TLS Web Server Authentication
```

The server (`orders`, port 6640) is 8 lines of Node: TLS checks the chain, the application reads the verified peer certificate and authorizes from the **SAN**, never from the CN (RFC 6125 and the CA/Browser rules deprecated CN for names years ago):

```js
https.createServer({ key, cert, ca, requestCert: true, rejectUnauthorized: true }, (req, res) => {
  const c = req.socket.getPeerCertificate();
  const ok = (c.subjectaltname || '').split(', ').some(s => (allow[req.url] || []).includes(s)); // allow = {'/invoices': ['DNS:billing.lab']}
  res.writeHead(ok ? 200 : 403); res.end(JSON.stringify({ cn: c.subject.CN, san: c.subjectaltname, allowed: ok }));
}).listen(6640);
```

```text
curl --cacert ca.crt --cert billing.crt --key billing.key https://localhost:6640/invoices
  -> {"cn":"billing","san":"DNS:billing.lab","valid_to":"Nov 20 09:08:36 2026 GMT","allowed":true}  HTTP 200
reports cert (same CA, SAN reports.lab)   -> {"cn":"reports","san":"DNS:reports.lab","allowed":false}  HTTP 403
no client certificate                     -> curl: (56) ... ; server: peer did not return a certificate
cert from another CA with the SAME subject name "Lab Internal CA" (mallory)
                                          -> curl: (56) Connection reset ; server: ERR_SSL_PROVIDER_SIGNATURE_FAILURE
cert whose notAfter is in the past        -> Connection reset ; openssl s_server: "verify error:num=10:certificate has expired"
client without --cacert                   -> curl: (60) self signed certificate in certificate chain
URL name billing.lab (server cert is orders.lab/localhost) -> curl: (60) no alternative certificate subject name matches target host name
```

Two lessons. Authentication (chain, validity) is TLS's job and is refused in the handshake, authorization (who may call `/invoices`) is still your code: `reports` has a perfectly valid certificate and gets a 403. And the mallory case shows how the chain is matched: OpenSSL finds the issuer by name, then fails on the SIGNATURE, so the same name with another key is rejected. The handshake itself, with `openssl s_server -Verify 1` and `s_client`, ends in `Verification: OK`, TLSv1.3, `TLS_AES_256_GCM_SHA384`, `Peer signature type: ecdsa_secp256r1_sha256`. Cost, 50 runs against the Node server: 7.1 ms median per new connection (curl process start included) against 0.27 ms per request on a reused connection: reuse connections, the handshake is the price.

What this does not solve: who runs the CA, who may ask it for a `billing` certificate (that is secret zero again), and how 1 day certificates get renewed. That machinery is what SPIFFE/SPIRE adds.

### SPIFFE and SPIRE: the model

SPIFFE is a spec, SPIRE is the reference implementation. Four terms:

- **SPIFFE ID**: a URI, `spiffe://<trust domain>/<path>`, the name of a workload (`spiffe://lab.example/billing`). The trust domain is the boundary of one CA.
- **SVID** (SPIFFE Verifiable Identity Document): the proof of that ID. Two forms: **X.509-SVID** (a certificate with the ID as the only URI SAN, usable for mTLS) and **JWT-SVID** (a signed token with `sub`, `aud`, `exp`, for places TLS terminates, such as L7 proxies).
- **Trust bundle**: the public CA certificates (X.509 authorities) and JWT keys of a trust domain, how a peer verifies an SVID.
- **Workload API**: a local Unix socket on which a workload asks "who am I?" and gets SVIDs and the bundle. No credential is needed to call it: the agent identifies the caller from the kernel.

SPIRE has a **server** (the CA and the registry of entries) and an **agent** on every node. Identity is issued in two attestation steps. **Node attestation**: the agent proves to the server what node it runs on, with a platform document (AWS instance identity, Kubernetes PSAT, Azure MSI, TPM...) or, in the lab, a one-time `join_token`. **Workload attestation**: when a process calls the Workload API, the agent asks the kernel and plugins about it (Unix uid and path, Kubernetes namespace, ServiceAccount and Pod labels, Docker labels), producing **selectors**. An **entry** in the server says "parent = this agent, selectors = these, ID = this", and the agent hands the matching SVID to the caller. Nothing in the workload holds a secret.

### SPIRE in Docker (measured)

Lab: `idn-wl-spire-server` and `idn-wl-spire-agent` on a private Docker network, trust domain `lab.example`, SQLite datastore, `join_token` for the node and `unix` for workloads (the simplest pair that works in Docker), SVID TTL 2 minutes so rotation is visible. The images are distroless (no shell), so a workload here is the `spire-agent` binary itself run with `docker exec -u <uid>`, and the selector is the uid. Server config, the parts that matter:

```text
server { trust_domain = "lab.example"  ca_ttl = "24h"  default_x509_svid_ttl = "2m"  default_jwt_svid_ttl = "2m" }
plugins { DataStore "sql" {...sqlite3}  NodeAttestor "join_token" {}  KeyManager "memory" {} }
```

```text
$ spire-server token generate -ttl 300                       # one-time node credential
agent log: Node attestation was successful reattestable=false
           spiffe_id=spiffe://lab.example/spire/agent/join_token/f17b600e-...
$ spire-server entry create -parentID <that agent id> -spiffeID spiffe://lab.example/billing -selector unix:uid:1001
$ spire-server entry create -parentID <that agent id> -spiffeID spiffe://lab.example/orders  -selector unix:uid:1002
```

Workloads ask for their identity (uid 1001, 1002, then 1003 which has no entry):

```text
uid 1001: SPIFFE ID: spiffe://lab.example/billing   SVID Valid After 09:09:59, Valid Until 09:12:09   (CA valid until next day 09:09:30)
uid 1002: SPIFFE ID: spiffe://lab.example/orders
uid 1003: rpc error: code = PermissionDenied desc = no identity issued          (agent log: registered=false)
```

The first fetch, a few seconds after creating the entries, also failed with the same error: the agent syncs entries on an interval (5 s by default), so a new entry takes a few seconds to become visible. The X.509-SVID, decoded with openssl:

```text
subject=C=US, O=SPIRE      issuer=C=US, O=SPIFFE, serialNumber=8691...5765
notBefore=09:09:59  notAfter=09:12:09          (130 s window for a 120 s TTL: the start is backdated 10 s for clock skew)
X509v3 Subject Alternative Name: URI:spiffe://lab.example/billing
Key Usage (critical): Digital Signature, Key Encipherment, Key Agreement    EKU: Server Auth, Client Auth    CA:FALSE
$ openssl verify -CAfile bundle.0.pem svid.0.pem   -> svid.0.pem: OK
```

The identity is the URI SAN: no hostname, no CN. The bundle is the CA of `spiffe://lab.example`. A **JWT-SVID** for audience `orders.lab` (`spire-agent api fetch jwt -audience orders.lab`), decoded:

```text
header : {"alg":"ES256","kid":"87ANiYLUqY1Zy2c2hhOwpf5UZBFWx8xf","typ":"JWT"}
payload: {"aud":["orders.lab"],"exp":1795079541,"iat":1795079421,"sub":"spiffe://lab.example/billing"}
spire-agent api validate jwt -audience orders.lab    -> SVID is valid.  SPIFFE ID : spiffe://lab.example/billing
spire-agent api validate jwt -audience payments.lab  -> SVID is not valid: expected audience in ["payments.lab"] (audience=["orders.lab"])
```

The `aud` is mandatory and the verifier must demand its own: the same replay defense as in OAuth (a bearer JWT-SVID works for whoever holds it, so keep it short and audience bound; prefer the X.509-SVID where you control the TLS endpoint).

### Two workloads, mTLS, authorization by SPIFFE ID (measured)

`orders` (uid 1002) listens with its SVID, `billing` (1001) and `reports` (1003, given a temporary entry) connect with theirs. Both sides verify the chain against the bundle, and the identity check replaces hostname matching: the client demands that the server's URI SAN is `spiffe://lab.example/orders`, the server holds an allow list of SPIFFE IDs.

```js
const spiffeId = c => (c.subjectaltname || '').split(', ').find(s => s.startsWith('URI:spiffe://'))?.slice(4);
// server: tls.createServer({ key, cert, ca: bundle, requestCert: true, rejectUnauthorized: true }, s => { allowed = spiffeId(...) === 'spiffe://lab.example/billing' })
// client: tls.connect({ key, cert, ca: bundle, checkServerIdentity: (_, c) => spiffeId(c) === 'spiffe://lab.example/orders' ? undefined : new Error(...) })
```

```text
u1001: {"caller":"spiffe://lab.example/billing","allowed":true}
u1003: {"caller":"spiffe://lab.example/reports","allowed":false}
```

`reports` completes the handshake (a valid SVID from the same CA) and is refused by the allow list, the same split as in the openssl lab: the chain proves the ID, an ID check authorizes. Real deployments do this in a proxy (Envoy SDS), a library (`go-spiffe`, `java-spiffe`) or the mesh, not hand rolled.

### Rotation and "revocation" (measured)

```text
09:10:41 reports SVID created   09:10:51 agent SVID renewed   09:11:05 orders renewed   09:11:10 billing renewed
billing serial 87DB52EA... (09:09:59, 09:12:09)  ->  2CFFC0A4... (09:11:00, 09:13:10)
```

The agent renews at roughly half of the lifetime and the workload, watching the Workload API stream, receives the new SVID with no restart. Now the harder question. Entry for `reports` deleted at 09:11:24:

```text
09:11:32  fetch as uid 1003 -> rpc error: code = PermissionDenied desc = no identity issued
09:11:32  the SVID already issued: notAfter 09:12:41, `openssl verify -CAfile bundle.0.pem svid.0.pem` -> OK
```

Deleting the entry stops FUTURE issuance (within one sync) but an SVID in hand keeps verifying until it expires. X.509 revocation lists are not how this works: the control is the short TTL (default 1 hour in SPIRE, 2 minutes here), so the revocation window equals the TTL. Pick it as you would pick an access token lifetime. Two production notes from the lab itself: the `join_token` is a one-time bearer secret for the agent (secret zero moved from the workload to the node), and the agent log warned `reattestable=false`: with this attestor a restarted agent cannot get a new identity without a new token. Platform attestors (`k8s_psat`, `aws_iid`, `azure_msi`, `gcp_iit`, `tpm_devid`, `x509pop`; docs only here) prove the node from the platform and can re-attest on their own, which is why `join_token` is for labs.

### Kubernetes ServiceAccount tokens (docs only: no cluster here)

No `kind` or `minikube` is installed in this lab, so nothing below was run. Every Pod runs as a ServiceAccount, and since Kubernetes 1.22 the credential is a **projected, bound token** obtained through the TokenRequest API, not a stored Secret. In a pod spec:

```yaml
volumes: [{ name: vault-token, projected: { sources: [{ serviceAccountToken: { path: vault-token, expirationSeconds: 7200, audience: vault } }] } }]
```

The kubelet requests and refreshes it; the JWT carries `iss` (the cluster's issuer), `aud` (what you asked for, or the API server default), `exp`, and a `kubernetes.io` claim with the namespace, ServiceAccount and the Pod it is bound to, so deleting the Pod invalidates it. Because the audience is chosen per token, one Pod can hold a token only Vault accepts and none usable against the API server. When `--service-account-issuer` is an HTTPS URL, the API server publishes `/.well-known/openid-configuration` and `/openid/v1/jwks` (readable by every ServiceAccount via `system:service-account-issuer-discovery`), so an external system validates the token like any OIDC token: that is the whole of "Kubernetes as an identity provider". The Kubernetes lessons here already show a real decoded token (k3s) and the automount and RBAC side; this lesson only adds the identity view: the ServiceAccount is a workload ID, and what it may do inside the cluster is RBAC.

### CI federation: GitHub Actions OIDC (docs only, trust condition tested)

The classic bad practice is a cloud access key stored as a CI secret. With OIDC federation the workflow asks GitHub for a JWT and the cloud (or Vault) exchanges it for short-lived credentials. GitHub's issuer is `https://token.actions.githubusercontent.com` (its discovery document is public: `jwks_uri` `.../.well-known/jwks`, signing alg `RS256`, claims such as `sub`, `aud`, `repository`, `repository_id`, `repository_owner_id`, `ref`, `environment`, `job_workflow_ref`, `workflow_ref`). The doc has no full sample token, so the payload below is built from its claims table and sub formats, not a captured token:

```text
{"iss":"https://token.actions.githubusercontent.com","aud":"sts.lab.example",
 "sub":"repo:octo-org/octo-repo:ref:refs/heads/main","repository":"octo-org/octo-repo","ref":"refs/heads/main"}
```

The security is entirely in the trust condition that the role holds. `gh-trust.mjs` evaluates three conditions (glob match on `sub`, `iss` and `aud` checked) against four `sub` values:

```text
condition repo:octo-org/*                              ALLOW main, ALLOW pull_request, ALLOW side-project:anything, ALLOW environment:production
condition repo:octo-org/octo-repo:ref:refs/heads/main  ALLOW main, deny the other three
condition repo:octo-org/octo-repo:environment:production   ALLOW only the production environment job
```

The classic mistake is the first: any repository in the org, any branch or pull request, can assume the role, so a hobby repo or a PR from a branch becomes a way into production. Pin `sub` to one repository AND a ref or an environment (environments can require approvals), keep `aud` specific, and use the `repository_id` and `repository_owner_id` claims (the doc recommends them, since names can be renamed or re-registered). Never trust the issuer alone: the issuer signs tokens for every repository on GitHub.

### Cloud identities and mesh (docs only, the principle)

Same shape everywhere: the platform attests the workload and the cloud exchanges that proof for a short-lived credential, so no key is stored. **Azure**: managed identities for Azure resources, and Workload Identity Federation for external OIDC issuers such as Kubernetes or GitHub, with a federated credential matching `issuer`, `subject`, `audience`. **AWS**: IAM roles for service accounts (IRSA) and EKS Pod Identity (an agent on the node vends credentials to a Pod), with a role trust policy on the token `sub`. **GCP**: Workload Identity Federation with attribute conditions. **Meshes** (Istio, Linkerd): the sidecar or ambient node proxy obtains a short-lived workload certificate per ServiceAccount (Istio uses SPIFFE IDs of the form `spiffe://<domain>/ns/<namespace>/sa/<serviceaccount>`) and does mTLS between services automatically, so apps get the encryption and identity without code. You then write authorization on the identity (`AuthorizationPolicy`), the same allow list as above.

### The anti-pattern: user tokens between services

A tempting shortcut is to pass the user's access token from service to service as the "identity". It fails on audience, it hides which service acted, and it gives every service in the chain the user's full authority; the token exchange lesson measured that on the wire. Workload identity is the other half: services authenticate as themselves (this lesson), and the user is carried as data or as a delegated token (that lesson), never by borrowing the user's credential as the service's identity. Both layers should show in the audit log.

### Rotation, audit and attribution

- **Rotation**: automatic and routine (renewal at half life, measured), or you do not do it. A credential that needs a human to rotate will be rotated rarely.
- **Revocation**: by lifetime (measured: the old SVID verified until `notAfter`). For faster cut-off use a TTL of minutes, a deny rule at the policy layer, or both; do not rely on CRLs for workload certificates.
- **Attribution**: log the verified ID at the callee (`spiffe://lab.example/billing`, the cert SAN, the ServiceAccount `sub`, the GitHub `sub`), plus the user (`sub`, `act`) if there is one. "Which workload called which" is the trail an incident needs and a shared API key cannot give.
- **Secret zero, summarized**: SPIRE moves it to node attestation (the platform vouches), Kubernetes moves it to the kubelet, CI federation moves it to the CI platform's signing key. Each shifts trust to a smaller, better guarded place. NIST SP 800-207 (Zero Trust) frames this: authenticate and authorize every workload request, with no trust from network location.

### Which mechanism, and its trap

| Mechanism | What it proves | Credential life | Who validates | Trap |
|---|---|---|---|---|
| Static API key or secret | possession of the string | until someone rotates it | the callee compares it | copied, shared, not attributable |
| Client credentials with secret | the client knows its secret | token minutes, secret long | the authorization server | the secret is secret zero again |
| mTLS, own CA | holder of a CA-signed key | cert days to weeks, as you issue | TLS peer, then app on the SAN | no automation: renewal and who may ask for a cert |
| SPIFFE/SPIRE X.509 or JWT SVID | attested node plus workload selectors | minutes to 1 hour, auto-rotated | peer against the bundle, allow list of IDs | revocation = TTL; `join_token` is lab only |
| Kubernetes projected token | this Pod, this ServiceAccount, this audience | `expirationSeconds`, auto-refreshed | API server or any OIDC verifier via JWKS | audience not checked by the verifier |
| CI OIDC (GitHub Actions) | this run of this repository, ref, environment | the token minutes, then cloud credentials | cloud or Vault by `iss`, `aud`, `sub` | loose `sub` such as `repo:org/*` |
| Cloud managed identity | this resource or Pod, by the platform | minutes to hours | the cloud IAM | one identity shared by many workloads |
| Mesh mTLS (Istio, Linkerd) | this ServiceAccount's proxy | hours, auto-rotated | the peer proxy | identity only as fine as the ServiceAccount |

### Where to go next

Token exchange (I13) carries the user across services once each service has its own identity; the OAuth security lesson covers binding tokens to a certificate (`cnf`, RFC 8705), which is the OAuth side of the mTLS measured here. Secret storage, vaults, rotation and just-in-time privileged access (I20) cover the credentials that remain after you remove what you can.

## Trade-offs

- **Own CA versus SPIRE.** openssl and a script are enough for a few services and teach the protocol, but renewal, distribution and "who may get which name" become your code; SPIRE automates all three at the cost of running a server, agents and registration.
- **X.509-SVID versus JWT-SVID.** X.509 is not replayable without the private key and fits mTLS; JWT-SVID travels through proxies that terminate TLS but is a bearer token, so keep it short and audience bound.
- **Short TTL versus load.** A 2 minute TTL makes revocation fast (measured: an issued SVID stopped verifying only at its 2 minute expiry) and renewal constant; an hour is easier to run and a longer exposure.
- **Authentication versus authorization.** A valid SVID or certificate (`reports` here) is not permission: keep an allow list or policy engine on the ID.
- **Platform identity versus portability.** IRSA, managed identity and projected tokens are the least work on one platform; SPIFFE gives one ID across clouds and VMs for a larger operational footprint.

## Documentation Links

- [SPIFFE Concepts, SPIFFE](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/) (doc)
- [SPIRE Concepts, SPIFFE](https://spiffe.io/docs/latest/spire-about/spire-concepts/) (doc)
- [Registering workloads, SPIFFE](https://spiffe.io/docs/latest/deploying/registering/) (doc)
- [The X.509-SVID specification, SPIFFE](https://github.com/spiffe/spiffe/blob/main/standards/X509-SVID.md) (doc)
- [The JWT-SVID specification, SPIFFE](https://github.com/spiffe/spiffe/blob/main/standards/JWT-SVID.md) (doc)
- [Service Accounts, Kubernetes](https://kubernetes.io/docs/concepts/security/service-accounts/) (doc)
- [Managing Service Accounts (projected tokens, issuer discovery), Kubernetes](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/) (doc)
- [OpenID Connect in GitHub Actions (security hardening), GitHub Docs](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) (doc)
- [OpenID Connect reference (claims), GitHub Docs](https://docs.github.com/en/actions/reference/security/oidc) (doc)
- [Workload identities overview, Microsoft Learn](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-overview) (doc)
- [EKS Pod Identity, AWS](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html) (doc)
- [Workload Identity Federation, Google Cloud](https://cloud.google.com/iam/docs/workload-identity-federation) (doc)
- [Istio security concepts, Istio](https://istio.io/latest/docs/concepts/security/) (doc)
- [Automatic mTLS, Linkerd](https://linkerd.io/2/features/automatic-mtls/) (doc)
- [RFC 8705, OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens, IETF](https://datatracker.ietf.org/doc/html/rfc8705) (doc)
- [NIST SP 800-207, Zero Trust Architecture, NIST](https://csrc.nist.gov/pubs/sp/800/207/final) (doc)
