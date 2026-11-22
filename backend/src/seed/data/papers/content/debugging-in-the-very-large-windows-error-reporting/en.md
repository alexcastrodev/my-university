---
title: "Debugging in the (Very) Large: Ten Years of Implementation and Experience"
summary: Windows Error Reporting (WER) is a service that collects crash and hang reports from about a billion machines, groups them into buckets with client and server heuristics, collects more data only when needed, and uses the resulting statistics to decide which bugs to fix first. This is the ten-year retrospective from the Microsoft team.
researchArea: Software Engineering
keywords: error reporting, bucketing, crash triage, progressive data collection, statistics-based debugging, post-mortem debugging, minidump
version: 1.0
updatedAt: 2026-11-22
---

## Overview

Debugging one program on one machine is a solved routine: reproduce, attach a debugger, read the state. The paper starts from the observation that this routine stops working when a system has hundreds of components and millions of installations. Triaging reports one by one does not scale, root causes hide among many components, and the volume of reports for even a rare bug becomes overwhelming. Windows Error Reporting (WER) is Microsoft's answer, in use since 1999, and this SOSP 2009 paper describes its design and what ten years of operation taught the team.

The central move is to treat scale as the resource instead of the obstacle. Take people out of the critical path, accept millions of reports, and the law of large numbers does the rest: you do not need every report, only enough samples to diagnose and correlate. Even a wrong grouping repairs itself, because once the first bug is fixed, the second one reappears and dominates the later samples. The paper is a systems paper about an operational service, not a controlled experiment, and it should be read that way.

## Contribution

- **Bucketing.** Error reports likely to come from the same bug are grouped into a bucket, with the stated ideal of one bug per bucket and one bucket per bug. Grouping happens in two phases. First, client-side labeling assigns a first bucket from local evidence (program, module, offset of the crashing instruction, exception code). Then server-side classifying moves reports to other buckets as more data arrives. The classifier is the `!analyze` debugger extension, about 100,000 lines of code with some 500 heuristics, with roughly one heuristic added per week.
- **Expanding and condensing heuristics.** An expanding heuristic splits buckets so two bugs do not share one. A condensing heuristic merges buckets so one bug does not spread over many. The paper says the two kinds must complement each other, not conflict.
- **Progressive data collection.** Most reports are only a bucket identifier. If the service wants more, it asks for a minidump (an abbreviated stack and memory dump), then for broader dumps, related processes, log files, registry keys or system queries. Programmers can issue a "data wanted" request for a bucket.
- **Statistics-based debugging.** The central database lets programmers rank buckets by volume, find hidden causes by comparing expected and observed frequencies of modules, test hypotheses against thousands of dumps, measure how widely a fix has been deployed, and watch for regressions.
- **Direction to solutions.** The service keeps a mapping from buckets to a URL with a fix, so a user hitting a known problem is sent to the update.

## Methodology

This is an experience paper. The authors describe the algorithms and the architecture, then report measurements taken from the production service and from internal and beta releases of Microsoft products. There is no comparison against an alternative system and no controlled study. The architecture section covers the four-stage client protocol, the service, and the storage. The evaluation covers scalability, bug finding, the quality of the bucketing heuristics, and a set of aggregate measurements about third-party use and the Windows installed base.

## Findings

The numbers below are from the text. Figures are plots and I used only values stated in the text.

- **Scale.** WER collected its first million reports within 8 months of its 1999 deployment and billions since. From January 2003 to January 2009 report volume grew by a factor of 30, against a factor of 13 for the number of clients connecting to Windows Update. The service has about 60 servers, a 65 TB storage network for the report database and a 120 TB one for up to 6 months of raw dump archives. It is provisioned for well over 100 million reports a day.
- **Progressive collection pays off.** In the first stage of the protocol, a static page tells the client whether the service already has enough data, which is the case for over 90 percent of reports. That is what lets one pair of database servers record the errors of all Windows machines.
- **Worked example of load.** In February 2007 the Renos malware made the shell crash in a loop. Reports rose from zero to almost 1.2 million per day. A Defender signature released on February 27 brought them under 100,000 within three days.
- **Value for fixing bugs.** Windows Vista programmers fixed over 5,000 bugs found by WER in betas, after static analysis and model checking had found over 100,000. Across Windows, SQL, Office and Internet Explorer data, a bug reported by WER is 4.5 to 5.1 times more likely to be fixed than one reported directly by a person.
- **Pareto shape.** The first quartile of reports sits in significantly less than 1 percent of buckets, and the last quartile spans 88 to 93 percent of them. In Vista, the top 500 buckets hold 65 percent of reports, and 58 percent in Vista SP1, since the largest were fixed.
- **Rare bugs become findable.** In a pre-release of MSN Explorer with 3.6 million users, less than 0.18 percent of users saw two or more failures in 30 days. At that rate, a lab never sees the bug, but WER found Windows NT and Office bugs that had lived over five years.
- **Hidden cause by statistics.** In one case, 96 percent of the machines reporting an invalid pointer in the tracing infrastructure ran one third-party driver, far above that driver's share of the population. The vendor found the bug. In another, a vendor already knew about a processor bug but had not realized how often it occurred until shown the WER data, and released a microcode fix.
- **Bucketing quality.** Over a sample of 300 million reports in 25 million buckets, the most important labeling heuristic by far was `module_offset`. As a pessimistic bound on condensing failures, the authors assume every bucket with a single report is misplaced, since real bugs are hit more than once. By that bound as much as 37 percent of PowerPoint reports in the Office 2010 internal preview may be misplaced. Over-condensing is much rarer, and each `!analyze` improvement is re-run over the kernel minidumps kept for six months.
- **Providers improve.** One kernel-mode provider began using WER in May 2007 and, within five months, its share of kernel crashes dropped from 7.6 to 3.8 percent.

## Critical Analysis

The evidence is a ten-year operational history from the team that built the system. It is rich, but it is largely observational. The authors explain the 4.5 to 5.1 times figure by saying WER reports document internal computation state while human reports document external symptoms, but they do not control for the kinds of bug each source finds, and there is no baseline of a project that did not use WER. It is a correlation inside one company's workflow.

The points below are a reading of the paper, not claims it makes.

- **The bucket count is a quality metric the paper cannot fully check.** The one-hit-wonder rule is an assumption stated by the authors, and an upper bound. It treats a bucket of one report as an error of the grouping, which is plausible for crashes but is an assumption, not a measurement. The authors say the design of optimal bucketing remains open.
- **Heuristics are tied to a specific stack.** Most of the 500 heuristics depend on Windows internals: stack frames, loaded modules, kernel pool state. The idea transfers (group by a stable signature, refine as more data arrives), but the heuristics themselves do not.
- **Privacy rests on policy more than on mechanism.** The service zeroes known identifiers and minimizes heap collection, but states it lacks the metadata to filter possible personal data from stacks and heap, and relies on informed consent and data-access policy.
- **Its worldview is crashes.** Hangs, installation failures and assertions enter through custom code. Failures that do not crash or that depend on distributed state are outside what a minidump can show. Studies that mine bug trackers, such as [What Bugs Live in the Cloud?](/papers/what-bugs-live-in-the-cloud-a-study-of-3000-issues-in-cloud-systems), see the failures people chose to report, a different sample from the one WER collects automatically.

## Further Research

- The DSN 2011 paper on crash graphs (Kim, Zimmermann and Nagappan) is described as addressing misclassification of crashes, which is the weakness named here. I did not read it.
- Compare label-then-classify with log template extraction, which solves a similar grouping problem on text, not on stacks.
- Measure how well a stable signature predicts a single root cause outside crash dumps, for instance for failed messages in a queue or failed jobs in a pipeline.
- Re-read the privacy section against the current regulation that applies to automatically collected diagnostic data.
