---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Rebuild Lab 2's Put/Append/Get interface on top of the complete Raft implementation from Labs 3-6, routing every write through the replicated log before applying it.
- Implement the client-side logic that finds the current leader, including handling a stale cached leader and retrying against a different server.
- Combine Lab 2's duplicate-detection table with Raft's commit pipeline so a request is applied at most once even after a leader change mid-request.
- Verify linearizability directly, using a checker rather than eyeballing output, against a workload run under concurrent clients, crashes, and partitions simultaneously.

## Context & Motivation

This is the lab this whole discipline is named for: "o banco replicado" tasks.md's own one-line description of this discipline opens with. Every earlier lab was a prerequisite piece: Lab 1's simulator, Lab 2's duplicate-detection semantics, Labs 3 through 6's complete Raft implementation. This lab assembles them into a real, replicated key-value store, matching MIT 6.5840's Lab 4 in full, and holds itself to that lab's actual correctness bar: linearizability, `distributed-systems-i`'s own rigorously defined guarantee, verified under concurrency and failure simultaneously, not merely correctness on the easy, sequential, no-failure case.

## Core Theory

`distributed-systems-i`'s **The Replicated State Machine Approach** already establishes the architecture this lab implements directly: a deterministic state machine (here, the KV store's `data` map), fed a single, agreed-upon sequence of operations via consensus, produces identical state on every replica. This lab's entire job is wiring the KV service from `single-node-kv-server-with-at-most-once-semantics` to consume that agreed-upon sequence from Raft's commit pipeline, rather than applying operations directly to its own local state the instant a request arrives.

## Worked Examples

### API specification

Identical client-facing interface to Lab 2 (`Put`, `Append`, `Get`), but every server is now one Raft peer, and a client's request must reach whichever server currently holds the Raft leadership; a request sent to a follower is rejected, not silently misrouted.

### Step 1 — submitting a client operation through Raft, not applying it directly

```go
func (kv *KVServer) Put(args *PutArgs, reply *PutReply) {
    op := Op{Type: "Put", Key: args.Key, Value: args.Value,
              ClientId: args.ClientId, RequestId: args.RequestId}
    index, _, isLeader := kv.rf.Start(op) // submit to Raft; does NOT apply yet
    if !isLeader {
        reply.Err = ErrWrongLeader
        return
    }

    ch := kv.waitChannelFor(index)
    select {
    case appliedOp := <-ch:
        if appliedOp.ClientId != args.ClientId || appliedOp.RequestId != args.RequestId {
            // A DIFFERENT operation ended up committed at this index —
            // this server's leadership was lost and regained, or a
            // stale RPC reply raced a newer one. Report failure rather
            // than falsely confirming a write that didn't actually commit.
            reply.Err = ErrWrongLeader
            return
        }
        reply.Err = OK
    case <-time.After(kv.opTimeout):
        reply.Err = ErrTimeout
    }
}
```

The check inside the `select` is the single most important line in this lab: `Start` returning an index is only a promise the operation *might* commit there, not a guarantee it will, since a leader change before commitment can let a different operation end up at that same index instead. Skipping this check is a real, common source of a client silently believing a write succeeded when a completely different write actually committed at that log position.

### Step 2 — applying committed operations, with Lab 2's duplicate detection reused unchanged

```go
func (kv *KVServer) applyLoop() {
    for msg := range kv.applyCh { // fed by Raft's commit pipeline
        op := msg.Command.(Op)
        kv.mu.Lock()
        if last, ok := kv.lastOp[op.ClientId]; !ok || last.RequestId != op.RequestId {
            switch op.Type {
            case "Put":
                kv.data[op.Key] = op.Value
            case "Append":
                kv.data[op.Key] += op.Value
            }
            kv.lastOp[op.ClientId] = opResult{RequestId: op.RequestId, Value: kv.data[op.Key]}
        }
        kv.mu.Unlock()
        kv.notifyWaitChannel(msg.CommandIndex, op)
    }
}
```

This is exactly `single-node-kv-server-with-at-most-once-semantics`'s duplicate-detection table, unmodified, now consuming from Raft's `applyCh` instead of an RPC handler directly, which is precisely the point: the earlier lab's correctness work is reused, not redone, here.

### Step 3 — the client finding, and re-finding, the current leader

```go
func (c *Client) Put(key, value string) {
    args := &PutArgs{Key: key, Value: value, ClientId: c.id, RequestId: c.nextReqId()}
    for {
        var reply PutReply
        ok := c.Call(c.servers[c.leaderGuess], "KVServer.Put", args, &reply)
        if ok && reply.Err == OK {
            return
        }
        c.leaderGuess = (c.leaderGuess + 1) % len(c.servers) // wrong guess; try the next server
    }
}
```

### Step 4 — verifying linearizability, not just "the final value looks right"

```go
func TestPersistPartitionUnreliableLinearizable4B(t *testing.T) {
    cfg := MakeConfig(t, 5, net)
    cfg.net.SetUnreliable(0.1)

    var ops []porcupine.Operation // recorded, per-client, with real timestamps
    for round := 0; round < 5; round++ {
        cfg.partition(randomMajorityMinoritySplit())
        runConcurrentClients(cfg, &ops) // records call/return times of every op
        cfg.healPartition()
        cfg.crashOneRandomServer()
        cfg.restartIt()
    }

    if !porcupine.CheckOperations(kvModel, ops) {
        t.Fatal("history is not linearizable")
    }
}
```

`porcupine.CheckOperations` (or an equivalent linearizability checker) is doing real, necessary work here that a simpler "read the final key values and see if they look plausible" check cannot: linearizability is a claim about the *entire ordering* of overlapping operations across all clients, not just the final state, and a bug that produces a final state that happens to look correct while still violating linearizability at some intermediate point is exactly the kind of bug this lab's real correctness bar is built to catch.

## Common Misconceptions & Pitfalls

- **"Once `rf.Start()` returns an index, the operation is committed."** It is only submitted; a leader change before that log position actually commits can let a completely different operation end up there instead, which is exactly what Step 1's post-wait identity check exists to detect.
- **"Applying a command directly on the leader as soon as `Start` is called, and skipping the wait for `applyCh`, is fine since this server is the leader."** This applies an operation that might never actually commit, for instance if the leader is immediately partitioned away before replicating it to a majority, producing a state divergence from every other replica.
- **"Checking that the final key-value pairs match expectations is enough to confirm correctness."** Linearizability is a claim about the full ordering of concurrent operations, not just the eventual state; a real linearizability checker run against a recorded operation history, as in Step 4, catches ordering violations a final-state-only check would miss entirely.

## Summary

This lab assembles every earlier lab in this discipline into the replicated key-value store this discipline is named for: Lab 2's Put/Append/Get interface and duplicate-detection logic, unmodified, now fed by the complete Raft implementation from Labs 3 through 6, with client requests routed to the current leader and confirmed only once Raft's own commit pipeline, not merely `Start`'s return value, reports the operation applied. Matching MIT 6.5840's Lab 4 in full means holding this implementation to its real correctness bar, linearizability verified with a real checker against concurrent clients, crashes, and partitions run simultaneously, rather than a final-state check that a genuinely broken implementation could still happen to pass.

## Documentation Links

- [MIT 6.5840 — Lab 4: KV Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-kvraft1.html): the real lab this exercise matches, including its linearizability test suite (TestOnePartition4B, TestPersistPartitionUnreliableLinearizable4B).
- [Herlihy & Wing — Linearizability: A Correctness Condition for Concurrent Objects (1990)](https://cs.brown.edu/people/mph/HerlihyW90/p463-herlihy.pdf): the original paper defining the correctness property this lab's own tests verify directly against a recorded operation history.
