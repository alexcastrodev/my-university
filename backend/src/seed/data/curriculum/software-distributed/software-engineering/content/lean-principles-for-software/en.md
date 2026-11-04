---
version: 1.0
updatedAt: 2026-11-03
---
## Learning Objectives

- State the seven Lean software development principles as the Poppendiecks presented them in 2003, and name the software wastes that the first principle maps onto.
- Explain "decide as late as possible" as the Last Responsible Moment, and tell it apart from procrastination.
- Compute flow efficiency for a piece of work, and relate work in progress, throughput and the time work spends in the system.
- Place Lean relative to Extreme Programming, Scrum and Kanban: which is a set of principles, which is a method, and what each borrows.

## Context & Motivation

The Scrum Guide says Scrum "is founded on empiricism and lean thinking", and that "Lean thinking reduces waste and focuses on the essentials." `extreme-programming-practices` described a concrete engineering method, and `kanban-and-flow-based-process` described a concrete flow method with WIP limits. Lean sits one level below both: it is the body of thinking that explains why such practices work. Mary and Tom Poppendieck brought it to software in their 2003 book *Lean Software Development: An Agile Toolkit*, which organizes the material into seven principles and 22 "thinking tools" (publisher's description).

The term "lean" itself comes from manufacturing. John Krafcik's 1988 article "Triumph of the Lean Production System" (Sloan Management Review) is generally credited with coining "lean production", and Womack and colleagues' 1990 MIT study of the car industry, *The Machine that Changed the World*, popularized the word (Poppendieck, writing in 2015, credits the book with giving the field the term). The Poppendiecks argue that the software version had to be adapted, not copied, and that adaptation is the main thing this lesson tries to preserve.

## Core Theory

### The seven principles

The 2003 table of contents names seven chapters, one per principle:

```text
1. Eliminate Waste           5. Empower the Team
2. Amplify Learning          6. Build Integrity In
3. Decide as Late as         7. See the Whole
   Possible
4. Deliver as Fast as
   Possible
```

Book vs today: the names drift between sources. Poppendieck's 2015 chapter writes "Build quality in" for principle 6, and Wikipedia lists "Optimize the whole" for principle 7. The 2003 chapter title is "See the Whole", and this lesson uses the 2003 names. "Optimizing the whole" names the same idea.

### Eliminate waste, and what counts as waste

Chapter 1 maps manufacturing's wastes onto software. The book's headings are partially done work, extra processes, extra features, task switching, waiting, motion and defects, followed by a heading on management activities. Wikipedia's table pairs them with manufacturing terms: inventory becomes partially done work, overproduction becomes extra features, transportation becomes task switching, and motion becomes hand-offs. The unfamiliar one is partially done work: code that is written but not integrated, tested or released is inventory that has cost money and earned nothing, and it ages. XP's YAGNI (extra features) and `continuous-integration` (partially done work) can be read as waste elimination in this sense.

### Amplify learning and decide as late as possible

Software development is a learning process, so shorter feedback loops (iterations, tests, releases) raise the amount learned per week. The same fact drives principle 3. In "Concurrent Development" (2003), an excerpt from their book, the Poppendiecks define the **Last Responsible Moment** as "the moment at which failing to make a decision eliminates an important alternative", and warns that past that moment "decisions are made by default". Their tactics are practical: share partially complete designs, collaborate directly instead of through hand-offs, hide implementation behind modules and interfaces, and "develop a quick response capability", because "the slower you respond, the earlier you have to make decisions."

The caution is equally explicit: "Procrastinating is not the same as making decisions at the Last Responsible Moment; in fact, delaying decisions is hard work", and "a bias toward late commitment must not degenerate into a bias toward no commitment." Some decisions, such as layering and the choice of language, are best made early.

The excerpt also revisits the cost-of-change argument from `the-cost-of-defects-found-late`. It cites Boehm's 1987 figure of 100 times and his 2001 remark that the factor can be closer to 5:1 for small systems. For physical products it cites an older estimate of 1000:1 and argues that the sequential process could itself be the cause of such a ratio. For software it says that a few basic architectural decisions, such as the choice of language or layering, "might have the 100:1 cost escalation ratio", that "a single cost escalation factor or curve is misleading", and that "it is the sequential approach that causes the cost of most changes to escalate exponentially", because sequential development "emphasizes getting all the decisions made as early as possible". Treat that as the authors' argument, not a settled result.

### Deliver as fast as possible: flow, queues and pull

Poppendieck (2015) reframes Lean as **flow efficiency**: the share of elapsed time in which someone is actually working on the item. Her illustration is a broken crown. Her own repair took two weeks (336 hours) for 1.5 hours of dentist time, a flow efficiency of 1.5 / 336, about 0.45%. Her husband's repair in the same situation took eight hours: 1.5 / 8 = 18.75%, and 42 times faster. Citing Modig and Ahlstrom, she says Lean is not the kind of efficiency that "strives to keep every resource busy all of the time", because fully utilized resources create queues. For orientation only, she estimates (her own characterization, not a measured result) that traditional software development is typically under 10% flow efficient, agile practice 30 to 40%, and thriving internet companies approaching 70% or more.

Queues connect this to Kanban. For a limited first-in-first-out queue, she states, time in the queue is the number of items divided by the average completion rate. Applied to everything in progress, the same division gives the average time an item spends in the system, work plus waiting. Pull systems and queueing theory were already chapter 4 tools of the 2003 book; in 2015 she credits Anderson's 2010 *Kanban* with giving teams "a powerful visual method for managing and limiting work-in-process" just as two-week iterations began to feel slow. So Kanban applies Lean ideas, and the WIP limit in `kanban-and-flow-based-process` is a way of controlling the queue term in that formula.

### See the whole

Poppendieck argues that agile "focused on optimizing software development, which frequently was not the system constraint", while Lean looks across the value stream "from concept to cash" (a phrase from the subtitle of the 2006 sequel, consistent with the work of Taiichi Ohno). A team that doubles its coding speed gains little if a manual release process holds every change for a month.

She also warns against importing factory practice unchanged: "transferring lean practices from manufacturing to development has led to some disastrous results", for instance because lean production reduces variation while product development needs variation to explore alternatives.

## Worked Examples

### Example 1: flow efficiency of one feature

Invented numbers, in working days. For each stage, "wait" is time queued before work starts.

```text
Stage      touch  wait
analysis     2     8
develop      6    10
review       1     5
QA           3     9
release      1     4
Total       13    36   elapsed 49 days
Flow efficiency = 13 / 49 = 26.5%
```

The team shortens review (reviews within a day: wait 5 becomes 1), moves regression checks into the pipeline (QA wait 9 becomes 3) and automates the release (wait 4 becomes 0.5). Touch time is unchanged at 13 days, elapsed time drops to 35.5 days, and flow efficiency becomes 13 / 35.5 = 36.6%. The lead time is about 28% shorter although nobody typed faster. That is "deliver as fast as possible" achieved by removing waiting.

### Example 2: WIP, throughput and time in the system

A team finishes 3 items per week and keeps 12 items in progress. The average time an item spends in the system, working and waiting together, is items in progress divided by completion rate: 12 / 3 = 4 weeks. Cutting work in progress to 6 gives 6 / 3 = 2 weeks. If the smaller limit costs some throughput, say 2.5 per week because people sometimes idle, the result is 6 / 2.5 = 2.4 weeks, still 40% shorter than 4 weeks. The relation holds for averages in a steady state, and it assumes the limit does not starve the bottleneck.

### Example 3: finding the Last Responsible Moment

A checkout team must choose between two payment providers. The first story that calls the provider starts in week 9, and onboarding and certification take 3 weeks, so the choice cannot wait past week 9 - 3 = week 6. Deciding in week 1 would be early commitment on little information; deciding after week 6 would delay the story. Between now and week 6 the team writes the checkout against an interface, runs a short spike on each provider in week 4, and decides in week 5 or 6 with evidence. The deadline came from the dependency arithmetic, not from a feeling.

## Common Misconceptions & Pitfalls

- **"Lean means keeping everyone busy and cutting costs."** Poppendieck, citing Modig and Ahlstrom, says the opposite: resource efficiency "will almost always destroy overall efficiency" because of queues. Example 1 improved without anyone working harder.
- **"Decide as late as possible means put it off."** Example 3 shows the moment is computed from dependencies and lead times, and Poppendieck says delay "is hard work". Passing the moment turns a decision into a default.
- **"Lean software is Toyota's factory, applied to code."** She warns that copying factory practices produced "disastrous results". The principles carry over; the practices have to be rebuilt for development.
- **"Lean and Kanban are the same thing."** Lean is a set of principles from 2003. Kanban is a specific method with WIP limits, formalized in 2010, that implements some of them. A team can follow Lean principles without Kanban boards.

## Summary

Lean software development, introduced by Mary and Tom Poppendieck in 2003, adapts lean manufacturing thinking into seven principles: eliminate waste, amplify learning, decide as late as possible, deliver as fast as possible, empower the team, build integrity in and see the whole. Poppendieck presents it as a theoretical framework for agile practices; XP's YAGNI and `continuous-integration`, Kanban's WIP limits and, by the Scrum Guide's own statement, Scrum itself all connect to it. Its distinctive moves are measuring flow efficiency instead of resource utilization, using queues to explain waiting time, deferring commitment to the Last Responsible Moment without sliding into indecision, and looking at the whole value stream, not only the coding step. `user-stories-epics-and-the-product-backlog` turns to the work items that flow through that stream.

## Documentation Links

- [Poppendieck: Lean Software Development, The Backstory (2015)](https://www.leanessays.com/2015/06/lean-software-development-history.html): lean origins, the seven principles, flow efficiency and the contrast between agile and lean.
- [Poppendieck & Poppendieck (2003): Concurrent Development (book excerpt)](https://www.leanessays.com/2003/08/concurrent-development.html): the Last Responsible Moment, tactics for delaying commitment and the cost-escalation argument.
- [Lean Blog: The term lean production is 25 years old](http://www.leanblog.org/2013/09/the-term-lean-production-is-25-years-old-my-thoughts-on-the-original-article/): the credit to Krafcik's 1988 article for the term "lean production".
- [Poppendieck: When Demand Exceeds Capacity (2022)](https://www.leanessays.com/2022/06/when-demand-exceeds-capacity.html): the relation between queue length, completion rate and time in the queue.
- [InformIT: Lean Software Development, An Agile Toolkit](https://www.informit.com/store/lean-software-development-an-agile-toolkit-9780321150783): the publisher's description and full table of contents of the 2003 book.
- [Wikipedia: Lean software development](https://en.wikipedia.org/wiki/Lean_software_development): the principle names and the waste mapping table; a secondary source.
- [Schwaber & Sutherland: The Scrum Guide](https://scrumguides.org/scrum-guide.html): the statement that Scrum is founded on empiricism and lean thinking.
