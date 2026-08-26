---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn the two ad hoc task-queue patterns *Redis in Action* builds directly from core data types — no dedicated queue product, no Streams, just a `LIST` and a `ZSET` used deliberately — and understand exactly what each one buys and what it doesn't. The book frames the whole idea plainly: "When handling requests from web clients, sometimes operations take more time to execute than we want to spend immediately. We can defer those operations by putting information about our task to be performed inside a queue, which we process later. This method of deferring work to some task processor is called a task queue." The first pattern is a first-in, first-out queue built from `RPUSH`/`BLPOP` on a `LIST`. The second extends it with delay and scheduling, using a `ZSET` scored by execution timestamp because "Normally when we talk about times, we usually start talking about ZSETs." **This is the older, simpler layer of Redis queueing** — the sibling `redis-streams` concept covers the newer, more robust evolution of the same idea: Streams' consumer groups add per-message acknowledgment and automatic crash recovery, closing a gap this List-based approach never had a native answer for. Understanding that gap — and exactly where it bites — is as much the point of this concept as the mechanics themselves.

## Use Cases

- **Deferring a slow, failure-prone operation out of the request path** — the book's running example is exactly this: outgoing email "is one of those internet services that can have very high latencies and can fail," so a marketplace sale pushes an `{'seller_id', 'item_id', 'price', 'buyer_id', 'time'}` JSON blob onto `queue:email` instead of sending the email inline, and a separate worker process drains it.
- **A single generic worker dispatching many different task types by name** — rather than one queue per operation, the book's `worker_watch_queue()` unpacks each item as `['FUNCTION_NAME', [ARG1, ARG2, ...]]` and calls whichever registered callback matches, so one worker pool can run email sends, notifications, and any other job that fits the same envelope.
- **Coarse-grained task priorities without a priority-queue data structure** — passing multiple list names to `BLPOP`/`BRPOP` (`high`, `medium`, `low`) and letting Redis's own semantics — "the first LIST to have any items in it will have its first item popped" — do the prioritization, no extra bookkeeping required.
- **Scheduling work for a specific future time** — the book's own feature example is delayed selling: "Rather than putting an item up for sale now, players can tell the game to put an item up for sale in the future," which needs a queue that understands *when*, not just *whether*, an item should run.
- **A lightweight alternative to standing up a dedicated broker** — the book explicitly frames this as the ad hoc option next to "many different pieces of software designed specifically for task queues (ActiveMQ, RabbitMQ, Gearman, Amazon SQS, and others)," useful when a project already depends on Redis and doesn't want a second piece of infrastructure just to move jobs a few hops.

## Deep Dive

### First-in, first-out queues: RPUSH in, BLPOP out

The FIFO queue is a plain `LIST`, pushed on one end and popped from the other: "we'll push emails to send onto the right end of the queue with RPUSH, and pop them off the left end of the queue with LPOP. (We do this because it makes sense visually for readers of left-to-right languages.)" Because a worker process's entire job is to sit on this queue, the book reaches for the blocking pop rather than polling: "we'll use the blocking version of our list pop, BLPOP, with a timeout of 30 seconds." A 30-second timeout on `BLPOP` isn't arbitrary — it's a periodic wake-up so the worker's `while not QUIT` loop can still notice a shutdown signal even when the queue is empty, rather than blocking forever.

```python
def send_sold_email_via_queue(conn, seller, item, price, buyer):
    data = {
        'seller_id': seller, 'item_id': item, 'price': price,
        'buyer_id': buyer, 'time': time.time()
    }
    conn.rpush('queue:email', json.dumps(data))          # producer

def process_sold_email_queue(conn):
    while not QUIT:
        packed = conn.blpop(['queue:email'], 30)          # consumer
        if not packed:
            continue
        to_send = json.loads(packed[1])
        try:
            fetch_data_and_send_sold_email(to_send)
        except EmailSendError as err:
            log_error("Failed to send sold email", err, to_send)
        else:
            log_success("Sent sold email", to_send)
```

**Because Redis only gives a single caller a popped item**, the book notes, "we can be sure that none of the emails are duplicated and sent twice" — that atomicity is real and free. But a single-purpose queue like this one only scales to one job type per list. The generalization is `worker_watch_queue()`: instead of hardcoding "send an email," each queued item names the function to call and its arguments, and the worker looks the name up in a callback table:

```python
def worker_watch_queue(conn, queue, callbacks):
    while not QUIT:
        packed = conn.blpop([queue], 30)
        if not packed:
            continue
        name, args = json.loads(packed[1])
        if name not in callbacks:
            log_error("Unknown callback %s" % name)
            continue
        callbacks[name](*args)
```

**Priorities** fall out of a feature `BLPOP`/`BRPOP` already have — accepting multiple list names in one call and popping from whichever has items first: "Remember the BLPOP/BRPOP commands — we can provide multiple LISTs in which to pop an item from; the first LIST to have any items in it will have its first item popped." Turning three separately-pushed queues (`high`, `medium`, `low`) into a priority scheme is a one-line change to `worker_watch_queue()` — pass a list of queue names instead of one, and `BLPOP` handles the ordering:

```python
def worker_watch_queues(conn, queues, callbacks):     # queues, plural, in priority order
    while not QUIT:
        packed = conn.blpop(queues, 30)
        if not packed:
            continue
        name, args = json.loads(packed[1])
        if name not in callbacks:
            log_error("Unknown callback %s" % name)
            continue
        callbacks[name](*args)
```

The book is honest that this isn't a general priority queue — it's strict ordering between a small, fixed number of lanes, not per-item priority within a lane — and flags that "there are situations where multiple queues are used as a way of separating different queue items... without any desire to be 'fair,'" where an application might want to reorder the queue list occasionally so one fast-growing queue doesn't starve the others. It also points outward rather than claiming this is novel: "If you're using Ruby, you can use an open source package called Resque that was put out by the programmers at GitHub. It uses Redis for Ruby-based queues using lists, which is similar to what we've talked about here."

### Delayed tasks: a ZSET scored by execution time

A `LIST` has no notion of "not yet" — everything in it is eligible to pop immediately. Scheduling requires a second structure, and the book walks through three candidate designs before picking one:

> "We could include an execution time as part of queue items, and if a worker process sees an item with an execution time later than now, it can wait for a brief period and then re-enqueue the item." — rejected, because it wastes the worker's time.
>
> "The worker process could have a local waiting list for any items it has seen that need to be executed in the future..." — rejected, because "if the worker process crashes for an unrelated reason, we lose any pending work items it knew about."
>
> "What if, for any item we wanted to execute in the future, we added it to a ZSET instead of a LIST, with its score being the time when we want it to execute? We then have a process that checks for items that should be executed now, and if there are any, the process removes it from the ZSET, adding it to the proper LIST queue." — the one the book builds, "because it's simple, straightforward, and we can use a lock from section 6.2 to ensure that the move is safe."

The second rejected option is the important one to notice: it's the same "state lives only in a crashable process's memory" failure mode this whole chapter keeps steering away from (see the sibling `redis-distributed-locking-and-semaphores` concept's crash-window discussion) — the fix, again, is to put the state in Redis itself.

`execute_later()` is the producer side. A delayed item is a JSON-encoded four-tuple — unique identifier, destination queue, callback name, and its arguments — and it lands in either the `LIST` (immediate) or the `delayed:` `ZSET` (future), depending on whether a delay was requested:

```python
def execute_later(conn, queue, name, args, delay=0):
    identifier = str(uuid.uuid4())
    item = json.dumps([identifier, queue, name, args])
    if delay > 0:
        conn.zadd('delayed:', item, time.time() + delay)
    else:
        conn.rpush('queue:' + queue, item)
    return identifier
```

The consumer side is where the ZSET's limitation shows up directly: "Unfortunately, there isn't a convenient method in Redis to block on ZSETs until a score is lower than the current Unix timestamp, so we need to manually poll." `poll_queue()` fetches the single lowest-scored item, checks whether its time has come, and — if so — acquires a fine-grained lock on the item's identifier before moving it from the ZSET to its destination `LIST`, so two competing pollers can't both move (and duplicate) the same item:

```python
def poll_queue(conn):
    while not QUIT:
        item = conn.zrange('delayed:', 0, 0, withscores=True)
        if not item or item[0][1] > time.time():
            time.sleep(.01)                     # nothing due yet — poll again
            continue

        item = item[0][0]
        identifier, queue, function, args = json.loads(item)

        locked = acquire_lock(conn, identifier)
        if not locked:
            continue                             # someone else is already moving it

        if conn.zrem('delayed:', item):
            conn.rpush('queue:' + queue, item)   # hand off to the FIFO queue
        release_lock(conn, identifier, locked)
```

Because moving items into ordinary queues is all this poller does, "we only need to have one or two of these running at any time (instead of as many as we have workers), so our polling overhead is kept low." The `time.sleep(.01)` is a real, tunable cost — a tight poll loop trading CPU and Redis round trips for scheduling precision — and the book flags the obvious refinement without implementing it: "we could add an adaptive method that increases the sleep time when it hasn't seen any items in a while, or we could use the time when the next item was scheduled to help determine how long to sleep, capping it at 100 milliseconds."

**Respecting priorities for delayed items** reuses the same idea as the FIFO queue's priority lanes — extra `*-delayed` lists (`high-delayed`, `medium-delayed`, `low-delayed`) placed *before* their non-delayed equivalents in the list passed to `worker_watch_queues()`, so a task whose time has just come jumps ahead of the backlog in its priority tier. The book is careful to explain why this uses `RPUSH` into a dedicated delayed lane rather than the seemingly simpler `LPUSH` straight onto the front of the existing queue: "Suppose that all of our workers are working on tasks for the medium queue... Suppose also that we have three delayed tasks that are found and LPUSHed onto the front of the medium queue. The first is pushed, then the second, and then the third. But on the medium queue, the third task to be pushed will be executed first, which violates our expectations that things that we want to execute earlier should be executed earlier." `LPUSH` reverses ordering among items pushed in sequence; a separate FIFO lane doesn't.

### Book vs today

The current [Redis job-queue documentation](https://redis.io/docs/latest/develop/use-cases/job-queue/) confirms the book's core architectural instincts are still exactly right, thirteen years later — Lists for FIFO/LIFO ordering, sorted sets for delayed and priority execution: "Run FIFO, LIFO, priority, and delayed-execution queues on core Redis data structures... Sorted sets (ZADD, ZRANGEBYSCORE) for delayed execution and priority queues, scored by run-at timestamp or priority." The `ZSET`-scored-by-execution-time pattern in this concept is, structurally, the same thing Redis's own docs recommend today.

What's changed is the reliability bar. The same documentation is explicit that a workable job queue "needs at-least-once delivery, an atomic handoff from queue to worker, and a way to reclaim jobs from workers that crashed mid-processing" — and it names the plain `BLPOP` consumer this concept builds as exactly the gap: "If a worker process crashes after RPOP has removed the message but before it has finished processing, that message is lost." The fix Redis documents today is the same one the sibling `redis-core-data-types-strings-lists-hashes` concept covers — pop into a *processing* list with `BRPOPLPUSH` (or its modern, non-deprecated replacement, `BLMOVE`) instead of a bare `BLPOP`, so a crashed worker's claimed-but-unfinished job is still sitting somewhere findable, with a reclaimer scanning for timed-out entries. Notably, *this specific book section* (6.4, task queues) doesn't reach for that idiom at all — it uses plain `BLPOP`/`RPUSH`, no processing list — so the crash-safety gap here is actually a step behind the reliable-queue pattern the book itself builds two sections earlier in the same chapter for locking.

**Where `redis-streams` fits in.** Even the processing-list fix has a manual edge: nothing automatically removes a job from the processing list on success, and nothing tracks *how many times* a job has been reclaimed. That's precisely the problem Streams solve structurally rather than by convention — a consumer group's Pending Entries List tracks per-consumer ownership natively, `XACK` retires a job the moment it's genuinely done, and `XCLAIM`/`XAUTOCLAIM` reassign anything left idle past a threshold, all without the application having to maintain a second list by hand. Current Redis docs list this directly among today's recommended building blocks: "Streams with consumer groups for fan-out across multiple worker pools with independent progress tracking." For a queue where losing a job silently is unacceptable, or where more than one independent worker pool needs to see the same job stream, Streams are the more robust, guarantee-bearing evolution of exactly the pattern in this concept — see `redis-streams` for the full mechanism.

**Production systems today mostly don't hand-roll either version.** The same Redis documentation now lists an entire ecosystem of maintained libraries built on top of these primitives — Sidekiq and Resque for Ruby, Celery/RQ/Dramatiq for Python, Bull/BullMQ for Node.js, Asynq for Go, and for the JVM specifically, Redisson and Spring Batch's Redis job repository — closing with the same conclusion the book itself already reached about priority queues by pointing to Resque: "Use established libraries — Sidekiq, Celery, Bull/BullMQ, RQ — that implement reliable queue patterns on Redis out of the box." The book's code is still the right way to understand what a Redis task queue has to get right; reproducing it from scratch in a real system mostly means re-solving crash recovery a maintained library, or Streams, has already solved.

## Trade-offs

- **The plain `BLPOP` FIFO queue is genuinely simple and genuinely not crash-safe.** An item popped by `BLPOP` is gone from Redis the instant it's returned — if the worker dies before finishing whatever it was going to do with it, that job is lost with no trace it ever existed. The book's own chapter builds the fix for this exact failure mode (a processing list, or ultimately a lock) for a different problem two sections earlier; section 6.4's queues don't apply it. Reach for the `BRPOPLPUSH`/`BLMOVE`-into-a-processing-list idiom, or Streams, the moment a lost job is a real incident and not an acceptable rare loss.
- **List-based priority lanes are strict, not fair.** Multiple lists passed to `BLPOP` guarantee a high-priority item is always taken before a medium one, but they don't guarantee the low-priority lane ever gets serviced under sustained high-priority load — the book names this directly and its only mitigation is manually reordering the queue list occasionally. A true weighted-fair scheduler is out of scope for this pattern entirely.
- **The ZSET delayed queue trades a blocking primitive for a polling loop.** `LIST`s get `BLPOP` for free; `ZSET`s have no equivalent "block until the lowest score is ≤ now," so the poller spends CPU and Redis round trips checking `ZRANGE ... WITHSCORES` on a fixed interval (`time.sleep(.01)` in the book) whether or not anything is due. That's a real, tunable cost — tighter polling means lower scheduling latency and higher load; looser polling is the opposite — and it's why the book recommends running only one or two pollers rather than one per worker.
- **`LPUSH`-to-the-front looks like the obvious way to prioritize a delayed task and silently breaks ordering.** The book's own worked example (three delayed tasks LPUSHed in sequence execute in reverse order) is worth internalizing as a general lesson about `LIST` semantics, not just a fact about this pattern: pushing several items to the same end in sequence always reverses their relative order on that end.
- **This whole pattern is a comprehension exercise as much as a shipping recommendation today.** It's the right way to understand what a Redis queue has to get right — atomic handoff, ordering, delay, priority — but per the "Book vs today" section above, both current Redis documentation and the book's own aside about Resque point the same direction: production systems reach for Streams' consumer groups when the crash-recovery gap matters, or for a maintained library (Sidekiq, BullMQ, Celery, or Redisson on the JVM) that has already encoded the reliable version of this pattern, rather than re-deriving it from `LPUSH`/`BLPOP`/`ZADD` from scratch.

## Documentation Links

- [Josiah Carlson, "Redis in Action" (Manning, 2013) — Chapter 6, "Application components in Redis," section 6.4 "Task queues" (6.4.1 First-in, first-out queues; 6.4.2 Delayed tasks), p. 134-140](https://www.manning.com/books/redis-in-action) — doc
- [Redis Documentation — Redis job queue (use case guide)](https://redis.io/docs/latest/develop/use-cases/job-queue/) — doc
- [Redis Documentation — LPUSH](https://redis.io/docs/latest/commands/lpush/) — doc
- [Redis Documentation — BLPOP](https://redis.io/docs/latest/commands/blpop/) — doc
- [Redis Documentation — BLMOVE (non-deprecated replacement for BRPOPLPUSH)](https://redis.io/docs/latest/commands/blmove/) — doc
- [Redis Documentation — ZADD](https://redis.io/docs/latest/commands/zadd/) — doc
- [Redis Documentation — ZRANGEBYSCORE](https://redis.io/docs/latest/commands/zrangebyscore/) — doc
- [Redis Documentation — Redis Streams (consumer groups, at-least-once delivery)](https://redis.io/docs/latest/develop/data-types/streams/) — doc
