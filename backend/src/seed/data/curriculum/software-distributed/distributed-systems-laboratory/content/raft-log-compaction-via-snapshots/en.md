---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Explain why an unbounded, never-truncated Raft log is a real, practical failure mode, not merely an inefficiency, for a follower that falls badly behind.
- Implement periodic snapshotting that lets a server discard log entries already reflected in a saved state snapshot.
- Implement the InstallSnapshot RPC that lets the leader bring a badly lagging follower current in one transfer instead of replaying its entire missed history.
- Verify, by deliberately starving a follower of AppendEntries long enough that ordinary log replication could not plausibly catch it up, that only a snapshot transfer restores it correctly.

## Context & Motivation

`raft-persistence-and-crash-recovery` established that a server's log must persist in full to survive a crash safely. Left unaddressed, this creates a real, growing cost: a long-running cluster's log grows without bound, and a follower that has been disconnected, or simply slow, for long enough faces replaying an enormous history just to catch up, work whose cost grows with how long the divergence has lasted rather than staying bounded. This lab, matching MIT 6.5840's Lab 3D, implements the fix: periodically compacting the log into a snapshot, and a direct snapshot transfer for a follower too far behind to catch up any other way.

## Core Theory

A snapshot is a compact representation of the service's state as of a specific, already-committed log index, everything needed to reconstruct that state, without needing any log entry at or before that index. Once a snapshot exists at index `X`, every log entry at or before `X` is redundant, its effect is already captured in the snapshot, and can be safely discarded. `InstallSnapshot`, sent when a leader's `nextIndex` for a follower falls at or before the leader's own oldest remaining log entry, transfers the snapshot directly rather than attempting to replay log entries that no longer exist on the leader's own side.

## Worked Examples

### API specification

```text
Snapshot(index int, snapshotData []byte)  — called by the SERVICE
  (the KV layer built in a-linearizable-replicated-kv-store-on-raft)
  once it knows entries up to `index` are safe to discard.

InstallSnapshotArgs  { Term, LeaderId, LastIncludedIndex,
                        LastIncludedTerm, Data }
InstallSnapshotReply { Term }
```

### Step 1 — discarding the log's prefix on a snapshot

```go
func (rf *Raft) Snapshot(index int, snapshotData []byte) {
    rf.mu.Lock()
    defer rf.mu.Unlock()

    if index <= rf.lastIncludedIndex {
        return // already compacted at least this far; nothing to do
    }
    newLog := rf.log[index-rf.lastIncludedIndex:] // keep only entries AFTER index
    rf.lastIncludedTerm = rf.log[index-rf.lastIncludedIndex].Term
    rf.lastIncludedIndex = index
    rf.log = newLog
    rf.persister.Save(rf.encodeState(), snapshotData) // atomic with the log truncation
}
```

Saving the truncated log and the snapshot data together, in one atomic call, matters directly: persisting them separately leaves a real window where a crash between the two writes produces a server whose log and snapshot disagree about what state index `lastIncludedIndex` actually reflects, a real, silent correctness bug this lab's tests are built to catch.

### Step 2 — the leader deciding when to send a snapshot instead of entries

```go
func (rf *Raft) replicateTo(peer int) {
    rf.mu.Lock()
    if rf.nextIndex[peer] <= rf.lastIncludedIndex {
        // The follower needs entries the leader itself no longer has;
        // only a snapshot transfer can bring it current.
        args := &InstallSnapshotArgs{
            Term: rf.currentTerm, LeaderId: rf.me,
            LastIncludedIndex: rf.lastIncludedIndex,
            LastIncludedTerm:  rf.lastIncludedTerm,
            Data:              rf.persister.ReadSnapshot(),
        }
        rf.mu.Unlock()
        rf.sendInstallSnapshot(peer, args)
        return
    }
    rf.mu.Unlock()
    rf.sendAppendEntries(peer) // ordinary path, from raft-log-replication-and-commitment-implemented
}
```

### Step 3 — the follower applying an installed snapshot

```go
func (rf *Raft) InstallSnapshot(args *InstallSnapshotArgs, reply *InstallSnapshotReply) {
    rf.mu.Lock()
    if args.Term < rf.currentTerm {
        reply.Term = rf.currentTerm
        rf.mu.Unlock()
        return
    }
    rf.log = []LogEntry{{Term: args.LastIncludedTerm}} // discard everything;
                                                          // the snapshot supersedes it
    rf.lastIncludedIndex, rf.lastIncludedTerm = args.LastIncludedIndex, args.LastIncludedTerm
    rf.persister.Save(rf.encodeState(), args.Data)
    rf.mu.Unlock()

    rf.applyCh <- ApplyMsg{SnapshotValid: true, Snapshot: args.Data, SnapshotIndex: args.LastIncludedIndex}
}
```

### Step 4 — a test that forces a snapshot transfer, not ordinary catch-up

```go
func TestSnapshotBasic3D(t *testing.T) {
    cfg := MakeConfig(t, 3, net)
    victim := (cfg.checkOneLeader() + 1) % 3
    cfg.disconnect(victim)

    for i := 0; i < 50; i++ {
        cfg.one(i, 2) // 50 more commits on the majority side
        // Each Snapshot() call on the majority discards more of the log,
        // so by the time `victim` reconnects, the leader no longer HAS
        // the entries `victim` is missing.
    }

    cfg.connect(victim)
    cfg.one(999, 3) // victim must catch up via InstallSnapshot, then agree
}
```

## Common Misconceptions & Pitfalls

- **"An unbounded log is only a memory-efficiency problem, not a correctness one."** For a follower disconnected long enough, once the leader has already discarded the entries that follower needs, ordinary AppendEntries genuinely cannot catch it up at all; without InstallSnapshot, that follower is stuck permanently, which is a real availability failure, not merely wasted memory.
- **"Truncating the log and saving the snapshot can happen as two separate steps."** A crash between the two leaves a server whose persisted log and persisted snapshot describe inconsistent states; Step 1's single, atomic `persister.Save` call covering both is what this lab's own persistence discipline, established in `raft-persistence-and-crash-recovery`, requires here too.
- **"Testing snapshot installation just means calling InstallSnapshot directly in a unit test."** `TestSnapshotBasic3D`'s approach, disconnecting a follower and driving enough real commits that the leader's own log genuinely no longer reaches back far enough, is what actually forces the leader's `replicateTo` logic to choose the InstallSnapshot path itself, rather than testing the RPC handler in isolation from the decision that triggers it.

## Summary

An unbounded Raft log is a real availability failure waiting to happen for any follower that falls behind long enough that the entries it needs have already been superseded elsewhere; this lab implements periodic snapshotting, discarding log entries a snapshot has already made redundant, and the InstallSnapshot RPC that transfers a snapshot directly to a follower too far behind for ordinary log replication to help, matching MIT 6.5840's Lab 3D. Saving a truncated log and its corresponding snapshot atomically, and testing this lab's logic by genuinely forcing the leader to discard entries a disconnected follower still needs, are what actually verify this lab's implementation rather than exercising only its easier, no-real-divergence path.

## Documentation Links

- [MIT 6.5840 — Lab 3: Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-raft1.html): the real lab this exercise matches, including its 3D snapshotting test suite (TestSnapshotBasic3D, TestSnapshotInstall3D).
- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): the original paper's log-compaction section specifying the InstallSnapshot RPC implemented here.
