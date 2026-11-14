---
version: 1.0
updatedAt: 2026-11-14
---
# Azure Service Bus: Queues, Topics, Settlement and Dead-Letter Queues

> Exam domain: **Connect to and consume Azure services (20-25%)**, skill group *Develop event- and message-based AI solutions*.

---

## Messages versus events

| | **Message** (Service Bus) | **Event** (Event Grid) |
|---|---------------------------|------------------------|
| Intent | A **command** or work item the sender wants processed | A **notification** that something happened |
| Consumer | One logical consumer per queue, or one per topic subscription | Any number of subscribers, each reacts on its own |
| Broker role | Holds the message until a receiver **settles** it | Pushes the event and retries |
| Typical AI use | Queue document-ingestion jobs, chunking, embedding work | React to a blob being created, a resource changing |

---

## Queues, topics and subscriptions

- A **queue** is point-to-point: competing consumers share the work, each message goes to one of them.
- A **topic** is publish-subscribe: the sender sends to the topic, and every **subscription** gets its own copy of the messages that match its **rules**.
- Subscription rule types: **SQL filter**, **correlation filter**, **boolean filter**. A new subscription has a default rule that accepts everything.
- **Sessions** give ordered, FIFO processing per `session_id` and make one receiver own a whole session.
- **Duplicate detection** uses `message_id`. The sender sets a unique, meaningful `message_id`.

---

## Send and receive in Python

```python
from azure.identity import DefaultAzureCredential
from azure.servicebus import ServiceBusClient, ServiceBusMessage

NAMESPACE = "shop-bus.servicebus.windows.net"

with ServiceBusClient(NAMESPACE, DefaultAzureCredential()) as client:
    with client.get_queue_sender("ingest") as sender:
        sender.send_messages(ServiceBusMessage(
            body='{"docId": "17"}',
            message_id="doc-17-v3",                    # dedupe and idempotency key
            application_properties={"kind": "pdf"},
        ))

    with client.get_queue_receiver("ingest", max_wait_time=5) as receiver:
        for msg in receiver:
            try:
                process(msg)
                receiver.complete_message(msg)         # success: remove it
            except TransientError:
                receiver.abandon_message(msg)          # retry soon: unlock it, delivery count + 1
            except BadPayloadError as e:
                receiver.dead_letter_message(msg,      # will never succeed: park it
                    reason=type(e).__name__, error_description=str(e))
```

---

## Receive modes and settlement

| Mode | Behavior | Risk |
|------|----------|------|
| **Receive-and-delete** | The broker considers the message settled when it sends it | If the receiver crashes after receiving, the message is **lost** |
| **Peek-lock** | The broker locks the message. You settle it explicitly | A slow handler can lose the lock |

Settlement operations in peek-lock:

| Operation | Result |
|-----------|--------|
| **Complete** | Success. The message is removed |
| **Abandon** | Release the lock now. The message is redelivered and its **delivery count increases** |
| **Defer** | Keep it in the queue but not delivered to normal receives. You fetch it later by sequence number |
| **Dead-letter** | Move it to the dead-letter queue, with a reason you choose |

Lock facts:

- Default lock duration is **1 minute**. Maximum is **5 minutes**. Set it above your normal processing time.
- For longer work, **renew the lock** (`AutoLockRenewer` in the Python SDK) instead of raising the duration.
- If the lock expires, the message returns to the front of the queue and the delivery count increments.
- If the **connection drops** or the receiver closes before you settle, the settlement does not reach the service and the message is redelivered later.
- **Settle before you close the receiver.** Completing after closing throws and settles nothing.
- A lost lock raises `MessageLockLostException` (or `SessionLockLostException`) in .NET-style SDKs. In that case the delivery count is **not** incremented.

Because a message can be delivered more than once, **handlers must be idempotent**. The usual way is to check `message_id` against a processed-ids store.

---

## Dead-letter queues (DLQ)

Every queue and every topic **subscription** has its own dead-letter sub-queue. It cannot be created separately or deleted. Topics themselves have no DLQ, because messages are forwarded to subscriptions within milliseconds.

Addressing it:

```text
<queue path>/$deadletterqueue
<topic path>/Subscriptions/<subscription path>/$deadletterqueue
```

```python
from azure.servicebus import ServiceBusSubQueue

with client.get_queue_receiver("ingest", sub_queue=ServiceBusSubQueue.DEAD_LETTER) as dlq:
    for msg in dlq:
        print(msg.dead_letter_reason, msg.dead_letter_error_description)
        dlq.complete_message(msg)        # remove it from the DLQ
```

### Why messages are dead-lettered

| Dead-letter reason | Cause |
|--------------------|-------|
| `MaxDeliveryCountExceeded` | Delivery attempts exceeded **Max delivery count** (default **10**). Includes repeated abandon and repeated lock expiry. This cannot be disabled, only raised |
| `TTLExpiredException` | The message's time to live ran out **and dead-lettering on message expiration is enabled** |
| `HeaderSizeExceeded` | The size quota for the stream was exceeded |
| `Session ID is null` | A message without a session id was sent to a session-enabled entity |
| `MaxTransferHopCountExceeded` | More than **4** hops of auto-forwarding |
| (filter exception) | A subscription SQL filter raised an error and **dead-lettering on filter evaluation exceptions** is on |
| Your own reason | The application called dead-letter explicitly |

More facts:

- Time to live is **not** observed in the DLQ itself, and you cannot dead-letter a message *from* a DLQ.
- There is **no automatic cleanup** of the DLQ. Messages stay until you receive and complete them.
- Deferred messages are **not** moved to the DLQ when they expire.
- **Transfer dead-letter queue**: if a message cannot be forwarded (auto-forward or send-via) the message goes to the transfer DLQ of the **source** entity: `<queue path>/$Transfer/$DeadLetterQueue`.
- To reprocess: fix the cause, then **resend** the message. Service Bus Explorer in the portal can peek, edit and resend DLQ messages.
- Put the exception type in the dead-letter **reason** and details in the **description** to make troubleshooting easy. The Standard tier message size limit is **256 KB**, Premium is higher.

---

## Quick check

1. A poison message is retried 10 times and then vanishes from the queue. **It went to the DLQ with `MaxDeliveryCountExceeded`.**
2. Processing takes 7 minutes. **Renew the lock. The maximum lock duration is 5 minutes.**
3. Two services each need a copy of every order message. **One topic with two subscriptions.**
4. Messages must be handled in order per customer. **Enable sessions and use the customer id as the session id.**

---

## Official documentation

- [Service Bus dead-letter queues](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues)
- [Message transfers, locks and settlement](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-transfers-locks-settlement)
- [Azure Service Bus](https://learn.microsoft.com/en-us/azure/service-bus-messaging/)
