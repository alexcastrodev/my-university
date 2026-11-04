---
version: 1.0
updatedAt: 2026-11-03
---
## Learning Objectives

- State precisely what the Scrum Guide says about forecasting tools, and which popular terms (velocity, story points) it never uses.
- Compute a velocity range from sprint history and turn it into a delivery forecast, for both a fixed date and a fixed scope.
- Read a burndown chart and a burnup chart for the same project, and explain why only the burnup separates progress from scope change.
- Explain why velocity is a planning aid for one team and not a measure of productivity, and recognize the symptoms of its misuse.

## Context & Motivation

`user-stories-epics-and-the-product-backlog` ended with items that have sizes. Sizes exist so the team can answer the question stakeholders always ask: when will it be done, or how much will be done by a date? `estimation-and-risk-in-software-projects` argued that an honest estimate is a range, and the same applies here.

The Scrum Guide is restrained on this point. In the text of the 2020 edition, the words "velocity", "story point" and "estimate" do not appear. On sizing it says only that "The Developers who will be doing the work are responsible for the sizing." The Developers' confidence in a Sprint forecast depends on knowing "their past performance, their upcoming capacity, and their Definition of Done". And in the section on the Sprint it says: "Various practices exist to forecast progress, like burn-downs, burn-ups, or cumulative flows. While proven useful, these do not replace the importance of empiricism. In complex environments, what will happen is unknown. Only what has already happened may be used for forward-looking decision making."

So burn-downs and burn-ups are named, as options, and velocity is not named at all. Velocity appears in XP's planning game, where the developers determine the speed at which they can perform (Wikipedia, XP practices). This lesson treats these charts and numbers as tools whose value depends on how they are used.

## Core Theory

### Sizing and velocity

Teams commonly size items in **story points**: a relative estimate of how large an item looks next to items the team already understands. In Mike Cohn's explanation a point estimate does not say that an item will take three days, and a five for one team may not mean the same as a five for another. **Velocity** is then the total size of the items a team completed in an iteration. The convention is to count only items that are fully Done; this matches the Scrum Guide's rule that "Work cannot be considered part of an Increment unless it meets the Definition of Done". Partial credit would hide unfinished work in the number meant to predict finished work.

### Forecasting with a range

A single average hides the normal variation between iterations. Cohn recommends a **velocity range** taken from recent history. Two questions then have simple answers:

```text
Fixed date:   sprints remaining x low velocity  ..  x high velocity
              = how much can probably be delivered by the date
Fixed scope:  remaining size / high velocity  ..  / low velocity
              = how many sprints it will probably take
```

Cohn also adds an allowance for work not yet discovered, because backlogs grow, and updates the forecast after every sprint, in line with the Guide's empiricism.

### Burndown and burnup

A **burndown chart** plots remaining work against time. It usually carries an "ideal" line from the starting total straight to zero. Some practitioners object to the name, because the line is a calculation from estimates, and estimates are more likely to be wrong than the work (Wikipedia, Burn down chart), so it is a reference line and not a target. A **burnup chart** plots completed work rising over time, together with a separate line for total scope.

The difference matters whenever scope changes. Remaining work equals total scope minus work done, so on a burndown a new item looks identical to lost progress: the line rises or flattens, and the reader must guess which happened. On a burnup, progress shows on one line and scope on the other. The Scrum Guide lists both, plus cumulative flow (see `kanban-and-flow-based-process`), as forecasting practices without ranking them.

### Why velocity is not productivity

Martin Fowler's "Cannot Measure Productivity" (2003) gives the underlying reason: productivity is output divided by input, and "we can't measure output". He rejects lines of code, is unconvinced by function points, and holds that "any true measure of software development productivity must be based on delivered business value". Velocity does not escape the problem: it is the team's own estimate of size, in its own private unit.

Once velocity becomes a target, it stops describing anything. Cohn says velocity "should support forecasting, not become a performance target", and warns that fixing a conversion between points and days creates pressure: "Stakeholders treat estimates as commitments. Managers compare point totals across teams. Velocity becomes a target. Teams inflate estimates to protect themselves." The Wikipedia article on velocity invokes Goodhart's law in its popular wording, that any measure which becomes a target ceases to be a good measure. That wording is a later paraphrase (Marilyn Strathern's, 1997), not Goodhart's own sentence; `software-quality-metrics` gives the original and the attribution. The Agile Manifesto's own principle is that "Working software is the primary measure of progress".

Book vs today: velocity and story points belong to the practitioner literature, not to the 2020 Scrum Guide, which names no unit and treats the charts as optional practices. Flow measures, such as cycle time and flow efficiency (`kanban-and-flow-based-process`, `lean-principles-for-software`), are an alternative when work does not fit stable iterations.

## Worked Examples

### Example 1: a forecast from six sprints

Invented velocities for six completed sprints: 21, 28, 24, 30, 26, 23. The mean is 25.3, the range 21 to 30. The remaining backlog is 180 points.

```text
Using the mean only:  180 / 25.3 = 7.1 -> "8 sprints"
Using the range:      180 / 30 = 6.0 -> 6 sprints   (best case)
                      180 / 21 = 8.6 -> 9 sprints   (worst case)
With 15% allowance for undiscovered work: 180 x 1.15 = 207
                      207 / 30 = 6.9 -> 7 sprints
                      207 / 21 = 9.9 -> 10 sprints
```

The honest statement is "7 to 10 sprints", not "8". For a fixed date with six sprints left, the same history gives 6 x 21 = 126 to 6 x 30 = 180 points of capacity, mean 152. Apply the same 15% allowance: if known work is only 1/1.15 of what will really be asked for, 126 points of capacity cover about 110 points of the known backlog, 152 cover about 132 and 180 cover about 157. Items within the first 110 points of the ordered backlog are likely, those between about 110 and 157 are uncertain, and the rest are unlikely. Taking the lowest and highest of the sprints is how Cohn builds the range in his own worked example, where six velocities from 27 to 36 become "between 27 and 36".

### Example 2: one project on a burndown and on a burnup

Total scope starts at 120 points. The team completes 20, 22, 18, 21, 19 and 20 points in sprints 1 to 6 (mean 20). The Product Owner adds 15 points in sprint 3 and 10 in sprint 5.

```text
Sprint  scope  done (cum.)  remaining  ideal remaining
  1     120       20          100          100
  2     120       42           78           80
  3     135       60           75           60
  4     135       81           54           40
  5     145      100           45           20
  6     145      120           25            0
```

On the burndown, remaining work is 15 above the ideal line in sprint 3 and 25 above it by sprints 5 and 6, which reads as a team falling behind. Those gaps are exactly the 15 and 25 points of scope added. On the burnup, the done line rises by about 20 per sprint, close to a straight line, and the scope line steps up twice. Progress was steady; scope grew. The last 25 points at 18 to 22 per sprint take 25 / 22 = 1.1 to 25 / 18 = 1.4 sprints, so two more: the project finishes in sprint 8, and a stakeholder can see the two extra sprints came from the 25 added points.

### Example 3: velocity as a target

A team completes 8 stories per sprint, sized at 3 points on average, so its velocity is 24. Management sets a goal: "raise velocity by 30%". Nothing about the work changes, but the team starts sizing stories at 3.9 points on average. Velocity becomes 8 x 3.9 = 31.2, up 30%, while users receive the same 8 stories per sprint as before. The metric improved and the output did not, the pattern the popular form of Goodhart's law describes.

## Common Misconceptions & Pitfalls

- **"Scrum requires velocity and a burndown chart."** The Scrum Guide never uses the word velocity or the term story point, and names burn-downs and burn-ups only as examples of practices that exist and "do not replace the importance of empiricism".
- **"Velocity measures how productive a team is, so compare teams."** Example 3 shows how easily a team's unit can be changed, and Cohn says not to compare raw velocities across teams. Fowler's argument is that output itself is hard to measure.
- **"The ideal line is the plan, and being above it means failure."** In Example 2 the team was above the line only because scope grew. The line is built from estimates, so it is a reference, not a target.
- **"Average velocity gives the date."** Example 1 gives 8 sprints for the mean and 7 to 10 for a range with an allowance. A single date states a certainty the data does not have.
- **"Good metrics mean the product is good."** Burn charts count sized items, not whether users benefit.

## Summary

The Scrum Guide mentions burn-downs, burn-ups and cumulative flow as forecasting practices that are useful but "do not replace the importance of empiricism", and it never uses the words velocity or story point. Velocity, which appears in XP's planning game, is the total size of fully Done items per iteration, and the sound way to use it is as a range, applied to remaining size or remaining sprints, with an allowance for undiscovered work and an update after every sprint. A burnup chart separates progress from scope change, which a burndown blurs. Velocity is a team's private planning unit and not a measure of productivity: Fowler argues productivity cannot be measured by output counts at all, and once velocity becomes a target it stops measuring anything, as the 30% example shows.

## Documentation Links

- [Schwaber & Sutherland: The Scrum Guide](https://scrumguides.org/scrum-guide.html): the exact statements on sizing, forecasting, burn-downs and burn-ups, and on the Definition of Done.
- [Agile Manifesto: Principles](https://agilemanifesto.org/principles.html): "Working software is the primary measure of progress."
- [Fowler: Cannot Measure Productivity](https://martinfowler.com/bliki/CannotMeasureProductivity.html): why lines of code and function points do not measure output, and why value is the real measure.
- [Mountain Goat Software: Agile Planning and Forecasting](https://www.mountaingoatsoftware.com/agile/agile-planning-and-forecasting): Cohn's treatment of velocity ranges, fixed-date and fixed-scope forecasts and unknown work.
- [Mountain Goat Software: Story Points](https://www.mountaingoatsoftware.com/agile/story-points): story points as relative size, and the warnings against using velocity as a target or comparing teams.
- [Wikipedia: Burn down chart](https://en.wikipedia.org/wiki/Burn_down_chart): how to read the ideal and actual lines, the objection to the word "ideal", and a short description of burnup charts.
- [Wikipedia: Velocity (software development)](https://en.wikipedia.org/wiki/Velocity_%28software_development%29): the definition and the Goodhart's law caution.
