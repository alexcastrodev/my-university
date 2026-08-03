---
title: Scaling Real-Time Messaging: Ordering, Fan-out, and Presence
description: The deep-dive half of a chat system design interview — guaranteeing per-chat message ordering with Kafka, decoupling fan-out from the chat server via CDC, scaling WebSocket delivery with pub/sub, taming WebSocket churn with leased subscriptions, and partitioning/caching storage for billions of users.
difficulty: Advanced
readingTime: 16
tags:
  - System Design Interviews
  - Real-Time Systems
  - Scalability
  - Message Ordering
  - Pub/Sub
prerequisites:
  - label: Designing a Large-Scale Chat System (Slack-like)
    slug: designing-a-large-scale-chat-system
  - WebSockets basics
  - Kafka partitioning basics
related:
  - label: Message Brokers: Queues vs. Log-Based Streaming
    slug: message-brokers-queues-vs-logs
  - label: Change Data Capture (CDC)
    slug: change-data-capture
  - label: Consistent Hashing
    slug: consistent-hashing
  - label: Caching Strategies and CDNs
    slug: caching-strategies-and-cdns
  - label: Read/Write Splitting and CQRS-Lite
    slug: read-write-splitting-and-cqrs-lite
---

## Overview

The [high-level design for a Slack-like chat system](designing-a-large-scale-chat-system) covers the happy path for four features at a whiteboard level, but a senior-level interview keeps pushing: what happens at a billion users, when the chat server itself becomes a bottleneck, when a message arrives out of order, or when a user's WebSocket connection keeps hopping between nodes? This concept works through four deep dives that typically follow the high-level design in a system design interview: message ordering, WebSocket fan-out at scale, WebSocket connection churn, and backend storage pressure.

## Why Message Ordering Is Hard at Scale

Two messages sent moments apart — "party at 5pm, can you come?" followed by "yes, sounds good" — completely change meaning if delivered out of order. Three options exist to guarantee per-chat ordering:

1. **Client-side timestamps.** Fragile: client clocks are decentralized and not synchronized, so ordering by client timestamp can silently misorder messages whenever two devices' clocks drift.
2. **Server-side sequence number per chat.** Works, but requires a counter that's consistent across every node handling that chat — coordinating that counter across multiple data centers adds real infrastructure complexity and becomes a bottleneck at scale.
3. **Kafka-based ordered ingestion per chat (recommended).** Partition a Kafka topic by `chat_id`. Every message for a given chat always lands in the same partition, and Kafka guarantees order *within* a partition. As chat volume grows, add more partitions; Kafka's own replication and offset tracking handles failure recovery (a consumer that crashes redelivers from its last committed offset without message loss) — see [Message Brokers: Queues vs. Log-Based Streaming](message-brokers-queues-vs-logs) for why a log-based broker, not a plain queue, is what provides this guarantee.

## Kafka-Based Ordered Ingestion Per Chat

With Kafka introduced, the chat server writes each accepted message to a Kafka topic partitioned by `chat_id` instead of (or in addition to) synchronously handling fan-out itself:

```
Chat Server --> Kafka topic (partitioned by chat_id) --> Consumer group --> DB + fan-out
```

Each partition is consumed by exactly one consumer within a consumer group, so all messages for one chat are processed in the order they were produced, by a single consumer, without cross-node coordination for that chat's ordering.

## CDC-Driven Fan-out Jobs (Removing the Chat Server as a Bottleneck)

Rather than having the chat server itself decide "is this recipient online, offline — where do I push this?" for every message (making it a single hot path for both writes and delivery logic), that responsibility can move to a separate **fan-out job** triggered by [Change Data Capture](change-data-capture) on the message table's write. The moment a message row commits, CDC (e.g., Debezium reading the database's write-ahead log) emits a change event that a fan-out worker consumes independently:

```
DB write (message table) --CDC--> Fan-out job --> query WebSocket Server (online?) --> push
                                              \--> offline --> push notification (APNs/FCM)
```

This decouples "persist the message" from "figure out delivery," so the chat server's write path stays fast and fan-out logic can scale (or fail) independently as its own microservice.

## Scaling WebSocket Fan-out with Redis Pub/Sub

Billions of users means billions of devices holding open WebSocket connections, potentially spread across many WebSocket server instances. If the fan-out job had to know *which specific server instance* holds a given user's connection, that's a tight coupling that doesn't scale. Instead, use a **pub/sub layer (e.g., Redis Pub/Sub)** with one channel per `chat_id`:

```
Fan-out job --publish--> Redis channel "chat:{chat_id}" --> subscribed WebSocket servers --> push to connected clients
```

Each WebSocket server dynamically subscribes to the channels for the chats its currently-connected clients belong to. The fan-out job publishes once per chat event; Redis handles delivering that single publish to every subscribed server, instead of the fan-out job needing to track individual server-to-connection mappings.

## WebSocket Churn: Leased Subscriptions with TTL

Users change devices, lose connectivity, and reconnect — often to a *different* WebSocket server node. This is **WebSocket churn**. Two ways to handle a WebSocket server's channel subscriptions as clients move:

- **Subscribe to everything, indefinitely** — simple but wasteful: most channels a server subscribes to may have no currently-connected client for that chat, especially once a client has moved to another node.
- **Lease the subscription with a TTL (recommended)** — a WebSocket server's channel subscription expires after a short window (e.g., 10 seconds) and is renewed only while it still has a live connection interested in that channel. If a client has moved elsewhere, the stale subscription lapses instead of continuing to receive (and potentially double-deliver) messages for a connection that no longer exists there.

Leased subscriptions prevent stale connections from silently accumulating and reduce the risk of the same message being pushed to more than one now-defunct connection.

## Partitioning and Replicating Chat Storage

At billion-user scale, a single database instance can't absorb the write or read load. Two levers:

- **Horizontal partitioning (sharding).** Shard the `message` table by `chat_id` (writes and reads for a conversation stay co-located) and the `inbox` table by `recipient_user_id` (offline delivery lookups are per-recipient, not per-chat). See [Consistent Hashing](consistent-hashing) for how shard assignment is typically computed so that adding/removing shards doesn't require reshuffling most of the data.
- **Read replicas across regions ("write locally, read globally").** Because the system has already chosen availability over strict consistency, a small delay before a replica catches up is acceptable — see [Read/Write Splitting and CQRS-Lite](read-write-splitting-and-cqrs-lite). Writes go to a local primary; reads can be served from the nearest geo-replica.

## Choosing NoSQL for Write-Heavy Chat Data

Chat messages are a write-heavy, key-value-shaped workload (look up by `chat_id` or `message_id`, rarely joined across many tables), which favors a NoSQL store optimized for write throughput over a relational database — unless a specific query pattern genuinely requires multi-table joins, in which case relational is still the right call for that specific data (see [Polyglot Persistence](polyglot-persistence)). The rule of thumb from the interview: pick the storage engine per access pattern, not one engine for the whole system.

## Caching Hot Data (Chat Membership, Device Sessions, Recent Messages)

Some data changes rarely but is read constantly: chat membership (who's in a group), device sessions, and the most recent message slice for a chat. This is exactly the profile for a cache-aside layer — see [Caching Strategies and CDNs](caching-strategies-and-cdns). The interview's rule of thumb: caching roughly 10% of the hottest data can eliminate 80% of database calls, and caching 10-20% can push that to 97-99%, because access patterns for this kind of data are heavily skewed toward a small hot set. A CDC stream can proactively populate the cache before a fan-out job needs the data, rather than the fan-out job populating the cache reactively on a miss.

## Client-Side Deduplication via Monotonic Message IDs

Because sessions move across devices and networks are unreliable, the same message can occasionally be re-pushed to a client that already received it (e.g., a reconnect race). Rather than solving this purely server-side, the client keeps track of the highest `message_id` it has already processed for a chat (message IDs are minted by the chat server and are monotonically comparable, even if not strictly sequential integers); any incoming message with an ID the client has already seen or superseded is safely ignored. This pushes a cheap idempotency check to the edge instead of requiring server-side dedup bookkeeping per device.

## Trade-offs

- **Kafka-based ordering adds an entire streaming platform to the architecture just to guarantee ordering for what might be a small fraction of "same-chat, near-simultaneous" messages.** It's the right call at the scale this design targets, but it's meaningful operational overhead (partition rebalancing, consumer lag monitoring) that a smaller system shouldn't pay for prematurely.
- **CDC-driven fan-out decouples the write path from delivery, but introduces replication lag as a new source of latency** — a message is "written" before it's "fanned out," so a client could, in principle, see its own message echoed back to it before another observer receives it, and that ordering has to be handled at the UI level.
- **Leased WebSocket subscriptions trade a small, constant renewal overhead (a heartbeat every ~10 seconds) for avoiding stale-connection message duplication** — cheap insurance against a much worse failure mode (users seeing the same message twice, or a "ghost" connection absorbing messages meant for nobody).
- **NoSQL-first for message storage optimizes the common case (single-partition writes/reads) at the cost of expensive or unsupported multi-table joins** — if a later feature (e.g., full-text search across all chats a user belongs to) needs that kind of query, it likely needs a separate index/store, not a schema change to the primary store.

## Interview Questions

- Why does partitioning a Kafka topic by `chat_id` guarantee ordering, and what happens to that guarantee if you instead partition by a random key?
- What's the failure mode if the CDC pipeline lags behind the primary database by several seconds during a fan-out spike?
- Why is a leased (TTL) pub/sub subscription preferable to an indefinite one for WebSocket servers specifically?
- If a `message_id` is a UUID (not a strictly incrementing integer), how can a client still use it to detect "have I already seen this message"?
- Under what conditions would you choose a relational database over NoSQL for part of this system, even though the system overall favors write throughput?

## References

- Apache Kafka Documentation, ["Topics, Partitions, and Ordering Guarantees"](https://kafka.apache.org/documentation/#intro_topics)
- Redis Documentation, ["Pub/Sub"](https://redis.io/docs/latest/develop/interact/pubsub/)
- Debezium Documentation, ["Change Data Capture Tutorial"](https://debezium.io/documentation/reference/stable/tutorial.html)
- Discord Engineering, ["How Discord Stores Billions of Messages"](https://discord.com/blog/how-discord-stores-billions-of-messages)
- IGotAnOffer: Engineering, [System design mock interviews (YouTube)](https://www.youtube.com/@IGotAnOffer-Engineering)
