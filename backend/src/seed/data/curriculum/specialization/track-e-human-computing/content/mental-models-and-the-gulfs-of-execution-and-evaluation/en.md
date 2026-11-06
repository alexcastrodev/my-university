---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define a mental model and explain why it is a belief that can be wrong while still being useful.
- Define the gulfs of execution and evaluation, and attribute them precisely.
- Use the seven stages of action to locate where an interaction breaks.
- Keep Gibson's affordance and Norman's use of the word apart, and date "signifier" correctly.
- Diagnose an interface with affordance, signifier, mapping, feedback, and constraint, and say which gulf each one narrows.

## Context & Motivation

`human-perception-and-cognition-for-interface-design` covered what people can perceive and hold in mind. This lesson asks what they do with it: how a person decides what to do next with a system, and how they tell whether it worked. This vocabulary is often used loosely. "Affordance" in particular has at least two meanings, and arguments about it usually come from people using different ones. Precise terms give you a way to say where an interaction breaks, instead of saying that it "feels unintuitive".

## Core Theory

### Mental models

NN/g defines the term this way: "A mental model is what the user believes about the system (web, application, or other kind of product) at hand." Three properties matter.

- It is a belief, based on experience, not a fact about the system.
- It differs between people, since each person's background differs.
- It is used to predict: people choose actions according to what they expect to happen.

A mental model does not have to be accurate to be useful. It has to predict well enough for the task at hand. Trouble starts when the model predicts wrongly and nothing in the interface corrects it.

Designers cannot speak to users directly through a product. All the user gets is what Norman calls the system image: the operations, results, and presentation of the product. Wikipedia's account of his principles lists a good conceptual model, with a coherent and consistent system image, among them. If that image suggests the wrong model, users will reason correctly from a wrong premise.

### The two gulfs

The **gulf of execution** is the gap between what a person intends and what the system lets them do, or how well it supports doing it. The question is: how do I do this here?

The **gulf of evaluation** is the difficulty of working out the state of the system and interpreting it in terms of one's expectations and intentions. The question is: what happened, and is that what I wanted?

Attribution takes some care, because short accounts credit Norman alone. NN/g (Whitenton, 2018) says that the terms were invented in 1986 by Ed Hutchins, Jim Hollan, and Don Norman, writing about direct manipulation in the book *User Centered System Design*, edited by Norman and Draper. The Interaction Design Foundation's glossary says that the terms were introduced in Norman (1986) and popularized by his 1988 book, and adds that the idea of treating the discrepancy as gulfs came from Hollan and Hutchins during a revision of the direct manipulation chapter. These accounts fit together: the direct manipulation work is by the three authors, and Norman's writing spread the terms. A journal paper by the same three authors with the title "Direct Manipulation Interfaces" had appeared in *Human-Computer Interaction* in 1985. The open accounts cited here date the terms to the 1986 book and say nothing about that journal version.

### The seven stages of action

Norman's model, in chapter 2 of the book first published in 1988, divides an action into stages. Wikipedia's account lists them as forming the target, forming the intention, specifying an action, and executing the action, then perceiving the state of the world, interpreting it, and evaluating the outcome. Labels vary across sources and editions, but the shape stays the same: a goal at the top, execution going down into the world, and evaluation coming back up.

```text
           goal
          /    \
   intention    evaluate outcome
   specify      interpret state      execution on the left
   execute      perceive state       evaluation on the right
          \    /
         the world
```

This is an analysis tool. Its value is locating a failure at a stage: the person had the right intention but could not specify the action, or perceived the result and misread it. It is not a measured sequence with timings. The IxDF glossary also notes that these ideas sit in the information-processing tradition, whose assumptions many researchers criticize.

### Affordance: Gibson's meaning

The perceptual psychologist James J. Gibson developed the term. Wikipedia dates it to his 1966 book, while Norman cites Gibson's 1977 and 1979 works. Gibson's best-known definition, as quoted there from the 1979 book, begins: "The affordances of the environment are what it offers the animal, what it provides or furnishes, either for good or ill."

Norman's own summary is useful here, since he is clear about the difference: "To Gibson, affordances are a relationship." and "They are a part of nature: they do not have to be visible, known, or desirable." So a Gibsonian affordance exists whether or not anyone perceives it. A knee-high ledge affords sitting for an adult and not for a small child, because the affordance is relative to the actor's body, not to anyone's belief.

### Affordance: Norman's meaning

Norman brought the word into design in *The Psychology of Everyday Things* (1988), later retitled *The Design of Everyday Things*. His interest was what the user can tell. Writing later, he takes part of the blame for the confusion: "I should have used the term “perceived affordance,” for in design, we care much more about what the user perceives than what is actually true."

The distinction becomes sharp on screens. "All screens afford touching: only some detect the touch and are capable of responding." Clicking is available at every pixel, so it is wrong to ask whether an on-screen object "affords clicking". He says the real question is whether the user perceives clicking there as meaningful. William Gaver (1991) offered another useful division, into perceivable, hidden, and false affordances: a hidden one exists with no information showing it, and a false one appears to exist but does not.

### Signifier

"Signifier" is the term that removes the ambiguity, and its date matters. The concept entered *The Design of Everyday Things* with the Revised and Expanded Edition of 2013, as Wikipedia's entries on the book and on affordance report. Norman had already published the idea, though, in a 2008 column for ACM *Interactions*, "Signifiers, not affordances":

> I call any physically perceivable cue a signifier, whether it is incidental or deliberate.

The 2008 sense is broad. It includes accidental cues, such as an empty train platform. The column's stance is also harder than the book's: it tells designers to forget affordances, and says that "The perceivable part of an affordance is a signifier". As reported in Wikipedia's entry, the 2013 edition keeps both concepts, with affordances determining what actions are possible and signifiers communicating where the action should take place.

Use this working rule. An affordance is what can be done, and a signifier is what tells you. A button's shape and label are signifiers. The ability to press it is the affordance.

### Mapping, feedback, and constraints

Norman's list of principles, as Wikipedia gives it, includes **mappings**, the relationships between actions and results, and between controls and their effects, and **feedback**, the information the user receives about the results of actions. **Constraints** limit what can be done. His page on affordances gives a clean example of keeping these apart: "The cursor is not an affordance; it is visual feedback."

| Tool | Main gulf | What it does |
|---|---|---|
| Signifier | Execution | Shows what can be done, and where |
| Mapping | Both | Makes the control predict the effect, and the display show it |
| Constraint | Execution | Removes wrong actions |
| Feedback | Evaluation | Reports what happened and the current state |
| Visible state | Evaluation | Shows how things are, even with no recent action |

The table is an organizing summary for this lesson, not one from a source.

## Worked Examples

### Example 1: a mental model that passes every check

A newcomer to Git believes that `git commit` saves work to the team's server. After committing, they run `git status`. The output below is from Git 2.50.1, in a repository with one commit not yet pushed:

```text
On branch main
Your branch is ahead of 'origin/main' by 1 commit.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean
```

Walk it through the stages. The goal is to share work. Execution seems to go well, since the commit command succeeds. On evaluation, a person skimming reads "nothing to commit, working tree clean" as "done". The output in fact contains the correction, in the second and third lines. This is a gulf of evaluation with a mental-model cause: the feedback is accurate, but it needs the two-repository model to be interpreted. The command's designers did narrow the gulf, since the hint names the next action.

### Example 2: classify four controls

The classification below is this lesson's analysis of common patterns, and no study produced it.

| Control | Action possible? | Signifier? | Diagnosis |
|---|---|---|---|
| Underlined gray text that does nothing | No | Yes, it looks like a link | False signal: a signifier without the action |
| Swipe left on a list row to delete | Yes | None | Hidden: execution gulf unless learned elsewhere |
| Button grayed out with no reason given | Not now | Yes, but the cause is missing | Constraint without explanation |
| Button with label, focus ring, hover state | Yes | Yes | Perceivable |

The hidden swipe is not automatically a defect. For experts it can be a fast shortcut, provided another visible route exists. So the verdict depends on the users and tasks from `what-hci-studies-users-tasks-and-context`.

### Example 3: an on/off switch

NN/g's article on the gulfs describes a Bluetooth switch from Windows 10, with a label beside it reading the current state. Pushing it toward the word "Off" turned it on, opposite to a physical sliding switch, where you push toward the state you want. The person's model came from the physical switch, the display suggested that model, and the system behaved differently. The article notes that the problem eases when several switches in different states are visible, and proposes a checkbox as an alternative, which depends on one mark and not on position. A general rule follows: a familiar appearance recruits a familiar model, so the behavior had better match it.

### Example 4: a confirmation that does not evaluate

Return to the Hawaii alert in `what-hci-studies-users-tasks-and-context`. The FCC report says that the prompt read "Are you sure that you want to send this Alert?", the same for a test and a live alert, and that it did not offer a chance to review the text to be sent. Read in terms of gulfs, the last step before an irreversible action gave no information for evaluating it: the prompt asked for a decision and showed nothing to decide on. A prompt that named the live audience and showed the message text would narrow that gulf.

The limit of that fix also comes from the report. The officer believed that the attack was real, so better evaluation of the alert might not have changed the decision. Here the wrong mental model was formed before the screen, in how the drill was announced. The design tools in this lesson address the gulf at the interface, and they do not repair a wrong belief about the world.

### Example 5: feedback timing

A fictional upload button takes 3 seconds to respond, showing nothing in the meantime. People press it again and create duplicates. The gulf is one of evaluation: nothing distinguishes "working" from "ignored". Using the guidance from `human-perception-and-cognition-for-interface-design`, the button should acknowledge the press within about 0.1 second and show that work is in progress. At the same time, a constraint should disable a second press, and past about 10 seconds, a progress indicator should say how far along it is.

## Common Misconceptions & Pitfalls

- **"This button has good affordance."** On a screen, this usually means it has a good signifier. Say that instead.
- **"Gibson and Norman mean the same."** Gibson's affordances exist regardless of perception, and Norman's interest was what the user perceives.
- **"Signifier is a 2013 idea."** It entered the book in 2013. Norman's published use dates at least from his 2008 column.
- **"Norman's gulfs" with no other names.** The direct manipulation work is by Hutchins, Hollan, and Norman, and the idea of gulfs is credited to Hollan and Hutchins by the IxDF glossary.
- **"Users have the wrong mental model, so they need training."** Often, but it can also be that the system image taught that model.
- **"Feedback was shown, so evaluation is solved."** Example 1 shows correct feedback that needs a model to interpret.
- **"The seven stages describe how people really think, in order."** It is an analytical framework, not a timing model.

## Summary

A mental model is a user's belief about a system, used to predict what will happen. The gulf of execution is the distance from intention to available action, and the gulf of evaluation is the distance from system state to understanding. The terms come from Hutchins, Hollan, and Norman's direct manipulation work and Norman's 1986 and 1988 writing. Gibson's affordance is a relation between actor and environment that exists whether or not anyone perceives it, whereas Norman's early use concerned what is perceived. His "signifier", in a 2008 column and then in the 2013 edition, separates the cue from the action. Signifiers, mappings, constraints, and feedback narrow the gulfs, and none of them repairs a wrong belief formed elsewhere.

## Documentation Links

- [Whitenton (2018): The Two UX Gulfs](https://www.nngroup.com/articles/two-ux-gulfs-evaluation-execution/): definitions, the 1986 attribution, and the Bluetooth switch example.
- [IxDF: Gulf of Evaluation and Gulf of Execution](https://ixdf.org/literature/book/the-glossary-of-human-computer-interaction/gulf-of-evaluation-and-gulf-of-execution): definitions, the origin of the terms, and a note on the criticism of the framework.
- [Chan (2024): Mental Models and User Experience Design](https://www.nngroup.com/articles/mental-models/): what a mental model is, and how it forms.
- [Wikipedia: Seven stages of action](https://en.wikipedia.org/wiki/Seven_stages_of_action): the stages as listed from Norman's book.
- [Wikipedia: The Design of Everyday Things](https://en.wikipedia.org/wiki/The_Design_of_Everyday_Things): the editions, the 2013 addition of signifiers, and the list of principles.
- [Wikipedia: Affordance](https://en.wikipedia.org/wiki/Affordance): Gibson's definition, Norman's use, and Gaver's categories.
- [Norman: Affordances and Design](https://jnd.org/affordances-and-design/): Norman on Gibson's meaning and on perceived affordances.
- [Norman (2008): Signifiers, not affordances](https://jnd.org/signifiers-not-affordances/): author's version of the Interactions column.
- [FCC (2018): Report on the Hawaii False Alert](https://docs.fcc.gov/public/attachments/DOC-350119A1.pdf): the wording of the confirmation prompt, and the officer's belief.
