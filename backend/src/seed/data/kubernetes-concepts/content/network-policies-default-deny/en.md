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

## Documentation Links

- [Kubernetes docs: Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/): semantics, default policies, selector behaviour.
- [Kubernetes docs: Declare Network Policy](https://kubernetes.io/docs/tasks/administer-cluster/declare-network-policy/): step-by-step example.
- [Calico docs: Kubernetes network policy](https://docs.tigera.io/calico/latest/network-policy/get-started/kubernetes-policy/kubernetes-network-policy): enforcement on MicroK8s' default CNI.
- [Network Policy Editor (Cilium)](https://editor.networkpolicy.io/): visual editor to check selector logic.
