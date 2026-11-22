---
title: "StepFly: Agentic Troubleshooting Guide Automation for Incident Diagnosis"
summary: StepFly runs troubleshooting guides with an LLM agent. It extracts an execution graph and reusable query templates from each guide offline, then executes the graph online with a scheduler and executors that share a memory, running independent steps in parallel. On 15 guides and 80 incidents it succeeds about 94 percent of the time with GPT-4.1.
researchArea: Software Engineering
keywords: troubleshooting guides, incident diagnosis, LLM agents, AIOps, execution DAG, query templates, site reliability engineering, parallel execution
version: 1.0
updatedAt: 2026-11-22
---

## Abstract

Effective incident management in large-scale IT systems relies on troubleshooting guides (TSGs), but their manual execution is slow and error-prone. While recent advances in LLMs offer promise for automating incident management tasks, existing LLM-based solutions lack specialized support for several key challenges, including managing TSG quality issues, interpreting complex control flow, handling data-intensive queries, and exploiting execution parallelism. We first conducted an empirical study on 92 real-world TSGs, and, guided by our findings, we present StepFly, a novel end-to-end agentic framework for troubleshooting guide automation. Our approach features a three-stage workflow: the first stage provides a comprehensive guide together with a tool, TSG Mentor, to assist site reliability engineers (SREs) in improving TSG quality; the second stage performs offline preprocessing using LLMs to extract structured execution directed acyclic graphs (DAGs) from unstructured TSGs and to create dedicated Query Preparation Plugins (QPPs); and the third stage executes online using a DAG-guided scheduler-executor framework with a memory system to ensure correct workflow and support parallel execution of independent steps. Our empirical evaluation on a collection of real-world TSGs and incidents demonstrates that StepFly achieves a ~94% success rate on GPT-4.1, outperforming baselines with less time and token consumption. Furthermore, it achieves a remarkable execution time reduction of 32.9% to 70.4% for parallelizable TSGs. Our code and sample data are publicly available at https://github.com/microsoft/StepFly.

## Overview

A troubleshooting guide (TSG) is the document an on-call engineer follows for a class of incident: query this log, check that deployment, compare two metrics, branch on the result. Following it by hand under time pressure is slow and easy to get wrong. The earlier [AutoTSG](/papers/autotsg-learning-and-synthesis-for-incident-troubleshooting) work turned guides into notebooks with classifiers and synthesized parsers. StepFly, from Microsoft and Tsinghua University and published in the Proceedings of the ACM on Software Engineering (FSE 2026), asks what an LLM agent can do with the same guides.

The authors' argument is that generic agents (they test ReAct and TaskWeaver) treat a guide as clean documentation, and it is not. Guides are long, have branches and early exits, carry large templated queries, and are written as sparse notes by experts. StepFly therefore adds structure around the model instead of leaving the plan to it.

## Contribution

- **An empirical study of 92 TSGs from 9 teams**, with findings on length (most about 3K tokens, 5 to 15 steps, up to 30), on independence of steps, on the share of query templates (about 35.85 percent of tokens on average) and on quality issues.
- **TSG Mentor and a writing guide.** A tool that classifies quality issues, reformats a TSG and gives inline suggestions. The guide requires that guides stay readable for people, not only for agents.
- **Offline extraction.** An LLM extracts an execution DAG from each TSG (nodes are steps, edges carry conditions) and Query Preparation Plugins (QPPs), which hold a query template and fill in its parameters, so the model does not write queries on the fly. TSG authors review the result.
- **Online execution.** A scheduler walks the DAG, marking nodes and edges as unknown, enabled or disabled. Executors run the steps with plugins and a code interpreter, with retries up to a limit. A key-value memory stores tool output so that large data moves by reference instead of through the prompt.
- **Parallelism.** Steps with no dependency run on several executors at once, as a team of engineers would split the work. Finding independent steps was done with SREs, and automating that is left for future work.

## Methodology

The study labeled the issues of the 92 TSGs line by line with four annotators (two researchers, two SREs), each TSG reviewed by two of them, with Cohen's kappa 0.78 and about 12 percent of items needing a third annotator. Issues fall in five groups: Clarity and Precision (37.4 percent), Database Instruction (27.2), Data Flow (20.4), Presentation and Structure (9.9) and Control Flow (5.1).

The evaluation uses 15 widely used TSGs, from 3 to 28 steps and 9 on average, and 80 real incidents from a production system at Microsoft. The 15 guides were revised by experienced SREs following the quality guidelines first. Past incidents give the ground truth. A run counts as a success only if both the execution path and the diagnostic conclusion match the human label. Each setting ran three times. Models were GPT-4.1, GPT-4.1-mini, GPT-4o and Grok-3.

## Findings

- **TSGs are hard for agents as written.** Many guides have long or branching flow, large queries and quality issues. The study finds nearly half of the TSGs have opportunities for parallel execution.
- **TSG Mentor.** With leave-one-out over the 92 TSGs and three similar guides as few-shot examples, it reaches recall 0.78, precision 0.85 and F1 0.81 at finding issues (a match is the same category within 5 lines).
- **Extraction is accurate.** Against ground truth corrected by SREs, DAG extraction gets node scores above 99 percent, edge F1 about 93.47 percent and condition matching about 91.78 percent. QPP extraction succeeded 97.3 percent of the time (251 successful extractions), and the failures came from the model.
- **Success rate.** Under GPT-4.1, StepFly reaches 94.38 percent, against 71.25 for ReAct and 80.0 for TaskWeaver, and 84.38 percent with GPT-4.1-mini. The gain over the better of the two baselines is from about 8 points (Grok-3) to about 20 (GPT-4o). The variant without QPPs is lower by 2.5 points (GPT-4.1) to 10.63 (GPT-4.1-mini). ReAct often stopped midway or produced wrong queries, and TaskWeaver often executed wrong steps.
- **Time and tokens.** The median time of StepFly is 88 percent of ReAct's and 38 percent of TaskWeaver's. Token use is lower for StepFly too.
- **Parallelism.** On 7 of the 15 TSGs that can be parallelized, with 2 to 5 executors, time falls between 32.9 and 70.6 percent (the abstract says 70.4, the text gives 70.6 for one guide and 70.4 for another), and the mean reduction with 5 executors is 51.31 percent. Adding executors beyond the guide's maximum parallelism does nothing.
- **Deployment.** A prototype is triggered automatically by incoming incidents. The authors report that it runs hundreds of times a week for over 170 monitors from more than 70 teams and has reduced median incident mitigation time by about 34 percent. The text I read gives no method for that figure.

## Critical Analysis

The system is built with care, and the design (a graph that constrains the agent, templates instead of generated queries, memory instead of prompt stuffing) addresses the failures the baselines show. The evidence has limits the authors partly state in their threats to validity.

The points below are a reading of the paper, not claims it makes.

- **The comparison is on revised guides.** The 15 TSGs were rewritten by SREs to meet StepFly's own quality guidelines before the evaluation, and extracted DAGs and QPPs are reviewed by authors. The 94 percent is the result of a pipeline with human preparation, not of raw guides, and the paper does not report accuracy on unrevised ones.
- **Baselines get less structure by design.** ReAct and TaskWeaver share the prompt and plugins, but not the DAG, the QPPs or the memory. The ablation without QPPs is useful. There is no ablation of the DAG or the memory separately, so it is not clear which part carries the gain.
- **Success is scored against past incidents.** The incident resolutions were known, so a run is checked against a label. This does not show behavior on a new incident with no recorded answer, which is when the agent is needed.
- **The deployment number is not backed by a method in the text.** A 34 percent reduction in median mitigation time is a strong claim. Without a control or a before and after description, it should be read as the authors' report.
- **The agent is diagnostic only by choice.** The safety discussion says execution focuses on read-only steps (queries, metrics, analysis) and that SREs review conclusions before any mitigation. That is a sensible limit, and it also means the design does not yet address guides whose steps change state, the gap left by [AutoTSG](/papers/autotsg-learning-and-synthesis-for-incident-troubleshooting).

## Further Research

- Evaluate on raw, unrevised guides, and measure how much of the gain comes from the quality step.
- Ablate the DAG and the memory separately, and test the agent against incidents with no known answer.
- Automate finding parallelizable steps, which the authors leave to SREs, and study the token cost when a parallel branch turns out unnecessary.
- Extend from diagnosis to guarded remediation, with approvals for steps that change state.
