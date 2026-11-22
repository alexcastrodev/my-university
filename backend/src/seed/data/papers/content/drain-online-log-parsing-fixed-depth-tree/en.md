---
title: "Drain: An Online Log Parsing Approach with Fixed Depth Tree"
summary: Drain turns raw log lines into templates and groups in a single streaming pass, using a parse tree of fixed depth that routes each line by its length and its first tokens before a similarity check. On five public log sets it matches or beats earlier parsers on accuracy and runs faster than the other online parsers.
researchArea: Software Engineering
keywords: log parsing, log templates, online algorithm, fixed depth parse tree, log analysis, anomaly detection, log groups
version: 1.0
updatedAt: 2026-11-22
---

## Overview

Logs are often the only record of what a running system did, and most analysis techniques (anomaly detection, fault diagnosis, performance work) need structured events, not free text. The first step is log parsing: split each line into a constant part, the template, and variable fields. Writing and maintaining regular expressions by hand does not scale. The paper gives three reasons: log volume grows fast (a large service can write 50 GB, or 120 to 200 million lines, per hour), components are written by hundreds of developers who do not know each other's logging purpose, and logging statements change constantly.

Earlier data-driven parsers were mostly offline. They need the logs of a period collected first, are limited by the memory of one machine, and do not match how logs are shipped, which is line by line to a central server. Drain, from the Chinese University of Hong Kong and Sun Yat-sen University, is an online parser: it needs no training step, no source code, and processes each line as it arrives. It is a conference paper at ICWS 2017.

## Contribution

- **A fixed depth parse tree.** The tree has a root, internal nodes and leaf nodes, and every leaf sits at the same depth, set by a parameter. Internal nodes encode search rules and hold no log groups. Leaves hold lists of log groups, each with a template (the log event) and the IDs of the lines in it. Fixing the depth bounds how many nodes are visited for any line.
- **Two encoded rules.** The first layer routes by message length (number of tokens), on the assumption that lines of one event usually have the same length. The next layers route by the first tokens, on the assumption that the start of a line is more likely constant. Tokens with digits are sent to a wildcard node, and a `maxChild` parameter caps the children of a node, so lines that start with a number do not blow up the tree.
- **A five-step procedure.** Preprocess with simple regular expressions for known variables such as IPs and block IDs, search by length, search by preceding tokens, choose the group with the best token-by-token similarity (accepted if it is at or above a threshold `st`), then either update the template with wildcards where tokens differ or create a new group and the missing tree nodes.
- **Released code.** The source of Drain was made public.

## Methodology

The authors evaluate Drain on five real log sets, with more than 10 million lines in total, from supercomputers (BGL, from Lawrence Livermore, and an HPC cluster), a distributed system (HDFS on a 203-node cluster on Amazon EC2, and ZooKeeper on a 32-node cluster in their lab) and a standalone program (Proxifier). Three of the sets came from other researchers, because companies rarely release logs.

Four existing parsers are the baselines: LKE and IPLoM (offline), SHISO and Spell (online). Accuracy is an F-measure over pairs of messages: two messages of the same event put in the same group count as a true positive, two of different events put in the same group a false positive, and two of the same event put in different groups a false negative. Runs used a server with an Intel Xeon E5-2670v2 and 128 GB of RAM, repeated 10 times, with each parser re-tuned by the authors. A case study then feeds each parser's output into an anomaly detection workflow on HDFS logs, where PCA over an event count matrix marks blocks as normal or abnormal.

## Findings

Numbers below are from Tables III, IV and VI and the text.

- **Accuracy.** Drain scores 0.99 on BGL, 0.84 on HPC, 0.99 on HDFS, 0.99 on ZooKeeper and 0.86 on Proxifier. The paper says it is best on four sets and second on Proxifier, where Spell scores 0.87. IPLoM, an offline parser, ties Drain at 0.99 on BGL, HDFS and ZooKeeper, so "highest" there includes a tie.
- **LKE is evaluated on samples.** LKE is quadratic and could not finish in reasonable time (days or weeks) on four of the sets, so its accuracy there is computed on 2,000-line samples, as in earlier work by the authors.
- **Speed.** Drain needs 115.96 s for BGL (4,747,963 lines) and 325.7 s for HDFS, against 447.14 s and 676.45 s for Spell, the next best online parser. SHISO needs 10,964.55 s on BGL. The authors report improvements of at least 51.85 percent over the online parsers on all five sets, and 81.47 percent on HPC. IPLoM is close (140.57 s on BGL, 333.03 s on HDFS) but loads all the logs in memory. The paper argues the cost is linear in the number of lines, O((d + cm)n), with d the depth, c the candidate groups in a leaf and m the message length.
- **Scaling.** On 25 samples of increasing size, LKE grows fastest because it is quadratic, while Drain, Spell and SHISO are linear.
- **Case study.** On 575,061 HDFS blocks with 16,838 labeled anomalies, Drain and IPLoM both give 10,998 reported anomalies, 10,720 detected (63 percent) and 278 false alarms. The version with perfect parsing reports 11,473, detects 11,195 (66 percent) and has the same 278 false alarms. SHISO, with accuracy 0.93, reports 13,050 and has 1,907 false alarms, about 6 times more than the others. Higher parsing accuracy did not guarantee a better result downstream, which is the point of the study.

## Critical Analysis

The evaluation is clear and uses five datasets from different kinds of systems. It is also a snapshot: the tuned parameters differ per dataset (Table II), the baselines were re-tuned by the same authors, and the datasets are logs from systems that predate the paper, which say little about current logging styles.

The points below are a reading of the paper, not claims it makes.

- **The two assumptions are about the shape of lines.** Routing by length assumes one event keeps one token count, and routing by leading tokens assumes the start of a line is constant. The paper admits variable length can occur and says simple post-processing can handle it, but it does not measure how often the assumptions break. A message that starts with a variable, or one whose number of tokens depends on a list, is placed in the wrong subtree until the digit rule or `maxChild` catches it.
- **Fragmentation is the risk the design trades for speed.** A group that is only joined by the similarity threshold `st` can split one event in several templates, and the metric counts that as false negatives. This is the same failure of grouping as the "second bucket" problem that [Debugging in the (Very) Large](/papers/debugging-in-the-very-large-windows-error-reporting) measures for crash reports, and the paper's own case study shows that small parsing errors reach the downstream detector.
- **Preprocessing carries domain knowledge.** The regular expressions for IPs and block IDs are small (at most two per set), but they are chosen by someone who knows the dataset. The headline result is not purely unsupervised.
- **Accuracy is about templates, not about meaning.** The metric checks grouping, not whether a template is a useful unit for diagnosis. The case study is one task on one dataset.

## Further Research

- Test how accuracy changes when logging statements change over time, since online parsers must keep their tree valid as templates evolve.
- Measure the fragmentation rate on logs from current systems, with structured and multi-line messages that the 2017 datasets do not cover.
- Compare against parsers based on language models, and against logging libraries that emit structured events from the start, which remove parsing from the pipeline.
- Use the groups as keys for deduplication or triage of failed messages, and measure how many distinct groups one root cause produces.
