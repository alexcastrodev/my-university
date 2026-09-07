---
version: 1.0
updatedAt: 2026-09-08
---
## Learning Objectives

- Define a functional requirement precisely: a statement of a specific behavior the system must exhibit given a specific input.
- Define a non-functional requirement precisely: a constraint on the quality, performance, or condition under which functional behavior must hold, not a behavior itself.
- Explain why a missed functional requirement and a missed non-functional requirement fail differently in practice, and why the second is systematically more dangerous.
- Classify a batch of real, concrete requirement statements correctly, including at least one statement that looks functional but is actually a disguised non-functional requirement.

## Context & Motivation

`requirements-elicitation-specification-and-validation` established that a specification must be precise enough for two engineers to build the same thing from it. This concept sharpens that precision one level further by naming a distinction every real specification has to get right: whether a given requirement states *what* the system does, or *how well* (or under what constraint) it must do it. Sommerville's textbook draws this line as the functional versus non-functional distinction, and it is not a pedantic classification exercise. The two kinds of requirement are verified differently, fail differently in production, and, as `from-requirements-to-architecture-decisions` shows later in this discipline, drive genuinely different downstream decisions: a functional requirement mostly constrains what code gets written, while a non-functional requirement frequently constrains which architecture is even viable in the first place.

## Core Theory

### Functional requirements: specific behavior, specific input

A functional requirement states a discrete, checkable behavior: "given a valid username and password, the system must authenticate the user and issue a session token." It is verified by exercising the system with a specific input and checking a specific output or effect, exactly the kind of statement `unit-integration-and-system-testing` (`software-construction`) already teaches how to test at every level from unit to system. A functional requirement that is missing or wrong produces a clear, reportable defect: a user tries to log in, the specific behavior does not happen, someone files a bug.

### Non-functional requirements: quality attributes and constraints

A non-functional requirement constrains a quality attribute of the system as a whole, or of some functional behavior, rather than stating a new behavior of its own: "the authentication endpoint must respond within 300 milliseconds for 99% of requests," "the system must remain available during a single data center outage," "the codebase must allow a new payment provider to be added without modifying existing provider code." None of these three sentences describes a new thing the system does; each constrains how well, how reliably, or how flexibly an existing or planned behavior must hold up.

```text
FUNCTIONAL:      "The system authenticates a user with a valid
                  username and password."
                  -> verified by: exercise with specific input,
                     check specific output.

NON-FUNCTIONAL:  "The authentication endpoint responds within
                  300ms for 99% of requests."
                  -> verified by: load testing, measuring a
                     distribution across many requests, not a
                     single pass/fail check on one input.
```

### Why the two fail differently in production

A missing functional requirement produces a visible defect the moment someone exercises the missing behavior; it is loud, specific, and easy to attribute to a cause. A missing or underspecified non-functional requirement is systematically quieter and more dangerous: a system with every functional requirement correctly implemented can still be entirely unusable under real load, entirely insecure against a real attacker, or entirely unmaintainable after six months of feature work, and none of those failures shows up as a single failing test case the way a functional bug does. This is exactly why `scalability-and-maintainability-principles` (`system-design-concepts`) frames scalability and maintainability as load parameters and an operability-simplicity-evolvability triad rather than as pass/fail checks: non-functional quality is measured on a spectrum under realistic conditions, not verified with a single input.

### A common non-functional category: ISO 25010's quality characteristics, named honestly

Real non-functional requirements cluster into well-known categories: performance (latency, throughput), reliability (availability, fault tolerance), security, usability, maintainability, and portability, among others. This concept does not claim these categories are exhaustive or perfectly separable (a security requirement and a reliability requirement often interact directly, as `from-requirements-to-architecture-decisions` will show), only that naming the category a given requirement falls into is a genuinely useful step toward writing it precisely enough to verify.

## Worked Examples

### Example 1: classifying a batch of requirements

```text
1. "Users can reset their password via an emailed link."      -> Functional
2. "Password reset emails must be delivered within 60
    seconds of the request, 95% of the time."                 -> Non-functional (performance)
3. "The system must support at least 50,000 concurrent
    active sessions."                                          -> Non-functional (scalability)
4. "A locked-out user can unlock their account after
    three failed attempts by contacting support."              -> Functional
5. "All stored passwords must be hashed, never stored
    in plaintext."                                              -> Non-functional (security)
```

Statement 1 and statement 2 look similar (both are about password reset) but classify differently: 1 states a specific behavior the system performs; 2 constrains how fast that behavior must occur across many occurrences, not what the behavior is.

### Example 2: a functional requirement disguised as a design instruction

"The system must use a message queue to process orders." Read literally this sounds like an architecture decision, not a requirement at all, and it is a common, real specification mistake: it smuggles in a specific implementation choice (a message queue) as if it were a stakeholder need. The actual underlying requirement is almost always non-functional: perhaps "order processing must continue accepting new orders even if the payment provider is temporarily unavailable" (a reliability requirement), which a message queue happens to be one reasonable way to satisfy, but is not itself the requirement. Writing the implementation choice into the requirement forecloses `from-requirements-to-architecture-decisions`'s job before it starts, and a validation review (`requirements-elicitation-specification-and-validation`) should catch and rewrite statements like this back to the real underlying need.

### Example 3: two systems that pass every functional test and still fail

A team ships a search feature. Every functional test passes: search for an exact title returns the right result, search for a partial match returns a reasonable result set, search with no results shows the correct empty state. Three weeks after launch, real traffic reveals the search endpoint takes 4 seconds to respond under normal load, because no non-functional requirement was ever written for search latency, and no load test ever exercised it. The functional requirements were correct and completely implemented; the missing non-functional requirement produced a real production failure invisible to every test the team actually ran.

## Common Misconceptions & Pitfalls

- **"Non-functional requirements are optional or 'nice to have.'"** Example 3 shows a fully correct functional implementation can still be an unusable, failed product if a non-functional requirement (latency, in that case) was never written down and verified; non-functional requirements are not a lower-priority add-on to functional ones.
- **"An architecture decision written into a requirement is just being specific."** Example 2 shows this specifically forecloses the actual downstream decision (`from-requirements-to-architecture-decisions`) and usually hides the real, verifiable non-functional need underneath a premature implementation choice.
- **"You can verify a non-functional requirement the same way you verify a functional one, just check it once."** The distinction in Core Theory is explicit: a non-functional requirement is verified as a distribution under realistic conditions (a percentage of requests within a latency bound, availability over a real time window), not as a single pass or fail on one input, which is exactly why non-functional testing (load testing, chaos testing) is a genuinely different activity from functional testing.

## Summary

A functional requirement states a specific behavior given a specific input, and is verified the same way `unit-integration-and-system-testing` already teaches: exercise it, check the output. A non-functional requirement instead constrains a quality attribute (performance, reliability, security, maintainability) across many occurrences or under realistic conditions, and is verified as a measured distribution, not a single pass or fail check. The two fail differently in production: a missing functional requirement produces a loud, specific, easily attributed bug, while a missing non-functional requirement can leave a system that passes every functional test still fundamentally unusable once real load, real attackers, or real maintenance pressure arrive. Writing an implementation choice directly into a requirement statement, rather than the underlying non-functional need it is meant to satisfy, is a common real mistake that forecloses the genuine architecture decision this discipline treats separately in `from-requirements-to-architecture-decisions`.

## Documentation Links

- [Sommerville: Software Engineering (10th Edition, Pearson)](https://www.pearson.com/en-us/subject-catalog/p/software-engineering/P200000003258/9780137503148): the standard textbook source for the functional versus non-functional distinction and the common non-functional categories used in this concept's classification examples.
- [IEEE Computer Society: SWEBOK v4.0 Guide](https://www.computer.org/education/bodies-of-knowledge/software-engineering): the Software Requirements knowledge area this classification belongs to, alongside elicitation, specification, and validation.
