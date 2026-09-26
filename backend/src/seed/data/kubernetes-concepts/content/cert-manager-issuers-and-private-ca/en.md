---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

cert-manager turns TLS certificates into Kubernetes objects: you declare a `Certificate` (or annotate an Ingress), and cert-manager obtains it from an **Issuer**, stores it in a `kubernetes.io/tls` Secret and renews it before it expires. Issuers can be ACME (Let's Encrypt), HashiCorp Vault, a cloud CA, or a **CA you own**. For internal hostnames that no public CA will certify (`*.internal`, `*.corp.example.com`, a lab), a private CA issuer gives you real, automatically renewed certificates that your own machines trust. This concept covers installing cert-manager, Issuer vs ClusterIssuer, bootstrapping a private root CA inside the cluster, and issuing certificates for Ingresses from it.

## Use Cases

- HTTPS for internal admin UIs (dashboards, Grafana, internal tools) on hostnames without public DNS.
- Replacing the controller's default self-signed certificate with ones that browsers and application runtimes can be made to trust.
- Issuing certificates for service-to-service TLS (databases, message queues) from the same CA.
- Using the company's existing intermediate CA to sign cluster certificates.

## Deep Dive

### Installing

```bash
microk8s enable cert-manager
kubectl -n cert-manager get pods      # cert-manager, cainjector, webhook
```

The MicroK8s 1.35 add-on installs cert-manager v1.19. Elsewhere, the official Helm chart or static manifest from the cert-manager releases page does the same. Wait for the webhook before creating resources, or the API server rejects them:

```bash
kubectl -n cert-manager rollout status deploy/cert-manager-webhook
```

### Issuer vs ClusterIssuer

- `Issuer` is namespaced: it can only issue Certificates in its own namespace, and any Secret it references (a CA key, ACME account key) lives in that namespace.
- `ClusterIssuer` is cluster scoped: usable from any namespace; its Secrets live in the cert-manager namespace (the "cluster resource namespace", `cert-manager` by default).

For a single platform CA used by every namespace, a ClusterIssuer is the natural choice.

### Bootstrapping a private root CA in the cluster

Three objects: a self-signed issuer used once, a CA certificate issued by it, and a CA issuer that signs with that CA.

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: {name: selfsigned-bootstrap}
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata: {name: internal-root-ca, namespace: cert-manager}
spec:
  isCA: true
  commonName: Internal Root CA
  secretName: internal-root-ca
  duration: 87600h                 # 10 years
  privateKey: {algorithm: ECDSA, size: 256}
  issuerRef: {name: selfsigned-bootstrap, kind: ClusterIssuer}
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: {name: internal-ca}
spec:
  ca:
    secretName: internal-root-ca   # read from the cert-manager namespace
```

Verified on MicroK8s: both issuers became `READY True` within seconds. Applying the `Certificate` printed a warning worth knowing:

```
Warning: spec.privateKey.rotationPolicy: In cert-manager >= v1.18.0, the default value changed from `Never` to `Always`.
```

With `Always`, every renewal generates a new private key. For the root CA, that means a renewal produces a **new CA** that clients do not trust yet. Set `rotationPolicy: Never` on the CA certificate, or give it a duration so long that you will plan its rotation deliberately.

### Using the company's CA instead

If an internal PKI already exists, put its intermediate certificate and key into a `kubernetes.io/tls` Secret in the cert-manager namespace and point the CA ClusterIssuer at it. Clients that already trust the company root then trust every cluster certificate automatically, with no new root to distribute.

```bash
kubectl -n cert-manager create secret tls corp-intermediate \
  --cert=intermediate-chain.pem --key=intermediate.key
```

### Certificates for Ingresses

The simplest path is the ingress-shim: annotate the Ingress and cert-manager creates the `Certificate` for every `tls` entry.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-tls
  annotations:
    cert-manager.io/cluster-issuer: internal-ca
spec:
  ingressClassName: public
  tls:
    - hosts: [secure.example.test]
      secretName: secure-example-tls
  rules:
    - host: secure.example.test
      http:
        paths:
          - {path: /, pathType: Prefix, backend: {service: {name: echo, port: {number: 80}}}}
```

Verified: cert-manager created `Certificate/secure-example-tls` (`READY True`), the Secret has type `kubernetes.io/tls` with `tls.crt`, `tls.key` and `ca.crt`, and Traefik served it:

```
$ curl -vk --resolve secure.example.test:443:<node-ip> https://secure.example.test/
*  expire date: Dec 25 20:19:24 2026 GMT
*  issuer: CN=Internal Root CA
```

The default lifetime is 90 days, renewed at two thirds of it. Tune with `cert-manager.io/duration` and `cert-manager.io/renew-before` annotations, or write the `Certificate` yourself for full control (key algorithm, extra SANs, usages).

### Making clients trust the CA

A private CA only helps if clients trust it:

```bash
kubectl -n cert-manager get secret internal-root-ca -o jsonpath='{.data.ca\.crt}' | base64 -d > internal-root-ca.crt
```

- Browsers and OS: import into the system trust store (company MDM for laptops).
- MicroK8s nodes pulling from a registry with this certificate: `certs.d/<host:port>/hosts.toml` `ca =`.
- Applications calling internal HTTPS endpoints: add the CA to the runtime's trust store (the OS bundle in the image, a Java truststore, `NODE_EXTRA_CA_CERTS` for Node.js), typically mounted from a ConfigMap.
- In-cluster distribution to many namespaces: cert-manager's `trust-manager` syncs a CA bundle into a ConfigMap in every namespace.

### Debugging issuance

```bash
kubectl get certificate,certificaterequest -A
kubectl describe certificate secure-example-tls
kubectl -n cert-manager logs deploy/cert-manager
```

A `Certificate` stuck `READY False` shows the reason in its events and in the related `CertificateRequest` (issuer not ready, CA Secret missing in the wrong namespace, invalid hostnames).

## Trade-offs

- **Private CA vs public CA.** A private CA works for any hostname, offline, with no rate limits, and requires distributing its root to every client. Public certificates are trusted everywhere and need public DNS and a working ACME challenge.
- **In-cluster root vs corporate intermediate.** An in-cluster root is quick to set up and becomes one more root to distribute and protect (its key lives in a Secret). A corporate intermediate fits existing trust and governance, at the cost of involving the PKI owners.
- **Short vs long certificate lifetimes.** Short lifetimes limit the damage of a leaked key and are free with automatic renewal; they make any renewal failure visible sooner. Monitor `certmanager_certificate_expiration_timestamp_seconds`.

## Documentation Links

- [cert-manager docs: Installation](https://cert-manager.io/docs/installation/): Helm and static manifests.
- [cert-manager docs: CA issuer](https://cert-manager.io/docs/configuration/ca/): configuring a CA ClusterIssuer.
- [cert-manager docs: SelfSigned (bootstrapping a CA)](https://cert-manager.io/docs/configuration/selfsigned/#bootstrapping-ca-issuers): the three-object pattern.
- [cert-manager docs: Securing Ingress resources](https://cert-manager.io/docs/usage/ingress/): ingress-shim annotations.
- [cert-manager docs: Certificate resource (rotationPolicy)](https://cert-manager.io/docs/usage/certificate/#configuring-private-key-rotation): private key rotation defaults.
- [cert-manager docs: trust-manager](https://cert-manager.io/docs/trust/trust-manager/): distributing CA bundles.
