---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

By default every Pod can talk to every other Pod in the cluster, across all namespaces. A **NetworkPolicy** changes that for the Pods it selects: once a Pod is selected by a policy for ingress (or egress), only the traffic some policy explicitly allows gets through. The standard pattern is a **default deny** per namespace plus small allow rules for real dependencies. Policies are enforced by the CNI plugin, not by Kubernetes itself, and egress rules have a trap that breaks DNS. This concept covers both directions, cross-namespace rules, and how to verify them, with results from a real cluster.

## Use Cases

- Making a database reachable only from the applications that use it.
- Isolating teams or environments that share a cluster.
- Limiting what a compromised container can reach (lateral movement, data exfiltration).
- Allowing monitoring and ingress controllers through without opening everything.

## Deep Dive

### Enforcement depends on the CNI

The API accepts NetworkPolicies on any cluster, but only a CNI that implements them enforces them. Calico (MicroK8s default), Cilium and k3s's built-in controller do; plain Flannel does not, and there the policies are silently ignored. Always verify with a real connection test.

### Default deny for incoming traffic

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny-ingress, namespace: shared}
spec:
  podSelector: {}               # every Pod in the namespace
  policyTypes: [Ingress]        # no ingress rules listed = nothing allowed in
```

Then allow what is needed:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-db-from-team-a, namespace: shared}
spec:
  podSelector: {matchLabels: {app: db}}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: {kubernetes.io/metadata.name: team-a}
      ports: [{port: 5432, protocol: TCP}]
```

Verified on k3s v1.36 with an nginx `db` in namespace `infra` and clients in `app` and `lab`:

| Step | From `app` | From `lab` |
|---|---|---|
| no policy | reachable | reachable |
| `default-deny-ingress` in `infra` | blocked (timeout) | blocked |
| + allow from namespace `app` on port 80 | reachable | blocked |

`kubernetes.io/metadata.name` is a label Kubernetes sets on every namespace automatically, which makes it the reliable way to select a namespace by name.

### The selector semantics that trip people up

```yaml
ingress:
  - from:
      - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: team-a}}
        podSelector: {matchLabels: {app: web}}        # AND: web Pods in team-a
```

```yaml
ingress:
  - from:
      - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: team-a}}
      - podSelector: {matchLabels: {app: web}}        # OR: all of team-a, or web Pods in THIS namespace
```

One list item with both selectors is an AND; two items is an OR. The difference is a single `-`. A `podSelector` alone in `from` only matches Pods in the policy's own namespace.

Policies are additive: if any policy allows a connection, it is allowed. There is no "deny" rule to override an allow.

### Default deny for outgoing traffic, and DNS

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny-egress, namespace: team-a}
spec:
  podSelector: {}
  policyTypes: [Egress]
```

Verified: right after applying it, name resolution in the namespace failed:

```
$ kubectl -n app exec client -- nslookup db.infra
nslookup: write to '10.43.0.10': Connection refused
```

Every hostname now looks "unknown", and applications log DNS errors rather than network errors. Egress deny must always come with a DNS allowance:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-dns, namespace: team-a}
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: {matchLabels: {kubernetes.io/metadata.name: kube-system}}
          podSelector: {matchLabels: {k8s-app: kube-dns}}
      ports:
        - {port: 53, protocol: UDP}
        - {port: 53, protocol: TCP}
```

Then add egress rules for each real dependency (the database in `shared`, an external API by CIDR with `ipBlock`). Remember that the connection needs both sides: an egress allow in `team-a` **and** an ingress allow in `shared` if `shared` has a default deny.

### What else needs to be allowed

After default deny, list the traffic that is easy to forget:

- **Ingress controller** to your web Pods (from the controller's namespace, e.g. `ingress`).
- **Monitoring**: Prometheus scraping metrics ports (from `observability` or `monitoring`).
- **Webhooks and operators** calling Pods, and Pods calling the Kubernetes API (egress to the API server address on 443/6443/16443).
- **Health probes** are sent by the kubelet from the node and are generally not blocked by NetworkPolicies on common CNIs.

### Verifying policies

```bash
kubectl -n team-a run nettest --rm -it --image=busybox:1.37 --restart=Never -- \
  sh -c 'nslookup db.shared; wget -qO- -T 3 http://db.shared:5432 || echo BLOCKED'
kubectl get networkpolicy -A
kubectl -n shared describe networkpolicy allow-db-from-team-a
```

Keep a small script of "should connect" and "should be blocked" pairs and run it after every policy change, like the `auth can-i` checks for RBAC.

## Trade-offs

- **Default deny vs open by default.** Deny-by-default contains breaches and documents dependencies, at the price of breaking anything nobody wrote down, which you will discover the first day.
- **Ingress only vs ingress and egress.** Ingress policies protect services and are easy to get right; egress policies stop exfiltration and need DNS, API server and external endpoints listed explicitly.
- **Standard NetworkPolicy vs CNI-specific policies.** The standard API is portable and limited (no L7 rules, no cluster-wide defaults, no explicit deny); Calico and Cilium policies add those features and tie you to the CNI.

## Lab

In this lab you receive a shared namespace with a database and a cache, and a `policies.yaml` that looks like it protects the database but leaves four things wrong at once. Your job is to lock the namespace down so that only one kind of Pod from another namespace reaches the database, while keeping a strict egress that does not break DNS. The core idea is to feel that a NetworkPolicy only restricts the Pods it selects, and that two selectors in the same list item or in separate items mean completely different things.

**The scenario**

A real Kubernetes cluster (k3s, started by Testcontainers, whose built-in controller enforces NetworkPolicies) receives the Pods from `src/test/resources/k8s/workloads.yaml`, which is given.

- `shared`: `db` and `cache` (HTTP on 8080) and an `impostor` Pod labelled `app=api`.
- `team-a`: an `api` Pod (`app=api`).
- `team-b`: a `client` Pod.
- `src/main/resources/k8s/policies.yaml`: the only file you edit. It already has a `default-deny-egress` in `team-a` (keep it) and an `allow-api-to-db` in `shared` with a selector mistake.
- `src/test/java/NetworkPoliciesTest.java`: makes real HTTP requests and requires `team-a/api` to reach `db.shared` by name and nothing else to reach `db` or `cache`.

**What you will do, step by step**

1. **Run the tests first.** Four things fail at once: `team-a/api` cannot even resolve names, `team-b` reaches `cache` and `shared/impostor` reaches both services.
2. **Close the ingress of `shared` (TODO-00).** `cache` is selected by no policy, so the whole cluster can reach it. Add a default deny for incoming traffic to every Pod in `shared`.
3. **Fix the selectors (TODO-01).** In `allow-api-to-db`, the two selectors are in separate items of the `from` list, which means "any Pod in `team-a`" OR "any Pod labelled `app=api`" (including the impostor in `shared`). Merge them into one item so it means "Pods `app=api` **in** `team-a`".
4. **Allow DNS and the traffic to the database (TODO-02).** With egress denied, `api` cannot resolve `db.shared`. Allow the DNS queries (UDP and TCP 53 to the kube-dns Pods in `kube-system`) and the traffic from `team-a` to `db` in `shared` on port 8080.

**How you know you are done**

`mvn -pl kubernetes-concepts/network-policies-default-deny test` passes: `team-a/api` fetches `db` by name and `impostor`, `team-b` and everyone else are blocked. You should be able to explain why a `namespaceSelector` and a `podSelector` in the same item are an AND, and in separate items an OR.

**Optional challenges**

- **TODO-03:** remove the DNS rule from your solution and run `nslookup db.shared` from `team-a/api`. What error does the application see, and why does it look like a DNS problem rather than a network policy problem?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container and pull `busybox` inside it) and the article "NetworkPolicies and Default Deny".

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/network-policies-default-deny test`. The `TODO-00` to `TODO-02` comments in `policies.yaml` mark what to do. Allow rules can take a few seconds to be programmed, and the test already retries.

## Documentation Links

- [Kubernetes docs: Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/): semantics, default policies, selector behaviour.
- [Kubernetes docs: Declare Network Policy](https://kubernetes.io/docs/tasks/administer-cluster/declare-network-policy/): step-by-step example.
- [Calico docs: Kubernetes network policy](https://docs.tigera.io/calico/latest/network-policy/get-started/kubernetes-policy/kubernetes-network-policy): enforcement on MicroK8s' default CNI.
- [Network Policy Editor (Cilium)](https://editor.networkpolicy.io/): visual editor to check selector logic.
