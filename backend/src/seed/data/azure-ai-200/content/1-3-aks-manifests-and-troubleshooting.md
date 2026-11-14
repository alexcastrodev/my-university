---
version: 1.0
updatedAt: 2026-11-14
---
# Azure Kubernetes Service: Manifests, Monitoring and Troubleshooting

> Exam domain: **Develop containerized solutions on Azure (20-25%)**, skill group *Implement container-orchestrated solutions* (AKS part, plus troubleshooting for AKS **and** Container Apps).

---

## When AKS and when Container Apps

| You need | Choose |
|----------|--------|
| Full Kubernetes API, custom controllers, your own manifests | **AKS** |
| Run containers with revisions and KEDA, no cluster to manage | **Container Apps** |

The exam states "by using manifest files" for AKS, so expect YAML and `kubectl`.

---

## A complete manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api          # must match the selector above AND the Service selector below
    spec:
      containers:
        - name: api
          image: myregistry.azurecr.io/shop/orders-api:1.4.2
          ports:
            - containerPort: 8000
          env:
            - name: LOG_LEVEL
              valueFrom:
                configMapKeyRef: { name: orders-config, key: log-level }
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef: { name: orders-secrets, key: db-password }
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits:   { cpu: "1",  memory: 512Mi }
          readinessProbe:
            httpGet: { path: /healthz, port: 8000 }
          livenessProbe:
            httpGet: { path: /healthz, port: 8000 }
            initialDelaySeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: orders-api
spec:
  type: ClusterIP                 # LoadBalancer for a public IP
  selector:
    app: orders-api
  ports:
    - port: 80
      targetPort: 8000
```

| Object | Purpose |
|--------|---------|
| **Deployment** | Declares replicas and a pod template, and performs rolling updates |
| **Service** | A stable virtual IP and DNS name in front of the pods it **selects by label** |
| **ConfigMap / Secret** | Non-sensitive and sensitive configuration, consumed as env vars or files |
| **Readiness probe** | Failing means the pod is removed from the Service endpoints |
| **Liveness probe** | Failing means the kubelet restarts the container |

Service types: `ClusterIP` (in-cluster only, default), `NodePort`, `LoadBalancer` (an Azure load balancer with a public or internal IP).

### Deploy and roll back

```bash
az aks get-credentials --resource-group rg-shop --name aks-shop

kubectl apply -f orders.yaml
kubectl rollout status deployment/orders-api
kubectl rollout undo deployment/orders-api        # back to the previous revision
```

Let the cluster pull from your registry without secrets:

```bash
az aks update --name aks-shop --resource-group rg-shop --attach-acr myregistry
```

That grants the cluster's kubelet identity `AcrPull` on the registry.

---

## The troubleshooting ladder

Always go from the outside in: **pods, then the pod's details, then logs, then events, then the Service, then the network**.

```bash
kubectl get pods -o wide                       # status, restarts, node
kubectl describe pod orders-api-7d9f...        # Events section at the bottom
kubectl logs orders-api-7d9f... --previous     # logs of the crashed container
kubectl get events --sort-by=.lastTimestamp    # cluster events
kubectl get endpoints orders-api               # which pod IPs back the Service
kubectl exec -it orders-api-7d9f... -- sh      # look inside
kubectl port-forward svc/orders-api 8080:80    # test from your machine
```

### Symptom table

| Symptom | Usual cause | How to confirm and fix |
|---------|-------------|------------------------|
| `ImagePullBackOff` / `ErrImagePull` | Wrong image name or tag, or no `AcrPull` for the cluster | `describe pod` shows the pull error. Fix the tag or `--attach-acr`. |
| `CrashLoopBackOff` | The process exits on start (bad config, missing secret, exception) | `kubectl logs --previous` |
| `Pending` | Not enough CPU or memory on any node for the `requests`, or an unbound volume | `describe pod` Events say `FailedScheduling` |
| Service has **no endpoints** | The Service `selector` does not match the pod labels, or pods are not ready | `kubectl get endpoints`, compare labels, check the readiness probe |
| Pod `Running` but unreachable | Wrong `targetPort`, or a network policy | `port-forward` to the pod, then to the Service |
| `OOMKilled` (exit code **137**) | The container exceeded its memory `limit` | `describe pod` shows the last state. Raise the limit or fix the leak. |

To test end-to-end connectivity inside the cluster, start a throwaway pod and call the Service by its DNS name:

```bash
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://orders-api.default.svc.cluster.local/healthz
```

---

## Troubleshooting Azure Container Apps

| Need | Where |
|------|-------|
| Live container output | Log stream in the portal, or `az containerapp logs show` |
| History and queries | The Log Analytics workspace connected to the environment (console logs and system logs) |
| Why a revision is unhealthy | The revision's **provisioning status** and **running status** |

Running statuses worth recognizing: **Activating** (zero replicas, one being provisioned), **Activation failed** (the first replica failed to provision), **Degraded** (at least one replica failed), **Failed** (critical error, common causes are termination and exit code **137**), **Scale to 0** (zero replicas, new ones start when a scale rule fires).

- **Console logs** are what your process writes to stdout and stderr.
- **System logs** are platform events such as image pull problems, probe failures and scaling decisions.
- A revision that never becomes ready (failing startup or readiness probe) keeps the **old** revision serving in single revision mode, so the symptom is "my deployment did nothing".

---

## Quick check

1. The Service exists but `kubectl get endpoints` is empty. **Selector and pod labels do not match, or no pod is ready.**
2. Where do you read the output of a container that already crashed? **`kubectl logs <pod> --previous`.**
3. A new Container Apps revision shows *Activation failed*. **Read the system logs and the revision status, then check the image and probes.**

---

## Official documentation

- [Azure Kubernetes Service](https://learn.microsoft.com/en-us/azure/aks/)
- [Kubernetes: debug pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)
- [Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/)
