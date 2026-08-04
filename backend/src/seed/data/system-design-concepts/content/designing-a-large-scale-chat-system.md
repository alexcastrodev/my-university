---
title: Designing a Large-Scale Chat System (Slack-like)
description: A worked system design interview walkthrough for a Slack-like chat product — functional and non-functional requirements, core entities, why WebSockets replace request/response polling, and the high-level design for sending messages, rich media, offline delivery, and message deletion.
difficulty: Intermediate
readingTime: 18
tags:
  - System Design Interviews
  - Real-Time Systems
  - WebSockets
  - Messaging
  - API Design
prerequisites:
  - Basic client-server networking
  - REST APIs
  - Relational vs. NoSQL databases basics
related:
  - label: "Scaling Real-Time Messaging: Ordering, Fan-out, and Presence"
    slug: scaling-real-time-messaging-ordering-and-fan-out
  - label: CAP Theorem
    slug: cap-theorem
  - label: Load Balancing Strategies
    slug: load-balancing-strategies
---

## Overview

"Design Slack" (or Messenger, or WhatsApp) is one of the most common system design interview prompts because it forces a candidate to reason about real-time delivery, offline users, multi-device consistency, and unstructured media all in one system. Like any ambiguous prompt, the interviewer gives you a one-line statement — "design a chat system" — and expects *you* to scope it down to an MVP of three or four features rather than attempt every Slack feature (threads, search, reactions, integrations) in a 45-60 minute session. This concept walks through that scoping exercise and the resulting high-level design; the follow-up concept, [Scaling Real-Time Messaging](scaling-real-time-messaging-ordering-and-fan-out), covers the deep dives on ordering, fan-out, and presence at billion-user scale.

## Functional Requirements

Decompose the vague prompt into a concrete MVP before designing anything. For this walkthrough, the scope is four features:

- **Send and receive messages**, one-to-one or in a group chat.
- **Send rich media** (images, videos, files), not just plain text — this is a deliberate probe into structured vs. unstructured data storage choices.
- **Receive real-time notifications for offline users** — the user experience has to be seamless whether the recipient is actively connected or not.
- **Delete a message**, with the deletion propagating to every recipient across every one of their devices (a user may be logged in on a phone, a laptop, and a tablet at once).

Explicitly listing what's *out* of scope (search, threads, reactions, read receipts beyond a basic mention) is as important as listing what's in — it signals to the interviewer that you understand the difference between a full product and an interview-sized MVP.

## Non-Functional Requirements

Non-functional requirements describe the *qualities* of the system, and every one of them should be backed by a number — either given by the interviewer or an assumption you state and ask them to validate:

- **Scalability** — assume 1 billion daily active users and 100k concurrent chats. At 1B DAU, that's roughly 12k queries per second sustained load. Always clarify daily vs. monthly active users; the two imply very different infrastructure.
- **Low latency** — real-time chat delivery should stay under ~200ms to avoid a perceived lag; anything crossing 500ms is treated as a degraded path that falls back to batching.
- **Consistency vs. availability** — network partitions are a given in any distributed system (see [CAP Theorem](cap-theorem)), so the real choice is CP or AP, never CA. A chat system prioritizes **availability** over strict consistency: showing a slightly stale message list beats refusing to serve one.
- **Message durability** — messages must survive node failure and be recoverable for audit/compliance and disaster recovery (RPO/RTO), not just cached in memory.
- **Consistency across multiple devices** — a message, its deletion, a typing indicator, a read receipt, and a presence update all need to propagate to every device a user is logged into, not just the one that triggered the event.

## Core Entities

Before jumping to APIs or diagrams, name the nouns the system needs to persist:

- **User** — a registered participant who can send and receive messages.
- **Chat** — an abstraction over a one-to-one conversation or a group; this is what a message is "sent to."
- **Message** — the content itself, either plain text or a pointer to rich media.
- **Media** — unstructured content (image, video, audio, file) sent as part of a message.
- **Device Session** — the active WebSocket connection or push-notification endpoint for one of a user's devices; because a user can be logged in on multiple devices simultaneously, session state has to be tracked per device, not just per user.

## Why WebSockets, Not REST Polling

A traditional REST request/response cycle means the client has to open a new connection (or poll repeatedly) to find out whether the server has anything new to say — expensive and high-latency for a system that's fundamentally a back-and-forth conversation. **WebSockets** provide a single, persistent, bidirectional connection: once established, either side can push a message to the other at any time without renegotiating a connection. Any feature requiring true real-time interaction — not just chat — is a candidate for WebSockets over polling (see [RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455) for the protocol spec).

## WebSocket Events and Payloads

WebSocket connections carry structured **events**, each with an event name and a payload; the server decides what to do (broadcast, acknowledge, persist) based on the event type:

| Event | Direction | Purpose |
|---|---|---|
| `send_message` | client → server | Client submits a new message. |
| `new_message` | server → clients | Server fans the message out to the other participant(s) (one-to-one or group). |
| `message_deleted` | server → clients | Broadcasts a deletion so every participant's client removes the message locally. |
| `user_typing` / `typing_started` / `typing_stopped` | client → server, server → clients | Typing indicator, individual or group. |
| `read_receipt` | client → server, server → clients | Read acknowledgement. |
| `presence_update` | server → clients | Online/offline status change. |

A representative payload for a broadcast message includes a server-generated globally unique `message_id`, the `chat_id` (user or group), the content, and metadata (timestamp, sender). The server — not the client — mints the `message_id`, because client clocks aren't trustworthy for ordering (more on this in the fan-out deep dive).

## High-Level Design: Sending a Message (1:1 and Group Chat)

Start simple: don't add a component until measured complexity demands it. The base flow:

```
Client --(WebSocket)--> API Gateway --> Chat Server --> DB (message table)
                                            |
                                            v
                              Query WebSocket Server for active sessions
                                            |
                             (online)                    (handled in deep dive: offline)
                                v
                      Push new_message to active recipients
```

The **API Gateway** acts as reverse proxy, load balancer, and handles authN/authZ, rate limiting, and protocol translation. The **Chat Server** (a microservice) validates the sender, classifies the message type (text vs. media), generates a globally unique `message_id` (e.g., a UUID) before persisting, writes the row, and optionally increments a per-chat sequence number. It then asks the **WebSocket Server** — which tracks every device's active connection — which recipients are currently online, and pushes `new_message` to those sessions.

### Database schema for use case 1

| Table | Key columns |
|---|---|
| `user` | `user_id`, `username`, ... |
| `chat` | `chat_id`, `is_group`, `created_at` |
| `chat_members` | `chat_id`, `user_id`, `joined_at` |
| `message` | `message_id` (global unique), `chat_id`, `sender_id`, `content`, `parent_message_id` (nullable, for threaded replies), `created_at` |

Keeping `parent_message_id` from day one means the schema can grow into threaded replies later without a migration that breaks existing rows.

## High-Level Design: Rich Media Messages

Large binary payloads (images, videos, files) don't belong in the same store as text — this is the [polyglot persistence](polyglot-persistence) instinct at work. The flow changes at the front:

```
Client --> Media Server --(pre-signed URL)--> Client --(direct upload)--> S3
Client --(send_message with media_id)--> API Gateway --> Chat Server --> DB
```

The client asks the **Media Server** for a pre-signed upload URL, uploads the binary *directly* to object storage (e.g., S3) — bypassing the chat server entirely for the heavy payload — and receives back a `media_id`/URL. The `send_message` event then carries that media reference instead of raw bytes. The `message` table only needs two additional columns, `media_id` and `media_url`, to distinguish structured (text) from unstructured (media) content; the rest of the pipeline (persist, look up active sessions, fan out) is identical to use case 1.

## High-Level Design: Offline Delivery via Inbox and Push Notifications

Everything up to this point assumes the recipient is online. For an **offline** recipient, the system shouldn't wait for them to reconnect before doing anything — it should proactively notify them. When the chat server (via the WebSocket server) determines a recipient has no active session:

1. Insert a row into an **`inbox`** table: `user_id`, `message_id` (FK to `message`), `created_at`, `delivered_at` (nullable).
2. Send a push notification (e.g., via APNs for iOS) that says *"you have a new message"* — not the message content itself.
3. When the user reconnects, the WebSocket server reads their pending `inbox` rows, pushes the actual messages, and stamps `delivered_at` so the same message is never redelivered.

A cleanup job periodically purges delivered inbox rows (or they're marked and left for audit, depending on the durability requirement).

## High-Level Design: Deleting a Message

Deletion mirrors the send flow: the chat server deletes (or soft-deletes) the row by `message_id`, then checks recipient status exactly as before — online recipients get a `message_deleted` event pushed immediately; offline recipients get a push notification. An `is_deleted` flag on the `message` (or `inbox`) row means that when an offline user reconnects and the inbox is replayed, already-deleted messages are filtered out rather than delivered and then retracted.

## Trade-offs

- **Prioritizing availability over consistency (AP) means recipients can briefly see a different message state on different devices.** This is an acceptable trade for chat (a slightly stale message list) but would be unacceptable for, say, a financial ledger — always name which subsystem's trade-off you're describing.
- **Storing only a media pointer (not the binary) in the message table keeps the hot path fast, but couples message integrity to two systems (the relational/NoSQL store and object storage) instead of one.** A dangling `media_url` with a missing S3 object is a failure mode that has to be handled (e.g., a background reconciliation job).
- **Pre-signed upload URLs remove the chat server from the media upload's critical path, improving throughput, but push authorization logic (who's allowed to upload what, size limits) into the media server and the storage bucket's own policy, not the chat server's request validation.**

## Interview Questions

- Why does the chat server generate the `message_id` instead of trusting a client-supplied one?
- What changes in the high-level design between a one-to-one chat and a group chat with 500 members?
- Why store a pointer (media URL) rather than the media itself in the message table?
- How would you extend the schema to support threaded replies without breaking existing queries?
- What's the difference between "the message wasn't delivered" and "the message was delivered to a device that's no longer valid"?

## References

- IETF, ["RFC 6455 — The WebSocket Protocol"](https://datatracker.ietf.org/doc/html/rfc6455)
- IGotAnOffer: Engineering, [System design mock interviews (YouTube)](https://www.youtube.com/@IGotAnOffer-Engineering)
- System Design Handbook, ["Slack System Design Interview: The Complete Guide"](https://www.systemdesignhandbook.com/guides/slack-system-design-interview/)
- MDN Web Docs, ["WebSockets API"](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
