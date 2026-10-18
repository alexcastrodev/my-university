---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

An **Ingress** is a set of HTTP routing rules (host and path to Service) that an **Ingress controller** implements, usually on ports 80 and 443 of the node. It lets many services share one IP with hostnames like `api.example.com` and `grafana.example.com`, and terminates TLS in one place. The landscape changed in 2026: the community `ingress-nginx` controller reached end of life in March 2026, MicroK8s replaced its NGINX-based ingress add-on with **Traefik**, and the **Gateway API** is the successor to the Ingress resource. This concept covers the Ingress resource, what the MicroK8s add-on gives you today, routing several applications by host, and when to write Gateway API routes instead.

## Use Cases

- Exposing an API, dashboards and admin tools on one node under different hostnames.
- Terminating TLS for all of them with one certificate strategy (cert-manager).
- Reading an older guide that says "enable ingress, you get NGINX" and understanding what actually runs now.
- Planning a migration from NGINX-specific annotations.

## Deep Dive

### What `microk8s enable ingress` installs today

Verified on MicroK8s `1.35/stable` (v1.35.6, September 2026), which already ships the change announced with 1.36:

```
$ microk8s enable ingress
...
Gateway API is also available. Create HTTPRoute resources for modern routing.

$ kubectl -n ingress get ds
NAME      DESIRED   CURRENT   READY
traefik   1         1         1

$ kubectl get ingressclass
NAME      CONTROLLER                      
nginx     traefik.io/ingress-controller
public    traefik.io/ingress-controller
traefik   traefik.io/ingress-controller
```

- The controller is **Traefik v3** (image `traefik:v3.6.x`) as a DaemonSet in namespace `ingress`, with `hostPort` 80 and 443 on the node.
- Three IngressClasses all point to it: `public` and `nginx` exist for compatibility with manifests written for the old NGINX add-on.
- Traefik runs its `kubernetesIngressNGINX` provider for class `nginx`, which understands a subset of `nginx.ingress.kubernetes.io/*` annotations. Verified: an Ingress with class `nginx` and `nginx.ingress.kubernetes.io/rewrite-target: /` routed `/api` to the backend's `/`.
- The Gateway API CRDs are installed, with a `GatewayClass` `traefik` and a ready `Gateway` `traefik-gateway` in namespace `ingress`, listening on HTTP.
- Without a TLS Secret, HTTPS answers with `CN=TRAEFIK DEFAULT CERT`, a self-signed placeholder. `--default-ssl-certificate NAMESPACE/NAME` on enable replaces it.

Older MicroK8s revisions and many tutorials install `ingress-nginx` instead. If you run one of those, know that upstream `kubernetes/ingress-nginx` stopped receiving fixes, including security fixes, on 24 March 2026.

### An Ingress with hosts and paths

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: team-a
spec:
  ingressClassName: public
  tls:
    - hosts: [api.example.com]
      secretName: api-example-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: {name: api, port: {number: 80}}
```

- `ingressClassName` selects the controller. Omitting it relies on a default class; be explicit.
- `pathType: Prefix` matches by path segments (`/api` matches `/api` and `/api/x`, not `/apix`); `Exact` matches one path; `ImplementationSpecific` is controller-defined.
- An Ingress can only route to Services **in its own namespace**. Services in `team-a`, `monitoring` and `tooling` each need an Ingress in their own namespace (hosts can all share the same controller and IP).

A typical single-node layout, one Ingress per namespace:

| Host | Namespace | Service |
|---|---|---|
| `api.example.com` | `team-a` | `api:80` |
| `grafana.example.com` | `monitoring` | `grafana:80` |
| `admin.example.com` | `tooling` | `dashboard:8443` (HTTPS backend) |

Backends that speak HTTPS themselves (the dashboard on 8443) need the controller to use TLS towards them. With Traefik that is a `ServersTransport` or the annotation `traefik.ingress.kubernetes.io/service.serversscheme: https` on the Service; with ingress-nginx it was `nginx.ingress.kubernetes.io/backend-protocol: HTTPS`. Controller-specific annotations are exactly what makes Ingress manifests non-portable.

Testing without DNS:

```bash
curl -H 'Host: api.example.com' http://<node-ip>/
curl -k --resolve api.example.com:443:<node-ip> https://api.example.com/
```

### Gateway API: the successor

Ingress only standardised host and path routing; everything else (rewrites, header matching, timeouts, backend TLS, traffic splitting) went into annotations. The Gateway API splits responsibilities into typed resources:

- `GatewayClass`: which controller (installed by the add-on).
- `Gateway`: listeners (ports, protocols, TLS), owned by the platform team.
- `HTTPRoute`: routing rules, owned by each application team, attached to a Gateway, possibly from another namespace.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: api, namespace: team-a}
spec:
  parentRefs:
    - {name: traefik-gateway, namespace: ingress}
  hostnames: [api.example.com]
  rules:
    - matches: [{path: {type: PathPrefix, value: /}}]
      backendRefs: [{name: api, port: 80}]
```

Verified on the MicroK8s add-on: this route became `Accepted` and `ResolvedRefs`, and `curl -H 'Host: gw.example.test' http://<node-ip>/` reached the backend. Header matches, weights for canaries, redirects and URL rewrites are fields in the spec, not annotations, and work the same across implementations. The SIG Network tool `ingress2gateway` (1.0 released March 2026) converts existing Ingresses, including many NGINX annotations.

### Which one to write today

- **New services**: HTTPRoute if your controller supports Gateway API (Traefik, Envoy Gateway, Istio, Cilium, NGINX Gateway Fabric all do).
- **Existing Ingresses**: they keep working on Traefik. Plan a migration, starting with the ones that rely on NGINX annotations, since Traefik's NGINX compatibility covers only a subset.
- **Portable, simple host/path rules**: plain Ingress without annotations is still fine and supported.

## Trade-offs

- **Ingress vs Gateway API.** Ingress is simpler and universally understood; Gateway API is more verbose but expressive and portable without annotations, and it is where new features land.
- **hostPort DaemonSet vs LoadBalancer Service.** The MicroK8s add-on binds 80/443 directly on the node, perfect for one node; with several nodes you need something in front (DNS round robin, MetalLB, an external load balancer).
- **Compatibility classes vs rewriting manifests.** The `nginx` class on Traefik gets old manifests running immediately; relying on it long term means depending on a compatibility layer instead of the controller's native features.

## Lab

In this lab you get two routes that do not work: an Ingress for `shop.lab` that only serves the home page, and a Gateway API `HTTPRoute` for `blog.lab` that never serves anything. Your job is to edit only `routes.yaml`. The core idea is to feel how an ingress controller (the Traefik bundled with k3s) matches host and path, and how the Gateway API separates who owns the Gateway (the platform) from who attaches routes to it (the team), with the answer to each problem written in the route's status conditions.

**The scenario**

Two apps in the `web` namespace (busybox serving HTTP on port 8080) must be reachable by hostname through Traefik. The tests start a real k3s with Traefik and its Gateway API provider enabled and send real requests with different `Host` headers.

- `src/test/resources/k8s/traefik-config.yaml`: turns on Traefik's `kubernetesGateway` provider. Given.
- `src/test/resources/k8s/apps.yaml`: Deployments and Services `shop` (with `/` and `/cart/`) and `blog`, plus a `client` Pod the requests are sent from. Given.
- `src/main/resources/k8s/routes.yaml`: the `shop` `Ingress` and the `blog` `HTTPRoute`. This is your file.
- The `traefik-gateway` `Gateway` in `kube-system` (listener `web`, port 8000) belongs to the platform team and the tests check that it did not change.

**What you will do, step by step**

1. **Run the tests and read the status.** The failure message shows the `HTTPRoute` conditions, which say why it was not accepted.
2. **Make every shop page reachable (TODO-00).** The home page works, but `/cart/` and the rest return 404. Look at the `pathType` of the `/` path in the Ingress and pick the type that also covers sub-paths.
3. **Make the blog route work (TODO-01).** The `HTTPRoute` lives in `web` and points to a Gateway in `kube-system`. Use the conditions to find out what the Gateway's listener allows, and fix it on your side without editing anything in `kube-system`. Remember the blog must be served by an `HTTPRoute`, not an Ingress.

**How you know you are done**

`mvn -pl kubernetes-concepts/ingress-controllers-and-gateway-api test` passes all four tests: `shopServesEveryPage`, `blogIsServedThroughTheGatewayApi`, `unknownHostsGetA404` and `platformGatewayIsUnchanged`. You should be able to explain why the `Exact` Ingress only served the home page and which `HTTPRoute` condition pointed at the blog problem.

**Optional challenges**

- **TODO-02:** instead of a Gateway per team, the platform could let routes from `web` attach to `traefik-gateway`. Which field of the Gateway would change, and what is given up?

**Prerequisites:** Docker running (the tests start a `rancher/k3s` container, which installs Traefik and pulls `busybox`), Java and Maven, and the article Ingress Controllers and the Gateway API.

**How to run it:** clone the repository and, from its root, run `mvn -pl kubernetes-concepts/ingress-controllers-and-gateway-api test`. The `TODO-00` and `TODO-01` comments in `routes.yaml` mark what is left. The first run is slow because Traefik is installed by a Helm job after the cluster starts.

## Documentation Links

- [Kubernetes docs: Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/): rules, path types, TLS, IngressClass.
- [Kubernetes docs: Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/): resource model and roles.
- [Gateway API: HTTPRoute](https://gateway-api.sigs.k8s.io/reference/api-types/httproute/): matches, filters, backend references.
- [Kubernetes blog: Announcing Ingress2Gateway 1.0](https://kubernetes.io/blog/2026/03/20/ingress2gateway-1-0-release): migration tool from Ingress to Gateway API.
- [MicroK8s: Release notes](https://canonical.com/microk8s/docs/release-notes): the ingress add-on moving from NGINX to Traefik.
- [Traefik docs: Kubernetes Ingress NGINX provider](https://doc.traefik.io/traefik/reference/install-configuration/providers/kubernetes/kubernetes-ingress-nginx/): supported NGINX annotations.
