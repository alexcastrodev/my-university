---
version: 1.0
updatedAt: 2026-11-03
---
## Learning Objectives

- Name the nine product quality characteristics of ISO/IEC 25010:2023 and say which ones were added or renamed relative to the 2011 edition.
- Explain what happened to the quality-in-use model, which older course notes still attribute to ISO/IEC 25010.
- Turn a quality characteristic into a checkable requirement: a sub-characteristic, a measure, a threshold, and a measurement method.
- Separate what the free material on the standard shows from what only the purchased text shows.

## Context & Motivation

`functional-vs-non-functional-requirements` ended by saying that non-functional requirements fall into well-known categories and that naming the category helps you write the requirement precisely. It used the category names (performance, reliability, security, maintainability) informally. This lesson gives the formal vocabulary behind those names, the ISO/IEC 25010 product quality model, with a warning attached.

The warning is that this is a dated standard. ISO/IEC 25010 appeared in 2011 and was replaced in November 2023. Textbooks, slide decks, and many web pages still list the 2011 characteristics, including "usability" and "portability", which are no longer top-level characteristics. A student who memorizes the old list writes requirements against a model ISO has withdrawn. So this lesson teaches the current edition and marks what older lists say as "book versus today".

The full text of the standard is sold, so the last part of Core Theory states what the free material does and does not show.

## Core Theory

### What the standard is for

ISO/IEC 25010:2023 is titled "Systems and software engineering, Systems and software Quality Requirements and Evaluation (SQuaRE), Product quality model". It is the second edition and replaces ISO/IEC 25010:2011. Its scope says the model applies to ICT products and software products and is "composed of nine characteristics (which are further subdivided into subcharacteristics)". It lists uses such as eliciting requirements, setting testing objectives, and setting acceptance criteria.

The model is a reference vocabulary, so that two people who say "reliability" mean the same thing. It does not say how much of each quality a product needs; that belongs to the requirements process.

### The nine characteristics of the 2023 product quality model

```text
1. Functional suitability   functional completeness, functional correctness,
                            functional appropriateness
2. Performance efficiency   time behaviour, resource utilization, capacity
3. Compatibility            co-existence, interoperability
4. Interaction capability   appropriateness recognizability, learnability,
                            operability, user error protection, user
                            engagement, inclusivity, user assistance,
                            self-descriptiveness
5. Reliability              faultlessness, availability, fault tolerance,
                            recoverability
6. Security                 confidentiality, integrity, non-repudiation,
                            accountability, authenticity, resistance
7. Maintainability          modularity, reusability, analysability,
                            modifiability, testability
8. Flexibility              adaptability, scalability, installability,
                            replaceability
9. Safety                   operational constraint, risk identification,
                            fail safe, hazard warning, safe integration
```

Two details are easy to miss. First, functional suitability is itself a quality characteristic: the standard defines it as the capability of a product to provide "functions that meet stated and implied needs of intended users" when used under specified conditions, one dimension among nine, with completeness, correctness, and appropriateness as its sub-characteristics. Second, the sub-characteristic "capacity" is defined as meeting requirements for the maximum limits of a product parameter, with the number of concurrent users given as an example.

### What changed since 2011 (book versus today)

The foreword of the 2023 edition lists its own changes, so these are safe to state:

- Safety was added as a characteristic with five sub-characteristics.
- Usability and portability were replaced by interaction capability and flexibility.
- Inclusivity and self-descriptiveness, resistance, and scalability were added as sub-characteristics of interaction capability, security, and flexibility.
- User interface aesthetics and maturity were replaced by user engagement and faultlessness.
- Accessibility was split into inclusivity and user assistance.

The 2011 total of eight is not printed in the foreword; it follows from these changes, while the 2023 count of nine is stated in the scope.

### Where quality in use went

Older sources describe ISO/IEC 25010 as two models: product quality and quality in use. The 2023 foreword says the other parts of the 2011 document moved to ISO/IEC 25002 (quality models overview and usage) and ISO/IEC 25019 (the quality-in-use model). The catalog description of ISO/IEC 25019:2023 says it defines a quality-in-use model composed of three characteristics. A third-party summary at arc42 names them beneficialness, freedom from risk, and acceptability; that is a secondary source, since the standard's text is sold.

The product model describes properties of the thing you build; the quality-in-use model describes outcomes when real people use it in a real context. The 2023 edition says interaction capability is "a prerequisite for usability", which is judged by the effectiveness, efficiency, and satisfaction of actual use.

### From characteristic to requirement

"The system shall be reliable" cannot fail a test. A checkable quality requirement has four parts:

1. The sub-characteristic it constrains (availability, not just "reliability").
2. A measure (the fraction of time the service is operational and accessible when required for use, which is how the ISO 25000 listing words availability).
3. A threshold (at least 99.9% over a calendar month).
4. A measurement method (what is counted, over what window, and how any statistic is computed).

The standard has an annex on using the model for measurement, and the SQuaRE family has a separate quality measurement division where the measures themselves live. This lesson covers only the four-part structure, which the examples exercise.

### What is public and what is sold

The full text of the standard is sold. Free material covers three things: the ISO catalog record; a publisher preview with the scope, the foreword, the contents, and the first definitions (functional suitability, performance efficiency, compatibility, and the opening of interaction capability); and a third-party listing at iso25000.com with the names of every characteristic and sub-characteristic and a short definition of each. That listing words its definitions as "degree to which ...", unlike the standard's own "capability of a product to ...", so it is a guide to the meaning and not a quotation of the standard. The definitions used in the examples below come from that listing and are marked as such. Only the purchased text shows the standard's own definitions of the remaining characteristics, the Annex A comparison with 2011, and the measurement annex.

## Worked Examples

### Example 1: classifying requirements from the earlier lesson

```text
"Reset emails delivered within 60 s, 95% of the time"  -> Performance efficiency / time behaviour
"At least 50,000 concurrent active sessions"           -> Performance efficiency / capacity
"Stored passwords hashed, never plaintext"             -> Security / confidentiality
"Remain available during a single data center outage"  -> Reliability / availability
"Add a payment provider without modifying existing
 provider code"                                        -> Maintainability / modifiability
```

The first three rows come from the earlier lesson's classification batch; the last two are its examples of non-functional statements. The earlier lesson called the 50,000-session statement scalability. In the 2023 model that word is a sub-characteristic of flexibility, and the ISO 25000 listing words scalability as handling growing or shrinking workloads or adapting capacity to variability. A fixed maximum such as 50,000 concurrent users matches the standard's definition of capacity instead. "Must grow from 50,000 to 500,000 as the business grows" would be scalability. The listing words confidentiality as data being accessible only to those authorized, availability as being operational and accessible when required for use, and modifiability as being modifiable effectively and efficiently without introducing defects or degrading existing product quality. Those fit rows 3 and 4. Row 5 is the closest call: its clause about not modifying existing provider code also reads like the listing's modularity, where a change to one component has minimal impact on others, so modifiability is a defensible choice, not the only one.

### Example 2: a proportion, a percentile, and the mean

A team writes: "The search endpoint responds within 300 ms for 95% of requests." They sample 20 latencies (ms): 112, 98, 130, 121, 105, 99, 140, 118, 126, 102, 95, 110, 133, 108, 250, 119, 101, 124, 640, 115. A script gives a mean of 147.3, a median of 116.5, and a maximum of 640. Exactly 19 of 20 sampled requests (95%) are at or under 300 ms, so the sample meets the proportion with no percentile estimator involved, but only at the margin: one more slow request would break it. The sample is not the service, though. The exact 95% confidence interval for 19 of 20 runs from about 75% to 99.9%, so the requirement also has to say which requests it covers, such as every request in a stated window.

Suppose the team restates it as "the 95th percentile is at most 300 ms". Now the estimator matters, because a percentile of 20 values has to be computed. Linear interpolation gives 269.5 ms. The nearest-rank method takes the ceil(0.95 x 20) = 19th sorted value, 250 ms. NumPy's `method="higher"` works from the zero-based position (n - 1) x 0.95 = 18.05 and takes the next sorted value above it, the 20th, which is 640 ms. The first two pass and the third fails, on identical data, because the methods differ in the position they compute (nearest-rank uses another formula) and in how they resolve a fractional position (linear interpolates between the neighbors, while `higher` jumps to the upper one). Two lessons follow. State the requirement as a proportion, or name the estimator if you use a percentile. And do not substitute the mean: 147.3 ms hides the 640 ms request. The sample would miss a "99% under 300 ms" target, and 20 samples is too few to support a 99% claim anyway.

### Example 3: an availability budget

Over a 30-day month a script gives these downtime allowances: 99.5% allows 216 minutes, 99.9% allows 43.2 minutes, and 99.99% allows about 4.3 minutes. Over a 365-day year, 99.9% allows 8.76 hours.

Both of the following calculations assume that component failures are independent, which is a strong assumption. For components in series, availabilities multiply: two components at 99.9% each give 0.999 x 0.999 = 0.998001, about 86.4 minutes of downtime per 30 days, twice the 43.2 minutes that each part alone allows. For two replicas at 99% each where either one suffices, unavailabilities multiply: 1 - 0.01 x 0.01 = 99.99%. A "99.9% availability" requirement that does not say whether it covers one component or the whole user-facing path is ambiguous in exactly this way.

### Example 4: migrating an old requirements document

A 2019 specification has a section "Usability: the system shall be accessible to users with disabilities." Under the 2023 model, usability is no longer a product characteristic, and accessibility was split into inclusivity and user assistance. The requirement cannot be moved over unchanged: it has to be re-read against the two new names and the interaction capability characteristic they sit under. Whether it becomes one requirement or two depends on what the stakeholders meant by "accessible". The migration forces a clarification the coarser old word hid.

## Common Misconceptions & Pitfalls

- **"ISO/IEC 25010 has eight characteristics, including usability and portability."** That is the 2011 edition, which has been replaced. The current product quality model has nine, with interaction capability, flexibility, and safety.
- **"25010 contains the quality-in-use model."** In 2011 it did. In 2023 that model moved to ISO/IEC 25019, as the foreword states.
- **"A requirement is done once it names a characteristic."** Example 2 shows data that meets a proportion requirement and can fail the same requirement restated as a percentile with an unnamed estimator. It needs a measure, a threshold, the population it covers, and a method that leaves no such choice open.
- **"Maximize all nine."** Characteristics trade off (strict security can cost time behaviour), so a specification states priorities, and the levels come from stakeholders and risk, not from the standard.

## Summary

ISO/IEC 25010:2023 defines nine product quality characteristics: functional suitability, performance efficiency, compatibility, interaction capability, reliability, security, maintainability, flexibility, and safety. Compared with 2011 it adds safety, replaces usability and portability with interaction capability and flexibility, and moves the quality-in-use model to ISO/IEC 25019, so older notes describe a withdrawn edition. A characteristic becomes a requirement only with a sub-characteristic, a measure, a threshold, and a measurement method, as the examples show. The full text is sold; free material shows the scope, foreword, contents, first definitions, and the names and short definitions of all sub-characteristics.

## Documentation Links

- [ISO: ISO/IEC 25010:2023 catalog page](https://committee.iso.org/standard/78176.html): the official record of the edition, its publication date, its status, and the statement that it replaces ISO/IEC 25010:2011.
- [ISO/IEC 25010:2023 publisher preview (iTeh)](https://cdn.standards.iteh.ai/samples/78176/13ff8ea97048443f99318920757df124/ISO-IEC-25010-2023.pdf): the preview pages, including the foreword's list of changes, the contents, the scope, and the first definitions.
- [ISO 25000: ISO/IEC 25010 characteristics and sub-characteristics](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010): a public listing of the nine characteristics and their sub-characteristics with short definitions, worded differently from the standard's own.
- [arc42 Quality Model: update on ISO 25010, version 2023](https://quality.arc42.org/articles/iso-25010-update-2023): a practitioner summary of what the 2023 edition added, renamed, and split.
- [IEC Webstore: ISO/IEC 25019:2023 Quality-in-use model](https://webstore.iec.ch/publication/90105): the catalog description of the standard that now holds the quality-in-use model.
- [arc42 Quality Model: ISO 25019](https://quality.arc42.org/standards/iso-25019): a third-party outline of the three quality-in-use characteristics and their sub-characteristics.
