---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a single-node Put/Append/Get key-value server over Lab 1's unreliable transport.
- Implement client-side retry logic that resends a request when `Call` returns false, and explain why this alone reintroduces a duplicate-execution bug.
- Implement server-side duplicate detection using a client ID and monotonically increasing request ID, and verify it correctly suppresses a re-executed Put while still allowing a legitimately new one.
- Design a test that forces the exact race this lab exists to close: a reply lost after a Put has already been applied, followed by a client retry.

## Context & Motivation

`distributed-systems-i`'s **At-Least-Once, At-Most-Once, and Exactly-Once Semantics** already drew the theoretical distinction this lab makes concrete: an unreliable network naturally gives you at-least-once delivery (a client that doesn't get a reply just retries, so a request might arrive and be processed more than once), and turning that into the at-most-once execution guarantee application code actually wants requires deliberate, explicit bookkeeping, not something a network protocol provides for free. This lab builds a real key-value server specifically to force that theoretical gap into a concrete, reproducible bug, then closes it.

This lab also matters as a prerequisite for the discipline's later capstone: `a-linearizable-replicated-kv-store-on-raft` reuses this exact Put/Append/Get interface and its duplicate-detection logic, replacing only the single-node storage underneath with a full Raft-replicated log.

## Core Theory

Nothing about *why* at-most-once semantics require explicit state is re-derived here, that argument already exists in `at-least-once-at-most-once-and-exactly-once-semantics`; this lab is the discipline of turning it into working code. Two pieces of state make it concrete: a request identifier attached to every client call, unique per client and monotonically increasing, and a server-side table remembering, per client, the highest request ID already applied and what result it produced.

## Worked Examples

### API specification

```text
Client.Put(key, value string)
Client.Append(key, value string)   // appends value to the existing value
Client.Get(key string) string      // returns "" if key doesn't exist

Every RPC sent by the client includes a fixed ClientId (a random int64
generated once, at client creation) and a RequestId (incremented before
each new call, including retries of the SAME logical request, which
reuse the SAME RequestId as the original attempt).
```

### Step 1 — the naive version, and its bug

```go
func (kv *KVServer) Put(args *PutArgs, reply *PutReply) {
    kv.mu.Lock()
    defer kv.mu.Unlock()
    kv.data[args.Key] = args.Value
}
```

```go
func (c *Client) Put(key, value string) {
    args := &PutArgs{Key: key, Value: value, ClientId: c.id, RequestId: c.nextReqId()}
    for {
        var reply PutReply
        if c.Call("KVServer.Put", args, &reply) {
            return
        }
        // Call returned false: retry with the SAME args, including the
        // SAME RequestId, since this is a retry of the same logical
        // request, not a new one.
    }
}
```

Run against Lab 1's simulator with `SetUnreliable(0.3)`, this pair of functions fails a very specific, real test: force a scenario where the server actually applies a `Put`, but the reply is dropped on the way back (a real, common outcome once `SetUnreliable` is nonzero). The client sees `Call` return `false`, retries with identical arguments, and the naive server above applies the same `Put` a second time. For a plain `Put`, this happens to be harmless, since the second identical write is a no-op in effect, but the same naive pattern applied to `Append` corrupts the value, appending the same text twice.

### Step 2 — server-side duplicate detection

```go
type opResult struct {
    RequestId int64
    Value     string // for Get/Append, the value to return on a retry
}

type KVServer struct {
    mu      sync.Mutex
    data    map[string]string
    lastOp  map[int64]opResult // ClientId -> most recent applied op
}

func (kv *KVServer) Append(args *AppendArgs, reply *AppendReply) {
    kv.mu.Lock()
    defer kv.mu.Unlock()

    if last, ok := kv.lastOp[args.ClientId]; ok && last.RequestId == args.RequestId {
        // This exact request was already applied; the reply was what
        // was lost, not the request's effect. Return the SAME result
        // without re-applying the append.
        reply.Value = last.Value
        return
    }

    kv.data[args.Key] += args.Value
    kv.lastOp[args.ClientId] = opResult{RequestId: args.RequestId, Value: kv.data[args.Key]}
    reply.Value = kv.data[args.Key]
}
```

The check against `lastOp` is what actually closes the gap: a retried request with a `RequestId` already recorded is recognized as "already applied," and the server replays the previously computed result instead of re-executing the operation, which is what correctly turns the network's at-least-once delivery into the at-most-once execution the client actually needs.

### Step 3 — a test that forces the race, not just hopes for it

```go
func TestDuplicateAppendSuppressed(t *testing.T) {
    net := MakeNetwork()
    net.SetUnreliable(0.0) // deterministic for this specific check
    kv := StartKVServer(net)
    c := MakeClient(net)

    c.Append("x", "a")
    // Manually simulate a lost reply: call the server directly with the
    // SAME RequestId a second time, exactly what the client's own retry
    // loop would produce after a dropped reply.
    kv.Append(&AppendArgs{Key: "x", Value: "a", ClientId: c.id, RequestId: c.lastReqId}, &AppendReply{})

    if got := c.Get("x"); got != "a" {
        t.Fatalf("expected \"a\" (duplicate suppressed), got %q", got)
    }
}
```

## Common Misconceptions & Pitfalls

- **"Retrying an RPC on failure is itself the bug."** Retrying is the correct, necessary client behavior given an unreliable network; the bug is a server that has no way to distinguish a genuinely new request from a retry of one it already applied. The fix lives on the server side, not by avoiding retries on the client side.
- **"A Put is idempotent by nature, so duplicate detection doesn't matter for it."** A plain, unconditional `Put` happens to tolerate re-application harmlessly, but `Append` does not, and a server built to only handle the easy, idempotent case silently corrupts state the moment a non-idempotent operation is added.
- **"Testing this with `SetUnreliable` and hoping the race occurs eventually is sufficient."** A probabilistic test can pass by luck without the underlying bug being fixed; Step 3's direct, manual replay of a request with a reused `RequestId` forces the exact scenario deterministically, which is what actually verifies the fix rather than merely failing to observe the bug on one run.

## Summary

This lab turns `at-least-once-at-most-once-and-exactly-once-semantics`'s theoretical distinction into a concrete, reproducible bug and its fix: a client that retries on an unreliable network naturally produces at-least-once delivery, which silently corrupts a non-idempotent operation like `Append` unless the server explicitly tracks, per client, which request IDs have already been applied and what result they produced. This exact Put/Append/Get interface and its duplicate-detection logic is reused unchanged in `a-linearizable-replicated-kv-store-on-raft`, where the single-node storage underneath is replaced with a full Raft-replicated log.

## Documentation Links

- [MIT 6.5840 — Lab 2: Key/Value Server 1](https://pdos.csail.mit.edu/6.824/labs/lab-kvsrv1.html): the real lab this exercise is modeled on, including its own duplicate-detection correctness requirement.
- [Birrell & Nelson — Implementing Remote Procedure Calls (1984)](http://www.bitsavers.org/pdf/xerox/parc/techReports/CSL-83-7_Implementing_Remote_Procedure_Calls.pdf): the original source for the at-least-once-versus-at-most-once distinction this lab makes concrete.
