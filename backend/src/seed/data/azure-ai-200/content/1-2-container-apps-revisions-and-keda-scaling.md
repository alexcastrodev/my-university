---
version: 1.0
updatedAt: 2026-11-14
---
# Azure Container Apps: Revisions and Event-Driven Scaling with KEDA

> Exam domain: **Develop containerized solutions on Azure (20-25%)**, skill group *Implement container-orchestrated solutions*.

---

## The mental model

| Concept | What it is |
|---------|------------|
| **Environment** | The secure boundary around one or more container apps (shared network and logging) |
| **Container app** | Your workload: containers, ingress, secrets, scale rules |
| **Revision** | An **immutable snapshot** of a version of the app |
| **Replica** | One running instance of a revision |

Container Apps runs on Kubernetes, but you never touch manifests. Scaling is powered by **KEDA** (Kubernetes Event-driven Autoscaling).

---

## Environment configuration, secrets and variables

```bash
az containerapp create \
  --name orders-api --resource-group rg-shop \
  --environment shop-env \
  --image myregistry.azurecr.io/shop/orders-api:1.4.2 \
  --target-port 8000 --ingress external \
  --secrets "db-password=$DB_PASSWORD" \
  --env-vars "LOG_LEVEL=info" "DB_PASSWORD=secretref:db-password"
```

`secretref:` makes a variable read from the app's secret store instead of holding the value. Secret values are **application-scope** settings, and a revision must be **restarted** before a running container sees a changed secret.

---

## Revisions

A revision is created the first time you deploy, and again whenever you make a **revision-scope** change.

| Change scope | Creates a new revision? | Examples |
|--------------|-------------------------|----------|
| **Revision-scope** (`properties.template`) | Yes | Revision suffix, container image and configuration, **scale rules** |
| **Application-scope** (`properties.configuration`) | No, applied to all revisions | Secret values, revision mode, ingress and traffic-splitting rules, labels, registry credentials, Dapr settings |

### Revision modes

| Mode | Behavior | Default |
|------|----------|---------|
| **Single** | A new revision is activated and scaled up. Traffic moves only when it is ready. Old revisions are deprovisioned. | **Yes** |
| **Multiple** | Several revisions stay active. You choose traffic percentages and when to deactivate old ones. | No |

In single mode a new revision counts as **ready** when it provisioned successfully, scaled up to match the previous revision's replica count (within the new min and max), and **all replicas passed startup and readiness probes**. Until then the old revision keeps 100% of the traffic. That is the zero-downtime guarantee.

```bash
az containerapp revision set-mode --name orders-api -g rg-shop --mode multiple

# blue-green style: send 20% to the new revision
az containerapp ingress traffic set --name orders-api -g rg-shop \
  --revision-weight orders-api--v1=80 orders-api--v2=20
```

- A **label** gives a revision its own stable URL. Moving the label to another revision keeps the URL. Labels are most useful in multiple mode.
- Revision names follow `<APP_NAME>-<REVISION_SUFFIX>`. A suffix must be lower case alphanumeric or dashes, start with a letter, not contain `--` and be at most 64 characters.
- Inactive revisions are free, and by default Container Apps keeps **100** of them.

---

## Scaling: limits, rules, behavior

| Limit | Default | Allowed |
|-------|---------|---------|
| Minimum replicas | **0** | 0 up to 1,000 |
| Maximum replicas | **10** | 1 up to 1,000 |

- With the default of 0 minimum replicas the app **scales to zero** and you pay no usage charges while it is at zero.
- If you do **not** enable ingress and set no `minReplicas` and no custom rule, the app scales to zero and **nothing can start it again**. Set `minReplicas` to 1 or add a rule.
- With several rules, the app scales as soon as **any one** rule's condition is met.

### Rule types

| Type | Based on | Default threshold |
|------|----------|-------------------|
| **HTTP** | Concurrent HTTP requests per replica | `concurrentRequests` = **10** |
| **TCP** | Concurrent TCP connections per replica | `concurrentConnections` = **10** |
| **Custom** | Any KEDA scaler: CPU, memory, Azure Service Bus, Event Hubs, Kafka, Redis, Azure Queue Storage and more | scaler specific |

### A Service Bus scale rule, translated from KEDA

A KEDA `ScaledObject` trigger becomes `custom` in Container Apps: the trigger `type` goes to `custom.type`, the trigger `metadata` goes to `custom.metadata`.

```yaml
template:
  scale:
    minReplicas: 0
    maxReplicas: 20
    rules:
      - name: orders-queue
        custom:
          type: azure-servicebus
          metadata:
            queueName: orders
            namespace: shop-bus
            messageCount: "5"
          identity: system   # managed identity instead of a connection string secret
```

The same thing with the CLI:

```bash
az containerapp update --name orders-worker -g rg-shop \
  --min-replicas 0 --max-replicas 20 \
  --scale-rule-name orders-queue --scale-rule-type azure-servicebus \
  --scale-rule-metadata "queueName=orders" "namespace=shop-bus" "messageCount=5" \
  --scale-rule-identity system
```

Authentication for a scaler uses either a **Container Apps secret** (`auth` with `secretRef` and `triggerParameter`) or, where supported (Service Bus, Event Hubs, Queue Storage), a **managed identity**. Prefer identity.

### Scale behavior numbers

| Behavior | Value |
|----------|-------|
| Polling interval (KEDA queries the event source) | 30 seconds |
| Cool down period (after the last event, before scaling to 0) | 300 seconds |
| Scale up stabilization window | 0 seconds |
| Scale down stabilization window | 300 seconds |
| Scale up step | 1, 4, 8, 16, 32 ... up to the maximum |
| Scale down step | 100% of the replicas that need to shut down |

The polling interval does **not** apply to HTTP and TCP rules. The cool down period only matters for the last replica going to 0.

**Worked example.** `messageCount: "5"`, queue length 50, max 20:

```text
desiredReplicas = ceil(50 / 5) = 10
target          = min(maxReplicaCount, desiredReplicas, max(4, 2 * currentReplicaCount))
```

With 1 replica running that is `min(20, 10, max(4, 2)) = 4`, then it keeps stepping up on later polls until it reaches 10.

### Gotchas

- Changing a scale rule is a revision-scope change, so it **creates a new revision**. In multiple mode the old revision keeps its old rules.
- Non-HTTP event rules expect `activeRevisionsMode` to be `single`.
- Vertical scaling is not supported, and replica counts are a target, not a guarantee.
- Event-driven **Container Apps jobs** use `ScaledJob`-style rules and do not support HTTP or TCP rules.

---

## Quick check

1. A queue worker must be idle (cost zero) when the queue is empty. **`minReplicas: 0` with an `azure-servicebus` custom rule.**
2. You changed an image tag and want 10% of the traffic on it. **Multiple revision mode plus a traffic split.**
3. You rotated a secret and the app still uses the old one. **Restart the revision.**

---

## Official documentation

- [Scaling in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)
- [Update and deploy changes with revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
- [KEDA scalers](https://keda.sh/docs/latest/scalers/)
