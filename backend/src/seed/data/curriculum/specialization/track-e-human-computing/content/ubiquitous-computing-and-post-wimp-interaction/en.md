---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State what WIMP stands for, who defined post-WIMP and how, and how that term differs from Nielsen's noncommand interfaces.
- Apply the four themes and six trade-off qualities of reality-based interaction to a concrete design.
- Separate what held up in Weiser's 1991 vision from what did not, with a dated source for each claim.
- Weigh evidence on touch, voice, gesture, and gaze by its date, population, and task.
- Compute a WCAG spacing check and a gesture agreement score, and say what each leaves out.

## Context & Motivation

`internationalization-and-localization` moved an interface across locales. This lesson moves it off the desk: into a hand, a kitchen, a car, a headset. Two narratives frame that move: ubiquitous computing, from Mark Weiser's 1991 article, and post-WIMP interaction, a family of styles defined by what they leave behind.

Both attract retrofitting ("Weiser predicted the smartphone") and marketing vocabulary ("natural"). Evidence about modalities ages fast, so every finding below carries its date. Treat each as a snapshot.

## Core Theory

### WIMP and the names for what came after

Nielsen's 1993 article on noncommand interfaces lists the generation of "Windows, Icons, Menus, and a Pointing device", and says the next generation "may move beyond the standard WIMP paradigm". His name for that generation rests on control of the dialogue. The unifying concept, he wrote, is "the abandonment of the principle underlying all earlier interaction paradigms: that a dialogue has to be controlled by specific and precise commands issued by the user". The computer infers from observing the user instead.

Post-WIMP is a different kind of term. Jacob and colleagues credit the definition to van Dam: interfaces "containing at least one interaction technique not dependent on classical 2D widgets such as menus and icons". That definition is about technique, and it is broad: one swipe qualifies. The two terms also cut differently. "Set a timer for ten minutes" is post-WIMP by van Dam's definition and still a precise user command, so by Nielsen's principle it is still a command.

### Reality-based interaction

Jacob et al. (CHI 2008) propose reality-based interaction (RBI) as a concept that ties together "a large subset" of these styles, not all of them. Their claim is that the styles build on what people already know from the non-digital world, which often narrows the gulf of execution from `mental-models-and-the-gulfs-of-execution-and-evaluation`.

| Theme | What people already have | Example from the paper |
|---|---|---|
| Naive physics | Common-sense knowledge of gravity, friction, inertia | A flicked list keeps scrolling, "as if the list itself had mass" |
| Body awareness and skills | Knowing and coordinating one's own body | Two-handed and whole-body input |
| Environment awareness and skills | Orientation, navigation, handling objects | A context-aware guide showing what is around the user |
| Social awareness and skills | Noticing and working with others | Tangible interfaces for co-located collaboration |

The framework's main rule concerns trade-offs: "the goal is to give up reality only explicitly and only in return for other desired qualities". They name six: expressive power, efficiency, versatility, ergonomics, accessibility, and practicality. Their iPhone case study is a 2008 snapshot: the on-screen keyboard favors versatility and gives up the passive haptics of physical keys. They add that the themes "may not be entirely universal".

### Weiser's vision, and how to cite it

The article is "The Computer for the 21st Century", *Scientific American* 265(3), September 1991. The publisher's page shows its subtitle: "Specialized elements of hardware and software, connected by wires, radio waves and infrared, will be so ubiquitous that no one will notice their presence". Rogers (2022) gives one of the body's most cited lines as: "The most profound technologies are those that disappear. They weave themselves into the fabric of everyday life until they are indistinguishable". She summarizes the aim as "an easier, calmer way of living".

Bell and Dourish (2007) note that Weiser formed the vision in the late 1980s, and that the article was also a progress report on devices already built at Xerox PARC. Device classes came in tiers, summarized by Pavlus (2013) as tabs (small, wearable), pads (handheld, mobile), and boards (large, fixed). And Bell and Dourish read the setting as the workplace: "a tool for labor".

### Context awareness

Dey et al. (2001), as quoted by Dourish, define context as "any information that can be used to characterize the situation of entities". Dourish (2004) names four assumptions under that style of definition: context is information, it is delineable in advance, it is stable, and it is separable from the activity. He then proposes an interactional view, whose central question is "how and why, in the course of their interactions, do people achieve and maintain a mutual understanding of the context for their actions?" Example 4 shows what that changes in a design.

### Modalities, with dates

**Touch.** Under WCAG 2.2 (W3C version of 12 December 2024), criterion 2.5.8 Target Size (Minimum), new in 2.2 at Level AA, asks for 24 by 24 CSS pixels with listed exceptions. Criterion 2.5.5 (Enhanced) asks for 44 by 44 at Level AAA. Criterion 2.5.1 Pointer Gestures (Level A) requires that multipoint or path-based gestures also work with a single pointer and no path, unless the gesture is essential, and 2.5.7 Dragging Movements (Level AA, new in 2.2) sets a similar rule for dragging. Apple's Human Interface Guidelines, as published in November 2026, list 44x44 pt as the iOS default control size and 28x28 pt as the minimum. So "44" is a default in one vendor's table and a Level AAA threshold in another document, not a law. The two also use different units.

**Voice.** Whitenton and Budiu (NN/g, September 2018) asked 211 daily assistant users, drawn from 464 respondents, about their last interaction. Most reported single-step tasks, nobody reported a research activity, and hands-free use, mostly while driving, was the most mentioned benefit (35% of those daily users). The authors conclude that people use assistants "only for the easiest tasks, mostly when their hands are busy". That is self-report about 2018 products. Amazon announced Alexa+, built on generative AI, in February 2025, so the 2018 task mix needs newer data before it is assumed to hold or to have changed.

Recognition also fails unevenly. Koenecke et al. (PNAS, 2020) ran five commercial systems on interviews with 42 white and 73 Black speakers across five US cities. The mean word error rate was 0.35 for Black speakers and 0.19 for white speakers, about 3.5 versus 1.9 errors per 10 reference words. The corpus was interviews, not assistant commands, and these are the systems of that period.

**Gesture.** Norman (2010) writes: "Most gestures are neither natural nor easy to learn or remember." His central complaint is that gestures are ephemeral: they leave no record, so a wrong response gives little information about why. Wobbrock et al. (CHI 2009) elicited 1080 gestures from 20 non-technical participants on a tabletop, for 27 commands. They found that desktop idioms strongly influence mental models, and that some commands draw little agreement, which suggests on-screen widgets (Example 3). Microsoft ended Kinect production in October 2017 after a reported 35 million units sold across two versions, but price and content shape such outcomes too, so that is no usability result. Touch gestures such as pinch did spread, and Norman's own essay treats such gestures as conventions that develop and get learned.

**Gaze.** Jacob (CHI 1990) named the core hazard: "Everywhere you look, another command is activated; you cannot look anywhere without issuing a command." Apple's visionOS guidance (November 2026) separates the two acts: looking highlights an element, and an indirect gesture commits. It also asks designers to "give people multiple ways to interact".

### Book versus today: Weiser's vision

| Claim, as reported | What held up | What did not, or changed |
|---|---|---|
| Computation spreads through everyday life | "Computation is embedded into the technology and practice of everyday life" (Bell and Dourish 2007). 91% of US adults own a smartphone, up from 35% in 2011 (Pew, 2026; US only, survey mode changed in 2023) | Much of it concentrated in one personal device, which Rogers (2022) says "became an extension of ourselves, rather than disappearing into the environment" |
| Tabs, pads, boards | Phones, tablets, and watches fit the tiers loosely (Pavlus 2013: the smartphone straddled tab and pad) | Only "family resemblances" (Bell and Dourish), not a match |
| Technology disappears | People use computational devices "without thinking of them as computational" (Bell and Dourish) | "Rather than being invisible or unobtrusive, ubicomp devices are highly present, visible, and branded" (same paper) |
| A break from the desktop paradigm | New device classes arrived | "The desktop computer has not been displaced, but augmented" (Bell and Dourish, 2007) |
| Seamless, calm infrastructure | | Bell and Dourish call the result messy. Rogers reports that computing "had taken quite different turns from being calm" |
| Workplace use | Work remains one use | Social, domestic, religious, and political uses, listed by Bell and Dourish |

Bell and Dourish's paper was accepted in 2006, before the 2007 smartphone in Rogers's account, and it also calls the vision "a very American one". Rogers argues for engagement over calm, which is a design position, not a measurement.

## Worked Examples

### Example 1: an RBI reading of a web map on a phone

This table is an analysis for this lesson, not from Jacob et al. WCAG applies here because the map is web content.

| Feature | RBI theme or trade-off |
|---|---|
| Flick to pan, with momentum | Naive physics |
| Pinch to zoom | Body skill, though a learned convention |
| View follows the user's position | Environment awareness |
| Search box | Gives up reality for efficiency and expressive power |
| Zoom buttons | Gives up reality for accessibility: 2.5.1 requires a single-pointer way to do what pinch does, and 2.5.7 requires a non-dragging way to pan |

The buttons look redundant until you ask who cannot pinch. Each departure from reality buys a named quality.

### Example 2: target size, in numbers

Take a row of 20 by 20 CSS pixel icons, below the 24 minimum. They can still pass through the Spacing exception: a 24 pixel diameter circle centered on each must not intersect another target or another undersized target's circle.

```text
width 20, gap 2: pitch 22, circles overlap    -> spacing exception fails
width 20, gap 4: pitch 24, circles just touch -> boundary
width 20, gap 6: pitch 26, circles clear      -> spacing exception passes
```

Circles of diameter 24 stop overlapping once the center-to-center pitch reaches 24, so a gap of 4 is the boundary, and a wider gap avoids relying on it. A real layout must check every neighbor. Now use the Shannon form from `fitts-law-and-hicks-law`, $ID=\log_2(D/W+1)$, for a thumb travel of $D=300$ pixels:

```text
D=300, W=24: ID = 3.75 bits
D=300, W=44: ID = 2.97 bits
```

The difference is about 0.8 bits. Turning it into milliseconds would need $a$ and $b$ from a regression on a specific device, so no time is claimed. Passing 2.5.8 is a floor, not evidence of comfortable use.

### Example 3: gesture agreement

For one command, Wobbrock et al. group identical gestures and compute $A_r=\sum_i(\lvert P_i\rvert/\lvert P_r\rvert)^2$, then average over commands. Their "move a little" (two hands) had groups of 12, 3, 3, and 2 out of 20, which gives $0.415$ (the paper rounds to 0.42). Overall agreement was 0.32 for one hand and 0.28 for two.

The next three commands are fictional, invented to show the arithmetic:

```text
command   groups (20 people)     A
delete    14, 4, 2               0.540
undo      6, 5, 5, 4             0.255
help      4, 3, 3, 3, 3, 2, 2    0.150
```

With 20 people, the floor is $0.05$ (everyone differs). A designer could keep a gesture for "delete" and give "help" an on-screen widget, which is the direction the paper suggests for low-agreement commands. The paper sets no universal cutoff, and the numbers come from one tabletop study.

### Example 4: a context rule that breaks

A phone silences calls when the calendar shows a meeting and location says "office". That rule treats context as delineable and stable. Now the user is waiting for a call from a hospital. The sensed fields are correct and the action is wrong, because what matters is how the people involved take the situation. Applying Dourish's view (the fix is this lesson's, not his), the design shows what it inferred and offers a one-step override.

## Common Misconceptions & Pitfalls

- **"Weiser predicted the smartphone."** The tiers resemble later devices, but Rogers notes that the phone became an extension of ourselves instead of disappearing.
- **"Post-WIMP replaced WIMP."** Bell and Dourish reported augmentation in 2007, and Jacob et al. still use an expert's hotkeys as the case where efficiency beats reality.
- **"Natural means no learning."** Norman's point is that most gestures must be learned, and Wobbrock's data show low agreement for some commands.
- **"Voice is hands-free, so it is accessible."** Error rates in Koenecke et al. differ by speaker group, and a person who cannot speak clearly needs another route.
- **"Context awareness means more sensors."** Dourish's objection applies to perfect data too.

## Summary

WIMP names a generation, post-WIMP (van Dam's definition, via Jacob et al.) names a broad set of techniques, and noncommand (Nielsen) names a shift in who controls the dialogue. RBI explains what many of those styles borrow from reality, and insists that reality be traded only for named qualities. Weiser's vision held up on the spread of computation and missed on invisibility, seamlessness, calm, and the workplace frame, as Bell and Dourish (2007) and Rogers (2022) document. Claims about touch, voice, gesture, and gaze need a date, a population, and a task.

## Documentation Links

- [Jacob et al. (2008): Reality-Based Interaction](https://www.cs.tufts.edu/~jacob/papers/chi08.pdf): themes, trade-offs, and the iPhone case.
- [Nielsen (1993): Noncommand User Interfaces](https://www.nngroup.com/articles/noncommand/): generations, WIMP, and noncommand interfaces.
- [Scientific American: The Computer for the 21st Century](https://www.scientificamerican.com/article/the-computer-for-the-21st-century/): citation and subtitle.
- [Bell and Dourish (2007): Yesterday's Tomorrows](https://www.dourish.com/publications/2007/BellDourish-YesterdaysTomorrows-PUC.pdf): the vision against later practice.
- [Rogers (2022): The Four Phases of Pervasive Computing](https://discovery.ucl.ac.uk/10153147/1/Rogers_Four%20Phases%20of%20Pervasive%20Computing-Rogers-Jun22.pdf): quotes Weiser and reviews the field.
- [Pavlus (2013): How Smart Watches and Phablets Fulfill a 20-Year-Old Prophecy](https://www.technologyreview.com/2013/03/18/179356/how-smart-watches-and-phablets-fulfill-a-20-year-old-prophecy-about-ubiquitous-computing/): the device tiers, read in 2013.
- [Dourish (2004): What We Talk About When We Talk About Context](https://www.dourish.com/publications/2004/PUC2004-context.pdf): two views of context.
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/): criteria 2.5.1, 2.5.5, 2.5.7, 2.5.8.
- [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): control sizes per platform.
- [Apple HIG: Eyes](https://developer.apple.com/design/human-interface-guidelines/eyes): gaze in visionOS.
- [Whitenton and Budiu (2018): The Paradox of Intelligent Assistants](https://www.nngroup.com/articles/intelligent-assistants-poor-usability-high-adoption/): 211 daily users.
- [Koenecke et al. (2020): Racial Disparities in Automated Speech Recognition](https://ideas.repec.org/a/nas/journl/v117y2020p7684-7689.html): abstract.
- [Amazon (2025): Introducing Alexa+](https://www.aboutamazon.com/news/devices/new-alexa-generative-artificial-intelligence): vendor announcement.
- [Norman (2010): Natural User Interfaces Are Not Natural](https://jnd.org/natural-user-interfaces-are-not-natural/): the essay.
- [Wobbrock et al. (2009): User-Defined Gestures for Surface Computing](https://faculty.washington.edu/wobbrock/pubs/chi-09.02.pdf): elicitation and agreement.
- [Game Developer (2017): Microsoft kills the Kinect](https://gamedeveloper.com/business/microsoft-kills-the-kinect-as-production-shuts-down): end of production.
- [Jacob (1990): What You Look At Is What You Get](https://www.cs.tufts.edu/~jacob/papers/chi90.pdf): the Midas Touch problem.
- [Pew Research Center (2026): Americans' Use of Mobile Devices](https://www.pewresearch.org/internet/fact-sheet/mobile/): US ownership data.
