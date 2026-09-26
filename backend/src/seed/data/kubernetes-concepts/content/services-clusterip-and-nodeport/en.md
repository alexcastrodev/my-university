---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

A Service gives a changing set of Pods one stable address. The `type` field decides who can reach that address: `ClusterIP` (the default) is reachable only from inside the cluster; `NodePort` additionally opens a port between 30000 and 32767 on every node, reachable from outside; `LoadBalancer` asks an external load balancer for an IP. On a single MicroK8s node without a cloud provider, NodePort is the simplest way to expose something like an admin dashboard, and it has limits worth knowing. This concept covers ClusterIP and NodePort, how traffic actually flows, and how to reach a NodePort from another machine.

## Use Cases

- Internal-only Services for databases, brokers and APIs that other Pods call.
- Exposing an admin UI (a dashboard, Grafana, an internal tool) on a fixed port of the node, without an Ingress.
- Choosing a NodePort number that survives re-creating the Service.
- Understanding why `ss -ltn` on the node does not show the NodePort, yet it works.

## Deep Dive

### ClusterIP

```yaml
apiVersion: v1
kind: Service
metadata: {name: api, namespace: team-a}
spec:
  type: ClusterIP               # default, can be omitted
  selector: {app: api}
  ports:
    - name: http
      port: 80                  # the Service's port
      targetPort: 8080          # the container's port (number or port name)
```

The Service gets a virtual IP from the service range (`10.152.183.0/24` on MicroK8s, `10.43.0.0/16` on k3s). No process listens on it: kube-proxy programs iptables or nftables rules on every node that translate `ClusterIP:80` to one of the ready Pod IPs on port 8080. That is also why you cannot `ping` a ClusterIP.

`targetPort` can reference the container port by name (`targetPort: http`), which lets you change the container port without touching the Service.

### NodePort

```yaml
spec:
  type: NodePort
  selector: {app: dashboard}
  ports:
    - name: https
      port: 8443
      targetPort: 8443
      nodePort: 30443           # optional; random in 30000-32767 if omitted
```

A NodePort Service is a ClusterIP Service **plus** a port opened on every node's IP. Traffic to `<any-node-ip>:30443` is forwarded to a ready Pod, even if that Pod runs on another node.

The range is enforced by the API server. Verified:

```
$ kubectl create service nodeport np --tcp=80:8080 --node-port=29999
The Service "np" is invalid: spec.ports[0].nodePort: Invalid value: 29999:
provided port is not in the valid range. The range of valid ports is 30000-32767
```

(The range can be changed with the API server flag `--service-node-port-range`, rarely worth it.)

**Pin the `nodePort` explicitly** for anything people bookmark or firewall rules reference. Without it, deleting and recreating the Service assigns a new random port. Also keep a small registry of which NodePorts you use: two Services cannot share one, and the second one fails with `provided port is already allocated`.

### Reaching a NodePort from outside

Verified on MicroK8s from the host machine:

```bash
$ kubectl get svc echo-np
NAME      TYPE       CLUSTER-IP      PORT(S)
echo-np   NodePort   10.152.183.68   80:32687/TCP

$ curl http://192.168.252.3:32687/
api
```

Use any node IP (or a DNS name pointing to it). What can get in the way:

- **Host firewall.** `ufw` or cloud security groups must allow the port. Nothing on the node listens on it in the usual sense: `ss -ltn | grep 32687` returned nothing, because the forwarding happens in kernel packet rules, not in a listening process. Firewall tools that only inspect listening sockets will not show it either.
- **Binding.** NodePorts open on all node addresses by default. On a node with a public and a private interface, restrict with kube-proxy's `--nodeport-addresses` (on MicroK8s in `/var/snap/microk8s/current/args/kube-proxy`) if the admin UI must only be reachable internally.
- **Source IP.** With the default `externalTrafficPolicy: Cluster`, the Pod sees the node's IP as the client, not the real one. `externalTrafficPolicy: Local` preserves the client IP, but only nodes running a ready Pod answer.
- **TLS and hostnames.** An app behind a NodePort is addressed as `https://node:30443`. Applications that build absolute URLs (OAuth redirect URIs, token issuers, links in e-mails) must be configured with exactly that external URL.

### Picking the type

| Need | Type |
|---|---|
| Pod-to-Pod inside the cluster | `ClusterIP` |
| Quick external access on a single node, admin UIs, labs | `NodePort` |
| Many HTTP services on ports 80/443 with hostnames and TLS | `ClusterIP` + Ingress or Gateway |
| A real external IP per Service | `LoadBalancer` (MetalLB on bare metal: `microk8s enable metallb`) |

On MicroK8s, the ingress add-on binds ports 80 and 443 on the node directly (hostPort), so HTTP services usually go through the Ingress, and NodePort is reserved for non-HTTP protocols or things that must stay independent from the Ingress (an admin UI is a good example: it is how you fix a broken Ingress).

### Checking a Service end to end

```bash
kubectl -n team-a get svc api
kubectl -n team-a get endpointslices -l kubernetes.io/service-name=api   # which Pod IPs are behind it
kubectl -n team-a run curl --rm -it --image=curlimages/curl:8.16.0 --restart=Never \
  -- curl -s http://api/healthz
```

No endpoints means the selector matches no **ready** Pod: wrong labels or failing readiness probes.

## Trade-offs

- **NodePort vs Ingress.** NodePort needs no extra component and works for any TCP protocol; it gives awkward high ports, one port per service, and no host-based routing or central TLS.
- **Fixed vs random nodePort.** Fixed ports are stable for users and firewalls and require you to manage collisions; random ports need no coordination and change whenever the Service is recreated.
- **`externalTrafficPolicy: Cluster` vs `Local`.** Cluster spreads traffic evenly and hides the client IP; Local preserves the client IP and can leave nodes without local Pods unable to answer.

## Documentation Links

- [Kubernetes docs: Service](https://kubernetes.io/docs/concepts/services-networking/service/): types, ports, selectors.
- [Kubernetes docs: Service type NodePort](https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport): range, choosing a port, `nodeport-addresses`.
- [Kubernetes docs: Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/): how kube-proxy implements ClusterIP and NodePort.
- [Kubernetes docs: Using Source IP](https://kubernetes.io/docs/tutorials/services/source-ip/): `externalTrafficPolicy` effects.
