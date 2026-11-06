---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Explain why fidelity is a set of dimensions and not one low-to-high scale.
- Define sketch, wireframe, mockup, and prototype, and say which dimension each one raises and which it leaves low.
- Report what Virzi, Sokolov, and Karis (1996) and Walker, Takayama, and Landay (2002) measured, including the limits of each study.
- Choose an artifact from the question you need answered, and name what that artifact cannot tell you.
- Name the documented costs of testing at too low a fidelity and of building too high a fidelity.

## Context & Motivation

`user-research-interviews-personas-task-analysis` leaves you with users, tasks, and a set of guesses about what would help them. Those guesses are hypotheses, and a prototype is the cheapest thing that can falsify one. Pernice (2016, NN/g) puts it directly: "A user interface prototype is a hypothesis". `requirements-elicitation-specification-and-validation` already lists prototyping as an elicitation technique, good for needs that surface only when something concrete exists. This lesson asks the next question: how concrete, and concrete in which respect?

The usual answer is a ladder: sketch, then wireframe, then mockup, then prototype, each rung better than the last. That picture is wrong in two ways. The four words do not sit on one axis, and the studies do not show that a higher rung finds more usability problems. `usability-testing-and-the-system-usability-scale` covers how to run the test. This lesson covers what to put in front of the participant.

## Core Theory

### Fidelity has dimensions

Walker et al. (2002) describe fidelity as how easily a prototype can be distinguished from the final product. "Distinguished in what way?" is the real question. Virzi et al. (1996) call fidelity "a continuum, not a dichotomy" and name four dimensions along which a prototype can differ from the product:

- **Breadth of features:** how many features it supports.
- **Degree of functionality:** how complete each feature's operation is.
- **Similarity of interaction:** how the user communicates with it (buttons, mouse, touch, speech).
- **Aesthetic refinement:** aspects that do not directly affect function, such as color and graphic design.

Lim, Stolterman, and Tenenberg (2008) offer a finer vocabulary. **Filtering dimensions** say which aspect of the design a prototype explores: appearance, data, functionality, interactivity, and spatial structure. **Manifestation dimensions** say how it is built: material (paper, code), resolution (level of detail, which they equate with fidelity), and scope (how much of the design it covers). They argue that the binary low versus high distinction can be problematic, and they cite McCurdy et al. (2006) as demonstrating a mixed-fidelity prototype, low on some dimensions and high on others.

Low fidelity also does not mean low function. In Virzi's second experiment, the low-fidelity voice system was a person reading prompts aloud, and any action possible in the final system was possible there.

### The four artifacts

The terms are conventions, not standards, and teams use them loosely. NN/g's glossary (Wang 2024) gives usable definitions:

- **Wireframe:** "A skeletal outline of a design layout used to represent the structure and functionality of an interface before visual design is considered."
- **Mockup:** "A static, high-fidelity simulation of a proposed UI design that includes visual-design details such as colors and imagery."
- **Prototype:** "An early version of a design used to test and validate ideas, interactions, and functionality."

**Sketch** has no entry of its own there. Use it for a fast, rough drawing whose job is to explore options, usually on paper. Gordon (2021, NN/g) warns that wireframes themselves range from quick sketches to detailed representations, so the sketch and wireframe boundary is one of intent as much as of drawing.

The table is this lesson's synthesis, using Lim's dimension names. It does not come from a single source.

| Artifact | Raises | Leaves low | Answers |
|---|---|---|---|
| Sketch | Speed and number of alternatives | Appearance, interactivity, data | Which ideas deserve more work? |
| Wireframe | Spatial structure, content hierarchy | Appearance, usually interactivity | Is the right content in the right place? |
| Mockup | Appearance | Interactivity, functionality | Does it look right, and does the visual hierarchy read? |
| Prototype | Interactivity, and functionality as needed | Whatever the question ignores | Can people do the task? |

So "prototype" is not a rung above mockup. It names a behavior, responding to the user, and it can be made of anything. A paper prototype has low appearance and real interaction logic. A clickable mockup has high appearance and a few hardwired paths.

### Who plays the computer

Something must respond to the participant. Pernice (2016) separates **interactive** prototypes, where each response is built before the test, from **static** ones, where a person responds during it. On paper, a person swaps sheets as the participant taps. In **Wizard of Oz**, a hidden person controls the participant's screen remotely. The trade is preparation time before the test against load and error risk during it.

### What the studies measured

**Virzi, Sokolov, and Karis (1996).** Two between-subjects experiments, each with 20 college-age subjects (10 per condition) thinking aloud. Experiment 1 tested an electronic book: a paper version on more than 100 index cards against the actual product. Experiment 2 tested a voice response system: a person reading prompts against a working high-fidelity prototype. The main finding: substantially the same problems appeared in both conditions.

| | Exp. 1, high | Exp. 1, low | Exp. 2, high | Exp. 2, low |
|---|---|---|---|---|
| Mean share of problems per subject | 38% | 34% | 40% | 46% |
| Problems found by the group | 34 of 38 | 32 of 38 | 19 of 21 | 20 of 21 |

The differences in sensitivity were not significant ($t(37)=1.08$, $p=.29$, and $t(20)=.870$, $p=.39$), and problem detection correlated across conditions ($r=.58$ and $r=.49$). The authors state the limits themselves: one cannot prove the null hypothesis, the results apply to think-aloud testing, and severity was not formally measured.

**Walker, Takayama, and Landay (2002).** 28 participants, recruited locally, none with professional web development experience, did five online banking tasks on two sites. The design crossed fidelity (sketched or HTML) with medium (paper or computer). Each person saw both media at one fidelity. The authors inserted usability problems on purpose, using Nielsen's heuristics. Participants averaged 34.6 distinct issues out of 169, with no significant difference by fidelity or medium, and severity did not differ either. People made about five more comments on computer than on paper, without finding more issues. One difference survives: when counted by issue, the *types* of problems differed by fidelity ($\chi^2=30.70$, $p<.01$). The analysis could not attribute that to a particular type.

Neither study shows that fidelity is irrelevant. Both show that, for finding usability problems in think-aloud task testing on those products, raising fidelity did not raise the yield.

### The cost of the wrong fidelity

**Too low: the question lives in a dimension you faked.** Wiklund et al. (1992), as reported by Virzi et al., had people rate prototypes of an electronic dictionary at four levels of realism. Realism did not change the ratings. But the prototypes did not reproduce the device's slow response times, so all of them were rated as more usable than the actual device. In Virzi's own Experiment 2, two problems were found by almost all high-fidelity subjects and few low-fidelity ones, because the two versions handled saving changes differently. A prototype can only reveal what it reproduces.

**Too high: you pay for dimensions the question does not need.** Virzi's voice prototype took over two months and held over 5,000 TFLX icons, seven databases, and over 500 sound files. The authors wrote that, had they run their experiment a year earlier, they would not have built it for usability testing. Hong et al. (2001), as reported by Walker et al., found that users rated prototypes of different fidelity differently on "finishedness" and "likeliness to change", while their priorities for improvement did not differ.

**Too few alternatives.** Tohidi et al. (2006) compared testing one design with testing three functionally equivalent but stylistically distinct ones. With a single design, users gave significantly higher ratings and less negative feedback. This concerns the number of designs and not fidelity, but it warns against reading praise for one polished candidate as evidence.

Pernice (2016) adds that designers feel less wedded to rough work and that polish can lead an executive to say "let's make it go live now". That is practitioner judgment and was not measured.

## Worked Examples

### Example 1: choosing by question

A university wants a phone flow for class enrollment. The table is an illustration of the reasoning, with no user data behind it.

| Question | Must be real | Can stay fake | Artifact |
|---|---|---|---|
| Does the step order match how students plan? | Sequence of steps | Everything visual | Sketches, a person swapping sheets |
| Can they find a time conflict in the timetable? | Layout, real course data | Color, brand | Wireframe with real data |
| Does a conflict badge read as a blocker? | Color, type, contrast | Behavior | Mockup, shown and discussed |
| Can they drag a class while seats run out? | Touch, timing, live state | Breadth of other features | Coded prototype on a phone |

Each row picks the cheapest artifact in which the deciding dimension is real. The last row needs code because similarity of interaction is the question, and the Wiklund result warns against guessing at timing.

### Example 2: reading Virzi's numbers

Virzi plots expected discovery with the formula from earlier work, where $p$ is the mean probability of detecting a problem and $n$ the number of subjects:

$$\text{found}(n)=1-(1-p)^n$$

Running it for Experiment 1 and comparing with the observed group totals:

```text
p       n=1    n=3    n=5    n=10   observed with 10 subjects
0.38    0.380  0.762  0.908  0.992  34/38 = 0.895
0.34    0.340  0.713  0.875  0.984  32/38 = 0.842
```

Both use the same denominator, the 38 distinct problems, so the comparison is fair. The formula overshoots, plausibly because one mean $p$ treats every problem as equally detectable, while the paper reports a problem found by 80% of subjects and others found by a single person.

The totals also bound the overlap. All 38 problems were found by at least one group, so $34+32-38=28$ were found by both, which leaves 6 found only at high fidelity and 4 only at low. In Experiment 2, $19+20-21=18$ were shared, with 1 and 2 unique. So "the same problems" means strongly overlapping sets, not identical ones. The authors attribute most of the remainder to normal variability, while noting they have no evidence to substantiate that belief.

### Example 3: raising one dimension

A search box must feel acceptable even though the backend needs about 1.8 seconds (an assumed figure for this example). A paper test cannot reveal the wait, and a full build is premature. Keep the appearance as a scanned sketch, as Walker et al. did with hotspots over sketches, and make only the timing real:

```js
// Appearance stays a sketch. Only response time is real.
async function showResults(results) {
  spinner.hidden = false;
  await new Promise((resolve) => setTimeout(resolve, 1800));
  spinner.hidden = true;
  list.replaceChildren(...results.map(render));
}
```

This is mixed fidelity in practice: one dimension at product level, the rest deliberately low. It answers whether people wait and understand the wait, and says nothing about the visual design.

## Common Misconceptions & Pitfalls

- **"Low fidelity finds fewer problems."** Virzi and Walker found no significant difference in count, in their tasks and with think-aloud. The claim that survives is narrower than "fidelity never matters".
- **"So high fidelity is a waste."** Not when the question is about timing, feel, or a behavior the cheap version handles differently. Virzi's two outlier problems came from exactly that.
- **"Paper always comes first."** Virzi reports colleagues doubting that the result extends to direct manipulation, immersive, or response-time sensitive systems, answers "We are not so sure", and leaves the exact bounds to further research. For a gesture or a latency question, paper may answer nothing.
- **"A clickable mockup is high fidelity."** It is high in appearance and low in functionality and data. Name the dimensions and the confusion goes away.
- **"A mockup can be usability tested as is."** A static image supports questions about comprehension and hierarchy. Testing a flow needs something, or someone, that responds.
- **"Users will tell us how to fix it."** Tohidi et al. conclude that usability testing "is a means to identify problems, not provide solutions."
- **Faking data unawares.** Lorem ipsum and tidy sample names hide what long labels and empty states do. Data is a dimension too.

## Summary

Fidelity is several dimensions: breadth, functionality, interaction, and appearance in Virzi's terms, and appearance, data, functionality, interactivity, and spatial structure in Lim's. A sketch raises speed and alternatives, a wireframe raises structure, a mockup raises appearance, and a prototype adds response, in any material. Two controlled studies found that low-fidelity prototypes surfaced about as many usability problems as high-fidelity ones under think-aloud testing, though not identical sets, and Walker et al. found differences in the types of issues. Fidelity fails when the question lives in a dimension the artifact fakes, as with the unrepresented response times in Wiklund's study, and it wastes money when you build dimensions the question ignores, as with Virzi's two-month voice prototype. Start from the question, make its deciding dimension real, and leave the rest cheap.

## Documentation Links

- [Virzi, Sokolov, Karis (1996): Usability Problem Identification Using Both Low- and High-Fidelity Prototypes](https://chi1996.acm.org/proceedings/papers/Virzi/RAVtext.html): the two experiments, the four dimensions of fidelity, and the report of Wiklund et al.
- [Walker, Takayama, Landay (2002): High-Fidelity or Low-Fidelity, Paper or Computer?](https://www.leilatakayama.org/downloads/Takayama.Prototypes_HFES2002_prepress.pdf): author prepress of the 2 by 2 experiment on fidelity and medium.
- [Lim, Stolterman, Tenenberg (2008): The Anatomy of Prototypes](https://faculty.washington.edu/jtenenbg/publications/limAnatomyOfPrototypes-tochi2008.pdf): author copy, with filtering and manifestation dimensions.
- [Tohidi, Buxton, Baecker, Sellen (2006): Getting the Right Design and the Design Right](https://www.microsoft.com/en-us/research/publication/getting-the-design-right-and-the-right-design-testing-many-is-better-than-one/): abstract of the study on testing one design against three.
- [Pernice (2016): UX Prototypes, Low Fidelity vs. High Fidelity](https://www.nngroup.com/articles/ux-prototype-hi-lo-fidelity/): interactive and static prototypes, and practitioner trade-offs.
- [Wang (2024): UX Deliverables Glossary](https://www.nngroup.com/articles/ux-deliverables-glossary/): definitions of wireframe, mockup, and prototype.
- [Gordon (2021): How to Draw a Wireframe](https://www.nngroup.com/articles/draw-wireframe-even-if-you-cant-draw/): the range of wireframe fidelity and how to sketch one.
