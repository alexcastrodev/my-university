---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Name Scrum's three accountabilities, five events, and three artifacts precisely, as defined by its own official guide, not by how a certification course markets them.
- State exactly what each event is for, and what specifically goes wrong when it is skipped or reduced to a status meeting.
- Explain Scrum's central tradeoff: a fixed timebox buys predictable planning and review cadence at the cost of delaying newly discovered work until the next Sprint.
- Distinguish Scrum's actual prescriptions from common, informal misuses of the term (a daily meeting that isn't a real Daily Scrum, a backlog that isn't a real Product Backlog).

## Context & Motivation

`software-process-models-waterfall-and-its-real-history` established the structural flaw agile processes exist to correct: an assumption that requirements can be fully known before implementation begins. Scrum is the most widely adopted concrete answer to that flaw, and it is worth treating with the same precision this discipline gave waterfall, defined by its own official specification rather than by the informal, often-diluted version many teams practice under its name. The Scrum Guide, maintained and published directly by Ken Schwaber and Jeff Sutherland, Scrum's own originators, is a short, precise, freely available document, and this concept works from it directly rather than from secondhand paraphrase.

## Core Theory

### The three accountabilities

Scrum defines exactly three accountabilities within a Scrum Team, no more:

```text
DEVELOPERS:      The people committed to creating any aspect of a
                  usable Increment each Sprint.

PRODUCT OWNER:   Accountable for maximizing the value of the
                  product resulting from the work of the
                  Developers; accountable for managing the
                  Product Backlog.

SCRUM MASTER:    Accountable for establishing Scrum as defined
                  in the Scrum Guide; helps everyone understand
                  Scrum theory and practice, and helps the team
                  focus on creating high-value Increments.
```

Notably absent from this list: a project manager role assigning individual tasks, or a separate "team lead" distinct from the Scrum Master. Scrum deliberately concentrates decision-making about what to build in the Product Owner and how to build it in the Developers as a self-managing group.

### The five events

```text
THE SPRINT:          A fixed-length timebox (one month or less)
                      containing all other events; produces a
                      usable, potentially releasable Increment.

SPRINT PLANNING:     Starts the Sprint. The Scrum Team decides
                      why this Sprint is valuable, what can be
                      done this Sprint, and how the chosen work
                      will get done.

DAILY SCRUM:         A 15-minute event, every working day,
                      for the Developers to inspect progress
                      toward the Sprint Goal and adapt the
                      plan for the next day.

SPRINT REVIEW:       The Scrum Team presents results to
                      stakeholders, inspects the Increment, and
                      adapts the Product Backlog based on
                      feedback.

SPRINT RETROSPECTIVE: The Scrum Team inspects how the last
                      Sprint went (individuals, interactions,
                      process, tools) and plans concrete
                      improvements for the next Sprint.
```

Each event is a genuine inspect-and-adapt point, not a status report; the Daily Scrum in particular is specified as being for the Developers themselves to replan their own next day, not a reporting-up meeting to a manager.

### The three artifacts

```text
PRODUCT BACKLOG:  An emergent, ordered list of everything
                   needed to improve the product; the single
                   source of work.

SPRINT BACKLOG:   The Sprint Goal, the Product Backlog items
                   selected for the Sprint, and the plan for
                   delivering them; owned entirely by the
                   Developers.

INCREMENT:        A concrete stepping stone toward the Product
                   Goal; each Increment must meet the Definition
                   of Done and be usable, regardless of whether
                   the Product Owner chooses to release it.
```

The Definition of Done, referenced by the Increment artifact, is exactly the kind of concrete checklist that connects directly to `unit-integration-and-system-testing` (`software-construction`): a real Definition of Done typically requires the Increment's code to pass its automated tests, among other conditions, tying Scrum's own artifact directly back to the unit-level testing discipline covered in this curriculum's sibling.

### The real tradeoff: a fixed timebox

Scrum's Sprint is a fixed timebox, and that fixedness is a genuine, deliberate tradeoff, not a neutral default. It buys the team and stakeholders a predictable cadence for planning and review, since everyone knows exactly when the next opportunity to reprioritize or inspect an Increment will occur. It costs the team the ability to reprioritize mid-Sprint without disrupting the Sprint Goal the team already committed to; genuinely urgent new work discovered mid-Sprint either has to wait for the next Sprint Planning, or, if it is disruptive enough, forces the Product Owner to consider cancelling the Sprint entirely, a real, specified but rarely used escape valve in the Scrum Guide itself. `kanban-and-flow-based-process`, the next concept in this discipline, is built specifically around the opposite tradeoff.

## Worked Examples

### Example 1: a "Daily Scrum" that isn't one

A team holds a 15-minute daily meeting where each Developer reports their individual status to the Scrum Master, who takes notes and follows up privately with anyone behind schedule. This looks like a Daily Scrum on the calendar, but it inverts the actual specified purpose: the Scrum Guide defines the Daily Scrum as the Developers inspecting progress toward the Sprint Goal and adapting their own plan together, not a status report upward to any single accountable individual. A meeting with the right name and the wrong structure gets none of the actual event's benefit (a self-organizing team replanning its own next day) while still costing the full 15 minutes.

### Example 2: skipping the Sprint Retrospective under deadline pressure

A team facing a tight external deadline decides to skip the Sprint Retrospective "just this once" to save the hour it would take. Three Sprints later, the same recurring problem (a slow, manual deployment step nobody has fixed) is still costing the team roughly the same hour, every single Sprint, because the one event specifically designed to surface and fix exactly this kind of recurring friction was the one event repeatedly cut. The retrospective's cost is visible and immediate (an hour, right now); its benefit (fixing a problem that otherwise repeats every Sprint indefinitely) is invisible until it is skipped often enough for the pattern to become obvious.

### Example 3: the fixed-Sprint tradeoff, made concrete

Mid-Sprint, a critical security vulnerability is discovered in a third-party dependency. The Sprint Backlog, already committed to a specific Sprint Goal, has no room allocated for this. The Product Owner faces the real tradeoff Core Theory names: either the fix waits until the current Sprint's Goal is met and the next Sprint Planning session, a real, sometimes unacceptable delay, or the Product Owner exercises Scrum's specified escape valve and cancels the current Sprint outright to replan around the vulnerability immediately, which itself has a real cost (the partially completed Sprint Goal work is set aside). Neither option is free; Scrum's fixed timebox trades away exactly this kind of mid-Sprint flexibility in exchange for the predictability it buys everywhere else.

## Common Misconceptions & Pitfalls

- **"A daily standup is the same thing as a Daily Scrum."** Example 1 shows a meeting can have the right name, length, and daily cadence and still fail the actual specified purpose if it is structured as a status report upward instead of the Developers replanning together; the label alone guarantees nothing.
- **"Retrospectives are the first thing to cut when time is short."** Example 2 shows the retrospective is specifically the mechanism for fixing recurring process friction; cutting it under pressure routinely preserves the exact friction that pressure came from in the first place.
- **"Scrum has a project manager role."** The three accountabilities in Core Theory are Developers, Product Owner, and Scrum Master; none of these maps onto a traditional project manager assigning individual tasks, and treating the Scrum Master as one is a common, real misapplication of the framework as officially defined.

## Summary

Scrum, as defined by its own official guide (Schwaber and Sutherland, 2020), prescribes exactly three accountabilities (Developers, Product Owner, Scrum Master), five events (the Sprint itself, Sprint Planning, the Daily Scrum, the Sprint Review, the Sprint Retrospective), and three artifacts (Product Backlog, Sprint Backlog, Increment), each with a precise, specified purpose that a superficially similar but differently structured meeting or document can fail to deliver even while matching Scrum's vocabulary. Scrum's Sprint as a fixed timebox is a genuine, deliberate tradeoff: predictable planning and review cadence, at the cost of deferring newly discovered work to the next Sprint (or forcing an explicit, costly Sprint cancellation for anything urgent enough not to wait). `kanban-and-flow-based-process`, next in this discipline, is built around choosing the opposite side of that same tradeoff.

## Documentation Links

- [Schwaber & Sutherland: The Scrum Guide (2020)](https://scrumguides.org/docs/scrumguide/v2020/2020-Scrum-Guide-US.pdf): the official, primary specification this concept's accountabilities, events, and artifacts are drawn from directly, published by Scrum's own originators.
- [ACM/IEEE: CS2013 Software Engineering Knowledge Area](https://csed.acm.org/knowledge-areas-software-engineering-se-cs2013-version/): lists agile process models, including Scrum, as core material within the Software Processes knowledge unit this concept belongs to.
