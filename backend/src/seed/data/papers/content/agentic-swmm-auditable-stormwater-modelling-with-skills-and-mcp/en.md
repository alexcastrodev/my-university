---
title: "Agentic SWMM: Auditable and Reproducible Stormwater Modelling Workflow with Agent Skills and Model Context Protocol"
summary: The authors put an LLM agent in front of the EPA SWMM stormwater simulator, through agent Skills and MCP tools, and show that a run driven by natural language produces byte-identical SWMM output files to a command-line run, with a hash-based record of every run.
researchArea: Software Engineering
keywords: agentic ai, model context protocol, agent skills, reproducibility, provenance, swmm, stormwater modelling
version: 1.0
updatedAt: 2026-11-03
---

## Abstract

Configuring urban hydrological models, such as the Storm Water Management Model (SWMM), for operational use remains onerous for many modellers. We propose aiswmm, a SWMM-specialized agentic runtime, together with an Agentic SWMM workflow that embeds (Agent) Skills and Model Context Protocol (MCP) tools to automate QGIS preprocessing, SWMM configuration, execution, and postprocessing. We demonstrate this natural-language triggered workflow on the Tod Creek watershed (located on the Saanich Peninsula, British Columbia). We also validate the proposed Agentic SWMM workflow at three levels: (i) a QGIS-based watershed-pour-point detection that agrees with the commercial PCSWMM® method to within 0.88% of the watershed perimeter (approximately 7.5 pixels in the digital elevation model); (ii) byte-identical SWMM output files (Secure Hash Algorithm 256-bit identical) between the command-line execution and the MCP paths across 60 paired simulations, and (iii) peak inflow at the watershed outlet matching to three significant digits between the manual SWMM interface and Agentic SWMM workflows. The results confirm that Agentic SWMM workflow can produce the same outputs with the manual SWMM interface, as they are designed to use the same computational engine. We also propose a verification-first contract and byte-level audit chain that record the inputs, parameters, and outputs of each run, thereby supporting the auditability and reproducibility. The aiswmm runtime, Skills, MCP servers, and byte-level audit chain are released as open source and remain compatible with mainstream agentic runtimes (Codex, Claude Code, Hermes, and OpenClaw) to support reproducible SWMM modelling driven by natural language.

## Overview

Urban stormwater models such as the EPA Storm Water Management Model (SWMM) are physics-based simulators: a modeller describes catchments, pipes and rainfall, and the engine computes runoff and flow. Setting one up, and running it again for many scenarios, means a lot of work in a graphical interface, and a result that cannot be traced back to the exact inputs is hard to trust in operational work. Python packages reduce the effort but are aimed at programmers, and the authors argue that machine-learning surrogates are harder to interpret and generalise poorly.

This paper, from the Department of Mechanical Engineering at the University of Victoria in Canada, appears in the first issue of the journal AI for Engineering (MDPI, 2026). It proposes to let a language model drive the whole workflow, from GIS preprocessing to plots, while all the numerical work stays inside the unchanged SWMM engine. It is a systems paper about how to put an LLM agent in front of a scientific tool and still be able to audit what happened.

Worth knowing first: what an agent loop with tool calls is, the idea of the Model Context Protocol (MCP) as a standard way to expose tools to a model, and what a cryptographic hash such as SHA-256 proves about a file.

## Contribution

- **aiswmm, a SWMM-specific agent runtime.** It orchestrates commands, reads and writes files and calls external programs in a controlled environment. Its loop is inspired by ReAct but emits structured tool calls (function calling) instead of parsed text, and a five-layer rule system decides when the agent may act alone and when it must stop and defer to the human modeller. It cannot run arbitrary commands.
- **Two layers, MCP and Skills.** MCP exposes the tools (the case study uses three servers: GIS preprocessing, running SWMM and plotting). Agent Skills act as standard operating procedures: what to call, in what order, with which quality gates. The authors argue that MCP alone gives tools with no procedure around them, and results that depend on the quality of the prompt.
- **A verification-first provenance contract.** Every run writes two files produced by deterministic Skill scripts, not by the LLM: a runner manifest and an audit file. Together they hold SHA-256 hashes of the input, output and report files and the outcome of quality gates (continuity errors, integrity of the peak value, SWMM return code and eight SWMM-specific screening rules).
- **Equivalence tests** between the agent path, the SWMM command line and the SWMM GUI, and an automatic pour-point detection in QGIS checked against PCSWMM.
- **An open source release** of the runtime, the Skills, the MCP servers and the audit chain, under the MIT licence.

## Methodology

The case study is the Tod Creek watershed, about 17 km² on the Saanich Peninsula in British Columbia, with a 27 m digital elevation model, soil and land-use polygons and 1984 daily rainfall. A lumped model represents the catchment. SWMM 5.2.4 is compiled from source on macOS and called as `swmm5 <inp> <rpt> <out>`. The main language model is OpenAI GPT-5.5 Thinking (gpt-5.5-2026-04-23), and QGIS 4.0.2 does the GIS work.

Validation has three levels:

1. **Pour point.** The swmm-gis Skill computes flow direction and accumulation with QGIS (D8 method) and takes the cell with the largest upstream accumulation. It is compared with a pour point set by hand in PCSWMM 7.7.
2. **Command line against MCP.** Two tests of 30 configurations each: in the first the storm's time-to-peak parameter goes from 0.30 to 0.50, in the second the imperviousness of the catchment is varied. Each configuration runs through the SWMM command line and through MCP, giving 60 pairs and 120 runs. Outputs are compared by SHA-256 (ignoring timestamps) and by R² and Nash-Sutcliffe efficiency of the peak flow.
3. **GUI against agent.** The baseline model that the agent generated from a prompt is recreated by hand in the SWMM GUI, and the peak inflow at the outlet node is compared.

The authors also audit three external SWMM benchmarks (a Tecnopolo January 1994 case, a TUFLOW-SWMM coupled benchmark and a Generate_SWMM_inp case) against published reference outputs. The scope of that check is reported in the supplementary material, which this analysis does not cover.

## Findings

These are the authors' reported results.

- The automatic pour point lies within 0.88% of the watershed perimeter of the PCSWMM point, about 7.5 pixels of the elevation model.
- All 60 command-line and MCP pairs gave byte-identical SWMM output files (SHA-256, excluding timestamps), R² and NSE of exactly 1.0, identical manifests, return code 0 and a maximum difference in peak flow of 0.0.
- For the GUI comparison, the peak inflow at node O1 for the 25 May 1984 Chicago design storm (peak-time parameter 0.40) matches to three significant digits. The files are not byte-identical, because node and junction names differ in the manually built model.
- The audit caught an inconsistency: two Python scripts written independently by the LLM picked 0.39655 and 0.40345 as the value closest to 0.40, and both figures were labelled 0.40. Only the SHA-256 values (different prefixes) and the manifests showed the difference. The authors take this as evidence for the contract.
- The release described is v0.6.4 with 14 Skills, 11 MCP servers and 45 MCP tools. Four Skills and six MCP tools were used in the validation.

## Critical Analysis

The engineering idea is sound and the authors are open about several limits. A few points are still worth separating from the headline claim.

- **Byte-identical command line and MCP is a weak test of the agent.** Both paths call the same `swmm5` binary on the same input file, so identical outputs show that the wrapper adds no hidden step. The authors say as much. It does not test whether the agent builds a sensible model from a prompt.
- **The GUI comparison starts from the agent's own model.** The baseline was generated by the agent and then recreated by hand, so matching peaks show that the GUI and the agent run the same model in the same way. They do not show that the agent chose good parameters from raw data, which the discussion itself says needs expert judgement (for example in the parameter mapping tables).
- **Narrow hydrological evidence.** One watershed, a lumped model, a synthetic design storm and peak flow only, and the authors state that this is not a validation of all SWMM outputs. The main text reports no comparison with observed streamflow.
- **The hallucination claims are argued, not measured.** The three layers of defence (a hard limit on the action space, schema-checked MCP tools, Skills with domain rules such as reading the peak from the node inflow summary) are plausible. The main text reports no rate of wrong tool calls and no run without Skills for comparison, and one primary model is used. Portability to Codex, Claude Code, Hermes and OpenClaw is stated with a citation rather than shown in the experiments. The authors also say the constraints are soft and open to prompt injection.
- **A reproducible run is not a reproducible agent.** The hash chain makes a run reproducible and exposes a divergence after the fact, as in the 0.39655 against 0.40345 example. The agent can still choose differently on another attempt, and the paper does not measure how often.
- **Moving software.** The results use v0.6.4, while the limitations mention a memory layer from v0.7.1 that the authors say is not yet validated. The project is pre-1.0 and under active development.

## Further Research

- An uncertainty quantification module (the authors name a watershed-entropy-based metric) and Skills and MCP tools for subcatchment partitioning.
- Validating the memory-informed runtime, where past audited runs guide new ones, on real SWMM project data.
- Urban pipe networks, which are still in an alpha state, and other SWMM modules such as water quality, which need real network data and expert parameters.
- Questions the paper leaves open: an ablation with and without Skills, repeated runs of the same prompt to measure how much the agent varies, and the same workflow with other models and runtimes.
