---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Describe the design of the inattentional blindness and change blindness studies, and tell the two phenomena apart.
- State what Miller (1956) and Cowan (2001, 2010) actually measured, and explain why neither result sets a size for menus.
- Use recognition, recall, and external memory to decide how much an interface may ask a person to remember.
- Say in what sense Gestalt "laws" are laws, and apply grouping principles to a layout without treating them as thresholds.
- Choose feedback for a delay using the response-time guidance, knowing that it is advice and where it came from.

## Context & Motivation

`what-hci-studies-users-tasks-and-context` said that users have capabilities that change performance. This lesson covers three of them: what people attend to, what they can hold in mind, and how they group what they see. These topics attract more folklore than any other part of HCI, because a laboratory number is easy to quote and hard to apply. "Seven items" and "people miss the gorilla" both started as careful findings about particular tasks. The habit to build here is to ask what the participants did, what was measured, and whether your interface resembles that situation.

## Core Theory

### Attention: inattentional blindness

Simons and Chabris (1999) tested whether people miss a visible event while attending to something else. Participants were 228 observers, almost all undergraduates, tested individually. After 36 were discarded for stated reasons, 192 remained, spread evenly over 16 conditions of 12 each.

Each observer watched a 75-second video of two teams of three passing basketballs, and silently counted passes by one team. In the Easy task they kept one count, and in the Hard task they kept separate counts of bounce and aerial passes. Partway through, a woman with an umbrella or a person in a gorilla suit walked through the scene for 5 seconds. Videos were either transparent (separately filmed, superimposed layers) or opaque (one live scene). Afterwards came surprise questions about anything unusual.

The main result: of the 192 observers, 46% failed to report the event. The other comparisons show what moves that number:

| Comparison | Noticed the event |
|---|---|
| Opaque vs. transparent video | 67% vs. 42% |
| Easy vs. Hard count | 64% vs. 45% |
| Umbrella woman vs. gorilla | 65% vs. 44% (the paper's text; its Table 1 averages to about 43% for the gorilla) |
| Gorilla, attending the black team vs. the white team | 58% vs. 27% |

The gorilla was black, so observers tracking the black team noticed it more often. Across the 16 conditions, noticing ranged from 8% to 100%. "Half of people miss a gorilla" is therefore an average over very different situations. The study concerns an unexpected event during a demanding monitoring task, with mostly student observers watching a video. It does not show that people miss everything outside the task, and it was not an interface study. The authors do mention one that was: Haines (1989), where some pilots using a head-up display in a landing simulator failed to notice a plane blocking their path.

### Attention: change blindness

Change blindness has a different design. In the flicker technique of Rensink, O'Regan, and Clark (abstract from 1996), an original image and a modified image alternated for 240 ms each, with an 80 ms blank field between them. The images were real-world scenes, and one object or region changed in appearance, color, or position. Observers pressed a key when they saw the change. Reaction times for some scenes reached 20 seconds, although the changes were large, repeated, and expected. Verbal cues helped considerably, which suggested that visibility was not the issue. The authors concluded that attention must be directed to an item while it changes for the change to be perceived.

The contrast matters. In inattentional blindness, the observer is not expecting anything. In change blindness, the observer here was searching for a change and still took many seconds. In both, having the information in front of the eyes was not enough. NN/g (2018) argues that loading a new page can play the role of the blank field. That is an analogy to the lab procedure, not a result of it.

### Working memory: what Miller measured

Miller's 1956 paper discussed two separate limits, as Wikipedia's account of the paper explains. One is absolute judgment: naming stimuli that vary on one dimension, such as tones of different pitch. Performance is close to perfect up to five or six stimuli, which corresponds to a channel capacity of about 2 to 3 bits. The other is memory span: the longest list a person can repeat back in order. Cowan's 2010 summary is that Miller showed one can repeat back a list of no more than about seven randomly ordered, meaningful items or chunks.

Span is roughly the same for binary digits (1 bit each), decimal digits (3.32 bits each), and words (about 10 bits each), so the limit is not in bits. Miller described it in chunks: the largest meaningful unit that the person recognizes, which depends on what that person already knows. He treated the numerical match between the two limits as a coincidence. "Seven" also did not hold as a constant later: span is around seven for digits, six for letters, and five for words.

### Working memory: what Cowan argues

Cowan (2001), as he summarizes it in 2010, asks what remains when people cannot use strategies. With rehearsal and grouping curtailed, recall shows a limit of 3 to 5 separate items. The procedures include a brief simultaneous spatial array, an unattended auditory channel, repeating a word aloud during presentation, and running span, where a list ends unpredictably. In one study he reports, young adults taught new word pairs remembered about 3 units with rehearsal prevented, whether the units were single words or learned pairs.

Seven and four therefore answer different questions. About seven is what people achieve repeating a list when they can use their strategies, and about four is an estimate of a central store with those strategies blocked. Four is also not settled. Other theories reject a fixed number of elements altogether.

### Why neither number sizes a menu

Both results come from recall of material that is no longer in view. Menu items stay on the screen. A person scanning a menu is recognizing and searching, not holding the list in mind, so these experiments do not apply to the question. Neither Miller nor Cowan says a menu should have seven items, or four. The number of items matters through search and decision, which `fitts-law-and-hicks-law` and `navigation-menus-windows-and-information-architecture` take up.

The findings do apply when information must be carried from one place to another with no visible copy.

### Recognition, recall, and external memory

Recognition is easier than recall because it offers more cues for retrieval (Budiu, NN/g, 2024). Showing options, recent items, and previous values turns a recall task into a recognition task. NN/g's article on working memory adds the other half: when a task is too hard, the interface can serve as external memory, keeping what the person would otherwise have to hold. So the design question is rarely "how many items?". It is "what must this person carry in their head between two moments, and can the system carry it instead?".

### Gestalt grouping: descriptions, not laws of nature

Wertheimer's 1923 paper showed that equally spaced dots form a uniform line, and that changing the spacing makes the closer dots group into pairs. Wagemans and colleagues (2012) call proximity the first of his "famous laws or (more accurately) principles of grouping". Others include similarity, common fate, good continuation, closure, symmetry, and parallelism. Newer additions include common region and element connectedness.

The wording in that review is telling. Similarity, common fate, and closure are each introduced with "all else being equal". A principle says which way a factor pushes, but it does not say how strong that push is, and in real layouts all else is not equal. Early critics faulted Gestalt psychology for imprecise laws, and for adding a new "law" for each factor found. Quantitative laws do exist, but they are for specific experimental setups such as dot lattices. One result is often misapplied: Elder and Goldberg (2002) found proximity by far the strongest cue, reducing entropy by roughly 75% versus about 10% each for good continuation and similarity. That was for contour grouping in natural images, and it is not a ranking for dashboards.

### Feedback and time

Nielsen's 1993 guidance gives three limits: 0.1 second for a response to feel instantaneous, 1 second for the flow of thought to stay uninterrupted, and 10 seconds for keeping attention on the dialogue. He credits this advice to Miller 1968 and Card et al. 1991. This is Robert B. Miller, not the George Miller of the magical number. The figures are rules of thumb for choosing feedback, not measured thresholds.

## Worked Examples

### Example 1: same options, spoken or shown

Take a list of eight options. On a screen, the list stays visible. The person scans until something fits, and the memory limits above are not the constraint. Read aloud by a phone system, the same eight options disappear as they are spoken. The caller must hold earlier options while judging later ones, which resembles the recall situation far more closely. So the same content has different demands. This is reasoning from the studies, not a measured result, and it gives no exact maximum. Letting the caller interrupt, or say what they want, removes the holding altogether.

### Example 2: chunks depend on the reader

A support flow shows a fictional 14-character reference on one screen and asks for it on the next: `BR202611047731`.

```text
Reader                       Units to hold
No pattern seen              14 characters
Sees BR, a year, a date      BR | 2026 | 1104 | 7 | 7 | 3 | 1  =  7 units
```

Displaying it as `BR-2026-1104-7731` helps people find the pattern, but dashes do not make `7731` a chunk, because a chunk is something the person already knows. The better fix avoids the memory task: carry the value to the next screen, or offer a copy button. If the person must move to another device, the value should be sent, not remembered.

### Example 3: spacing as grouping evidence

In a fictional form, each label sits 4 px above its field, and the next label sits 4 px below that field.

```text
gap label to own field:      4 px
gap field to next label:     4 px     ratio 1:1    ambiguous
after the fix:              4 px / 24 px    ratio 1:6
```

With equal gaps, proximity gives no answer about which field a label belongs to. Increasing the outer gap makes the pairs group. There is no established ratio here: 1:6 is a choice for this form. Other cues can also override it. Put two fields in one bordered card and common region pulls them together regardless of the gap, which is useful if intended and misleading if not.

### Example 4: where did the error message go?

A person completes a long form, scrolls to the bottom, and presses Submit. The page reloads and a red summary appears at the top, outside the viewport. This is an inference from the studies above, not a measured result for this form. The reload acts like the blank interval, and the message appears away from the person's attention, so the person may conclude that nothing happened.

Better options place the error next to the failed field, and move the view and keyboard focus there. The advice has a limit: motion attracts attention only if it is not competing. A monitoring dashboard with many tiles animating at once brings back the problem, because no single change stands out.

## Common Misconceptions & Pitfalls

- **"Miller proved menus need 7 plus or minus 2 items."** He discussed absolute judgment and memory span. Visible menus are neither.
- **"Cowan corrected seven to four, so use four."** The result concerns storage with strategies blocked, and it does not size any widget.
- **"Half of people miss a gorilla."** The overall figure was 46% failing to report the event, across conditions where noticing ranged from 8% to 100%.
- **"Grouping into threes makes anything memorable."** Spacing helps finding the parts. A chunk requires prior knowledge.
- **"Gestalt laws dictate layout."** They are tendencies stated with "all else being equal", and they can conflict.
- **"Users feel delays above 0.1 seconds, proven."** It is guidance, and the Miller credited for it is a different Miller.

## Summary

People see what they attend to. In the Simons and Chabris study, 46% of 192 observers missed an unexpected event while counting passes, and the flicker studies show that people can search for seconds for a large, repeating change. Memory limits are real but specific: about seven for immediate span with strategies available, and 3 to 5 chunks for a central store with strategies blocked, and neither applies to a list that stays on the screen. Interfaces help by turning recall into recognition and by acting as external memory. Gestalt principles describe how grouping tends to go, all else being equal. For each of these findings, check that your situation resembles the one that was measured.

## Documentation Links

- [Simons and Chabris (1999): Gorillas in our midst](https://www.chabris.com/Simons1999.pdf): the design, conditions, and results of the inattentional blindness study, from a co-author's site.
- [Rensink, O'Regan, and Clark (1996): To See or Not to See, abstract](https://www2.psych.ubc.ca/~rensink/publications/abs.96.2.html): the flicker method and its results, on the first author's site.
- [Budiu (2018): Change Blindness in UX](https://www.nngroup.com/articles/change-blindness-definition/): definition and how page loads relate to the laboratory flicker.
- [Cowan (2010): The Magical Mystery Four](https://pmc.ncbi.nlm.nih.gov/articles/PMC2864034/): the 3 to 5 chunk limit, its conditions, and a summary of Miller's result.
- [Wikipedia: The Magical Number Seven, Plus or Minus Two](https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two): account of Miller's two limits and of later work on span.
- [Budiu (2024): Memory Recognition and Recall in User Interfaces](https://www.nngroup.com/articles/recognition-and-recall/): why recognition is easier than recall.
- [Budiu (2018): Working Memory and External Memory](https://www.nngroup.com/articles/working-memory-external-memory/): offloading memory to the interface.
- [Wagemans et al. (2012): A Century of Gestalt Psychology in Visual Perception, part I](https://pmc.ncbi.nlm.nih.gov/articles/PMC3482144/): grouping principles, their limits, and attempts to quantify them.
- [Nielsen (1993): Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/): the 0.1, 1, and 10 second guidance and its sources.
