---
version: 1.0
updatedAt: 2026-11-03
---
## Learning Objectives

- Name XP's practices in both Kent Beck's flat 1999 list and the later grouped list of twelve, map the names between them, and state which problem each group addresses.
- Explain why the practices were designed to reinforce one another, using Martin Fowler's distinction between enabling and exploiting practices and the idea of a flattened cost-of-change curve.
- Evaluate pair programming against the actual experimental evidence, including the limits of that evidence, instead of against slogans for or against it.
- Separate what Scrum prescribes from what XP prescribes, and say which XP practices became common outside XP.

## Context & Motivation

`agile-processes-scrum-in-practice` presented Scrum as a framework for organizing decisions and feedback: who orders the work, when the team plans, inspects and adapts. The 2020 Scrum Guide states that Scrum is founded on "empiricism and lean thinking", but its text never mentions testing, integration, pairing or refactoring. Scrum deliberately says nothing about how code gets written. Extreme Programming (XP) is the agile method that answers exactly that question, and it answers it with concrete engineering practices.

XP came out of the Chrysler Comprehensive Compensation System (C3) payroll project, where Beck became project leader in March 1996 and asked the team, in his words, to "crank up all the knobs to 10 on the things I thought were essential and leave out everything else." His book *Extreme Programming Explained* appeared in October 1999 (dates per the Wikipedia article on XP).

`continuous-integration`, `test-driven-development` (`software-construction`) and `refactoring` (`software-construction`) each have a full lesson, and this one does not repeat them. It asks what XP adds: why the practices come as a set, what the rest of the set looks like, and what survived.

## Core Theory

### Two lists of practices

Beck's article "Embracing Change with Extreme Programming" (IEEE Computer, October 1999) gives a flat list of thirteen practices: planning game, small releases, metaphor, simple design, tests, refactoring, pair programming, continuous integration, collective ownership, on-site customer, 40-hour weeks, open workspace and "just rules". The grouped form cited later has twelve practices in four groups. The C2 wiki ties it to the first edition of Beck's book, and Wikipedia reproduces it, with some practices renamed:

```text
FINE-SCALE FEEDBACK:    Pair programming, Planning game,
                        Test-driven development, Whole team
CONTINUOUS PROCESS:     Continuous integration, Design improvement,
                        Small releases
SHARED UNDERSTANDING:   Coding standard, Collective code
                        ownership, Simple design, System metaphor
PROGRAMMER WELFARE:     Sustainable pace
```

The mapping: tests became test-driven development, on-site customer became Whole team, 40-hour weeks became sustainable pace, refactoring became design improvement, and metaphor became system metaphor. The grouped list adds coding standard and drops open workspace and just rules. The values are communication, simplicity, feedback and courage; respect was added in the 2004 second edition.

Book vs today: the second edition replaced the twelve with "primary" and "corollary" practices (such as Sit Together, Weekly Cycle, Ten-Minute Build and Test-First Programming), and Wikipedia notes that XP now accepts modified practices as long as their objectives are still met. Even the 1999 article's last practice, "just rules", lets the team change the rules if it agrees on how to assess the effects. Treat any list as a historical snapshot, not a checklist.

### Why the practices come as a set: the change curve

The classic argument for designing everything up front rests on a cost-of-change curve that rises steeply over a project (see `the-cost-of-defects-found-late`). Beck's 1999 article calls the waterfall "a rational reaction to the shocking measurement that the cost of changing a piece of software rose dramatically over time" and says XP "exploits the reduction in the cost of changing software". Fowler's "Is Design Dead?" (May 2004 version) states XP's counter-assumption: "The fundamental assumption underlying XP is that it is possible to flatten the change curve enough to make evolutionary design work." He then distinguishes two roles among the practices:

```text
ENABLING (they flatten the curve):
    testing, continuous integration, refactoring
EXPLOITING (they rely on a flat curve):
    evolutionary design, simple design and
    "you aren't going to need it" (YAGNI)
```

His warning is the key to the whole method: "you can't do those parts of XP that exploit the flattened curve without doing those things that enable the flattening." Many critics, he notes, attack the exploiting practices after trying them without the enabling ones. He also adds a qualification: at his employer, testing and continuous integration alone produced a marked improvement, enough "to seriously question the XP assertion that you need all the practices to get a big improvement".

### Pair programming and its evidence

In pair programming one person controls the keyboard and thinks about the code in detail while the other reviews continuously and thinks about the larger direction. They swap roles within minutes to hours, and partners rotate. It is `code-review` (`software-construction`) taken to the extreme: review happens while the code is being typed.

The best-known evidence is a 1999 controlled experiment at the University of Utah, reported by Cockburn and Williams (2000): in a software engineering course, one third of the advanced undergraduates worked alone and the rest in pairs. After an initial adjustment, pairs spent about 15% more time per program than individuals, and the paper states that their code had "about 15% fewer defects". The only measure it plots (Figure 2) is the post-development test cases passed, "essentially the percentage of the instructor's test cases passed", and the text gives no pass rates. A gap in pass rates is not the same as a 15% drop in defect count, so the figure is the authors' reading of the result. The abstract adds better design quality, lower staffing risk, better communication and more enjoyment, all "at statistically significant levels"; design quality rests partly on the experiment (pairs wrote the same functionality in fewer lines) and enjoyment on anonymous surveys.

The limits matter: the subjects were students, the programs were course assignments, and the authors advocate the practice. A later meta-analysis of published experiments (Hannay and colleagues, 2009) reports "a small significant positive overall effect of pair programming on quality", a medium effect on duration in pairs' favor and a medium negative effect on effort. Task complexity moderates these: pairs were faster on simple tasks, and produced higher-quality code on complex tasks at considerably greater effort. The authors also found large variation between studies and signs of publication bias, and conclude that moderating factors deserve more attention. So the trade between time and quality depends on the task, and neither "always" nor "never" is supported.

### Planning game, small releases and sustainable pace

The planning game splits planning in two. In release planning, customers write stories on cards, developers estimate them, and both sides agree what goes in the next release. In iteration planning, developers break the chosen stories into tasks. The aim is to "steer the project" toward delivery instead of predicting exact dates. Iterations run one to three weeks. Sustainable pace echoes an Agile Manifesto principle: sponsors, developers and users "should be able to maintain a constant pace indefinitely".

### What survived into common practice

The sources used here do not measure adoption, so these observations are hedged:

- Scrum's text contains none of XP's engineering practices. Mary Poppendieck (2015) observes that Scrum institutionalized iterations and cross-functional teams but omitted test-driven development and continuous integration, so a team can follow Scrum's events and still lack the practices that make frequent change safe.
- Continuous integration, test-driven development and refactoring now travel as freestanding practices. Fowler describes TDD as "developed by Kent Beck in the late 1990's as part of Extreme Programming".
- Pair programming, the on-site customer (Whole team in the grouped list) and the system metaphor are the contested ones. Critics say the on-site customer can become a single point of failure, and pairing's evidence is mixed. Nothing cited here settles their fate.

## Worked Examples

### Example 1: the pair programming ledger, recomputed

Cockburn and Williams give an illustrative cost model with their own assumptions. A program of 50,000 lines is written at 50 lines per hour. Programmers inject 100 defects per thousand lines, and a thorough process removes about 70% of them.

```text
Individuals:  50,000 / 50 = 1,000 hours
              injected 5,000 defects, 30% remain = 1,500
Pairs:        1,000 x 1.15 = 1,150 hours (150 hours extra)
              defects 15% lower: 1,500 x 0.85 = 1,275 remain
Avoided:      1,500 - 1,275 = 225 defects
At 10 hours of test-and-fix per defect: 225 x 10 = 2,250 hours
2,250 / 150 = 15 times the extra cost of pairing
```

The model takes the paper's "about 15% fewer defects" as a reduction in defect count, which, as noted above, is the authors' reading of a pass-rate result. On those assumptions pairing pays for itself fifteen times over. The inputs, including the 15% figures, come from the paper, which calls 10 hours per defect "a fairly conservative factor" and cites a range of 4 to 16 hours in system test; the lines above only redo the arithmetic.

### Example 2: how fragile that conclusion is

Everything hinges on the cost of a defect. The following variation is not from the paper. Keep the extra 150 hours and the 225 avoided defects, and vary the hours per defect, including values below the paper's range:

```text
10 hours per defect:  2,250 hours saved  (15 times the cost)
 1 hour  per defect:    225 hours saved  (1.5 times the cost)
0.5 hour per defect:    112.5 hours saved (0.75 times the cost)
```

The break-even defect reduction is 1% at 10 hours, 10% at 1 hour and 20% at half an hour. A team whose tests and continuous integration make defects cheap to fix gets less back from pairing. This follows from the arithmetic and is not a finding of the paper, but it shows why XP practices cannot be valued one at a time: each changes the price of the others.

### Example 3: exploiting without enabling

A team adopts the attractive half of XP: simple design, YAGNI and three-week releases. It skips automated tests and integrates only before a release. In week two a developer must change a discount routine used in four places. With no tests, nobody can tell whether the change broke anything, so people avoid touching shared code, duplication grows, and reviewers start demanding a written design before every change. The team has rebuilt up-front design out of self-defense: the exploiting practices ran on a curve that nothing had flattened.

## Common Misconceptions & Pitfalls

- **"XP means no design."** Fowler says XP is "just test, code, and refactor" only in outside impressions; in practice there is "a new balance between up-front design and refactoring", with room for designing before coding.
- **"Doing Scrum means doing XP."** Scrum's text contains none of these practices. A Scrum team must choose its engineering practices separately.
- **"Pair programming doubles the cost."** In the Utah experiment pairs took about 15% more time, not 100%. Example 2 shows even that result depends on what a defect costs, and the meta-analysis found the benefit is not uniform.
- **"Pick the practices you like."** Examples 2 and 3 show the practices depend on one another. You can choose, as Fowler's own testing-plus-integration experience shows, but only with the dependencies in view.

## Summary

Extreme Programming, developed by Kent Beck from 1996 and published in 1999, supplies what Scrum leaves out: concrete engineering practices, thirteen in Beck's 1999 article and twelve in the later grouped list. In Fowler's account, testing, continuous integration and refactoring flatten the cost of change, which lets evolutionary design, simple design and YAGNI work; remove the enabling practices and the exploiting ones fail. Pair programming shows how to read evidence: a 1999 student experiment reported about 15% more time for about 15% fewer defects, whether that pays off depends on what a defect costs, and a later meta-analysis found the effects depend on the task. Continuous integration, test-driven development and refactoring became freestanding practices, while pairing, the on-site customer (Whole team) and the system metaphor stay contested. `lean-principles-for-software` explains the principles these practices serve.

## Documentation Links

- [Fowler: Is Design Dead?](https://martinfowler.com/articles/designDead.html): the change curve and the enabling versus exploiting distinction.
- [Cockburn & Williams (2000): The Costs and Benefits of Pair Programming](https://web.eecs.umich.edu/~weimerw/2018-481/readings/pairprogramming.pdf): the Utah experiment and the cost model recomputed in Examples 1 and 2.
- [Wikipedia: Extreme programming](https://en.wikipedia.org/wiki/Extreme_programming): origin at C3, the values and the criticisms; a secondary source.
- [Wikipedia: Extreme programming practices](https://en.wikipedia.org/wiki/Extreme_programming_practices): the twelve practices by group, with the planning game phases.
- [Beck (1999): Embracing Change with Extreme Programming](https://chsasank.github.io/classic_papers/extreme-programming-embrace-change.html): a reading copy of the IEEE Computer article, with the flat list of practices.
- [C2 wiki: Extreme Programming Core Practices](https://c2.com/xp/ExtremeProgrammingCorePractices.html): the grouped list, old names and second-edition practices.
- [Hannay et al. (2009): The effectiveness of pair programming, a meta-analysis (abstract)](https://ebse.webspace.durham.ac.uk/ebse-bibliography/the-effectiveness-of-pair-programming-a-meta-analysis/): effects on quality, duration and effort, and the task-complexity moderator.
- [Fowler: Test Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html): attributes TDD to Beck and XP.
- [Poppendieck: Lean Software Development, The Backstory](https://www.leanessays.com/2015/06/lean-software-development-history.html): the observation that Scrum omitted test-driven development and continuous integration.
- [Schwaber & Sutherland: The Scrum Guide](https://scrumguides.org/scrum-guide.html): the 2020 text, with no engineering practices.
- [Agile Manifesto: Principles](https://agilemanifesto.org/principles.html): the sustainable development principle behind sustainable pace.
