---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Identify exactly which pieces of Raft state must be durable across a crash for the protocol's safety properties to hold, and which pieces may safely be lost.
- Implement persistence of that state using a simple, synchronous save-to-disk call triggered on every state change that requires it.
- Implement recovery on restart that rebuilds an in-memory server from persisted state rather than starting fresh.
- Verify correctness under a total power failure, every server in the cluster crashing and restarting at once, not just a single node's crash.

## Context & Motivation

`distributed-systems-i`'s own `crash-faults-vs-byzantine-faults` establishes crash faults, a server stopping and possibly restarting with its prior state intact, as the fault model Raft is designed against. That model has a hidden assumption this lab makes explicit: it assumes a restarted server's prior state actually survived the crash. A server that restarts with a blank `currentTerm` and `votedFor` can grant a second, conflicting vote in a term it already voted in before crashing, directly violating the one-vote-per-term rule `raft-leader-election-implemented` depends on. This lab, matching MIT 6.5840's Lab 3C, closes that gap.

## Core Theory

Not every piece of a Raft server's state needs to survive a crash, only the pieces the protocol's safety argument actually depends on being durable. `currentTerm` and `votedFor` must persist, because losing them lets a restarted server violate one-vote-per-term. The log must persist, because losing committed entries violates the durability a client was already told a committed write has. `commitIndex`, `nextIndex`, and `matchIndex`, by contrast, are safely rebuildable, a restarted server can safely start with a conservative `commitIndex` of 0 and recompute the rest through ordinary AppendEntries exchanges, exactly the kind of self-healing behavior `raft-log-replication-and-commitment-implemented`'s consistency check already provides.

## Worked Examples

### API specification

```text
Persister interface (provided, simulating a real disk):
  Save(raftState []byte, snapshot []byte)
  ReadRaftState() []byte

A Raft server calls persist() synchronously, before returning from any
RPC handler, whenever currentTerm, votedFor, or the log changes.
```

### Step 1 — what gets serialized, and what does not

```go
func (rf *Raft) persist() {
    w := new(bytes.Buffer)
    e := gob.NewEncoder(w)
    e.Encode(rf.currentTerm)
    e.Encode(rf.votedFor)
    e.Encode(rf.log)
    // Deliberately NOT persisted: commitIndex, nextIndex, matchIndex,
    // and which peer (if any) this server currently believes is leader.
    // All are safely rebuilt after restart; persisting them would only
    // cost disk I/O on every heartbeat for no safety benefit.
    rf.persister.Save(w.Bytes(), rf.persister.ReadSnapshot())
}
```

### Step 2 — calling persist at exactly the right points

```go
func (rf *Raft) RequestVote(args *RequestVoteArgs, reply *RequestVoteReply) {
    rf.mu.Lock()
    defer rf.mu.Unlock()
    // ... vote-granting logic from raft-leader-election-implemented ...
    if voteGranted {
        rf.votedFor = args.CandidateId
        rf.persist() // MUST persist before the reply is sent, not after
    }
}
```

The comment above states this lab's single most common source of a subtle, hard-to-trigger bug: persisting *after* replying, or on a background timer, leaves a real window where a server grants a vote, replies, crashes before the write reaches disk, and restarts having forgotten the vote it already told a candidate it granted, silently reopening the exact double-vote bug persistence exists to close.

### Step 3 — recovery on restart

```go
func Make(peers []*ClientEnd, me int, persister *Persister) *Raft {
    rf := &Raft{peers: peers, me: me, persister: persister}
    rf.readPersist(persister.ReadRaftState())
    if rf.log == nil {
        rf.log = []LogEntry{{Term: 0}} // fresh start: sentinel entry
    }
    rf.commitIndex, rf.lastApplied = 0, 0 // deliberately NOT restored;
                                            // safely rebuilt via AppendEntries
    go rf.electionTimerLoop()
    return rf
}
```

### Step 4 — a test that forces a total power failure, not just one node's crash

```go
func TestPersist13C(t *testing.T) {
    cfg := MakeConfig(t, 3, net)
    cfg.one(11, 3)

    for i := 0; i < 3; i++ {
        cfg.crash(i) // simulate power loss: state gone from memory
    }
    for i := 0; i < 3; i++ {
        cfg.restart(i) // reconstructs each server via Make(), reading disk
    }

    cfg.one(12, 3) // the cluster must still reach agreement correctly
}
```

Crashing every server simultaneously, not just one, is deliberate: it forces every server's recovery path, not just a minority that could otherwise lean on already-correct peers, and it is the closest this lab's simulator comes to a real, whole-cluster power failure.

## Common Misconceptions & Pitfalls

- **"Persisting on a background timer every few hundred milliseconds is close enough."** The window between a state change and the next timer tick is exactly where a crash can lose a vote or a log entry the server already told a peer it had recorded; `raft-leader-election-implemented`'s safety guarantee depends on persistence happening synchronously, before the RPC handler that changed the state returns.
- **"commitIndex should be persisted too, since it tracks important progress."** It is safe, and cheaper, to rebuild: a restarted server's conservative `commitIndex` of 0 is corrected quickly through ordinary AppendEntries from the current leader, via the exact mechanism `raft-log-replication-and-commitment-implemented` already implements; persisting it adds disk I/O on every commit for no safety this lab's state analysis shows is actually needed.
- **"Testing a single server's crash and restart is sufficient to trust persistence."** A single-node crash test can pass even with subtly wrong persistence logic, since the other, still-alive servers can mask the bug; `TestPersist13C`'s simultaneous crash of the whole cluster removes that safety net and is what actually verifies recovery correctness.

## Summary

This lab identifies exactly which Raft state, `currentTerm`, `votedFor`, and the log, must survive a crash for the protocol's one-vote-per-term and log-durability guarantees to hold, and implements synchronous persistence of exactly that state, triggered before any RPC reply that depended on the change is sent, matching MIT 6.5840's Lab 3C. Testing recovery under a simultaneous crash of every server in the cluster, not just one node, is what actually forces and verifies every server's recovery path, since a single-node crash test can pass even with a subtly broken persistence implementation the surviving peers happen to mask.

## Documentation Links

- [MIT 6.5840 — Lab 3: Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-raft1.html): the real lab this exercise matches, including its 3C persistence test suite (TestPersist13C, TestFigure83C).
- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): the original paper specifying exactly which state Raft requires to be persisted before responding to RPCs.
