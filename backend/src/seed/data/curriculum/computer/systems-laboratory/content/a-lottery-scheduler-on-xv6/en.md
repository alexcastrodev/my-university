---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Replace xv6's default round-robin scheduler with a lottery scheduler that assigns each process a number of tickets and picks the next process via a weighted random draw.
- Implement a new system call letting a process set its own ticket count, and a sensible default ticket count for processes that never call it.
- Explain why lottery scheduling avoids starvation by construction, and connect that guarantee to the theoretical failure mode `priority-scheduling-and-starvation` already describes.
- Measure, empirically, whether a process's actual observed CPU share over a real run matches its ticket share of the total, within the randomness the mechanism itself introduces.

## Context & Motivation

`operating-systems-i`'s own **Multi-Level Feedback Queue Scheduling** and **Priority Scheduling and Starvation** cover two real, different approaches to fair CPU scheduling, one adjusting priority dynamically based on observed behavior, the other assigning fixed priorities with a real risk of starving low-priority processes indefinitely. This lab, matching the official OSTEP-projects xv6 scheduling assignment, implements a third, genuinely different mechanism inside a real, working kernel: lottery scheduling, where fairness comes from probability rather than from bookkeeping about each process's history.

## Core Theory

Nothing about *why* MLFQ adjusts priority based on observed behavior, or *why* fixed-priority scheduling can starve a process indefinitely, is re-derived here; both arguments already exist in this curriculum's `multi-level-feedback-queue-scheduling` and `priority-scheduling-and-starvation`. This lab implements a different design entirely: every runnable process holds some number of tickets, and the scheduler picks its next process by drawing a random number and finding which process's ticket range that number falls into, exactly the OSTEP-projects xv6 lottery assignment's own specification.

## Worked Examples

### API specification

```text
int settickets(int number);  // new syscall: sets the calling process's
                                // own ticket count; returns 0 on success

Default ticket count for a process that never calls settickets: 1
(matching the OSTEP-projects assignment's own stated default)
```

### Step 1 — adding a ticket count to xv6's process structure

```c
// kernel/proc.h
struct proc {
  // ... existing xv6 fields (pid, state, trapframe, etc.) unchanged ...
  int tickets;   // NEW: this process's ticket count
};
```

```c
// kernel/proc.c, in allocproc() — every NEW process starts with the
// documented default before it ever runs
p->tickets = 1;
```

### Step 2 — the new system call

```c
uint64
sys_settickets(void)
{
  int n;
  argint(0, &n);
  if (n < 1) {
    return -1;  // a process cannot hold zero or negative tickets
  }
  myproc()->tickets = n;
  return 0;
}
```

### Step 3 — replacing xv6's round-robin scheduler loop with a weighted draw

```c
// kernel/proc.c, scheduler() — xv6's default version walks the process
// table in a fixed order, picking the next RUNNABLE process in turn;
// this lab REPLACES that walk with a weighted random draw instead

void
scheduler(void)
{
  struct cpu *c = mycpu();
  for(;;){
    intr_on();

    int total_tickets = 0;
    for(struct proc *p = proc; p < &proc[NPROC]; p++) {
      if(p->state == RUNNABLE) total_tickets += p->tickets;
    }
    if (total_tickets == 0) continue;  // nothing runnable; spin

    int winner = random_int() % total_tickets;  // the "lottery draw"
    int counter = 0;
    for(struct proc *p = proc; p < &proc[NPROC]; p++) {
      if(p->state != RUNNABLE) continue;
      counter += p->tickets;
      if (counter > winner) {
        // this process's ticket RANGE contains the winning number —
        // it runs next
        acquire(&p->lock);
        p->state = RUNNING;
        c->proc = p;
        swtch(&c->context, &p->context);
        c->proc = 0;
        release(&p->lock);
        break;
      }
    }
  }
}
```

A process holding twice as many tickets as another occupies twice as wide a range within `total_tickets`, so it is drawn, on average, twice as often, with no per-process history, no queue-level bookkeeping, and no explicit aging mechanism needed at all to achieve that proportional fairness.

### Step 4 — why this avoids starvation by construction, and measuring it directly

```text
Any process with tickets >= 1 has a NONZERO probability of being drawn
on EVERY scheduling decision, regardless of how many other processes are
runnable or how long it has already waited — this is the structural
difference from fixed-priority scheduling, where a lower-priority
process can be starved indefinitely by a continuous stream of
higher-priority ones, exactly the failure mode
priority-scheduling-and-starvation describes.
```

```c
// A userspace test program: three child processes call settickets(1),
// settickets(2), and settickets(3) respectively, then each spins,
// incrementing its own counter, for a fixed wall-clock duration.
// Measured, over a long enough run, counts should land close to the
// 1:2:3 ratio the tickets specify, though NOT exactly, since the draw
// is genuinely random on every scheduling decision, not deterministic.
```

## Common Misconceptions & Pitfalls

- **"A process with more tickets is guaranteed to run before a process with fewer tickets, on any given draw."** The draw is genuinely probabilistic: a low-ticket process can still win any individual lottery, just with lower probability; the fairness lottery scheduling provides is a statistical guarantee over many scheduling decisions, not a deterministic ordering.
- **"Lottery scheduling needs to track how long each process has been waiting, similar to MLFQ's own priority-boosting mechanism."** It needs no such bookkeeping at all; the nonzero-probability-on-every-draw property that avoids starvation falls directly out of the ticket-range mechanism itself, which is precisely what makes this design simpler to implement than MLFQ's own multi-queue, priority-adjusting logic.
- **"Testing this scheduler means checking that observed CPU shares match ticket ratios exactly."** Given a genuinely random draw on every decision, exact matching is not the right expectation; Step 4's test checks that measured shares land *close to* the specified ratio over a long enough run, with the remaining variance being an expected, correct property of the mechanism, not a bug.

## Summary

This lab replaces xv6's default round-robin scheduler with a lottery scheduler, matching the official OSTEP-projects xv6 scheduling assignment: each process holds a ticket count (settable via a new syscall, defaulting to 1), and the scheduler picks its next process via a weighted random draw over all runnable processes' ticket ranges, giving processes CPU share proportional to their tickets without any per-process history or queue-level bookkeeping. Lottery scheduling avoids `priority-scheduling-and-starvation`'s own starvation failure mode by construction, since any process with at least one ticket has a nonzero probability of winning any given draw, a structurally different fairness guarantee from `multi-level-feedback-queue-scheduling`'s own history-based priority adjustment.

## Documentation Links

- [OSTEP Projects — xv6 Kernel Projects (Scheduling)](https://github.com/remzi-arpacidusseau/ostep-projects): the real, official assignment this lab's lottery-scheduler implementation matches, including its exact API and default-ticket-count specification.
- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Scheduling: The Multi-Level Feedback Queue"](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched-mlfq.pdf): the source for the contrasting priority-based scheduling design this lab's lottery mechanism is deliberately built differently from.
