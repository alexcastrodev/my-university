---
version: 1.0
updatedAt: 2026-11-03
---
## Learning Objectives

- Tell the history of the Software CMM accurately: who started it, why, and how a maturity framework and its questionnaire developed into a five-level model.
- Name the five CMM levels, and say what the model deliberately did not claim.
- State who owns CMMI today and how it changed hands.
- Explain what a maturity rating does and does not tell you about a product.

## Context & Motivation

`software-process-models-waterfall-and-its-real-history` showed that early process vocabulary came from organizations that wrote contracts, set milestones, and signed off phases. This lesson covers the other half of that story: how those organizations decided whom to trust with a contract. The answer the SEI worked toward from 1986 was to measure the contractor's process, in a framework that also aimed to help organizations improve it. The result was the Capability Maturity Model (CMM) and, later, the CMMI family.

This is a historical lesson, framed as "book versus today". Maturity models still exist and are still sold, so they are not dead. But many textbooks present the five levels as the way professional software organizations are graded, which is a description of the 1990s and not a measured account of current practice. This lesson gives what the model said, who maintains it now, and what can and cannot be concluded from that.

The previous lesson, `the-iso-iec-25010-quality-model`, described the quality of a product. A maturity model describes the organization that produces it. The introduction of the 2023 edition of 25010 notes that the SQuaRE product standards can be used alongside the ISO/IEC 33000 family on software process assessment: one family describes the product, the other assesses the process. Process quality and product quality are related, not identical, and that gap is the whole controversy.

## Core Theory

### Origins: a government problem and a questionnaire

The primary source is the SEI report CMU/SEI-93-TR-024, Capability Maturity Model for Software, Version 1.1 (Paulk, Curtis, Chrissis, Weber, February 1993). Its preface says that in November 1986 the Software Engineering Institute, with help from the Mitre Corporation, began developing a process maturity framework that would help organizations improve their software process. The effort was initiated in response to a request to give the federal government a way to assess the capability of its software contractors. In September 1987 the SEI released a brief description of the framework and a maturity questionnaire, a simple tool for finding areas where an organization's process needed improvement.

The report is candid about what went wrong: the questionnaire "was too often regarded as 'the model' rather than as a vehicle for exploring process maturity issues". After four years of experience with the framework and the preliminary questionnaire, the SEI evolved the framework into the CMM. Version 1.0 appeared in August 1991 and version 1.1, the one most textbooks describe, in February 1993.

The report also gives the lineage. Philip Crosby's quality management maturity grid (*Quality Is Free*, 1979) inspired the idea of maturity stages. Ron Radice and colleagues, working under Watts Humphrey at IBM, adapted it to software. Humphrey brought it to the SEI in 1986 and added maturity levels. He was the first director of the SEI's Software Process Program.

### The five levels

```text
Level 1  Initial     ad hoc, occasionally chaotic; success depends on
                     individual effort
Level 2  Repeatable  basic project management tracks cost, schedule, and
                     functionality; earlier successes can be repeated
Level 3  Defined     a documented, standard process for the whole
                     organization, tailored by each project
Level 4  Managed     detailed measures of process and product quality are
                     collected and controlled quantitatively
Level 5  Optimizing  continuous improvement driven by quantitative
                     feedback and piloted innovations
```

Levels 2 to 5 are decomposed into key process areas. Counting the report's figure, level 2 has six (including requirements management, project planning, quality assurance, and configuration management), level 3 has seven, level 4 has two, and level 5 has three: 18 in all. Level 1 has none, since it is defined by the absence of a stable process.

### What the model said about itself

Several statements in the report cut against the usual summary:

- It is "not prescriptive; it does not tell an organization how to improve".
- Level 1 organizations "frequently develop products that work, even though they may be over the budget and schedule". The complaint is unpredictability and dependence on heroes, not guaranteed failure.
- The model was written with "a large contracting organization" in mind and needs professional judgment when the business environment differs significantly.
- Moving from level 1 to level 2 can take "several years"; moving between the other levels usually takes "on the order of two years".

### From CMM to CMMI, and who owns it

These facts come from the CMMI Institute's company page and ISACA's 2023 announcement. The SEI released the first CMM version in 1991. Carnegie Mellon founded the CMMI Institute in 2012, and in 2016 ISACA, a nonprofit professional association, acquired it. CMMI V2.0 launched in 2018. ISACA announced V3.0 in April 2023, describing it as extending beyond product development, service operations, and supplier management into security, safety, data management, people management, and managing a virtual workforce, across eight domains, and tracing CMMI's roots to the Software CMM. So today CMMI is an ISACA product, not an SEI one.

The original Software CMM was succeeded by CMMI. Secondary summaries give the CMMI staged level names as Initial, Managed, Defined, Quantitatively Managed, and Optimizing, which differ from the 1993 names, so check the current model documents before relying on them.

### What industry added, and the limits of that claim

Three documented developments sit beside maturity models. The Agile Manifesto (2001) states a preference for "individuals and interactions over processes and tools" and "working software over comprehensive documentation". The SEI published "CMMI or Agile: Why Not Embrace Both!" (2008), proposing to use both. And the DORA research program, run by Google Cloud, measures delivery by observable outcomes, which the next lesson covers.

How widely CMMI is used today is a separate empirical question that this lesson does not answer. The documented claim is narrower: the CMM grew out of a framework meant both to help organizations improve their process and to let the government assess contractors by it, much product-software practice since has also looked at outcomes visible in the delivery pipeline, and appraisal-based ratings remain in use and under active development.

## Worked Examples

### Example 1: classifying four organizations

1. "Every project estimates, tracks schedule, and baselines requirements, but each team does it its own way." Level 2: the controls exist, but there is no single organizational standard process.
2. "A documented organizational process exists, and projects tailor it with approval." Level 3.
3. "Delivery depends on two senior engineers; when one left, the next release slipped by a quarter." Level 1, the dependence on individuals the report names.
4. "We collect defect and effort data on every project and use control limits to decide when a process is out of bounds." Level 4.

Each level asserts something about process discipline. None says whether the product is fast, secure, or pleasant to use.

### Example 2: how long is a climb?

If you read the report's "several years" for level 1 to 2 as three, then add two years for each of the three later steps, a script gives 3 + 2 + 2 + 2 = 9 years from level 1 to level 5. This illustrates the report's wording and is not a measured figure, but it shows why treating a level as a quarterly goal would distort what the level was meant to represent.

### Example 3: what "we are CMMI level 3" tells a customer

A vendor says it has been appraised at maturity level 3. It is reasonable to infer that the appraised unit had documented, standardized processes at the time. It is not reasonable to infer a defect rate, a deployment frequency, or any 25010 quality. For those, the customer needs product and delivery evidence, such as the measurable requirements from `the-iso-iec-25010-quality-model` and the delivery measures in the next lesson.

## Common Misconceptions & Pitfalls

- **"The CMM is how software organizations are graded today."** That is the textbook picture. CMMI is an ISACA-owned product line, and the textbook picture is not a measure of how widely it is used.
- **"Higher level means better software."** The report says level 1 organizations often ship working products. The levels describe predictability and process discipline.
- **"The CMM tells you how to improve."** The report says it is not prescriptive.
- **"The questionnaire is the model."** The SEI named this as an early mistake.
- **"Agile replaced CMM."** The SEI's 2008 report argues that the two are compatible and proposes using both. Nothing cited here documents a formal replacement; any shift in emphasis toward delivery outcomes is a reading of the sources above, not something they state.

## Summary

The Software CMM began in 1986 at the SEI as a process maturity framework to help organizations improve their software process, prompted by a federal request for a way to assess software contractors. The framework, released in 1987 with a questionnaire, was evolved into a five-level model (Initial, Repeatable, Defined, Managed, Optimizing) with 18 key process areas, reaching version 1.1 in 1993, and descends from Crosby's maturity grid through Humphrey and IBM. Its authors stressed that it is not prescriptive and that level 1 organizations can ship working products. CMMI succeeded it, moved to a CMMI Institute in 2012, and has been owned by ISACA since 2016, with V3.0 announced in April 2023. A maturity rating describes process discipline, not product quality. Agile values and outcome-based delivery measures grew up beside it, but how common CMMI is today is a separate question this lesson leaves open.

## Documentation Links

- [SEI: Capability Maturity Model for Software, Version 1.1 (CMU/SEI-93-TR-024)](https://resources.sei.cmu.edu/asset_files/TechnicalReport/1993_005_001_16211.pdf): the primary source for the origin, lineage, five levels, 18 key process areas, and the statements the model makes about itself.
- [CMMI Institute: company history](https://cmmiinstitute.com/company): the owner's own timeline, including the 1991 first version, the 2012 CMMI Institute, the 2016 acquisition by ISACA, and V2.0 in 2018.
- [ISACA: CMMI updates take performance improvements to the next level (2023)](https://www.isaca.org/resources/news-and-trends/isaca-now-blog/2023/cmmi-updates-take-performance-improvements-to-the-next-level): the announcement of CMMI V3.0, its eight domains, and ISACA's account of the model's history.
- [SEI: CMMI or Agile: Why Not Embrace Both! (2008)](https://www.sei.cmu.edu/library/cmmi-or-agile-why-not-embrace-both/): the SEI note arguing that CMMI and agile methods can be used together.
- [Agile Manifesto](https://agilemanifesto.org/): the four value statements of 2001 cited as the contrasting stance.
- [Wikipedia: Capability Maturity Model Integration](https://en.wikipedia.org/wiki/Capability_Maturity_Model_Integration): a secondary summary of CMMI's history and staged level names, to be checked against current model documents.
