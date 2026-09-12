---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement Raft's RequestVote RPC and the term-based voting rule that guarantees at most one leader per term.
- Implement randomized election timeouts and the heartbeat mechanism that suppresses unnecessary elections while a leader is alive.
- Verify, against Lab 1's simulator, that a single leader is elected, that it stays leader absent failures, and that a new leader takes over once the old one is killed or partitioned away.
- Identify why a naive, non-randomized timeout causes repeated split votes, and confirm the fix empirically rather than by argument alone.

## Context & Motivation

`distributed-systems-i`'s **Raft: Leader Election** already proves why term numbers and the one-vote-per-term rule are sufficient to guarantee at most one leader per term, and why randomized timeouts make a split vote a rare, self-correcting event rather than a recurring deadlock. This lab does not re-derive that proof; it is the first quarter of turning it into a real, running implementation, matching MIT 6.5840's Lab 3A exactly, run against real, repeatable failure scenarios rather than left as a diagram.

## Core Theory

This lab reuses `raft-leader-election`'s state machine unchanged: each server is Follower, Candidate, or Leader, a term number increases monotonically whenever a server starts an election, and a server grants its vote for a given term at most once, first-come-first-served. What this lab adds is the concrete machinery: a background goroutine per server tracking an election timeout, a RequestVote handler enforcing the one-vote-per-term rule, and a heartbeat mechanism (empty AppendEntries RPCs, whose full log-carrying behavior belongs to `raft-log-replication-and-commitment-implemented`) that resets followers' timeouts as long as a leader is alive.

## Worked Examples

### API specification

```text
RequestVoteArgs  { Term, CandidateId, LastLogIndex, LastLogTerm }
RequestVoteReply { Term, VoteGranted }

Each server runs one long-lived goroutine that:
  - resets a randomized election timer whenever it receives a valid
    heartbeat or grants a vote
  - starts an election (increments its term, votes for itself, sends
    RequestVote to all peers) if the timer fires with no leader heard from
```

### Step 1 — the vote-granting rule

```go
func (rf *Raft) RequestVote(args *RequestVoteArgs, reply *RequestVoteReply) {
    rf.mu.Lock()
    defer rf.mu.Unlock()

    if args.Term < rf.currentTerm {
        reply.Term, reply.VoteGranted = rf.currentTerm, false
        return
    }
    if args.Term > rf.currentTerm {
        rf.currentTerm = args.Term
        rf.votedFor = -1 // a higher term always resets any prior vote
        rf.state = Follower
    }
    // One vote per term: grant only if not already voted this term
    // (or already voted for this same candidate, for a retried RPC).
    if (rf.votedFor == -1 || rf.votedFor == args.CandidateId) && rf.logAtLeastAsUpToDateAs(args) {
        rf.votedFor = args.CandidateId
        reply.VoteGranted = true
        rf.resetElectionTimer()
    }
    reply.Term = rf.currentTerm
}
```

### Step 2 — randomized timeout, deliberately not fixed

```go
func (rf *Raft) newElectionTimeout() time.Duration {
    // 300-600ms window: wide enough that two followers rarely time
    // out within the same few milliseconds of each other, narrow
    // enough that recovery after a leader failure stays fast, matching
    // MIT 6.5840's own stated constraint of a new leader within 5s.
    return time.Duration(300+rand.Intn(300)) * time.Millisecond
}
```

### Step 3 — a test that forces, then heals, a leader failure

```go
func TestReElection3A(t *testing.T) {
    cfg := MakeConfig(t, 3, net) // 3-server cluster over Lab 1's simulator
    leader1 := cfg.checkOneLeader()

    cfg.disconnect(leader1) // simulated crash: cut off, not killed
    leader2 := cfg.checkOneLeader()
    if leader2 == leader1 {
        t.Fatalf("expected a new leader after disconnecting old leader")
    }

    cfg.connect(leader1) // old leader rejoins; must step down, not split-brain
    cfg.checkOneLeader()
}
```

## Common Misconceptions & Pitfalls

- **"A fixed, identical timeout on every server is simpler and should work fine."** It produces recurring split votes: every follower times out at the same instant, all become candidates simultaneously, and no single candidate gets a majority, repeating indefinitely; `clock-skew-and-spurious-elections` later measures exactly how bad this gets as the randomization window narrows.
- **"Once a leader is elected, the election logic's job is done."** A disconnected-then-reconnected old leader must recognize a higher term from the new leader's heartbeats and step down; skipping this produces two servers simultaneously believing they are leader, a real split-brain bug this lab's tests specifically probe for.
- **"Granting a vote is a simple yes as long as the term matches."** The `logAtLeastAsUpToDateAs` check (deferred in full detail to `raft-log-replication-and-commitment-implemented`, but already required here) exists because granting a vote to a candidate with a stale log risks electing a leader missing already-committed entries; skipping it passes this lab's simplest tests while silently violating Raft's safety property.

## Summary

This lab implements Raft's leader election exactly as MIT 6.5840's Lab 3A specifies it: RequestVote's one-vote-per-term rule, randomized election timeouts that make a split vote rare and self-correcting, and heartbeats that suppress unnecessary elections while a leader is alive, verified against Lab 1's simulator with real, repeatable scenarios, a disconnected leader forcing re-election, a healed partition forcing the old leader to step down, rather than left as an untested description of how the protocol is supposed to behave.

## Documentation Links

- [MIT 6.5840 — Lab 3: Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-raft1.html): the real lab this exercise matches, including its 3A leader-election test suite (TestInitialElection3A, TestReElection3A, TestManyElections3A).
- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): the original paper specifying the vote-granting rule and randomized-timeout mechanism implemented in this lab.
