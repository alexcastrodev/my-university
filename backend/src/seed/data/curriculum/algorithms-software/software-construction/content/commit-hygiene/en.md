---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why a commit is a unit of communication to future readers, not merely a save point in a tool.
- Distinguish an atomic commit (one logical change) from a commit that bundles several unrelated changes together.
- Write a commit message whose body explains *why* a change was made, not merely restate what the diff already shows.
- Evaluate whether a given commit message would still be useful to someone (including its own author) reading it months later with no other context.
- Identify the practical cost a project pays when its commit history is inconsistent or uninformative.

## Context & Motivation

Once a team has adopted feature branches and an always-working main line, a subtler question remains: what should any *individual* commit actually look like? Git will happily accept a commit that bundles a bug fix, a rename, an unrelated formatting pass, and a half-finished new feature all in one, with a message that just says "updates" — nothing about git's mechanics prevents this. But a commit is not only a mechanism for saving a snapshot; it is also, whether or not the author thinks of it this way, a message left for whoever reads the project's history later — a reviewer deciding whether to approve a change, a teammate trying to understand why a particular line looks the way it does, or the original author themselves, six months on, having long since forgotten the reasoning that seemed obvious at the time.

This is precisely the gap Missing Semester's treatment of git tooling points at when it moves past raw mechanics into how commits are actually used on real projects: the commit log is a project's most detailed, most precise record of *why* the code looks the way it does, available nowhere else — not in a design document, not in a comment, because comments describe the current state of the code while a commit message can describe the reasoning behind a *change*, including alternatives that were considered and rejected. ACM/IEEE's CS2013 software-engineering guidelines treat this kind of project-history discipline as a real, assessable practice, not a matter of personal taste, precisely because a project's history either functions as a usable resource for the team or it doesn't, and that outcome is determined entirely by whether individual commits were made with any discipline.

The core insight worth internalizing is a specific one: the diff attached to a commit already shows *what* changed, in exact, unambiguous detail — every added and removed line is right there. What the diff can never show, no matter how carefully it's read, is *why* that change was the right one to make, what problem it was solving, what alternative was considered and rejected, or what would break if it were reverted. A commit message that only restates the diff in prose ("changed the loop condition") adds nothing a reader couldn't already see for themselves; a commit message that explains the reasoning behind the change is the only place that reasoning is recorded at all.

## Core Theory

### A commit as a unit of communication, not just a save point

Treating a commit as "just a save point" leads naturally to committing whenever it's convenient, with whatever happens to be in progress, and describing it however quickly comes to mind — the equivalent of hitting Ctrl+S. Treating it instead as a deliberate unit of communication means asking, before committing, two separate questions: does this commit represent one coherent, describable change (not several unrelated ones bundled together), and does its message explain that change in a way a reader with no other context could actually use? Both questions matter independently — a well-described commit that bundles three unrelated changes is still hard to review, revert, or understand in isolation, and an atomic, focused commit with an uninformative message still fails to communicate anything useful about why it exists.

### Atomic commits: one logical change per commit

An atomic commit contains exactly the set of changes needed to accomplish one coherent purpose — fixing one bug, adding one small piece of functionality, renaming one thing consistently — and nothing else. The practical payoff shows up specifically when something later needs to be undone, reviewed, or understood in isolation: `git revert` on an atomic commit cleanly undoes exactly one logical change; `git revert` on a commit that bundled a bug fix together with an unrelated formatting pass either undoes both together or requires manually untangling them after the fact. Similarly, a reviewer examining one atomic commit at a time can evaluate "does this one change make sense" as a single, bounded question, rather than trying to hold several unrelated changes in mind simultaneously to judge whether the commit as a whole is acceptable.

### The anatomy of a useful commit message

A commit message that communicates well typically has two parts: a short summary line stating what changed, and — for anything beyond the most trivial change — a body explaining *why* it changed. The summary line exists for skimming a history quickly (`git log --oneline`); the body exists for the moment someone actually needs to understand the change deeply, and it is the body, not the summary, that should carry the reasoning: what problem this solves, why this particular approach was chosen over an alternative that might seem more obvious, and what constraint or bug report motivated it in the first place. None of that is visible in the diff itself — the diff only ever shows the resulting lines, never the reasoning that produced them.

### Why "what changed" is redundant with the diff

Every line of code that changed is already visible, precisely and unambiguously, the moment anyone looks at the commit's diff. A message that just restates this in prose — "changed the retry count from 3 to 5" for a diff that visibly changes `3` to `5` — adds a sentence's worth of text and zero additional information; anyone reading the commit already has the diff open. The only information a commit message can add that the diff cannot is the *why*: "increased the retry count from 3 to 5 because the payment API's own SLA allows for up to 4 seconds of transient 503s under load, and 3 retries at our current backoff schedule wasn't enough margin" is not visible anywhere in the diff, no matter how carefully it's read — it exists only if someone wrote it down.

## Worked Examples

### Example 1 — an uninformative message versus one that explains the reasoning

**Scenario:** the retry logic in a payment-processing client is changed from 3 attempts to 5.

**Diff (identical in both cases):**
```diff
- MAX_RETRIES = 3
+ MAX_RETRIES = 5
```

**Commit message, version A:**
```
fix stuff
```

**Commit message, version B:**
```
Increase payment API retry count from 3 to 5

Under sustained load, the payment provider's own status page documents
up to 4 seconds of transient 503 responses before recovering. At our
current exponential backoff schedule (200ms, 400ms, 800ms), 3 retries
only covers about 1.4 seconds of margin — not enough to ride out a
typical transient outage. Bumped to 5 retries (up to ~6.2 seconds of
margin) after confirming with the on-call payments engineer that this
still stays under our own request-timeout budget of 10 seconds.

Fixes the intermittent "payment failed" reports from ticket PAY-482,
which line up exactly with provider-side 503 spikes in the logs.
```

Both messages sit on top of the identical one-line diff. Version A tells a future reader nothing they couldn't already see by reading the diff itself — "fix stuff" doesn't even specify which of the two numbers was the problem. Version B answers every question someone revisiting this line months later would actually have: why 5 and not some other number, why this doesn't risk violating the overall timeout budget, and which real user-facing symptom motivated the change at all — none of which the diff could ever show on its own, no matter how long it's stared at.

### Example 2 — a bundled commit versus splitting it into atomic ones

**Scenario:** while fixing a bug in `calculate_discount()`, a developer also notices some unrelated code nearby that's inconsistently formatted, and reflexively cleans it up in the same sitting.

**Bundled (non-atomic) commit:**
```
commit 8f3a21c
Message: "fix discount bug and clean up code"

Diff touches:
 - calculate_discount(): fixes an off-by-one in a percentage calculation
 - format_receipt(): reformatted (whitespace, quote style) — unrelated to the bug
 - apply_tax(): reformatted (whitespace) — also unrelated
```

Three months later, `apply_tax()`'s reformatting turns out to have introduced a subtle change in float rounding that nobody caught in review because it was buried among 40 lines of unrelated whitespace diff. Reverting just the tax-rounding regression means either reverting this entire commit — which also undoes the correct discount-bug fix and the harmless receipt reformatting — or manually picking apart which lines belong to which of the three unrelated changes.

**Split into atomic commits:**
```
commit A: "Fix off-by-one in calculate_discount() percentage math"
  (touches only calculate_discount())

commit B: "Reformat format_receipt() for consistent quote style"
  (touches only format_receipt())

commit C: "Reformat apply_tax() whitespace"
  (touches only apply_tax())
```

With the work split this way, the tax-rounding regression can be reverted with `git revert <commit-C-hash>` alone — undoing exactly the change responsible, and nothing else. The discount fix and the receipt reformatting remain untouched, because they were never entangled with the change that caused the problem in the first place.

## Common Misconceptions & Pitfalls

- **"Commit messages are a formality nobody actually reads."** They are read constantly, just not always by the original author, and not always right away — by a reviewer deciding whether to approve a change, by `git blame` when someone is trying to understand why a specific line exists, by the original author themselves after enough time has passed that the reasoning is no longer memory, only history.
- **"Committing often means committing whatever is currently in the working directory."** Committing often is good practice, but each commit still needs to represent one coherent, describable change — "commit often" is not license to bundle three unrelated edits together just because they happened to exist at the same moment; splitting them, as in Example 2, costs little and pays off substantially later.
- **"The diff already explains everything, so the message can just say what changed."** The diff shows *what* changed with perfect precision and can never show *why* — Example 1 demonstrates this directly: the diff is identical in both versions, and only the message that explains the reasoning gives a future reader anything the diff itself couldn't already tell them.
- **"A long commit message means the change was complicated or risky."** Message length should track how much context a reader would otherwise be missing, not how large the diff is — a one-line diff can deserve several sentences of explanation (Example 1), while a large, mechanical, self-explanatory change (a straightforward rename applied everywhere) may need barely more than its summary line.
- **"Cleaning up unrelated code while fixing a bug is efficient — it saves a second trip."** As Example 2 shows, bundling unrelated changes into one commit trades a small convenience now for a real cost later: harder reviews, harder reverts, and a history where "what actually caused this regression" requires untangling several unrelated edits after the fact.

## Summary

A commit is best understood as a unit of communication aimed at a future reader — a reviewer, a teammate, or the original author months later — not merely a mechanism for saving progress. Two disciplines make that communication actually useful: keeping each commit atomic, so it represents exactly one logical, describable change and can be reviewed or reverted in isolation; and writing a message whose body explains *why* the change was made, since the diff itself already shows *what* changed in full, unambiguous detail and adds nothing when merely restated in prose. A bundled commit and an uninformative message both cost real time later — in confused reviews, in tangled reverts, in a history that no longer answers the one question it exists to answer: why does the code look the way it does.

## Documentation Links

- [The Missing Semester of Your CS Education (MIT)](https://missing.csail.mit.edu/) — doc
- [ACM/IEEE CS2013 — Software Engineering Knowledge Area](https://csed.acm.org/knowledge-areas-software-engineering-se-cs2013-version/) — doc
