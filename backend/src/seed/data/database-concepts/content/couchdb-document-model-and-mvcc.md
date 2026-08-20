---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Understand the two decisions that make CouchDB's document model genuinely different from a document store like MongoDB: every interaction happens over plain HTTP/REST — there is no separate wire protocol, no binary driver, "all calls to CouchDB happen through its REST interface" — and every document carries a revision id (`_rev`) that CouchDB uses for Multi-Version Concurrency Control instead of locks. CouchDB never blocks a writer waiting on another writer; it either rejects a write outright because the caller's `_rev` is stale, or — in the distributed/replicated case — lets both writes succeed and leaves the resulting conflict for the application to find and resolve on a later read.

## Use Cases

- Talking to CouchDB from any environment that can make an HTTP request — a shell script with `curl`, a browser's `fetch`, a load balancer's health check — with no driver, no client library, and no binary protocol to install or version-match.
- Writing the correct update sequence for any document: `GET` the document (to obtain the current `_id` and `_rev`), modify the *whole* JSON body, then `PUT` it back with that `_rev` — never a blind `PUT` or a partial field update.
- Explaining why a repeated or racing `PUT` comes back `409 Conflict` with `{"error":"conflict","reason":"Document update conflict."}` instead of silently overwriting someone else's change or hanging until a lock clears.
- Designing a multi-master or offline-first system (e.g., a PouchDB client syncing with a CouchDB server) where you must assume replication can and will produce documents with more than one live revision, and building the read path to check for and resolve `_conflicts` rather than trusting that "the document" is unambiguous.
- Diagnosing a bug report of the form "I updated the document and my change didn't stick" — the two live explanations under CouchDB's model are a stale-`_rev` rejection the client swallowed, or a replication conflict where a *different* revision than the one the user wrote won the deterministic tie-break and is what subsequent reads return.

## Deep Dive

### JSON over HTTP, and nothing else

The book's frame for the whole chapter: "CouchDB is document oriented, using JSON as its storage and communication language. All calls to CouchDB happen through its REST interface." There is no equivalent of MongoDB's BSON wire protocol or a driver that speaks a binary protocol underneath a friendlier API — "all libraries and drivers for CouchDB end up sending REST requests under the hood, so it makes sense to start by understanding how they work." Every operation in the chapter is a `curl` call:

```
$ curl "${COUCH_ROOT_URL}/music/2ac58771c197f70461056f7c7e0001f9"
{
  "_id": "2ac58771c197f70461056f7c7e0001f9",
  "_rev": "8-e1b7281f6adcd82910c6473be2d4e2ec",
  "name": "The Beatles",
  "albums": [ ... ]
}
```

`GET` is always safe — "CouchDB won't make any changes to documents as the result of a GET." Creating a new document is `POST` to the database URL (a `Content-Type: application/json` header is mandatory or CouchDB refuses the request); the `201 Created` response body hands back the server-assigned `_id` and the first `_rev`:

```
$ curl -i -XPOST "${COUCH_ROOT_URL}/music/" \
 -H "Content-Type: application/json" \
 -d '{ "name": "Wings" }'
...
{ "ok": true, "id": "2ac58771c197f70461056f7c7e002eda", "rev": "1-2fe1dd1911153eb9df8460747dfe75a0" }
```

This still holds unchanged in current CouchDB (3.5.x, verified against the Apache CouchDB documentation): the HTTP API is not a convenience layer over some faster native protocol, it *is* the protocol. That is the direct point of contrast with the MongoDB document model (see `mongodb-document-model-and-collections`): MongoDB documents travel over a BSON-based wire protocol that drivers implement natively for performance, and the shell/driver API lets you patch a single field in place with `$set`. CouchDB has no update-in-place operator at all — "unlike MongoDB, in which you modify documents in place, with CouchDB you always overwrite the entire document to make any change." Fauxton's web UI *looks* like field-level editing, but "behind the scenes it was rerecording the whole document when you hit Save Changes." Every update is read-whole-document, modify, write-whole-document back.

### `_rev` and MVCC: no locks, no transactions

`_id` and `_rev` are reserved fields on every document. `_id` is assigned once (by the client or by CouchDB) and never changes. `_rev` is assigned on every write and takes the form of an integer revision number, a dash, and a hash — e.g. `8-e1b7281f6adcd82910c6473be2d4e2ec` — where "the integer at the beginning denotes the numerical revision." To update or delete a document you must supply both the `_id` and a `_rev` that matches the document's current state, or CouchDB rejects the operation.

The book states the underlying philosophy directly: "There are no transactions or locking in CouchDB... All operations are first come, first served. By requiring a matching `_rev`, CouchDB ensures that the document you think you're modifying hasn't been altered behind your back while you weren't looking." Current CouchDB documentation frames the same mechanism as a deliberate trade for HTTP's statelessness: because "the HTTP protocol that CouchDB uses is stateless," MVCC lets CouchDB "handle many more concurrent connections" than a protocol that holds locks across requests, and readers are *never* blocked by writers — "any number of clients can be reading documents without being locked out or interrupted by concurrent updates, even on the same document." Concretely, on a single node, a second `PUT` reusing an already-superseded `_rev` gets:

```
$ curl -i -XPUT ".../music/2ac58771c197f70461056f7c7e002eda" ...
HTTP/1.1 409 Conflict
{"error":"conflict","reason":"Document update conflict."}
```

That single-node case is a *rejection*, not a lock — the second writer's request fails fast instead of queuing behind the first. `DELETE` is not exempt either: it still requires a matching `_rev` (via `If-Match` or a `?rev=` query parameter), returns a *new* revision even though the document is "gone," and, per the book, doesn't actually erase anything from disk — "the document wasn't really removed from disk, but rather a new empty document was appended, flagging the document as deleted."

### The distinctive part: conflicts that aren't rejected, they're detected

The 409-on-stale-`_rev` behavior above is optimistic concurrency control, and plenty of databases have something like it. What is genuinely distinctive to CouchDB — and the reason the book calls this out as its own design philosophy rather than a generic "document store" feature — is what happens once you replicate. CouchDB's canonical example (from the official documentation, not the book, but describing the same `_rev` mechanism the book introduces): Alice edits a contact's email address on her desktop and, before syncing, edits the same contact's phone number on her laptop. Both edits start from the same `_rev` and both succeed *locally* — there is no coordinator to block either write, because the two nodes aren't talking to each other yet. When the two databases replicate, CouchDB does not pick a winner and discard the loser outright: **both revisions are kept**, as two branches of the same document's revision tree, on both nodes. This is the "both writes succeed and the conflict surfaces afterward" behavior — CouchDB never blocked either edit, and the write path never failed; the conflict is discovered on read.

To make results deterministic without any node needing to talk to any other node, CouchDB runs a fixed, order-independent algorithm to pick one revision as the current "winner" — every replica, computing over the same set of revisions, converges on the same choice without a vote or a coordinator. But the losing revision is not deleted; it stays in the revision tree as a live leaf. An application can discover it explicitly:

- `GET /db/docid?conflicts=true` returns the winning revision plus a `_conflicts` array naming the other live revision ids.
- `GET /db/docid?open_revs=all` returns every leaf revision, including ones flagged `_deleted`.
- A Mango query with `{"selector": {"_conflicts": {"$exists": true}}}` finds every conflicted document in the database.

Resolving one is entirely the application's job: fetch each conflicting revision by id, apply whatever merge logic makes sense for the data (keep the phone-number edit *and* the email edit, in Alice's case), then submit a single `POST /_bulk_docs` call that writes the merged document and marks the losing revisions `"_deleted": true` so they stop showing up as live conflicts. Nothing in CouchDB will do that merge for you — it guarantees only that no edit is silently lost and that every replica agrees on which single revision is "current" until you say otherwise.

### Book vs. today

- **The core mechanism is unchanged.** Verified against current Apache CouchDB (3.5.x) documentation: the `_rev` format (`N-hash`), the 409-on-stale-`_rev` single-node rejection, the "both revisions survive replication" behavior, the deterministic winner-selection algorithm, and the `?conflicts=true` / `?open_revs=all` / `_bulk_docs` conflict-resolution API described above are all still exactly as the book (2018, describing CouchDB 2.0) presents them. The book's `curl` examples show `"version": "2.0.0"` in the welcome response; a current instance reports `3.5.x`, but every request shape in the chapter still works unmodified.
- **HTTP-only access has not changed and was never going to.** CouchDB has not added a binary wire protocol or a native driver protocol in the years since; REST-over-HTTP remains the *entire* API surface, by design, not as a legacy limitation waiting to be replaced.
- **Operational tooling for conflicts has grown.** CouchDB 3.5.0 (May 2025) added a built-in "conflict finder" scanner plugin — a server-side, cluster-wide way to surface documents with unresolved conflicts, complementing the always-available per-document `?conflicts=true` / Mango-query approach the book effectively teaches you to build yourself.
- **PouchDB is worth knowing as the client-side half of this story.** The book flags it in a sidebar as an emerging tool and explicitly declines to cover it. As of 2025 it remains an actively used JavaScript database that runs in the browser or on mobile and replicates bidirectionally with CouchDB — the standard way to get offline-first web/mobile apps talking to a CouchDB backend. Critically, PouchDB inherits this exact conflict model rather than hiding it: an app built on PouchDB still needs to detect and resolve `_conflicts` after sync, just on the client instead of (or in addition to) the server.

## Trade-offs

- **Never blocking is an availability trade, not a free lunch.** Because no node waits for any other node before accepting a write, CouchDB (and PouchDB clients syncing with it) keep accepting writes through partitions and offline periods that would stall a lock-based system. The bill comes due on reconnect: the application, not the database, must know how to merge Alice's email edit and phone edit, and every place a document can be concurrently edited on more than one node needs that merge logic designed up front — "eventually consistent" here means eventually *correct*, and only if someone wrote the resolution code.
- **A deterministic winner prevents divergence, not data loss risk to the user.** Every replica agreeing on the same "current" revision means reads are consistent across the cluster without coordination — but the winner is picked by a fixed algorithm over revision hashes, not by "which edit is more important" or "which edit is newer." A trivial typo fix can beat a substantive edit for winner status; if the application never checks `_conflicts`, users silently see the "wrong" (arbitrarily-chosen) version with no error raised anywhere.
- **Whole-document overwrite makes conflict detection simple and every write heavier.** Comparing one `_rev` string is all CouchDB needs to accept or reject a write, and there's no field-level merge logic inside the database to get wrong. The cost is that changing one field means transmitting and rewriting the entire document every time — no `$set`-style partial update — and a naive client that doesn't `GET` immediately before `PUT` will reliably 409 under any real concurrency.
- **HTTP-only access buys universal interoperability and gives up wire-level efficiency.** Any language with an HTTP client can talk to CouchDB with zero driver dependency, and every request is trivially reproducible with `curl` for debugging — genuinely valuable for the "runs on a phone, a laptop, and a datacenter" deployment story the book emphasizes. The cost is HTTP's per-request overhead (headers, connection setup, JSON (de)serialization) compared to a binary protocol purpose-built for a database's access patterns, which is part of why CouchDB is not the first reach for high-throughput OLTP workloads.
- **This is a different bet than MongoDB's, not a strictly better or worse one.** MongoDB's document model (see the sibling concept) optimizes for in-place partial updates and a driver-level wire protocol, and pushes conflict handling toward "the storage engine's locking made this safe" for a single primary; it has no document-level `_rev`/conflict-surfacing mechanism at all. CouchDB optimizes for surviving partition and offline operation across many independent writers, and pushes conflict handling explicitly into application code as a first-class, unavoidable step. Pick based on whether "many disconnected writers, occasionally reconciled" or "one authoritative primary, always reachable" describes your system.

## Documentation Links

- [Luc Perkins, Eric Redmond, and Jim R. Wilson, "Seven Databases in Seven Weeks", 2nd Edition (Pragmatic Bookshelf, 2018) — Chapter 5, "CouchDB", Introduction and Day 1: "CRUD, Fauxton, and cURL Redux"](https://pragprog.com/titles/pwrdata2/seven-databases-in-seven-weeks-second-edition/) — doc
- [Apache CouchDB Documentation — Technical Overview](https://docs.couchdb.org/en/stable/intro/overview.html) — doc
- [Apache CouchDB Documentation — Replication and Conflict Model](https://docs.couchdb.org/en/stable/replication/conflicts.html) — doc
- [Apache CouchDB Documentation — HTTP Document API (revisions, `_rev`, conflict responses)](https://docs.couchdb.org/en/stable/api/document/common.html) — doc
- [Apache CouchDB Documentation — Release Notes (What's New in 3.5)](https://docs.couchdb.org/en/stable/whatsnew/3.5.html) — doc
- [PouchDB Documentation — Conflicts Guide](https://pouchdb.com/guides/conflicts.html) — doc
