---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State what human-computer interaction (HCI) studies, using a published working definition, and say what that definition covers beyond screens.
- Describe any interaction through three variables: who the users are, what task they are doing, and the context they do it in.
- Explain why, from the user's side, the interface is the system, and where that claim stops being useful.
- Separate interface design from visual design, using a documented failure in which the look of the screen was not the main cause.
- Read an incident report or a field study and say what it found, about whom, and how far the finding reaches.

## Context & Motivation

`functional-vs-non-functional-requirements` lists usability among the common non-functional categories, next to performance and security. That placement is fair for a specification, but it can suggest that usability is a property you add to a finished system. HCI starts elsewhere. It asks what happens when a particular person tries to do a particular thing with a system under particular conditions, and it treats the answer as an empirical question.

The rest of this discipline depends on that framing. Perception and memory limits, predictive models, usability tests, accessibility, and internationalization are all ways of asking about one of the three variables introduced here. Findings in this field also come with conditions attached, so a large part of learning HCI is learning to ask who was studied, doing what, on which device.

## Core Theory

### A working definition

The definition most often repeated comes from the 1992 ACM SIGCHI curriculum group, and the HCI Bibliography displays it as: "Human-Computer Interaction (HCI) is a discipline concerned with the design, evaluation and implementation of interactive computing systems for human use and with the study of major phenomena surrounding them."

Two parts of that sentence matter. First, it joins making (design, evaluation, implementation) with studying (the "phenomena surrounding them"), so the field is both an engineering practice and an empirical science. Second, it says "systems", not "screens". A phone tree, a car dashboard, and a checklist that staff follow around a console can all fall inside it. The term itself was popularized by the 1983 book *The Psychology of Human-Computer Interaction* by Card, Moran, and Newell.

### Users

"The user" is rarely one person. Useful descriptions name what changes performance: domain knowledge, experience with this system, physical and sensory abilities, language, and motivation. One person also occupies several positions over time, from first use to daily expert, and a return visit after six months can resemble first use. Nielsen's usability components reflect this by listing learnability, efficiency, and memorability separately.

The person building the system is usually a poor stand-in. NN/g's article on mental models names the gap between designers' and users' mental models as one of the biggest dilemmas in usability. A designer knows how the system works, and that knowledge cannot be switched off.

### Tasks

A goal and a task are different. The goal survives a redesign ("pay this invoice"). The steps belong to the current design ("open the bank app, find the code, copy it, paste it"). Separating them matters because a step that exists only because of the design can be removed, while a goal cannot.

Tasks differ in frequency, in the cost of an error, and in whether an error can be undone. A rare, irreversible action deserves a different design from a frequent, reversible one. Nielsen also separates usability from utility, which asks whether the design does what users need at all. An easy flow for the wrong task still fails.

### Context

Context of use is everything around the person and the task that changes the outcome:

- **Physical**: lighting, noise, gloves, one free hand, a moving train.
- **Social and organizational**: who else is present, who supervises, what procedures say, shift changes, pressure of time.
- **Technical**: network quality, device age, other software, the data the system actually receives.

`usability-and-its-definition-iso-9241-11` turns this idea into a definition: usability is always stated for specified users, goals, and context. There is no context-free answer to "is this usable?", in the same way there is no load-free answer to "is this fast?".

### The interface is the system, from the user's side

Users do not see the architecture. They see what the system shows, and what happens after they act. From those observations they build a mental model, which NN/g defines as what the user believes about the system. `mental-models-and-the-gulfs-of-execution-and-evaluation` develops that idea. Two consequences follow here.

A system that is correct internally can still be wrong for its user. If a payment succeeded and the screen shows a spinner that never ends, the person will reasonably pay again.

The "interface" is also wider than the visible layout. It includes wording, defaults, error messages, latency, notifications, and the procedures around the software.

The claim has a limit. It describes what the user can observe, and it does not make internals unimportant. A database outage reaches the user as an interface problem, but the fix is in the database. The claim tells you where to measure, not where every cause lives.

### Not visual design alone

Visual design decides how information looks: hierarchy, color, type, spacing. It matters, and `human-perception-and-cognition-for-interface-design` shows why grouping and layout change what people perceive. HCI asks a different question, and with different evidence: did this person complete this task, how long did it take, what went wrong, and would it still work under other conditions? A polished screen can fail that test, and a plain one can pass it. The two are not rivals. Visual design is one of several layers that HCI evaluates, along with task flow, wording, feedback, and the surrounding procedure.

### How the field knows things

HCI uses controlled experiments, like those behind `fitts-law-and-hicks-law`, plus usability tests, interviews, and field observation. Each trades control for realism. An experiment isolates one variable with a narrow group of participants in a narrow task. A field study sees real conditions but cannot isolate causes as cleanly. Neither result transfers automatically, which is why the question "for which users, task, and context?" recurs through this discipline.

## Worked Examples

### Example 1: one feature, three contexts

The table is a constructed illustration. The people and settings are fictional, and no study produced it. The feature is the same in each row: reset a forgotten password.

| Variable | Office worker, desktop | Warehouse picker, shared scanner | Retiree, phone on a bus |
|---|---|---|---|
| Users | Daily computer use | Trained on one app only | Occasional use, larger text set |
| Task | Regain access, low urgency | Regain access mid-shift, every minute counts | Regain access to pay a bill today |
| Context | Second screen, email open | Gloves, no personal email on device | One hand, weak signal |
| Likely failure | Few | Reset link goes to an inbox the scanner cannot open | Code expires before it arrives |

The emailed link is correct in all three rows and fails in the second, because of who holds the device and where. Nothing about the visual design of the reset page would change that.

### Example 2: the Hawaii false missile alert, 2018

On January 13, 2018, the Hawaii Emergency Management Agency sent a live alert stating that a ballistic missile was inbound and ending "THIS IS NOT A DRILL". There was no missile. The correction through the same alert channels took 38 minutes. This is the Federal Communications Commission's account, from its April 2018 report.

The incident is often retold as a slip on a badly designed menu. The report's main finding is different. It describes the primary human error as a failure to hear or properly understand instructions indicating that the exercise was a test. The officer at the terminal reportedly believed that the threat was real, and the report concludes that the employee intended to initiate a real-world alert. The officer declined to be interviewed by the FCC, so this account rests on a written statement relayed by the agency, other staff, and a press interview.

The software still had weaknesses, which the report records:

- Live alerts and internal tests were sent from the same interface with the same log-in, and the drop-down listed "Test missile alert" together with "Missile alert" on one screen.
- The confirmation prompt read the same for a test and a live alert, and did not show the text about to be sent.

Sorted by the three variables, the report's other findings look like this:

| Variable | Finding in the report |
|---|---|
| Users | Other officers on shift understood it was a drill, and this one did not; the agency's own report notes earlier concerns about this employee |
| Task | The drill script mixed in the phrase "This is not a drill" from the live message |
| Context | The drill ran at a shift change, without notice, the day supervisor was not in the watch center, and no second officer had to confirm |

The sorting is an inference for this lesson, and the report does not use these categories. Because the officer intended to send a live alert, a sharper visual distinction between two menu items would not obviously have stopped it. That is the lesson: the failure lived in the wording of a procedure, in staffing, and in safeguards, and those are all part of the interface in the wide sense. Users matter in another way too. The report describes deaf members of a national association who sheltered in a windowless room, where they could not get radio or television broadcasts saying the alert was false.

### Example 3: an accurate model in a real clinic

Beede and colleagues (CHI 2020) studied a deep learning system for detecting diabetic eye disease in use in clinics in Thailand. The method was observation and interviews with nurses across eleven clinics. The abstract's central finding is a tension between the model's thresholds for data quality and the quality of data that arise in an imperfect, resource-constrained environment.

Google's summary of the work adds concrete detail: lighting varied among clinics and could affect image quality, and the system could conservatively label images with blur or dark areas as "ungradable". In the terms of this lesson, the users were nurses in a screening workflow, and the context included the room and the equipment. The study is qualitative and concerns these clinics. It shows that lab performance does not settle how a system behaves in a given setting, and it does not give a rate that applies elsewhere.

### Example 4: which variable does a change touch?

A fictional team proposes four changes to an expense-approval app. Sorting them shows which ones can affect task completion, and what evidence each would need.

| Proposed change | Layer | Evidence that would show it worked |
|---|---|---|
| New palette and icons | Visual | Preference, plus a check that contrast did not get worse |
| Fill in the cost center from the employee record | Task | Fewer fields typed, fewer rejected claims |
| Queue approvals when offline | Context | Completion rate on poor connections |
| Larger buttons | Users and context | Error rate for the people and devices actually in use |

Only the first is purely visual. It may still be worth doing, but it cannot claim a faster task unless the task was measured.

## Common Misconceptions & Pitfalls

- **"HCI is UI design."** The 1992 definition includes evaluation, implementation, and the study of surrounding phenomena. Example 2 is mostly about procedures.
- **"The operator clicked the wrong item."** In Example 2, the investigators concluded otherwise. Check the report before repeating the short version of an incident.
- **"Human error" as a conclusion.** The report names a human error and then lists the safeguards whose absence let it through. Stopping at the first half explains little.
- **"Our users are like us."** Builders know how the system works, and users cannot.
- **"A good result in the lab will carry over."** Example 3 shows how the environment can change what a system does. The reverse also holds: a field finding from eleven clinics is not a universal rate.
- **"Usable" with no qualifier.** Say for whom, doing what, and where.

## Summary

HCI studies interactive systems for human use, joining design, evaluation, and implementation with the study of the surrounding phenomena. Three variables organize that work: users, tasks, and context. From the user's side, the interface is the system, because what it shows and does is all the person can observe, and the interface extends to wording, latency, and procedures. Visual design is one layer of this, and it does not answer whether the task succeeded. The Hawaii report and the Thai clinic study both show failures that a look at the screen would not reveal, and each finding holds for its own people and setting.

## Documentation Links

- [HCI Bibliography](https://hcibib.org/): displays the 1992 SIGCHI Curriculum Development Group definition of HCI.
- [Wikipedia: Human-computer interaction](https://en.wikipedia.org/wiki/Human%E2%80%93computer_interaction): overview of the field and the origin of the term.
- [Nielsen (2012, reviewed 2026): Usability 101](https://www.nngroup.com/articles/usability-101-introduction-to-usability/): the five quality components and the distinction between usability and utility.
- [Chan (2024): Mental Models and User Experience Design](https://www.nngroup.com/articles/mental-models/): what a mental model is, and the gap between designers and users.
- [FCC (2018): Report on the Hawaii False Alert](https://docs.fcc.gov/public/attachments/DOC-350119A1.pdf): timeline, causes, and safeguards in the January 13, 2018 incident.
- [Beede et al. (2020): A Human-Centered Evaluation of a Deep Learning System Deployed in Clinics](https://research.google/pubs/a-human-centered-evaluation-of-a-deep-learning-system-deployed-in-clinics-for-the-detection-of-diabetic-retinopathy/): abstract of the field study in eleven clinics in Thailand.
- [Google (2020): Healthcare AI systems that put people at the center](https://blog.google/innovation-and-ai/technology/health/healthcare-ai-systems-put-people-center/): the authors' organization summarizing the same fieldwork, including lighting and ungradable images.
