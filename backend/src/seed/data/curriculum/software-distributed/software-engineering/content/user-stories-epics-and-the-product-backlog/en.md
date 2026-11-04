---
version: 1.0
updatedAt: 2026-11-03
---
## Learning Objectives

- Describe a user story as a card, a conversation and a confirmation, and check a story against Bill Wake's INVEST criteria.
- Distinguish a story's acceptance criteria from the Definition of Done that Scrum defines for the Increment.
- Split an epic into vertical slices that each deliver value, and recognize a split by technical layer as a failure.
- Order a Product Backlog using value, size, risk and dependencies, and say exactly what the Scrum Guide does and does not require about it.

## Context & Motivation

`requirements-elicitation-specification-and-validation` taught three activities: elicitation finds the need, specification writes it down in a form "precise enough that two different engineers reading it would build the same thing", and validation checks the written result against the real need. That model suggests a document finished before construction. Agile methods keep the three activities but spread them over time, and the user story is the device that makes this possible.

The Scrum Guide's 2020 text does not contain the words "user story", "epic", "acceptance criteria" or "estimate". It defines the Product Backlog and leaves the format of an item open. Stories come from Extreme Programming: as Martin Fowler writes, "Kent Beck first introduced the term as part of Extreme Programming to encourage a more informal and conversational style of requirements elicitation than long written specifications." So this lesson treats stories as a common choice of backlog item, not as part of Scrum.

## Core Theory

### A story is a card, a conversation and a confirmation

Fowler describes user stories as "chunks of desired behavior of a software system" used to divide functionality into pieces for planning. The essence of a story fits on one note card, and stories are "deliberately not fleshed out in detail until they are ready to be developed": you need only enough understanding to prioritize against other stories. A common formulation has three clauses, "As a ...", "I want ..." and "so that ...", naming who wants it, what they want and why. The "so that" gives the context that helps the team get from what the customer thinks they want to what they actually need.

Bill Wake (2003) credits Ron Jeffries with the three parts of a story: the **card**, the **conversation** and the **confirmation**, meaning tests. Wake warns that it is easy to mistake the card for the whole story. The confirmation is usually written as acceptance criteria or examples. Mapped onto the requirements lesson: the conversation is elicitation, the confirmation is the checkable specification, and the Sprint Review is validation, each done in small pieces just in time.

### Acceptance criteria versus the Definition of Done

These two are often confused. Acceptance criteria belong to one story and describe what must be true for that story. The Scrum Guide's **Definition of Done** is "a formal description of the state of the Increment when it meets the quality measures required for the product", applied to every item: "If a Product Backlog item does not meet the Definition of Done, it cannot be released or even presented at the Sprint Review." A story is finished only when it satisfies both its own criteria and the shared definition.

### INVEST

Wake's mnemonic describes a story that is easy to plan:

```text
Independent  can be scheduled in any order (not always possible)
Negotiable   details are co-created, not a contract
Valuable     it has to be valuable to the customer
Estimable    the team can size it roughly
Small        at most a few person-weeks of work (see below)
Testable     you can say how to verify it
```

On size, Wake writes that stories "typically represent at most a few person-weeks worth of work" and that some teams restrict them to a few person-days; Fowler's summary says "usually a matter of person-days". Wake also notes that if a customer cannot say how to test a story, the story may be unclear, may not be valuable to that customer, or the customer may just need help with testing.

### Epics and splitting

An **epic** is, in Mike Cohn's definition, a large story, useful for remembering a capability before its details are known and split before development. The word is common vocabulary, not a Scrum term. What the Scrum Guide does say is that "Product Backlog items that can be Done by the Scrum Team within one Sprint are deemed ready for selection", so anything bigger needs splitting.

How to split matters more than whether to. Wake's advice is that "the best way is to slice vertically through the layers", so each piece delivers customer value, and Cohn's checklist for bringing a story into a Sprint asks whether the team has avoided splitting it only by technical layer. A vertical slice goes through interface, logic and storage for one narrow behavior. Useful ways to find slices include splitting by workflow step, by business-rule variation, by the simple case first and the exceptions later, or by data variation. A split by layer yields pieces that cannot be demonstrated or validated until all of them are done.

### The Product Backlog

The Scrum Guide defines the Product Backlog as "an emergent, ordered list of what is needed to improve the product", the single source of work. The Product Owner is accountable for it, including ordering the items, but may delegate the work. **Refinement** is "the act of breaking down and further defining Product Backlog items into smaller more precise items", adding description, order and size, and "The Developers who will be doing the work are responsible for the sizing." The **Product Goal** is the long-term objective the backlog is planned against.

Because detail is added just in time, items near the top are small and well understood, and items far down are coarse and may be epics. Cohn's rule of thumb is detail enough for the next decision.

The Guide gives no ordering formula. Common inputs are value, size, risk, dependencies and the cost of delay (one of the 22 tools in the 2003 *Lean Software Development*, see `lean-principles-for-software`). XP's release planning sorts stories by value and then by risk (Wikipedia). Value per size is a convenient first pass, but the Product Owner's judgment orders the backlog.

## Worked Examples

### Example 1: from a vague request to a good story

A stakeholder says: "Members need to renew books." As a bare card, "Renew books" leaves Valuable and Testable open: nothing says what the member gains or how anyone would verify a renewal. Rewritten:

```text
As a library member, I want to renew a loan online
so that I can keep a book I am still reading without visiting the library.

Confirmation (acceptance criteria):
- A loan can be renewed once, for 14 days, before it is due.
- Renewal is refused if another member has reserved the book,
  and the screen says so.
- A loan that is already overdue cannot be renewed.
```

Check: Independent only in part (it needs Borrow, and its second criterion needs Reserve, so order matters, as Example 3 shows), Negotiable (screens and wording are open), Valuable (the member keeps the book), Estimable, Small, Testable (three concrete cases). A fourth case found in conversation, such as staff overriding the limit, becomes a new story.

### Example 2: splitting an epic vertically

The epic "Library lending" is too big for a Sprint. A vertical split, with invented relative sizes:

```text
Borrow an available book          5
Renew a loan                      2
Reserve a book that is out        5
Fines for late returns            8
Email reminders before due date   3
Librarian overdue report          3
Total                            26
```

Each slice works through screen, logic and database, so each can be shown to a librarian. The failing alternative is "Loans table", "Loans API" and "Loans screen" as three items: after two of them nothing can be demonstrated, and a wrong assumption behind the table surfaces only when the screen arrives.

### Example 3: ordering by value per size, then by judgment

The Product Owner assigns relative values (invented, 1 to 13) to the slices from Example 2 and the team supplies sizes:

```text
Story               value  size  value/size  depends on
Borrow a book         13     5     2.6       -
Renew a loan           5     2     2.5       Borrow, Reserve
Overdue report         5     3     1.7       Borrow
Reserve a book         8     5     1.6       Borrow
Fines                  8     8     1.0       Borrow
Email reminders        3     3     1.0       Borrow
```

Ratio order is only a starting point, and here it breaks a dependency: Renew ranks second, but its second criterion (refuse renewal when the book is reserved) needs Reserve, which ranks fourth. The Product Owner moves Reserve ahead of Renew. The alternative is to split Renew and build the reservation check later. The working order, with cumulative size, is:

```text
Borrow 5 (5), Reserve 5 (10), Renew 2 (12), Overdue report 3 (15),
Fines 8 (23), Email reminders 3 (26)
```

Fines rank low but hide an unanswered policy question (what is the rate, and is there a cap?), which is a risk. The Product Owner adds a short investigation (say one point) ahead of Fines, so the answer is known before the team builds them. That answer can change their size or rules, so their 8 points are provisional. Finally the Developers forecast what fits: if past performance suggests about 24 points per Sprint, the first Sprint could hold everything through Fines plus the investigation (23 + 1 = 24), with Email reminders next, but only if the answer leaves the 8 points unchanged; if they grow, Fines drop out of the forecast. The Product Owner decides the order, and the Developers decide how much to forecast.

## Common Misconceptions & Pitfalls

- **"A user story is a requirements document that fits on a card."** Wake warns against mistaking the card for the story. In Example 1 the criteria and the conversation carry the requirement.
- **"Scrum requires user stories, epics and story points."** The 2020 Scrum Guide mentions none of them. It describes an ordered Product Backlog, says items that can be Done within one Sprint are "deemed ready for selection", and is silent on the format of an item.
- **"Every backlog item must be fully specified up front."** Refinement is ongoing. Over-specifying the bottom of the backlog repeats the waterfall error described in `software-process-models-waterfall-and-its-real-history`.
- **"Acceptance criteria and the Definition of Done are the same."** Criteria are specific to a story; the Definition of Done is the shared quality bar for every Increment.
- **"Splitting by layer is just good technical decomposition."** Example 2 shows what it costs in feedback. Tasks are useful inside a story, but tasks are not stories (Cohn lists splitting stories into tasks as a common mistake).

## Summary

A user story, introduced by Kent Beck in Extreme Programming, is a deliberately small, conversational substitute for a long specification: a card that reminds the team of a need, a conversation that fills in details just in time, and a confirmation in the form of acceptance criteria. INVEST (Wake, 2003) tests whether a story is plannable. An epic is a story too large for a Sprint and must be split vertically so each slice delivers value. The Scrum Guide defines none of this vocabulary. It defines the Product Backlog as an emergent, ordered list, ordered by the Product Owner, refined so that the items near the top can be Done within a Sprint, and sized by the Developers. Ordering is judgment informed by value, size, risk, dependencies and cost of delay. `agile-metrics-velocity-burndown-burnup` shows how the sizes of these items feed forecasts.

## Documentation Links

- [Fowler: User Story](https://martinfowler.com/bliki/UserStory.html): Beck's origin of the term, the single-card essence, the "As a, I want, so that" form and INVEST.
- [Wake (2003): INVEST in Good Stories, and SMART Tasks](https://xp123.com/invest-in-good-stories-and-smart-tasks/): the original INVEST, and the card, conversation, confirmation attribution to Jeffries.
- [Mountain Goat Software: User Stories](https://www.mountaingoatsoftware.com/agile/user-stories): Mike Cohn's guide to detail, epics as large stories, splitting and common mistakes; a vendor site, used for definitions only.
- [Schwaber & Sutherland: The Scrum Guide](https://scrumguides.org/scrum-guide.html): the Product Backlog, refinement, the Product Goal and the Definition of Done.
- [Wikipedia: Extreme programming practices](https://en.wikipedia.org/wiki/Extreme_programming_practices): the planning game, with stories on cards sorted by value and risk.
