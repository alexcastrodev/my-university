---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement AppendEntries RPCs carrying real log entries, and the leader's per-follower `nextIndex` bookkeeping that tracks how far each follower has caught up.
- Implement the commit rule: an entry is committed once it is stored on a majority of servers, and only entries from the leader's current term directly trigger advancing the commit index.
- Implement the log-consistency check and the backtracking repair it forces when a follower's log has diverged from the leader's.
- Verify, by deliberately killing and restarting followers mid-stream, that a genuinely diverged log is repaired correctly, not just the easy no-failure path.

## Context & Motivation

`distributed-systems-i`'s **Raft: Log Replication and Commitment** already proves why the majority rule is what makes a committed entry durable across leader changes, and why an entry is only safe to commit once an entry from the leader's own current term has itself been committed via the majority rule (not any earlier-term entry alone). This lab turns that proof into the second quarter of a working Raft implementation, matching MIT 6.5840's Lab 3B, specifically engineered to force the log-inconsistency-repair path a no-failure test would never exercise.

## Core Theory

This lab extends `raft-leader-election-implemented`'s heartbeats, previously empty AppendEntries calls, into real log-carrying RPCs. The leader maintains, per follower, a `nextIndex`, its best guess at where that follower's log starts to diverge from its own, and a consistency check on every AppendEntries call either confirms agreement up to that point or forces the leader to back the guess up and retry, exactly the repair mechanism `raft-log-replication-and-commitment` already establishes is necessary once a follower has missed entries a now-superseded leader sent.

## Worked Examples

### API specification

```text
AppendEntriesArgs  { Term, LeaderId, PrevLogIndex, PrevLogTerm,
                      Entries[], LeaderCommit }
AppendEntriesReply { Term, Success, ConflictIndex, ConflictTerm }
```

### Step 1 — the consistency check on the receiving side

```go
func (rf *Raft) AppendEntries(args *AppendEntriesArgs, reply *AppendEntriesReply) {
    rf.mu.Lock()
    defer rf.mu.Unlock()

    if args.Term < rf.currentTerm {
        reply.Success = false
        return
    }
    rf.resetElectionTimer() // a valid leader is alive; stay follower

    // The core consistency check: does OUR log agree with the leader's
    // claim about what immediately precedes these new entries?
    if args.PrevLogIndex >= len(rf.log) || rf.log[args.PrevLogIndex].Term != args.PrevLogTerm {
        reply.Success = false
        reply.ConflictIndex, reply.ConflictTerm = rf.findConflictPoint(args.PrevLogIndex)
        return
    }

    rf.log = append(rf.log[:args.PrevLogIndex+1], args.Entries...)
    if args.LeaderCommit > rf.commitIndex {
        rf.commitIndex = min(args.LeaderCommit, len(rf.log)-1)
    }
    reply.Success = true
}
```

### Step 2 — the leader's per-follower bookkeeping and backtracking

```go
func (rf *Raft) replicateTo(peer int) {
    rf.mu.Lock()
    nextIdx := rf.nextIndex[peer]
    args := &AppendEntriesArgs{
        Term: rf.currentTerm, LeaderId: rf.me,
        PrevLogIndex: nextIdx - 1, PrevLogTerm: rf.log[nextIdx-1].Term,
        Entries: rf.log[nextIdx:], LeaderCommit: rf.commitIndex,
    }
    rf.mu.Unlock()

    var reply AppendEntriesReply
    if !rf.sendAppendEntries(peer, args, &reply) {
        return // dropped by Lab 1's simulator; a later heartbeat retries
    }

    rf.mu.Lock()
    defer rf.mu.Unlock()
    if reply.Success {
        rf.nextIndex[peer] = nextIdx + len(args.Entries)
        rf.matchIndex[peer] = rf.nextIndex[peer] - 1
        rf.tryAdvanceCommitIndex() // majority rule, see Step 3
        return
    }
    // Consistency check failed: back nextIndex up using the follower's
    // own conflict info rather than retreating one entry at a time,
    // which is what makes recovery from a long divergence fast.
    rf.nextIndex[peer] = rf.backtrackUsingConflict(reply.ConflictIndex, reply.ConflictTerm)
}
```

### Step 3 — the commit rule, including the current-term restriction

```go
func (rf *Raft) tryAdvanceCommitIndex() {
    for n := len(rf.log) - 1; n > rf.commitIndex; n-- {
        if rf.log[n].Term != rf.currentTerm {
            continue // the critical restriction: only the CURRENT
                      // term's entries directly advance commitIndex
        }
        count := 1 // the leader itself
        for peer := range rf.peers {
            if rf.matchIndex[peer] >= n {
                count++
            }
        }
        if count > len(rf.peers)/2 {
            rf.commitIndex = n
            return
        }
    }
}
```

### Step 4 — a test that forces real log divergence, not just the happy path

```go
func TestFailAgree3B(t *testing.T) {
    cfg := MakeConfig(t, 5, net)
    cfg.one(101, 5) // committed on all 5 servers

    leader := cfg.checkOneLeader()
    cfg.disconnect((leader + 1) % 5)
    cfg.disconnect((leader + 2) % 5) // 2 of 5 followers now cut off

    cfg.one(102, 3) // still a majority (3 of 5); must still commit
    cfg.one(103, 3)

    cfg.connect((leader + 1) % 5)
    cfg.connect((leader + 2) % 5)
    cfg.one(104, 5) // the reconnected followers must catch up correctly
}
```

## Common Misconceptions & Pitfalls

- **"Committing an entry as soon as a majority has it, regardless of term, is simpler and equally safe."** Raft's own safety proof depends specifically on the current-term restriction in Step 3; committing an earlier-term entry purely by majority count, without a current-term entry also having reached a majority, is a real, documented way to violate the leader-completeness property, even though it looks correct on tests without leader changes.
- **"Backing `nextIndex` up one entry per failed AppendEntries is fine."** It is correct but, for a follower that has diverged by many entries, forces one round trip per entry to repair, which real cluster tests, including the one in Step 4 at larger scale, can time out on; using the follower's `ConflictIndex`/`ConflictTerm` to jump back further in one step is what MIT 6.5840's own Lab 3B performance expectations assume.
- **"Testing only the case where no server is ever disconnected is enough to trust the implementation."** The log-consistency check and backtracking logic in Steps 1 and 2 are never exercised at all without a real divergence forcing them; `TestFailAgree3B`'s deliberate disconnect-then-reconnect is what actually verifies this lab's hardest logic, not the simpler agreement tests that pass even with a subtly broken repair path.

## Summary

This lab turns `raft-log-replication-and-commitment`'s majority-rule proof into working AppendEntries RPCs, per-follower `nextIndex` tracking, and a consistency check with backtracking repair, matching MIT 6.5840's Lab 3B, with the commit rule's current-term restriction implemented exactly as the safety proof requires rather than the simpler, unsafe majority-count-regardless-of-term shortcut a test suite without real leader changes might not catch. Deliberately disconnecting and reconnecting followers mid-stream, as in `TestFailAgree3B`, is what actually forces and verifies the log-repair path this lab's implementation exists to get right.

## Documentation Links

- [MIT 6.5840 — Lab 3: Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-raft1.html): the real lab this exercise matches, including its 3B log-replication test suite (TestBasicAgree3B, TestFailAgree3B).
- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): the original paper specifying the AppendEntries consistency check, the backtracking optimization, and the current-term commit restriction implemented here.
