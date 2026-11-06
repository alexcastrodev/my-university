---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Choose between an interview and contextual inquiry by what each can and cannot show about behavior.
- Attribute contextual inquiry to Beyer and Holtzblatt, and state its four principles and session structure.
- Write interview questions that ask about specific past events and avoid leading the participant.
- Say what makes a persona grounded, and audit one by tracing each claim to evidence.
- Build a hierarchical task analysis with plans, and apply Annett and Duncan's stopping rule.

## Context & Motivation

`usability-testing-and-the-system-usability-scale` needs representative users and representative tasks, and the heuristic evaluation in `nielsens-ten-heuristics-and-heuristic-evaluation` needs realistic scenarios for domain-specific systems. Neither method tells you who those users are or what those tasks should be. That is what user research is for. `requirements-elicitation-specification-and-validation` already showed the core hazard through a hypothetical request for an Excel export that turned out to be a way of emailing a report: asked what they need, people often describe a solution they have already imagined.

Interviews collect what people report, contextual inquiry observes work as it happens, and task analysis structures what was collected. Personas communicate that evidence, and without it they are fiction.

## Core Theory

### Interviews: reported behavior

Rosala and Pernice (2023) class the user interview as attitudinal: it collects reported behaviors, thoughts, and feelings, while a usability test observes behavior with a design. They treat an interview as a study, so it starts from concrete research goals, with a guide of a few open-ended questions and follow-ups. Asking about specific events works better than asking about general processes, because a particular incident jogs memory.

They also name the limits: faulty recollection, missing details (participants do not know what is relevant), and social-desirability bias. Their conclusion is that to know what users actually do, you need to observe them or collect behavioral data. The quality of the data also depends on the interviewer, since leading questions compromise validity.

### Contextual inquiry: Beyer and Holtzblatt

Contextual inquiry was developed by Hugh Beyer and Karen Holtzblatt. Their own account places the first work on Contextual Design at Digital Equipment Corporation in the early 1980s, with Holtzblatt's response to lab-based usability measures, a theoretical foundation published with Whiteside and Bennett in 1988, and the whole process set out in their 1997 book *Contextual Design*. Contextual inquiry is the field-data step of that larger process. Its basis is that work becomes so habitual that people have difficulty articulating what they do and why. So the interviewer observes people working in their own setting and inquires into actions as they unfold, and the two develop a shared interpretation.

Flaherty (2020) gives the master and apprentice model and four principles:

| Principle | Meaning |
|---|---|
| Context | Observe in the natural environment, not a lab or a conference room |
| Partnership | Researcher and user share control of the conversation |
| Interpretation | Build a shared interpretation, checked with the user |
| Focus | Know what the project needs, and let it guide attention |

Her session has four parts: **primer** (rapport, consent, purpose), **transition** (an explicit switch to watching), **contextual interview** (watch, stop at what you do not understand, discuss), and **wrap-up** (play your interpretation back for correction). Beyer and Holtzblatt add that field interviews are restricted to a few hours, unlike ethnography over weeks, because the method has to fit an engineering project.

Flaherty also gives a real case. Redesigning data entry for auto-insurance software, she interviewed specialists, and all three reported pasting batches of vehicle data from a spreadsheet. Observing some of them revealed unmentioned steps: they cross-referenced another tool for missing information, and they pressed Save after each manual entry although the program autosaved. That is one practitioner's account with a small sample, offered as an illustration, and it shows the kind of gap the method targets.

The method does not always fit. Flaherty says it is not especially useful for straightforward targets such as a newsletter signup form, and that direct observation may be the better option when people cannot be interrupted, as with doctors or air traffic controllers.

### Personas: fictional by design, grounded by evidence

A persona is a fictional, yet realistic, description of a typical or target user (Dykes, 2025). The word "fictional" invites the wrong conclusion, because the person is invented while the attributes should not be. Dykes puts it this way: "Personas might be made-up people, but they should be based on information about real people."

The technique's history shows the problem. Pruitt and Grudin (2003) trace abstract user representations to marketing and credit Alan Cooper with focusing them on design, and they say his early personas were rough sketches and that his method later came to include interviews or ethnography. They report on early persona-like efforts at Microsoft, whose first listed problem was that characters were not believable, being designed by committee or having an unclear relationship to data. Their response has parts you can copy:

- Start from existing segmentation and user research, and keep to 3 to 6 personas.
- Keep a foundation document per persona, with footnotes and links that tie each characteristic to its data.
- Run "sanity check" site visits with users who match the persona at a high level, to test the low-level details.

They call having every statement generated from or related to data a "not yet quite achieved goal", so even that team did not reach full traceability. Holtzblatt and Beyer quote Harley Manning: "a persona that's not backed by rich contextual data isn't valid".

A working standard follows from these sources: claims trace to evidence, gaps are marked as assumptions, and the persona is checked against matching people. Dykes adds a filter on content: keep a detail only if it would affect the design or help make a decision. A team that writes a persona without research has written a list of hypotheses. That list can be useful as a research plan, as long as nobody treats it as a finding.

### Hierarchical task analysis: Annett and Duncan

NN/g's Rosala (2020) separates a goal (registering for a service) from a task (filling in a form) and defines task analysis as two stages: gather information on goals and tasks, then analyze them. Her advice is to avoid relying only on self-report or simulation.

The hierarchical approach comes from Annett and Duncan's "Task analysis and training design" (1967). Its setting matters: industrial training, not software interfaces. Their problem was what to describe and at what level of detail, and they warn that setting out to describe everything is "to court disaster". Their rule describes performance in gross terms and asks two questions: what is the probability of inadequate performance without training, and what would inadequate performance cost the system? If the product of the two is unacceptable, the performance is re-described in more detail, and each subordinate operation meets the same rule. Analysis stops when the values are acceptable or when training requirements are clear. So depth varies within one analysis, and they note that estimates can be crude and still help. They add that costs should come from the sponsor, and warn against overlooking the rare but costly emergency.

Later practice calls this the P x C rule and adds **plans**, which state the order and conditions under which subtasks run: sequential, conditional, or iterative. Rosala notes that plans can capture how novices and experts differ. The report speaks of a hierarchical description, and the acronym HTA does not appear in it.

The Usability Body of Knowledge lists limitations worth keeping in mind: no strict rules, so different analysts produce inconsistent hierarchies at different levels of detail; it takes training; and it focuses on existing tasks rather than predicting. Applying the rule to interfaces means reading "without training" as "without help", an adaptation, not Annett and Duncan's claim.

## Worked Examples

Nothing below reports research. No interview, visit, or participant behind these examples exists. The clinic booking site is the fictitious case used in the previous lessons, and all estimates are invented to show the procedure.

### Example 1: rewriting an interview guide

The research goal: understand how patients decide when to book. Compare the questions, not the answers, since no answers exist here.

```text
Weak                                     Better
Do you like booking online?              Tell me about the last time you booked
                                         an appointment. How did it start?
Would a reminder be useful?              What happened the last time you missed
                                         or nearly missed an appointment?
Do you find the calendar confusing?      Walk me through how you chose the date
                                         the last time you booked.
How often do you book?                   When was the last time? And before that?
```

The left column is closed, supplies the idea, or asks for a general habit. The right column anchors on an event and leaves the content to the participant. Even so, the answers remain reports, so anything important goes on the list for observation.

### Example 2: auditing a persona

The persona and the sources are fictitious. The table shows the audit format, and study codes such as V1 stand for records a real project would hold.

```text
Claim about "Marina"                        Evidence         Status
Books for two children as well as herself   V1, V4, I2       traced
Books on the phone during a commute         analytics Q2     traced
Compares two clinics before choosing        I3, I5           traced
Reads the date field as DD/MM               T2 (2 sessions)  traced
Dislikes phone calls to the reception       I1, I2, I5       traced
Is 34 years old                             none             decorative
Would pay for faster appointments           none             assumption
Trusts doctors with more reviews            none             assumption
```

Five of eight claims trace to evidence, or 62.5%, a number that describes this audit and carries no standard threshold. The age has no source and, unless it changes a design decision, fails Dykes's filter, so it can stay only as a memorable detail. The two assumptions are the useful part: they become questions for the next round, and neither should justify a feature yet.

### Example 3: a persona-weighted priority

Pruitt and Grudin describe a matrix scoring each feature per persona, from $-1$ (harmed) to $+2$ (loves it), with weights by market share. Here the features, scores, and weights are invented.

```text
                        P1   P2   P3     weights 60/30/10   weights 40/30/30
Rebook in two taps       2    1    0     150                110
Family accounts          2   -1    1     100                 80
SMS reminders in bulk    0    1    2      50                 90
Printed receipt         -1    0    2     -40                 20
```

Under 60/30/10, family accounts rank second. Under 40/30/30, SMS reminders do. The order depends on the weights, so the weights need evidence as much as the persona does. The sum looks objective while it inherits every judgment in its cells.

### Example 4: an HTA with a stopping rule

Goal: book a slot on the stated date. Probabilities and costs (on a scale of 1 to 5) are invented estimates, and the threshold of 0.5 is a project choice. In a real analysis the sponsor would set costs and research would inform the probabilities.

```text
0 Book the appointment
  Plan 0: do 1; if not signed in do 2; then 3, 4, 5.
  1 Reach the booking entry        P=.05 C=1  PxC=.05  stop
  2 Identify the patient           P=.15 C=2  PxC=.30  stop
  3 Choose specialty and doctor    P=.10 C=2  PxC=.20  stop
  4 Choose date and time           P=.25 C=5  PxC=1.25 re-describe
    Plan 4: do 4.1 and 4.2; do 4.3; if the summary is wrong, return to 4.1.
    4.1 Read the calendar          P=.20 C=5  PxC=1.00 re-describe
        4.1.1 Recognize date order P=.20 C=5  PxC=1.00 flag for design
        4.1.2 Tell weekday by date P=.05 C=3  PxC=.15  stop
    4.2 Pick a free slot           P=.05 C=3  PxC=.15  stop
    4.3 Check the summary          P=.15 C=5  PxC=.75  flag for design
  5 Confirm and keep the proof     P=.10 C=3  PxC=.30  stop
```

Depth is uneven, as the rule intends: step 1 stays a single line, and step 4 goes two levels down. At 4.1.1 and 4.3 the requirement is clear, the rule's other way of ending, and here it is a design question. Annett and Duncan themselves remark, about movements that conflict with everyday habits, that job redesign may be more rational than training. Plan 0 records that a signed-in user skips step 2, which is how an analysis holds novices and repeat users in one tree.

Estimates carry the decision. If step 2 had $P=0.30$, the product would be 0.60 and it would need re-description too. So state the estimates and revisit them when data arrive. The high-product leaves also suggest tasks for a usability test, and a scenario for heuristic evaluators.

## Common Misconceptions & Pitfalls

- **"We interviewed users, so we know what they do."** Interviews report. The insurance case shows the gap between report and practice, and observation is what closes it.
- **"A persona is research."** It communicates research. Without the trace, it is a set of guesses with a photo.
- **"More personal detail makes it more real."** Details that change no decision only distract, as Dykes warns.
- **"HTA was invented for UX."** Annett and Duncan wrote about industrial training, and interface work adapted it.
- **"An HTA must reach keystrokes."** The stopping rule exists to prevent that. Completeness is the failure they warned about.

## Summary

Interviews collect reported behavior, and they work best anchored on specific past events, with their limits stated. Contextual inquiry, from Beyer and Holtzblatt, observes real work in place and builds a shared interpretation through context, partnership, interpretation, and focus. A persona is fictional as a character and should be factual in its attributes: claims trace to evidence, assumptions stay labeled, and a check with new people tests it. Hierarchical task analysis, from Annett and Duncan's 1967 work on training, re-describes a task only where the probability of failure times its cost is unacceptable, and plans record order and conditions.

## Documentation Links

- [Rosala and Pernice (2023): User Interviews 101](https://www.nngroup.com/articles/user-interviews/): goals, guides, open-ended questions, and limits of self-report.
- [Flaherty (2020): Contextual Inquiry](https://www.nngroup.com/articles/contextual-inquiry/): the four principles, the session structure, the insurance case, and when it does not fit.
- [Holtzblatt and Beyer: Contextual Design](https://ixdf.org/literature/book/the-encyclopedia-of-human-computer-interaction-2nd-ed/contextual-design): the authors' account of the method and its history.
- [Dykes (2025): Personas Make Users Memorable](https://www.nngroup.com/articles/persona/): definition, research phase, and which details belong.
- [Pruitt and Grudin (2003): Personas: Practice and Theory](https://www.microsoft.com/en-us/research/wp-content/uploads/2017/03/pruitt-grudinold.pdf): foundation documents, sanity checks, and the priority matrix.
- [Annett and Duncan (1967): Task Analysis and Training Design](https://files.eric.ed.gov/fulltext/ED019566.pdf): the report as held by ERIC, with the stopping rule.
- [Rosala (2020): Task Analysis](https://www.nngroup.com/articles/task-analysis/): goals versus tasks, the two stages, and plans.
- [Usability Body of Knowledge: Hierarchical Task Analysis](https://usabilitybok.org/hierarchical-task-analysis/): plans, the P x C rule, and limitations.
