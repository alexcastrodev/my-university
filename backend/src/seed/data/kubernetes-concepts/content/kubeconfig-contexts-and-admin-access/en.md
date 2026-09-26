---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

`kubectl` knows which cluster to talk to, and as whom, from a kubeconfig file. Once you run commands from a laptop or a CI job instead of the node itself, you need to export that file, merge it with others, switch between contexts safely, and understand what the credentials inside it can do. On MicroK8s the exported credentials are a client certificate in the `system:masters` group, valid for ten years and impossible to revoke individually, which makes protecting the file a real security topic. This concept covers `microk8s config`, contexts, the `KUBECONFIG` variable, and how to stop handing out that admin key.

## Use Cases

- Running `kubectl` and `kubectl apply -k` from your workstation against the MicroK8s node.
- Working with several clusters (lab, staging, production) without applying to the wrong one.
- Giving a CI pipeline access to one namespace only.
- Reacting when an admin kubeconfig leaked.

## Deep Dive

### Exporting the kubeconfig

```bash
microk8s config > ~/.kube/microk8s.yaml
```

Structure (verified on 1.35, secrets redacted):

```yaml
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: <CA>
    server: https://192.168.252.3:16443
  name: microk8s-cluster
contexts:
- context:
    cluster: microk8s-cluster
    user: admin
  name: microk8s
current-context: microk8s
users:
- name: admin
  user:
    client-certificate-data: <cert>
    client-key-data: <key>
```

Three things to notice:

- The API server listens on **16443**, not 6443.
- `server` is the node's IP. If you reach the node by a DNS name or a different IP (NAT, VPN), change it, and the name must be in the API server certificate's SANs (MicroK8s adds IPs automatically; extra names go in `/var/snap/microk8s/current/certs/csr.conf.template`, followed by `sudo microk8s refresh-certs --cert server.crt`).
- The user `admin` authenticates with a client certificate:

```bash
$ microk8s config | grep client-certificate-data | awk '{print $2}' | base64 -d \
    | openssl x509 -noout -subject -enddate
subject=CN = admin, O = system:masters
notAfter=Sep 23 19:59:25 2036 GMT
```

`O = system:masters` is a group that bypasses RBAC entirely, and the certificate is valid for ten years. Kubernetes has no certificate revocation list: the only way to invalidate a leaked copy is to rotate the cluster CA (`microk8s refresh-certs --cert ca.crt`), which invalidates every credential signed by it.

### Contexts: cluster + user + namespace

A context is a named triple. `kubectl config` manipulates the file:

```bash
kubectl config get-contexts
kubectl config current-context
kubectl config use-context microk8s
kubectl config set-context --current --namespace=team-a   # default namespace for this context
kubectl config rename-context microk8s prod-node1
```

A per-command override never changes the file:

```bash
kubectl --context=prod-node1 -n team-a get pods
```

In scripts and CI, **always pass `--context`** (or use a kubeconfig that contains exactly one context). Relying on `current-context` is how people run `kubectl delete` against production thinking it is the lab.

### Multiple kubeconfigs and KUBECONFIG

`KUBECONFIG` is a list of files (`:` separated on Linux and macOS) that kubectl merges in memory:

```bash
export KUBECONFIG=~/.kube/config:~/.kube/microk8s.yaml:~/.kube/staging.yaml
kubectl config get-contexts     # contexts from all files
```

Merge rules: the first file that defines a given name wins, and `current-context` comes from the first file that sets it. Name collisions are the classic trap: every MicroK8s export uses the same names (`microk8s-cluster`, `admin`, `microk8s`), so two exported clusters silently shadow each other. Rename before merging:

```bash
sed -e 's/microk8s-cluster/node1/g' -e 's/name: admin/name: node1-admin/' \
    -e 's/user: admin/user: node1-admin/' -e 's/: microk8s$/: node1/' \
    microk8s.yaml > node1.yaml
```

To flatten a merged view into one file:

```bash
KUBECONFIG=~/.kube/config:node1.yaml kubectl config view --flatten > merged.yaml
```

The file is a credential: keep it `chmod 600` (Helm warns about group or world readable kubeconfigs, kubectl does not).

### Restricting access instead of sharing the admin file

The admin kubeconfig is for break-glass and bootstrap. For people and pipelines, give each identity its own, scoped credentials. With the `rbac` add-on enabled:

```bash
microk8s enable rbac
kubectl -n team-a create serviceaccount ci-deployer
kubectl -n team-a create rolebinding ci-deployer --clusterrole=edit \
  --serviceaccount=team-a:ci-deployer
kubectl -n team-a create token ci-deployer --duration=1h    # short-lived token
```

A kubeconfig for that identity:

```yaml
users:
- name: ci-deployer
  user:
    token: <output of kubectl create token>
contexts:
- name: ci-team-a
  context: {cluster: node1, user: ci-deployer, namespace: team-a}
```

Revoking it is `kubectl delete rolebinding ci-deployer` or deleting the ServiceAccount, without touching anyone else. See the RBAC concept for building the Role.

On the node itself:

- `/var/snap/microk8s/current/credentials/` holds the admin and component kubeconfigs, readable by root and the `microk8s` group. Keep that group to the people who are allowed to be cluster-admin.
- Firewall port 16443 to the networks that actually need the API.

## Trade-offs

- **One admin kubeconfig for everyone vs per-identity credentials.** Sharing is fast to set up and impossible to audit or revoke. Per-identity credentials cost a Role and a binding per consumer and give you revocation and least privilege.
- **Long-lived vs short-lived tokens.** `kubectl create token` tokens expire (one hour by default), which is ideal for CI jobs that request one per run. A long-lived token Secret (`kubernetes.io/service-account-token`) survives forever and must be rotated by hand.
- **Merged KUBECONFIG vs one file per cluster.** Merging is convenient for interactive work; for automation, a dedicated single-context file per target is the safest default.

## Documentation Links

- [Kubernetes docs: Organizing cluster access using kubeconfig files](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/): merge rules and precedence.
- [Kubernetes docs: Configure access to multiple clusters](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/): contexts step by step.
- [MicroK8s: Working with kubectl](https://canonical.com/microk8s/docs/working-with-kubectl): `microk8s config` and external kubectl.
- [MicroK8s: Services and ports](https://canonical.com/microk8s/docs/services-and-ports): port 16443 and the credentials directory.
- [Kubernetes docs: Authenticating (X509 client certificates)](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#x509-client-certificates): why certificate users cannot be revoked.
