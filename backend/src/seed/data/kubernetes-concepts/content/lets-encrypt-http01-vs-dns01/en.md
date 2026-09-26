---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Let's Encrypt issues publicly trusted certificates for free, over the ACME protocol, after you prove you control the domain. cert-manager automates that proof with one of two challenge types: **HTTP-01** (serve a token on `http://<domain>/.well-known/acme-challenge/...`) or **DNS-01** (publish a token in a `TXT` record). They have different requirements, and picking the wrong one is the main reason certificates stay `READY False`. This concept covers an ACME ClusterIssuer, both challenges, staging vs production, rate limits, and the shorter certificate lifetimes Let's Encrypt is rolling out.

## Use Cases

- Public HTTPS for an API and a login page on a node with a public IP.
- Certificates for a cluster that is **not** reachable from the internet (office network, VPN only).
- Wildcard certificates (`*.example.com`).
- Understanding a challenge stuck in `pending`.

## Deep Dive

### An ACME ClusterIssuer

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: {name: letsencrypt-staging}
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: platform-team@example.com
    privateKeySecretRef: {name: letsencrypt-staging-account}
    solvers:
      - http01:
          ingress: {ingressClassName: public}
```

Start with **staging**. Its certificates are not trusted by browsers, but its rate limits are generous, so a misconfiguration does not lock you out. Switch `server` to `https://acme-v02.api.letsencrypt.org/directory` (and use a separate issuer name and account Secret) once staging certificates are issued successfully.

Then annotate an Ingress exactly as with any issuer: `cert-manager.io/cluster-issuer: letsencrypt-prod`.

### HTTP-01

cert-manager creates a temporary Ingress (or HTTPRoute) and solver Pod that serves the token. Let's Encrypt's validation servers, **from the public internet**, fetch:

```
http://api.example.com/.well-known/acme-challenge/<token>
```

Requirements:

- Public DNS `A`/`AAAA` for the hostname pointing to the node or its load balancer.
- **Port 80** reachable from the internet (validation always starts on port 80; redirects to 443 are followed).
- The solver's Ingress must be served by the controller you name in `ingressClassName`.

Limits: no wildcards, one validation per hostname, and it simply cannot work for a cluster that the internet cannot reach. If a firewall allows only 443, HTTP-01 fails.

### DNS-01

cert-manager creates a `TXT` record `_acme-challenge.example.com` through your DNS provider's API, Let's Encrypt queries public DNS, cert-manager removes the record afterwards.

```yaml
solvers:
  - dns01:
      cloudflare:
        apiTokenSecretRef:
          name: cloudflare-api-token      # in the cert-manager namespace for a ClusterIssuer
          key: api-token
    selector:
      dnsZones: [example.com]
```

cert-manager supports Cloudflare, Route 53, Google Cloud DNS, Azure DNS, DigitalOcean, RFC 2136 (BIND and friends) and more through webhooks.

Advantages:

- **Works for clusters with no inbound internet access at all**, because only DNS is involved. This is the usual answer for internal services that still want publicly trusted certificates (the hostname must exist in a public zone, but it can resolve to a private IP).
- **Wildcards** (`*.example.com`) are only possible with DNS-01.

Costs:

- An API token with permission to edit DNS lives in the cluster. Scope it to the one zone and, where the provider allows, to `TXT` records.
- Propagation delay: cert-manager checks that the record is visible before asking for validation. Split-horizon DNS (an internal server answering for the same zone) can make that self-check fail; point cert-manager's checks at public resolvers with `--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53` and `--dns01-recursive-nameservers-only`.

### Choosing

| Situation | Challenge |
|---|---|
| Public node, port 80 open, individual hostnames | HTTP-01 |
| Internal or VPN-only cluster | DNS-01 |
| Wildcard certificate | DNS-01 |
| DNS provider without API | HTTP-01, or a CNAME delegation of `_acme-challenge` to a zone you can automate |

One issuer can hold several solvers with selectors (for example HTTP-01 by default and DNS-01 for `dnsZones: [internal.example.com]`).

### Debugging a pending certificate

The chain of objects is `Certificate -> CertificateRequest -> Order -> Challenge`. The Challenge has the useful message:

```bash
kubectl get certificate,certificaterequest,order,challenge -A
kubectl describe challenge <name>
```

Typical reasons: `connection refused` or timeout on port 80 (HTTP-01 not reachable), `404` (the solver Ingress is not served by the controller, wrong class), `DNS record not yet propagated` (DNS-01 self-check), `rateLimited` (see below).

### Rate limits and lifetimes

Production Let's Encrypt limits certificates per registered domain per week and duplicate certificates, among others. Debugging against production is the fastest way to hit them; that is what staging is for.

Lifetimes are getting shorter, which makes automation mandatory rather than convenient:

- Since 13 May 2026, the opt-in `tlsserver` ACME profile issues **45-day** certificates.
- From 10 February 2027 the default `classic` profile moves to 64 days, and from 16 February 2028 to 45 days.

cert-manager renews at two thirds of the lifetime by default, so it adapts on its own; what must not exist is any manual step or monitoring that assumes 90 days.

## Trade-offs

- **HTTP-01 vs DNS-01.** HTTP-01 needs no credentials in the cluster but requires inbound port 80 and public reachability. DNS-01 works anywhere and supports wildcards, but stores a DNS-editing credential in the cluster.
- **Wildcard vs per-host certificates.** One wildcard simplifies configuration; its key is shared by every service using it, so a leak affects all of them.
- **Public certificates vs a private CA.** Public certificates need no trust distribution; a private CA works without any external dependency or rate limit.

## Documentation Links

- [cert-manager docs: ACME](https://cert-manager.io/docs/configuration/acme/): issuer configuration, solvers, selectors.
- [cert-manager docs: HTTP01](https://cert-manager.io/docs/configuration/acme/http01/): ingress and Gateway API solvers.
- [cert-manager docs: DNS01](https://cert-manager.io/docs/configuration/acme/dns01/): providers, recursive nameservers.
- [Let's Encrypt: Challenge Types](https://letsencrypt.org/docs/challenge-types/): HTTP-01, DNS-01, TLS-ALPN-01 compared.
- [Let's Encrypt: Rate Limits](https://letsencrypt.org/docs/rate-limits/): production limits and staging.
- [Let's Encrypt: Decreasing Certificate Lifetimes to 45 Days](https://letsencrypt.org/2025/12/02/from-90-to-45): timeline for shorter lifetimes.
