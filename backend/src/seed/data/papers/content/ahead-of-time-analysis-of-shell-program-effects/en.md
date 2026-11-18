---
title: "Ahead-of-Time Analysis of Shell Program Effects"
summary: SaSh finds catastrophic bugs in shell scripts before they run by symbolically executing them optimistically, modeling external commands with pre- and post-condition specifications over a flat filesystem model, abstracting word expansion down to prefix, suffix and field count, and steering the search toward destructive commands, and it finds 115 of 116 documented bugs with no warnings on the fixed versions.
researchArea: Software Engineering
keywords: shell, static analysis, symbolic execution, program effects, filesystem model, word expansion, smt solver
version: 1.0
updatedAt: 2026-11-18
---

## Overview

The Unix shell is a core substrate for installation, administration and automation, and increasingly for AI agents, and shell programs are prone to severe and often irreversible effects. A 2015 bug in Valve's Steam updater deleted entire filesystems, a 2001 bug in Apple's iTunes updater wiped user drives, and a 2011 bug in the Bumblebee installer for Nvidia drivers is another documented disaster. These bugs are not crashes: the shell is permissive, so failing commands, missing dependencies and empty variables usually do not stop execution, and the vast majority of real shell bugs are, in the authors' words, misbehaviors, perfectly normal executions by the shell's semantics with unwanted effects.

The Steam bug shows why analysis is hard. The script sets `STEAMROOT` to the output of `cd "${0%/*}" && echo $PWD` in a subshell and later runs `rm -rf "$STEAMROOT"/*`. When the updater is launched from its own directory, `$0` has no slash, the `cd` fails, nothing is printed, `STEAMROOT` is empty and the command becomes `rm -rf /*`. Four kinds of expansion interact, an external binary does the damage, and the full script has 450 lines. The authors name four challenges: the shell's execution model (almost every command can fail, and warning on every possible failure flags nearly every `rm`), reasoning about opaque external commands and the environment they touch, approximating the outcomes of expansion, and the exponential growth of paths.

This SOSP 2026 paper, a Best Paper Award winner, presents SaSh, a static analyzer that simulates shell programs symbolically ahead of execution and warns about these behaviors, from Brown University with Stevens Institute of Technology and UCLA.

Terms to keep apart: symbolic execution runs a program on symbolic values instead of concrete ones and collects constraints (a path condition) along each path, field splitting is the step where the shell cuts an expanded string at `$IFS` characters into separate arguments, a semantic assertion is a constraint over the symbolic state whose violation is a bug, and a linter such as ShellCheck matches syntactic patterns instead of reasoning about executions.

Worth knowing first: POSIX word expansion (parameter expansion, field splitting, globbing), what an SMT solver such as Z3 answers, and why path explosion limits symbolic execution. Two sibling papers in the library come from the same group and look at the same problem from the runtime side. [Controlling Opaque-Component Effects with Semisolates and Try](/papers/controlling-opaque-component-effects-with-semisolates-and-try) isolates and then commits or discards the effects of a run, and [RT: Regular Types for the Streaming Shell](/papers/rt-regular-types-for-the-streaming-shell) types the streams between commands in a pipeline.

## Contribution

- **Optimistic symbolic execution.** A command either succeeds or fails as a whole, and failure is explored only for explicit conditional control (`if`, `&&`, `||`, `case`), so `rm a b c` does not fork into every subset of deletions. Behavior is also optimistic: for most bug classes SaSh reports only what must happen under the conditions the program itself creates, and for irreversible destructive effects it reports what may happen under those same conditions. A bug is therefore internally inconsistent or dangerous even in an ideal environment, which keeps the signal-to-noise high.
- **Eight classes of misbehavior.** Deleting a critical path (defined from the Filesystem Hierarchy Standard and POSIX, such as `/` and `/home`), dangerous word splitting, data loss (overwriting or deleting unread data), a command that is guaranteed to fail, an IO mismatch between commands, a missing command, identifier misuse (unbound variables, wrong function references) and degenerate control (constant conditions, loops that run zero or one time or forever). Each class is a semantic assertion checked by an SMT solver.
- **Command specifications.** External commands are modeled as triples: a usage assertion that warns if violated, a success postcondition and a failure postcondition, all over the symbolic shell and filesystem. For example `rm` asserts that its operands are directories or already-read files and, on success, marks them deleted. Specifications are written by hand, SaSh falls back to an empty one for unknown commands, and flags are assumed concrete so an invocation can be matched to its specification.
- **A flat filesystem model.** A map from path strings to a state made of a kind (file, directory, deleted) and a read status (read or unread), kept as an SMT array. It ignores directory structure, which makes reasoning cheap, and the unread bit is the proxy for data loss: overwriting or deleting a known-unread path is flagged. The interface (apply, encode, assert) allows richer models later.
- **An abstract domain for expansion.** The result of an expansion is a concrete string or a symbolic variable with a concrete prefix, a concrete suffix and a range for the number of fields it can split into. That is enough to see that `rm $1/usr` can split into several arguments, or that an empty variable leaves only the literal part, without enumerating outcomes. Alternative-value formats such as `${X-dflt}` fork the state on whether the variable is empty, and a symbolic `$IFS` is the rare case where SaSh warns and gives up on splitting.
- **Risk-directed exploration and friends.** Before full execution, a targeted phase picks one branch at each conditional by a local risk score, the number of commands in the branch that have a destructive specification, so it reaches dangerous code quickly. SaSh also merges states that differ only in unmodeled details, skips solver calls for assertions it can show trivially satisfiable, and splits a time budget among stages (targeted exploration capped at a third, unused time handed on).
- **Implementation.** Python 3.10 with Z3 4.15.4, MIT-licensed with all evaluation data. Loops are unrolled three times by default, `eval` and `source` are handled only for fully concrete arguments, background commands run as if in the foreground, and `trap` is not interpreted.

## Methodology

The ground-truth benchmark has 61 real programs holding 116 documented bugs, with fixed versions, collected from forums, Stack Overflow, Unix and Linux Stack Exchange, GitHub, GitLab and bug trackers, and including the Steam, iTunes and Nvidia disasters. Detection means a warning that describes the precise unwanted behavior, and the negative control runs SaSh on the fixed versions to see whether it still warns. A second set has 19 variants, semantically equivalent but syntactically different, of the programs where ShellCheck reports something (42 bugs). A third set is the Koala suite, 119 correct real-world scripts, used to measure the time for a complete analysis, and a fourth is open-source repositories analyzed over three weeks to find new bugs.

SaSh is compared with ShellCheck 0.11.0 with all checks enabled, counting a bug as found if ShellCheck issues any warning related to it, and with two LLMs, GPT-5.6 Sol (high reasoning) and Qwen 3.5 (9B), prompted to list bugs and line numbers and judged by hand, three trials each, on the original programs and on versions where a model added benign comments. Runs are on a single CloudLab node. The command specifications cover 13,425 of the 19,150 distinct invocations in the benchmark programs (70%).

## Findings

These are the authors' reported results.

- **Effectiveness.** SaSh finds 115 of 116 bugs in 60 of 61 programs, 97 within one second (83.6%) and 115 within 60 seconds, and it produces no warning on any fixed version. ShellCheck reports something related for 42 bugs in 19 programs, 18 of them from one MongoDB backup script, recognizes the fix in 35 of those, still warns on 7 fixed versions and stays silent on 74 bugs. On the 19 syntactic variants SaSh finds all 42 bugs and ShellCheck none.
- **The missed bug.** In a Debian debootstrap script, a `--print-debs` run with a target directory prints dependencies and then deletes the user-supplied directory. SaSh does not flag it because deleting a user-supplied path is usually not a bug, and it could be configured to by treating positional parameters as critical paths.
- **Speed and optimizations.** The average analysis takes 0.75 s (0.02 s to 23.31 s) excluding timeouts, and 11 programs hit the 60 s budget while still revealing their bug. Without any optimization SaSh finds 82 bugs in one second and 97 at saturation, without risk-directed exploration 98 and 111, and in full 97 and 115, 18% more than unoptimized. In the 405-line debootstrap script, with the destructive `rm -rf` 165 lines after the offending assignment and behind a 20-branch argument parser, SaSh goes from unable to find the bug in one hour to finding it in 30 seconds.
- **Complete analysis of correct scripts.** On Koala, 77 of 119 scripts (65%) finish within one second, 110 (92%) within one minute and all but three within 15 minutes, and those three do not finish within an hour.
- **New bugs.** SaSh produced 104 bug reports in 50 open-source projects, among them PyTorch, Next.js, the P4 compiler, Kubernetes, vLLM, AFFiNE and Moby, including dangerous path deletions, and 27 fixes had been accepted at the time of writing.
- **Against LLMs.** GPT-5.6 Sol finds 87.0%, 87.8% and 91.3% of SaSh's 115 bugs over three trials and 64.3%, 69.6% and 68.7% after benign comments are added, taking a median 54.5 and 81.2 times SaSh's time (API timings). Qwen 3.5 (9B) finds 12.2%, 6.1% and 2.6%, and 6.1%, 3.5% and 5.2% with comments. Both miss disasters such as the Steam, Node.js and debootstrap bugs, and comments cut their rate by 24% on average. The whole experiment cost $66.67.

## Critical Analysis

The paper states several limits itself.

- **Optimism is a choice.** Failure is explored only through explicit control flow and most bug classes require the bug to be certain under the program's own conditions, so bugs that depend on a hostile environment are deliberately not reported. The authors note the LLM results may not generalize to other models and that the models may have seen the programs and bug reports in training.
- **Hand-written specifications.** Coverage is 70% of invocations, unknown commands are ignored, and scaling is left to crowd-sourcing or synthesis from man pages.
- **Unsupported or approximated features.** `trap`, a symbolic `$IFS`, non-concrete `eval`, and constraints from `case` patterns are outside the model, loops are unrolled three times and functions are handled best-effort. A flat filesystem model drops structure and permissions. Three Koala scripts do not finish.

The following points are a reading of the evidence, not claims of the paper.

- **The benchmark and the design share a source.** The eight misbehavior classes were derived from a review of the same benchmark and the specifications were written by the authors, so 115 of 116 is partly in-sample. The 104 reports from unseen repositories are the better test, but only 27 fixes were accepted at the time of writing, so confirmed precision there is not yet known.
- **No false positives is a narrow claim.** It is measured on the fixed versions of the same 61 programs. The text I read does not say how many warnings SaSh gives on the 119 correct Koala scripts, which would be the more representative precision check.
- **The ShellCheck comparison is generous in one way and unequal in another.** Any related warning counts as a detection, even a generic one, which flatters the linter, but ShellCheck is a style tool with a different goal, and the 19 variants were built by the authors to exploit its syntactic nature. The result shows brittleness, not that the two tools compete on the same task.
- **The LLM gap on clean code is smaller than the headline.** GPT-5.6 Sol finds about 87% to 91% of SaSh's bugs on the original programs, judged under the most favorable reading, and the large gaps are the 9B model, the 24% drop with comments and the 55 to 81 times slower run. The experiment also counts only bugs found, not warnings on the fixed versions, so it says nothing about LLM false positives.
- **Optimism leaves a classic hole.** An unchecked `cd` followed by a destructive command depends on a command failing outside explicit control flow, which the model assumes does not happen, so that famous pattern is reported only when the failure shows up in a branch like the Steam one.
- **Scripts are modest in size.** The large examples are 400 to 450 lines, and the time to complete analysis grows past an hour for three of 119 ordinary scripts, so very large or loop-heavy installers remain a question.

## Further Research

- Generating command specifications automatically from manuals, examples or natural language, with some check against real command behavior.
- Richer filesystem models with permissions, links and mounts, and analysis of shell scripts that call other languages.
- Configurable policies so that intent-dependent bugs, such as deleting a user-supplied path, can be reported where the user wants them.
- Combining the static analysis with runtime isolation and with typed pipelines, which the sibling papers explore.
