---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Describe the Kanban Method's core mechanism: a continuous pull system limited by explicit work-in-progress (WIP) limits at each stage, with no fixed timebox.
- Explain why a WIP limit, not a burndown chart or a daily status check, is the actual mechanism that surfaces a bottleneck.
- Read a cumulative flow diagram and identify a stalled stage from it before it becomes a missed deadline.
- Contrast Kanban's continuous-flow tradeoff directly against Scrum's fixed-timebox tradeoff, and identify which real project conditions favor each.

## Context & Motivation

`agile-processes-scrum-in-practice` named Scrum's central tradeoff precisely: a fixed timebox buys predictable cadence at the cost of deferring newly discovered work. David Anderson's Kanban Method, formalized in his 2010 book after real, practical experience applying manufacturing-style kanban systems to knowledge work at Corbis and later at Microsoft, is built around choosing the opposite side of exactly that tradeoff: no fixed timebox at all, and a different mechanism entirely, work-in-progress limits, for keeping the team's effort focused and problems visible. Understanding Kanban honestly means understanding it is not simply "Scrum without Sprints"; it is a genuinely different control mechanism built on a different underlying model of how work actually flows through a team.

## Core Theory

### The pull system and explicit WIP limits

Kanban organizes work as a sequence of stages (for example: Backlog, In Progress, In Review, Done), visualized as columns on a board, with an explicit maximum number of items allowed in each in-progress stage at any one time, the work-in-progress (WIP) limit. Work is pulled into a stage only when that stage has capacity under its own WIP limit, never pushed in regardless of downstream readiness:

```text
Backlog  ->  In Progress (WIP limit: 3)  ->  In Review (WIP limit: 2)  ->  Done

If "In Progress" already holds 3 items, no new item may be pulled
into it, even if a team member is idle, until an item currently
in "In Progress" moves on to "In Review."
```

This is a genuinely different mechanism from Scrum's Sprint Backlog, which is planned once at the start of a fixed timebox; Kanban has no equivalent planning event fixing a batch of work in advance, work simply flows continuously, one item at a time, constrained only by the WIP limits at each stage.

### Why a WIP limit surfaces a bottleneck that a status check would miss

The genuine insight behind the WIP limit is what happens when a stage's limit is reached and stays reached: it forces a visible, immediate decision. If "In Review" is stuck at its WIP limit because reviews are backing up, no new item can enter "In Progress" beyond what "In Review" can eventually absorb, which means idle capacity earlier in the pipeline becomes visible and undeniable rather than quietly absorbed into starting yet another item that will just pile up at the same bottleneck later. A daily status check asking "is everyone busy" would report everyone as busy, since team members would simply start additional new items instead of confronting the actual constraint; a hard WIP limit removes that option and forces the bottleneck itself into view.

### Reading a cumulative flow diagram

A cumulative flow diagram plots, over time, the cumulative count of items in each stage, stacked. A healthy flow shows roughly parallel, steadily rising bands; a stalled stage shows its own band widening while the stage after it stays flat, a direct visual signal that work is piling up entering a stage faster than it is leaving it:

```text
count
  |        ___________________  Done (flat = nothing finishing)
  |       /
  |      /  ___________________  In Review (WIDENING = piling up)
  |     /  /
  |    /  /___________________   In Progress
  |   /  /
  |__/__/____________________________ time
```

This diagram makes a bottleneck visible days or weeks before it would otherwise surface as a missed deadline, precisely because it tracks the flow of work itself rather than any single person's reported status.

### Kanban's tradeoff against Scrum's, stated honestly

Kanban buys continuous responsiveness: a genuinely urgent item can be pulled in as soon as capacity allows, with no need to wait for a Sprint boundary or force a disruptive Sprint cancellation. It costs the predictable, fixed cadence Scrum's Sprint buys for planning and stakeholder review; without a Sprint boundary, a team has to build its own discipline around when to review priorities and reflect on process, since Kanban itself prescribes no equivalent to Sprint Review or Sprint Retrospective as fixed events (many real Kanban teams adopt a periodic cadence review anyway, borrowing the idea without borrowing Scrum's fixed-Sprint structure). Neither tradeoff is universally correct; a team with frequent genuine interruptions (a support or operations-heavy team) is a much better fit for Kanban's continuous responsiveness than for Scrum's Sprint commitment, while a team building a large, planned feature with predictable stakeholder review needs is often a better fit the other way.

## Worked Examples

### Example 1: a WIP limit forcing a real decision

A team's "In Review" stage has a WIP limit of 2, and both slots are currently occupied by pull requests waiting on the one senior engineer available to review them. A developer finishes a third piece of work and wants to start a fourth item from the backlog. The WIP limit says no: instead, the team's actual, visible choice becomes either helping unblock one of the two pending reviews (perhaps a second engineer, not usually a reviewer, steps in) or accepting that new work genuinely has to wait. Without the limit, the developer would simply start a fourth item, and the review bottleneck would keep growing invisibly until enough items backed up that the team's overall cycle time visibly degraded, days or weeks later.

### Example 2: reading a real stall from a cumulative flow diagram

A team's cumulative flow diagram shows the "In Progress" band steadily widening over two weeks while "Done" stays essentially flat. Read literally, this means items are entering "In Progress" faster than they are leaving it, a real, current bottleneck, even though every team member reports being fully busy during this same period, because being busy and making progress are not the same fact, and the diagram is tracking the second one, not the first.

### Example 3: choosing Kanban over Scrum for a genuine reason

A platform support team handles a continuous, unpredictable stream of incoming incidents alongside planned improvement work. Adopting Scrum for this team would mean every incoming incident either waits for the next Sprint Planning or forces a disruptive Sprint replan, neither of which matches how the team's real work actually arrives. Kanban's continuous pull, with WIP limits keeping planned improvement work and incident response from overwhelming each other, matches the team's actual arrival pattern directly, a concrete, real reason to choose Kanban's tradeoff over Scrum's rather than picking either process on trend or preference alone.

## Common Misconceptions & Pitfalls

- **"Kanban is just Scrum without Sprints, same thing otherwise."** Kanban's core control mechanism, explicit WIP limits enforced continuously, has no equivalent in Scrum, which controls work through Sprint planning and a fixed timebox instead; the two are genuinely different mechanisms, not the same idea with one feature removed.
- **"A Kanban board with no enforced WIP limits is still 'doing Kanban.'"** A board with columns but no enforced limit on how many items can sit "In Progress" loses the exact mechanism (Example 1) that surfaces bottlenecks; a visual board alone, without the limit actually being enforced, is a to-do list with extra columns, not the Kanban Method.
- **"Cycle time and being busy are the same signal."** Example 2 shows a team can be fully, genuinely busy while a cumulative flow diagram reveals work is actively piling up somewhere in the pipeline; "everyone is busy" answers a different question than "is work actually flowing."

## Summary

The Kanban Method, formalized by David Anderson in 2010 from real practice at Corbis and Microsoft, replaces Scrum's fixed Sprint timebox with a continuous pull system: work moves through named stages, and an explicit work-in-progress limit at each stage is the actual mechanism that surfaces a bottleneck, by forcing a visible decision the moment a stage fills up, rather than letting idle capacity elsewhere quietly absorb the problem. A cumulative flow diagram makes a stalled stage visible directly, as a widening band while the stage after it stays flat, days or weeks before the same problem would otherwise surface as a missed deadline. Kanban's tradeoff against Scrum's is genuine and symmetric: continuous responsiveness to newly arriving work, at the cost of the fixed planning and review cadence a Sprint boundary provides, which is exactly why a team's actual pattern of incoming work, not fashion or preference, should decide which process fits.

## Documentation Links

- [Anderson (2010): Kanban, Successful Evolutionary Change for Your Technology Business](https://archive.org/details/kanbansuccessful0000ande): the original book formalizing the Kanban Method for knowledge work, drawn from Anderson's real experience applying it at Corbis and Microsoft.
- [ACM/IEEE: CS2013 Software Engineering Knowledge Area](https://csed.acm.org/knowledge-areas-software-engineering-se-cs2013-version/): lists agile and flow-based process models within the same Software Processes knowledge unit this concept and `agile-processes-scrum-in-practice` both belong to.
