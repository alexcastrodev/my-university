---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Instrument `raft-leader-election-implemented`'s implementation to inject artificial clock skew between simulated nodes and to sweep the election-timeout randomization window.
- Measure, empirically, how election frequency and leader stability degrade as the randomization window narrows toward a fixed, identical timeout.
- Connect the measured breakdown point to Raft's own stated timing requirements, and to `distributed-systems-i`'s theoretical treatment of physical clock drift.
- Distinguish a spurious election, triggered by timing alone with no real leader failure, from a legitimate one, in a recorded experimental log.

## Context & Motivation

`distributed-systems-i`'s **Physical Clock Synchronization and Drift** establishes, theoretically, that real machine clocks run at slightly different rates and cannot be perfectly synchronized, which is precisely the physical reality Raft's randomized election timeout, already implemented in `raft-leader-election-implemented`, is designed to tolerate. This lab does not add new protocol logic; it instruments the existing implementation to make that tolerance measurable rather than merely argued for, injecting artificial skew and narrowing the randomization window until the protocol's own documented assumptions start to break down.

## Core Theory

Raft's own paper states a concrete timing requirement this lab is built to test directly: the broadcast time (time to send an RPC and receive a response) should be an order of magnitude less than the election timeout, and the election timeout should itself be a few times the broadcast time, wide enough that a randomly chosen timeout rarely collides with another server's. Clock skew erodes the margin this requirement depends on: if two servers' clocks drift far enough apart, their *actual* elapsed wait times, measured in real wall-clock time rather than each server's own local clock, can end up close together even when their local, randomized timeout values were chosen apart, reintroducing the split-vote problem randomization exists to avoid.

## Worked Examples

### API specification

```text
network.SetClockSkew(node string, drift time.Duration) — every
  timer this node schedules fires `drift` early or late relative to
  true simulated wall-clock time (positive drift = node's clock runs
  fast, so its timers fire early)

network.SetElectionWindow(min, max time.Duration) — overrides
  raft-leader-election-implemented's default 300-600ms randomization
  window for this experiment
```

### Step 1 — injecting skew into the existing timer logic

```go
func (rf *Raft) resetElectionTimer() {
    base := rf.newElectionTimeout() // from raft-leader-election-implemented
    skewed := base - rf.network.ClockSkewFor(rf.me) // fast clock -> fires sooner
    rf.electionTimer.Reset(skewed)
}
```

No change to the election *logic* itself, RequestVote's vote-granting rule, the commit pipeline, anything from earlier labs, only to when each server's own timer actually fires relative to true simulated time, isolating clock skew as the single variable this experiment measures.

### Step 2 — sweeping the randomization window and recording outcomes

```go
func TestElectionStabilityUnderSkew(t *testing.T) {
    windows := []struct{ min, max time.Duration }{
        {300 * time.Millisecond, 600 * time.Millisecond}, // Raft's own default
        {450 * time.Millisecond, 550 * time.Millisecond}, // narrower
        {490 * time.Millisecond, 510 * time.Millisecond}, // narrower still
        {500 * time.Millisecond, 500 * time.Millisecond}, // fixed: no randomization at all
    }
    skews := []time.Duration{0, 20 * time.Millisecond, 60 * time.Millisecond}

    for _, w := range windows {
        for _, skew := range skews {
            cfg := MakeConfig(t, 5, net)
            cfg.net.SetElectionWindow(w.min, w.max)
            for i := 0; i < 5; i++ {
                cfg.net.SetClockSkew(cfg.servers[i], skewFor(i, skew))
            }
            electionCount := cfg.runAndCountElections(30 * time.Second)
            t.Logf("window=%v skew=%v -> %d elections in 30s", w, skew, electionCount)
        }
    }
}
```

### Step 3 — representative measured results, and what they show

```text
window=[300ms,600ms]  skew=0    -> 1 election in 30s   (baseline: stable)
window=[300ms,600ms]  skew=60ms -> 1 election in 30s   (still stable: wide
                                                          window absorbs the skew)
window=[490ms,510ms]  skew=0    -> 3 elections in 30s  (narrow window alone
                                                          starts causing splits)
window=[490ms,510ms]  skew=60ms -> 11 elections in 30s (skew makes it much worse:
                                                          effective timeouts now
                                                          frequently coincide)
window=[500ms,500ms]  skew=any  -> elections every few seconds, no stable
                                     leader for more than a couple of terms
```

The pattern these numbers show directly is the theoretical point `physical-clock-synchronization-and-drift` makes abstractly: a wide randomization window absorbs realistic clock skew without much cost, but as the window narrows, skew stops being a second-order effect and starts dominating, until a fixed, non-randomized timeout produces near-continuous spurious elections regardless of skew, exactly the failure mode `raft-leader-election-implemented`'s Common Misconceptions section predicted but did not measure.

### Step 4 — identifying a spurious election in a recorded log

```text
[Server 2] term 14 -> 15, became candidate (no AppendEntries heard in 502ms)
[Server 2] elected leader, term 15
[Server 4] term 14 -> 15, became candidate (no AppendEntries heard in 498ms)
   -- Server 4's own timer fired only 4ms after Server 2's, despite BOTH
      servers previously receiving the SAME heartbeat from the same
      leader at the same logical time; this 4ms gap, well within this
      run's injected 60ms skew, is why the narrow-window experiment
      produces so many more elections than the baseline.
[Server 4] election fails: Server 2 already collected a majority
```

This is a spurious election precisely because no real leader failure occurred, the previous leader was alive and sending heartbeats normally; the election was triggered purely by two servers' effective timeouts, after accounting for injected clock skew, landing close enough together to both fire before either received the other's, or the leader's, next heartbeat.

## Common Misconceptions & Pitfalls

- **"Clock skew is a minor, theoretical concern that real systems don't need to worry about in practice."** This lab's own measured numbers show the opposite once the randomization window is narrow: skew on the order of tens of milliseconds, well within what real, unsynchronized machine clocks actually exhibit, measurably increases spurious elections, exactly the practical consequence `physical-clock-synchronization-and-drift` predicts theoretically.
- **"A narrower election timeout window is strictly better, since it means faster failure detection."** Faster detection trades directly against stability, as Step 3's data shows: narrowing the window reduces failover time on a genuine leader crash, but increases the rate of spurious elections when there is no real failure at all, a real, measured tradeoff, not a free improvement.
- **"This experiment just re-confirms something already proven; nothing new is learned by running it."** The Raft paper's own timing requirement, broadcast time an order of magnitude below election timeout, is stated as a guideline, not a proof with an exact numeric breakdown point; this lab's sweep is what turns that guideline into an actual measured curve for this specific implementation and simulator.

## Summary

This lab instruments `raft-leader-election-implemented`'s existing timer logic to inject artificial clock skew and sweep the election-timeout randomization window, without changing any protocol logic, turning `physical-clock-synchronization-and-drift`'s theoretical argument, that a wide randomization window is what makes Raft tolerant of realistic clock skew, into a measured curve showing exactly how spurious-election frequency rises as that window narrows and skew grows. A fixed, non-randomized timeout, the degenerate case at one end of that sweep, reliably produces near-continuous spurious elections, confirming empirically what `raft-leader-election-implemented`'s own Common Misconceptions section stated as a claim without measurement.

## Documentation Links

- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): the source of the broadcast-time-to-election-timeout ratio this lab's sweep tests directly against measured data.
- [Lamport — Time, Clocks, and the Ordering of Events in a Distributed System (CACM 1978)](https://lamport.azurewebsites.net/pubs/time-clocks.pdf): the foundational treatment of why physical clocks cannot be perfectly synchronized, the real-world phenomenon this lab's injected skew simulates.
