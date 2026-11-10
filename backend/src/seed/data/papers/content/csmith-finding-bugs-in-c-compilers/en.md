---
title: "Finding and Understanding Bugs in C Compilers"
summary: Csmith generates random C programs that avoid undefined behavior and compares what several compilers do with them, which led the authors to report more than 325 bugs in GCC, LLVM and other compilers over three years.
researchArea: Programming Languages
keywords: compiler testing, differential testing, fuzzing, undefined behavior, miscompilation, compcert
version: 1.0
updatedAt: 2026-11-01
---

## Overview

A compiler is supposed to be the one part of the toolchain that you do not have to question. When it produces wrong code without a warning, nobody finds the bug by reading the program, and the cause is hard to see. Compilers are tested mainly with fixed suites of programs, and the authors suspect that such suites leave large areas of the compiler untested.

This PLDI 2011 paper from the University of Utah presents Csmith, a tool that writes random but valid C programs, and reports what happened when the authors ran it against real compilers for three years. The headline is that every compiler tested crashed on valid input and also produced wrong code without a warning, with a special case in the middle of a verified compiler that the paper discusses at length.

Worth knowing first: what an optimizing compiler does, what "undefined behavior" means in C (signed overflow, reading uninitialised memory), and the idea of testing without an oracle by comparing implementations.

## Contribution

- **Randomized differential testing for C.** Csmith generates a program, a harness compiles it with several compilers and optimization levels, runs the results, and flags a bug when outputs disagree. No expected output is needed.
- **Programs with a single meaning.** The hard problem is to generate programs that are expressive (many C features, pointers, structs, loops) and also free of the 191 kinds of undefined behavior and independent of the 52 kinds of unspecified behavior in C99. If a program had undefined behavior, a difference between compilers would not prove a bug. Csmith combines static analysis during generation with dynamic checks.
- **An empirical study** of the bugs found: how many, in what compilers, with what symptoms, and in which part of the compiler.

## Methodology

The authors used the tool opportunistically for three years, reporting bugs to compiler teams. They also ran controlled experiments: tracking the crash rate and the wrong-code rate across many versions of GCC and LLVM, checking which bugs appear without optimization, measuring code coverage of the compilers when random programs are added to their test suites, and comparing Csmith with four other random program generators in a one-week run on identical machines.

They examined the bugs to classify them by symptom and by compiler phase, and tested CompCert, a compiler whose optimization passes are verified in a proof assistant, with about six CPU-years of random programs.

## Findings

These are the authors' reported results.

- More than 325 previously unknown bugs were reported, 79 against GCC and 202 against LLVM (about 2% of all LLVM bug reports). Most were fixed, and 25 GCC bugs were marked P1, the highest, release-blocking priority.
- Both GCC and LLVM became at least three orders of magnitude less likely to crash on the generated programs over the range of versions tested.
- Csmith found more distinct crash errors than the other four generators in a week.
- Adding 10,000 Csmith programs to the GCC and LLVM test suites barely changed line, function or branch coverage, which the authors call a negative result and think shows that these metrics are too shallow to capture what the random programs exercise.
- In CompCert they found no wrong-code error in the verified middle-end, which no other tested compiler could claim. They did find six wrong-code bugs in its unverified front end, and two more from an incomplete specification of PowerPC instructions. After these reports, the CompCert developer extended the verified part to cover integer promotions and other implicit casts.
- Bugs found were independently rediscovered by application developers, which the authors take as sign that they matter.
- A rough cost estimate puts each reported bug under US$1,000 to find.

## Critical Analysis

The paper changed compiler testing, and its method has been copied widely. For that reason it is worth noting what it does and does not show.

- **Bug count is not bug importance.** Many reported bugs were in unusual combinations of features that most programs never use. The authors answer this with evidence that real developers rediscovered some, but they cannot say how much real software was harmed.
- **A good oracle is limited by the generator.** Csmith finds only bugs in the part of C it can generate without undefined behavior. It can only find bugs that make compilers disagree, so a bug shared by all compilers, or one that depends on undefined behavior, stays invisible.
- **The coverage result is odd and not explained.** Finding hundreds of bugs while adding almost no coverage means the coverage metrics tell little here, and the paper's explanation is a guess.
- **Reporting choices.** The authors favoured open-source compilers whose teams answer quickly, which helps the fix rates look good. The study also measures one tool by the people who built it.
- **CompCert reading.** "Cannot find wrong code" is as of early 2011, for the middle-end, and in the setup tested. It is strong evidence for verification and not a proof for the whole compiler.

## Further Research

- Test generation guided by the structure of the compiler (white-box), which the authors name as promising but hard to combine with Csmith's design.
- Better test-case reduction, so that a bug report is small enough to understand.
- Testing for other languages, optimization levels and targets, and for the interaction of compilers with sanitizers and link-time optimization.
- A clearer understanding of how much testing verified artifacts like CompCert and seL4 make unnecessary.
