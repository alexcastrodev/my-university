---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define turnaround time, response time, and throughput as three distinct metrics a CPU scheduler might optimize for.
- Explain why these metrics often trade off against each other, so no single policy is unconditionally best.
- Distinguish workload assumptions (jobs arrive at once, run to completion, only use the CPU) from real-world scheduling, and explain why simplified assumptions are still useful for comparing policies.
- Compute turnaround time and average turnaround time for a small, concrete set of jobs.

## Context & Motivation

Now that a process can be created (`fork`/`exec`) and paused and resumed (context switching), a genuinely open question remains: when there are more ready processes than CPUs, in what order should the OS actually run them? This is the **CPU scheduling** problem, and before comparing any specific policy, it's necessary to pin down what "good" scheduling even means — because, as this concept and the four that follow it will show concretely, different reasonable-sounding goals can point to different, sometimes opposite, policies.

OSTEP introduces this with a deliberately simplified set of workload assumptions — every job runs for a known amount of time, arrives at the same moment, runs to completion without blocking, and only uses the CPU — not because real workloads look like this, but because a clean, comparable metric requires a clean, comparable setting first. Each of these simplifying assumptions gets relaxed one at a time across the next several concepts, and the metrics defined here stay the yardstick used throughout: this is the scoring system every subsequent scheduling policy in this discipline is graded against.

## Core Theory

### Three metrics, three different questions

- **Turnaround time** answers "how long did this job take, start to finish?" — formally, `completion time − arrival time`. It is the metric a batch job (a nightly report, a data pipeline) usually cares about most: total elapsed time until the work is done.
- **Response time** answers "how long until the job first gets any CPU time at all?" — formally, `first time scheduled − arrival time`. It is the metric an interactive program (a shell, a text editor) cares about most: a user typing a command wants to see *something* happen quickly, even if the full computation isn't finished yet.
- **Throughput** answers "how much work gets done per unit time, across the whole system?" — jobs completed per second, roughly. It is the metric a busy server handling many short requests cares about most.

These are not three ways of measuring the same thing — they can, and often do, disagree about which policy is "best." A policy that minimizes average turnaround time can produce terrible response time for some jobs (making them wait a long time before ever starting, even if their eventual finish times average out well), and vice versa.

### Why simplified assumptions come first

OSTEP's initial assumptions — jobs known in advance to run for a fixed amount of time, all arriving simultaneously, running to completion with no I/O, using only the CPU — are unrealistic on purpose. They let the very first scheduling policies be compared using a single clean number (turnaround time) without the added complexity of unpredictable arrival times or jobs pausing to wait on I/O. Each concept that follows relaxes exactly one of these assumptions: first arrival times become staggered, then response time becomes the concern that motivates round-robin, then unpredictability motivates feedback-based approaches (multi-level feedback queues). This concept's simplified world is scaffolding, not the final picture.

### Why the metrics trade off

Minimizing average turnaround time, all else equal, favors running short jobs before long ones — get the short ones out of the way fast, so they don't sit waiting behind something much bigger. But that same policy can make response time terrible for whichever job happens to be long, since it might not even start until every shorter job that arrived has already finished. Conversely, a policy engineered purely for fast response time — quickly giving every job *some* CPU time before fully finishing any of them — tends to increase average turnaround time compared to running jobs to completion in a well-chosen order, since constant switching adds overhead and delays every individual job's actual finish.

```mermaid
flowchart LR
    Goal1["Minimize turnaround time"] -->|favors| Policy1["Run short jobs first,\nto completion"]
    Goal2["Minimize response time"] -->|favors| Policy2["Give every job a slice\nquickly, then rotate"]
    Policy1 -.->|hurts| Goal2
    Policy2 -.->|hurts| Goal1
```

## Worked Examples

### Example 1: Computing turnaround time for three jobs run in arrival order

Three jobs, A, B, C, all arrive at time 0 (per the simplified assumption) with these run times, and are executed strictly in that order (first-come-first-served, the very next concept's subject):

```text
Job   Run time   Starts   Completes   Turnaround (completion - arrival)
A     10         0        10          10 - 0 = 10
B     10         10       20          20 - 0 = 20
C     10         20       30          30 - 0 = 30

Average turnaround time = (10 + 20 + 30) / 3 = 20
```

### Example 2: The same three jobs, reordered — same total work, different average

Reorder nothing about the jobs themselves, only the order they run in — same three jobs, same total run time, run shortest-first instead:

```text
Job   Run time   Starts   Completes   Turnaround
A     10         0        10          10
B     10         10       20          20
C     10         20       30          30

(All three jobs happen to have equal run time here, so reordering
 changes nothing — this is intentional: it shows that when jobs are
 equal length, arrival order doesn't matter for average turnaround.
 The next concept introduces unequal-length jobs, where order suddenly
 matters enormously.)
```

### Example 3: Response time vs. turnaround time can disagree

Two jobs arrive at time 0: job X takes 1 unit of CPU time, job Y takes 19 units. Compare running X first vs. Y first:

```text
Run X then Y:
  X: starts 0,  completes 1,  turnaround 1,  response time 0
  Y: starts 1,  completes 20, turnaround 20, response time 1
  Average turnaround = (1 + 20) / 2 = 10.5
  Average response   = (0 + 1) / 2 = 0.5

Run Y then X:
  Y: starts 0,  completes 19, turnaround 19, response time 0
  X: starts 19, completes 20, turnaround 20, response time 19
  Average turnaround = (19 + 20) / 2 = 19.5
  Average response   = (0 + 19) / 2 = 9.5
```

Running the short job first gives dramatically better average turnaround time (10.5 vs. 19.5) *and* better average response time (0.5 vs. 9.5) in this particular case — but the very next concept shows a scenario (the convoy effect) where a long job arriving first genuinely does block short jobs behind it, motivating shortest-job-first as an explicit policy rather than something that happens to work out.

## Common Misconceptions & Pitfalls

- **"A good scheduler just minimizes total time — there's one number to optimize."** There are at least three distinct, sometimes conflicting metrics (turnaround, response, throughput); a policy tuned for one can perform poorly on another, which is exactly why several different scheduling policies exist rather than one obviously-correct one.
- **"Response time and turnaround time measure the same thing, just with different names."** Turnaround time is about total elapsed time to *finish*; response time is about elapsed time until *first starting*. A job can have excellent response time (it started immediately) and mediocre turnaround time (it then got interrupted repeatedly and took a while to actually finish), or the reverse.
- **"The simplified workload assumptions (jobs known in advance, arrive together, no I/O) mean this material doesn't apply to real schedulers."** The assumptions are deliberately temporary scaffolding, relaxed one at a time across the concepts that follow — the metrics defined here (turnaround, response, throughput) remain the measuring stick used throughout, even once the assumptions become realistic.
- **"Throughput and turnaround time always move together."** A scheduler could finish jobs one at a time very efficiently (good throughput) while still making some individual jobs wait a very long time relative to their own run time (poor turnaround fairness for those specific jobs) — the two metrics look at different things (aggregate completions per time, vs. per-job elapsed time).

## Summary

CPU scheduling policies are judged against at least three distinct metrics: turnaround time (elapsed time to finish, from arrival), response time (elapsed time until first getting the CPU, from arrival), and throughput (completed jobs per unit time) — and these metrics can conflict, so no single scheduling policy is unconditionally best across all of them. OSTEP's initial simplified workload (jobs of known length, arriving together, running to completion without I/O) exists purely to let early policies be compared cleanly on turnaround time, with each unrealistic assumption relaxed one at a time by the concepts that follow. This concept's vocabulary and its three metrics are the constant yardstick the rest of this cluster uses: FCFS, SJF, round-robin, priority scheduling, and multi-level feedback queues are all, ultimately, different answers to which of these goals to prioritize and how.

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Scheduling: Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf) — the canonical treatment of scheduling metrics and the simplified workload assumptions this concept is built from.
- [ACM/IEEE CS2013 — Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/) — curriculum guidelines establishing scheduling metrics and policy comparison as core Operating Systems content.
