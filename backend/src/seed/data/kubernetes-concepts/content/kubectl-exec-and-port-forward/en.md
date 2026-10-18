---
version: 1.0
updatedAt: 2026-09-26
---
## Objective

Two kubectl commands give you direct access to what runs inside the cluster without exposing anything publicly: `kubectl exec` runs a command inside a running container, and `kubectl port-forward` tunnels a local port to a Pod or Service through the API server. A third, `kubectl debug`, attaches a temporary toolbox container when the image has no shell at all. This concept covers the three, the forms you will actually use, and their limits (port-forward is not load balancing, exec needs binaries in the image, and all of it requires RBAC permissions worth restricting).

## Use Cases

- Checking environment variables, mounted files and DNS from inside a Pod.
- Opening an internal admin UI or database port on your laptop without a Service of type NodePort.
- Debugging a minimal or distroless image that has no `sh`.
- Running a one-off command (a migration check, a cache flush) in the context of the application.

## Deep Dive

### kubectl exec

```bash
kubectl -n team-a exec web-6b48bf5ccc-rppzw -- env            # one command
kubectl -n team-a exec -it web-6b48bf5ccc-rppzw -- sh         # interactive shell
kubectl -n team-a exec -it deploy/web -- sh                   # any Pod of the Deployment
kubectl -n team-a exec -it web-xyz -c sidecar -- sh           # a specific container
```

- `--` separates kubectl flags from the command.
- `-i` passes stdin, `-t` allocates a TTY. Use `-it` for shells, **neither** for binary output you redirect (`kubectl exec ... -- tar czf - /data > data.tgz`): a TTY rewrites line endings and corrupts it.
- `deploy/web` picks one Pod of the Deployment; for a specific replica, use the Pod name.
- The command runs as the container's user, with its filesystem, environment and network. It is the most faithful way to test "can the app reach X": `exec ... -- wget -qO- -T 3 http://api.team-b/healthz`.

The command must exist in the image. Verified:

```
$ kubectl exec deploy/web -- bash
error: ... exec: "bash": executable file not found in $PATH
```

Alpine and BusyBox images have `sh` but not `bash`; distroless and scratch images have neither.

### kubectl debug: a toolbox next to the container

For images without a shell, add an **ephemeral container** with the tools you need, sharing the target container's process namespace:

```bash
kubectl -n team-a debug -it web-xyz --image=busybox:1.37 --target=nginx
```

Verified on k3s: inside the debug container, `ps` showed the target's processes (`nginx: master process`, worker processes), and the target's filesystem was reachable through `/proc/1/root` (`ls /proc/1/root/etc/nginx` listed `conf.d`, `fastcgi.conf`...). The ephemeral container stays in the Pod spec until the Pod is deleted; it cannot be removed or restarted.

Other forms:

```bash
kubectl debug web-xyz -it --copy-to=web-debug --container=app -- sh   # copy of the Pod with a shell as command
kubectl debug node/node1 -it --image=busybox:1.37                     # a Pod on the node with the host filesystem at /host
```

`kubectl debug` works on Pods and nodes, not on Deployments (verified: `"apps/v1, Kind=Deployment" not supported by debug`).

### kubectl port-forward

```bash
kubectl -n team-a port-forward pod/web-xyz 8080:80           # local 8080 -> Pod port 80
kubectl -n team-a port-forward svc/web 8080:80                # via a Service
kubectl -n monitoring port-forward svc/grafana 3000:80 &      # background it
curl http://localhost:8080/
```

Verified: `port-forward svc/web 18080:80` returned the nginx welcome page on `localhost:18080`.

How it works, and what follows from it:

- The connection goes from kubectl through the **API server** and the kubelet to the Pod. No Service port, NodePort or Ingress is needed, and nothing is exposed to anyone else.
- `svc/web` does **not** load-balance. kubectl resolves the Service to **one** Pod when the command starts and forwards everything there. If that Pod dies, the forward breaks and must be restarted.
- By default it listens on `127.0.0.1` only. `--address 0.0.0.0` exposes it to your network, which is rarely a good idea.
- It is a debugging tool: long-lived forwards drop on idle timeouts and API server restarts. For permanent access, use a Service and an Ingress with authentication.

Typical uses: a database client against a database Pod, a metrics or admin endpoint that is not exposed, a web UI that should only be reachable by operators.

### Who may do this

`exec`, `port-forward` and `debug` are powerful: exec gives a shell with the application's credentials, and port-forward reaches any Pod port bypassing Ingress authentication. In RBAC terms they are the subresources `pods/exec`, `pods/portforward` and `pods/ephemeralcontainers`. Grant them deliberately, not through a blanket `edit` role, where production is involved. Note that NetworkPolicies do not apply to port-forward traffic (it enters through the kubelet, not the Pod network).

## Trade-offs

- **exec vs debug.** exec is simple and needs tools in the image; debug works with any image and leaves an ephemeral container in the Pod until it is recreated.
- **port-forward vs a Service.** port-forward is private and temporary with no manifest changes; a Service is stable, shareable and needs access control of its own.
- **Minimal images vs debuggability.** Distroless images shrink the attack surface and remove the shell you would use to debug; `kubectl debug` is the answer that keeps both.

## Lab

In this lab you receive an `inspect.sh` that works on paper but fails in practice: it tries to read a file from inside a container with no shell and no `cat`, and then tries to reach the app through a DNS name that does not exist where the script runs. Your job is to inspect the running container and reach it from outside the cluster network. The core idea is to feel that `kubectl exec` only runs programs that exist in the image, and that `kubectl debug` and `kubectl port-forward` are the way out when that is not enough.

**The scenario**

A real Kubernetes cluster (k3s, started by Testcontainers) runs nginx from a minimal image, and the script runs on the node, where `kubectl` works but the cluster DNS does not.

- `src/test/resources/k8s/web.yaml`: given, with the `web` Deployment (nginx from `cgr.dev/chainguard/nginx`, port 8080, no shell, no `cat`, no package manager), the `web` Service and a `client` Pod. You may not change it.
- `src/main/resources/inspect.sh`: the only file you edit. It must print two lines.
- `src/test/java/DebugTest.java`: compares the output with what the test itself obtains, and also checks that no `kubectl port-forward` process is left running.

The two lines are the `worker_processes` line of `/etc/nginx/nginx.conf` as the running container sees it, and the `Server` header that `web` sends back.

**What you will do, step by step**

1. **Run the tests first.** See the two lines fail and read what the test expected.
2. **Read the file from the running container (TODO-00).** `kubectl exec ... cat` does not work because the image has no `cat`. Use an ephemeral debug container (`kubectl debug`) with an image that has the tools, targeting the nginx container so it shares the process namespace, and read the file through the target process's filesystem. That container's logs give back what it printed.
3. **Reach the app from outside the network (TODO-01).** `http://web:8080` does not resolve on the node. Use `kubectl port-forward` to go through the API server, fetch the `Server` header via `localhost` and **clean up afterwards**: the port-forward process must be stopped at the end of the script, or the test fails.

**How you know you are done**

`mvn -pl kubernetes-concepts/kubectl-exec-and-port-forward test` passes: the script exits successfully, line 1 is the real `worker_processes`, line 2 is the `Server` header and no `kubectl port-forward` is left behind. You should be able to explain why the debug container sees nginx's file without the Deployment being changed.

**Optional challenges**

- **TODO-02:** run `kubectl get pod -l app=web -o yaml` after the tests. What did your debug containers leave behind in the Pod, and how do you get rid of them?

**Prerequisites:** Docker running locally (the tests start a `rancher/k3s` container, which pulls `cgr.dev/chainguard/nginx` and `busybox`) and the article "kubectl exec, debug and port-forward".

**How to run it:** clone the repository and, from the root, run `mvn -pl kubernetes-concepts/kubectl-exec-and-port-forward test`. The `TODO-00` and `TODO-01` comments in `inspect.sh` mark the two commands to rewrite.

## Documentation Links

- [Kubernetes docs: Get a Shell to a Running Container](https://kubernetes.io/docs/tasks/debug/debug-application/get-shell-running-container/): exec usage.
- [Kubernetes docs: Debug Running Pods (ephemeral containers)](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#ephemeral-container): `kubectl debug`.
- [Kubernetes docs: Use Port Forwarding to Access Applications in a Cluster](https://kubernetes.io/docs/tasks/access-application-cluster/port-forward-access-application-cluster/): port-forward behaviour.
- [Kubernetes docs: Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/): limitations.
