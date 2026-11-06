---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State the central claim of semiotic engineering: interaction is metacommunication from designers to users, through the interface as their deputy.
- Classify interface signs as static, dynamic, or metalinguistic.
- List the 13 communicability evaluation tags in English and Portuguese, and tell apart the pairs that share a symptom.
- Run the three analysis steps of the Communicability Evaluation Method: tagging, interpretation, and semiotic profiling.
- Explain missing and declining affordances, and why the method is qualitative.

## Context & Motivation

`mental-models-and-the-gulfs-of-execution-and-evaluation` looks at interaction from the user's head: can this person work out what to do and what happened? `color-typography-and-icons` treats color, type, and icons as design material. Semiotic engineering, developed by Clarisse Sieckenius de Souza and the Semiotic Engineering Research Group (SERG) at PUC-Rio since 1990, adds a participant those views leave offstage: the designer.

De Souza's point is that an interface does not merely afford actions. It says something, on someone's behalf. A usability test can report that people failed to find a function. This theory asks what the system told them, what they took it to mean, and where that conversation broke down. Her own account is that user-centered design models leave the designers' meaning-making out: designers, she writes, "do not belong in UCD interaction models".

The full treatment is de Souza's 2005 book, which is sold. Her encyclopedia chapter, a 2000 paper, and a 2006 SERG case study are open.

## Core Theory

### Metacommunication

The core tenet is that human-computer interaction is **metacommunication**: communication about how, when, where, and why to communicate with the system. Designers cannot be present when someone uses the software, so they represent themselves in the interface. The interface is the **designers' deputy**. De Souza summarizes the message:

> Here is my understanding of who you are, what I've learned you want or need to do, in which preferred ways, and why. This is the system that I have therefore designed for you, and this is the way you can or should use it in order to fulfill a range of purposes that fall within this vision.

The "I" is the designer. Users unfold this message gradually as they interact. Two consequences follow. The message is one-way at interaction time: the designer cannot rephrase it. And the medium is computational, so designers must produce representations with one definitive encoded meaning, while users keep producing meanings freely. The system cannot reason its way to what a user meant if the designers did not anticipate it.

**Communicability** is the quality this theory evaluates: de Souza defines it as a system's ability to signify and communicate the designers' intent.

### Three classes of signs

- **Static signs** carry their meaning at one instant, and can be read from a screenshot: a toolbar icon, a label, a layout.
- **Dynamic signs** need time, and are read across states: a dialog that opens after a click, a spell-check button that reports it is disabled.
- **Metalinguistic signs** are signs about other signs: a help page, a field hint, an instructional video.

### The Communicability Evaluation Method

The method (CEM, or MAC in Portuguese, for Método de Avaliação de Comunicabilidade) tests users, then reconstructs how the designers' message was received. SERG's 2006 case study describes two preparatory steps and three analysis steps.

**Preparation and application.** Study the documentation and the application, and if possible talk to the designers. Select scenarios where the communication is likely to fail. Recruit a small number of participants, interview them before and after, and record the screen.

**1. Tagging.** Watch the recording and attach a tag to each moment of breakdown. Tags are stereotypical expressions that the evaluator "puts in the participant's mouth". De Souza, Prates, and Carey (2000) note that experts, designers, or users themselves may do the tagging, and that each introduces its own bias.

**2. Interpretation.** Tabulate the tags by frequency, context, and sequence, per participant and per task, and relate them to problems. SERG refers the explanation to five categories: the user cannot express what they mean, chooses the wrong way to express it, cannot interpret what the system expresses, chooses the wrong interpretation, or cannot even formulate a communicative intent.

**3. Semiotic profiling.** Reconstruct the global message by answering five questions: who the designers think the users are, what they think those users want and need, what preferences they assume and why, what system they consequently designed, and what their global design vision is.

### The 13 tags

The table gives the tags exactly as SERG's case study lists them, with the Portuguese terms in Mattos (2010), a UFMG dissertation supervised by Raquel Prates. The symptoms are short summaries. Failure type comes from Mattos's table, which classes a failure as temporary (the user notices and tries to overcome it), partial, or complete. Neither source prints the two lists side by side, so the pairing here follows the symptom descriptions.

| Tag | Portuguese | Symptom | Failure |
|---|---|---|---|
| Where is it? | Cadê? | Knows what to do, cannot find the element | Temporary |
| What now? | E agora? | Does not know what to do next, wanders | Temporary |
| What's this? | O que é isso? | Does not understand a sign, probes it | Temporary |
| Oops! | Epa! | One wrong action, corrected at once | Temporary |
| Where am I? | Onde estou? | Says things fit for another context | Temporary |
| I can't do it this way. | Assim não dá. | Abandons a several-step path, takes another | Temporary |
| Why doesn't it? | Por que não funciona? | Repeats an action whose effects are not the expected ones | Temporary |
| What happened? | Ué, o que houve? | Repeats because the effect is absent or unperceived | Temporary |
| Help! | Socorro! | Seeks help, documentation, or a person | Temporary |
| I can do otherwise. | Vai de outro jeito. | Misses the intended way, uses a workaround | Partial |
| Thanks, but no, thanks. | Não, obrigado. | Understands the intended way, deliberately declines it | Partial |
| Looks fine to me. | Para mim está bom. | Believes the goal was achieved, and it was not | Complete |
| I give up. | Desisto. | Believes the goal is unreachable, stops | Complete |

Spellings vary. Vasconcelos and Monteiro (2025) write "O que é isto?" and "Não, Obrigado!", and the 2000 journal paper mentions "I can't do it." for consciously abandoning a task, where the 2006 table has "I give up." Always state which list you use.

Several pairs need care, and the screen recording alone often cannot separate them:

- **Where is it? / What now?** Same wandering. In the first, the user knows the goal. SERG says this is usually a topic for the post-test interview.
- **Why doesn't it? / What happened?** In the first, the user sees effects and they are wrong. In the second, the user sees none.
- **I can do otherwise. / Thanks, but no, thanks.** Same behavior, different attitude. The interview, or earlier use of the affordance in the recording, separates them.
- **Looks fine to me. / I give up.** Both are task failures, with opposite attitudes.

"Help!" is special: SERG calls it a kind of meta-level tag, and notes it may be curiosity and not a breakdown at all.

### Missing and declining affordances

De Souza, Prates, and Carey (2000) take designers' talk of "affording" things as an expression of intent. A user who does not perceive the designed path and finds another **misses** the affordance ("I can do otherwise."). A user who perceives it and chooses otherwise **declines** it ("Thanks, but no, thanks."). They call these cases the most significant difference between communicability evaluation and other usability methods. They also separate levels: **operational** (single actions), **tactical** (a path of actions), and **strategic** (how the problem is conceived). A user may decline at one level because of something missed at another. One user declined template files because he had missed that templates can hold variable tags.

### What kind of result this is

CEM is qualitative. SERG states that results depend on the depth of the semiotic associations evaluators establish, not on the number of tests, and that the method's explanation is descriptive and not predictive. The 2000 paper says its studies did not, and were not meant to, have statistical significance. Mattos adds that the absence of tags means lack of evidence of problems, not that none exist. A sibling method, semiotic inspection, is analytic: a specialist walks through the interface looking for potential breakdowns, with no users.

## Worked Examples

### Example 1: a published session

SERG's case study compared two HTML tag editors, Arachnophilia and SpiderPad, with 10 participants of varying HTML expertise, none of whom had used either editor. One group started with each editor. Tasks included a nested list, a background color, and a table, with at most 4 minutes each. These are observed data, and the narrated Arachnophilia clip carries 12 tags:

```text
Where is it?             4
What's this?             3
Oops!                    2
I can do otherwise.      1
I can't do it this way.  1
Looks fine to me.        1
```

The sequence matters as much as the count. The clip opens with "Where is it?" then "I can do otherwise": the user appears to look for a list wizard, then types the numbers by hand. Mattos, citing Prates and Barbosa (2007), reads that pattern as a user trying to communicate something and adopting a non-optimal path. The clip ends with "Looks fine to me.", because the user declared the task done, although the list was not indented, without ever previewing the page.

### Example 2: reading the published totals

Across the study, SERG reports these hits, for subsets of tags:

```text
                                                Arachnophilia  SpiderPad
Task failure ("I give up", "Looks fine to me")  36             31
Where is it?, Oops!, What's this?,
What happened?, Why doesn't it?                 97             108
```

Neither gap is presented as a statistical result. The value lies in the explanation. Most participants said SpiderPad was easier, yet meaning-assignment problems were more frequent with it. Its help is terse and impersonal, while Arachnophilia's designer speaks in the first person, in a tutorial style. The profile answers question 1 differently for each: Arachnophilia talks to HTML learners, SpiderPad to HTML coders. Function by function, the editors have much in common, and SERG's conclusion is that functionality addressed to a different interlocutor may never get used.

### Example 3: illustration on a form

**This session is invented to show the procedure. Nothing here was observed, and no participant exists.** The system is the delivery form in `forms-and-input-design`, with an added coupon field and a "Limpar" (clear) button.

```text
time  invented event                                       tag
0:12  rests the pointer on "CEP", waiting for a hint       What's this?
0:48  types 01310 100, gets an error, retypes the same     Why doesn't it?
1:10  opens the FAQ page                                   Help!
2:05  opens menus looking for where the coupon goes        Where is it?
2:20  clicks Limpar, restores the fields at once           Oops!
2:55  reaches the next page, says the coupon was applied,
      but it was not                                       Looks fine to me.
```

Tallied by Mattos's types, that is 5 temporary failures and 1 complete. Interpretation: the "Why doesn't it?" points at a hint that says "with or without a hyphen" and is silent about spaces, a sign the designers wrote without anticipating this user's format. The "Looks fine to me." is the serious one, since the system never signified whether the coupon applied. A profile would then ask who these designers thought they were talking to: someone who already knows the CEP format and needs no confirmation. This shows how an evaluator reasons, and it is not evidence about any form.

### Example 4: missing or declining

Two real cases from de Souza, Prates, and Carey (2000), with SpiderPad. One participant built a whole table through the TAGS menu and never realized the toolbar had a table tool. That is "I can do otherwise.": the affordance was missed. Another used the tag bar for list items, then typed the remaining `<li>` tags by hand. The recording shows that he had used the affordance, so he knew it, and that makes it "Thanks, but no, thanks." The behaviors look alike: both took a longer route than the designer's. Evidence of awareness separates them, and the redesign differs. A missed affordance needs a better sign. A declined one may mean the offered path is worse for frequent use, or, as the authors note, that users are adapting the tool creatively.

## Common Misconceptions & Pitfalls

- **"Tags are quotes."** They are stereotyped utterances the evaluator attributes. The 2000 paper likens expert tagging to putting words in the user's mouth.
- **"Fewer tags means a better design."** The 2000 paper warns that few cases may come from early use, or from a range of affordances so narrow that users cannot do anything differently.
- **"Communicability is usability under another name."** A user can understand the message and refuse it. In SERG's study, most participants called easier the editor that had more meaning problems.
- **"The interview is optional."** Without it, several pairs of tags often cannot be told apart.
- **Inventing a tag.** The set is defined. Do not add "Too slow!" and call the result CEM.

## Summary

Semiotic engineering, from Clarisse de Souza and SERG, treats interaction as metacommunication: designers send a one-shot message about who the users are and how to use the system, through the interface as their deputy, with static, dynamic, and metalinguistic signs. Communicability is how well that message gets across. The Communicability Evaluation Method records users, tags breakdowns with 13 stereotyped expressions, interprets the tags, and reconstructs the message in a semiotic profile. Its distinctive results are missed and declined affordances at operational, tactical, and strategic levels. It explains rather than predicts, and interviews are essential to telling similar tags apart.

## Documentation Links

- [de Souza: Semiotics, Encyclopedia of Human-Computer Interaction, 2nd ed.](https://ixdf.org/literature/book/the-encyclopedia-of-human-computer-interaction-2nd-ed/semiotics): the theory in the author's words, with the metacommunication message and the sign classes.
- [de Souza, Prates, Carey (2000): Missing and Declining Affordances](https://www.scielo.br/j/jbcos/a/6nykpPHBs7ZCHZg4ddJSw6v/?lang=en): the three steps, affordance levels, and scenarios of good and bad news.
- [SERG (2006): Communicability Evaluation Case Study](https://id-book.pages.dev/downloads/casestudy_14point3.pdf): the method, the table of 13 tags, and the study of two HTML editors, on the companion site of *Interaction Design*.
- [Mattos (2010): Uma extensão do Método de Avaliação de Comunicabilidade para sistemas colaborativos](https://repositorio.ufmg.br/bitstream/1843/SLSS-89PHM6/1/bernardoaugusto.pdf): UFMG dissertation with the tags in Portuguese and the failure types.
- [Vasconcelos, Monteiro (2025): Comunicabilidade em comentários de usuários](https://sol.sbc.org.br/index.php/ihc_estendido/article/download/37766/37548): recent IHC poster that uses the 13 tags, with spelling variants.
