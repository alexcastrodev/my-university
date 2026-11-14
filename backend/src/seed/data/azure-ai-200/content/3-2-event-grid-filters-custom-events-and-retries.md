---
version: 1.0
updatedAt: 2026-11-14
---
# Azure Event Grid: Filters, Custom Events and Retries

> Exam domain: **Connect to and consume Azure services (20-25%)**, skill group *Develop event- and message-based AI solutions*.

---

## The building blocks

```text
 event source ──> topic ──> event subscription (filter + endpoint) ──> handler
 (Storage, Key Vault,       (system or custom)                          (Function, Service Bus,
  your app)                                                              Event Hubs, webhook ...)
```

| Term | Meaning |
|------|---------|
| **Event source** | Where the event happens. Azure services publish **system topic** events (Blob created, secret near expiry). Your own app publishes to a **custom topic** |
| **Topic** | The endpoint that receives events |
| **Event subscription** | Tells Event Grid which events go to which handler. Holds the **filters**, the **retry policy** and the **dead-letter** destination |
| **Handler** | The endpoint that gets the event |

Event Grid delivers each event **at least once** to each matching subscription. It does **not** guarantee ordering, so subscribers can see events out of order, and duplicates are possible.

---

## Publish a custom event

```python
from azure.core.messaging import CloudEvent
from azure.eventgrid import EventGridPublisherClient
from azure.identity import DefaultAzureCredential

client = EventGridPublisherClient(
    "https://orders-topic.westeurope-1.eventgrid.azure.net/api/events",
    DefaultAzureCredential(),
)

client.send(CloudEvent(
    source="/shop/orders",
    type="Shop.OrderPlaced",
    subject="/orders/1001",
    data={"orderId": 1001, "total": 249.90, "region": "eu"},
))
```

Event Grid accepts three schemas: **Event Grid schema**, **CloudEvents 1.0** and a **custom schema** (with input mapping). A topic uses one input schema, so pick CloudEvents for new work.

---

## Filters

You filter **on the subscription**, so each handler gets only what it cares about.

| Filter | Example |
|--------|---------|
| **Event types** | Only `Shop.OrderPlaced` |
| **Subject begins with / ends with** | `/orders/` and `.pdf` |
| **Advanced filters** on the envelope or `data` fields | `data.total NumberGreaterThan 100`, `data.region StringIn ["eu","uk"]` |

```bash
az eventgrid event-subscription create \
  --name big-eu-orders \
  --source-resource-id <topic-resource-id> \
  --endpoint-type azurefunction --endpoint <function-resource-id> \
  --included-event-types Shop.OrderPlaced \
  --advanced-filter data.total NumberGreaterThan 100 \
  --advanced-filter data.region StringIn eu uk
```

For a **webhook** endpoint Event Grid first performs a **validation handshake**. The Azure Functions Event Grid trigger answers it for you.

---

## Delivery, retry and dead-letter

Success is **only** `200`, `201`, `202`, `203` or `204`. Everything else is a failure.

### Retry schedule

Event Grid waits **30 seconds** for a response. If none arrives it queues a retry, with **exponential backoff** on a best-effort schedule:

```text
10 s, 30 s, 1 min, 5 min, 10 min, 30 min, 1 h, 3 h, 6 h, then every 12 h up to 24 h
```

Event Grid adds small randomization and may skip retries for an endpoint that is consistently unhealthy.

### Retry policy (you can change it)

| Setting | Allowed | Default |
|---------|---------|---------|
| **Maximum number of attempts** | 1 to 30 | **30** |
| **Event time-to-live (TTL)** | 1 to 1440 minutes | **1440** (24 hours) |

Whichever limit is reached **first** ends delivery. Expiry is checked only **at the next scheduled attempt**.

### Errors that are not retried

| Endpoint type | No retry for |
|---------------|--------------|
| Azure resources | `400`, `413`, `403` |
| Webhook | `400`, `413`, `401`, `403` |

`400` (bad request) and `413` (payload too large) mean delivery can never succeed, so the event is **dead-lettered immediately** (or dropped if dead-lettering is not configured).

Other codes have their own minimum waits: `408` retry after 2 minutes or more, `503` after 30 seconds or more, `401` and `404` for Azure resource endpoints after 5 minutes or more, everything else after 10 seconds or more.

### Dead-lettering

- **Off by default.** Without it, undeliverable events are **dropped**.
- To enable it, give the subscription a **Blob Storage container** as the dead-letter destination.
- An event is dead-lettered when it **expires (TTL)** or **exceeds the maximum attempts**.
- There is a **five minute delay** between the last attempt and the blob being written. If the dead-letter location is unavailable for **four hours**, the event is dropped.
- With managed identity for dead-lettering, assign the identity the right role on the storage account.
- Dead-lettered events carry `deadLetterReason`, `deliveryAttempts` and `lastDeliveryOutcome` (for example `NotFound`, `Unauthorized`, `TimedOut`).
- Create a subscription on the dead-letter storage account to be notified of undelivered events.

### Delayed delivery and probation

If an endpoint keeps failing, Event Grid **delays** further deliveries to protect it. Subscriptions can be put in **probation** for a short, error-dependent period (for example 10 seconds for busy, 5 minutes for not found).

### Batching

Delivery is **one event per request** by default (the payload is still an array of one). You can turn on batching per subscription:

| Setting | Range |
|---------|-------|
| Max events per batch | 1 to **5,000** |
| Preferred batch size in KB | 1 to **1,024** |

Batches are **all or none**: there is no partial success. Ask for no more events than the handler can process within the 30 second window.

---

## Event Grid or Service Bus?

| Question | Pick |
|----------|------|
| "React when a blob lands, a secret nears expiry, a resource changes" | **Event Grid** |
| "Queue jobs with ordering, sessions, DLQ, exactly one worker" | **Service Bus** |
| A subscriber should be called back by a push with filtering at the broker | **Event Grid** |
| A consumer pulls work at its own pace | **Service Bus** |

Combining them is common: Event Grid fires on *BlobCreated*, delivers to a **Service Bus queue**, and workers process at their own pace.

---

## Quick check

1. A handler returns `400` for an event. **It is not retried. It is dead-lettered if configured, otherwise dropped.**
2. Undeliverable events must be kept for analysis. **Configure a Blob Storage dead-letter container on the subscription.**
3. Only orders over 100 from the EU or UK. **Event type filter plus advanced filters.**
4. Delivery should stop after 2 hours. **Set TTL to 120 minutes.**

---

## Official documentation

- [Event Grid delivery and retry](https://learn.microsoft.com/en-us/azure/event-grid/delivery-and-retry)
- [Event filtering for subscriptions](https://learn.microsoft.com/en-us/azure/event-grid/event-filtering)
- [Azure Event Grid](https://learn.microsoft.com/en-us/azure/event-grid/)
