---
title: "RT: Regular Types for the Streaming Shell"
summary: RT is an overlay type system for Unix shell pipelines that describes the lines flowing between commands as regular expressions, checks each stage's output language against the next stage's input language and reports a counterexample line, extended with polymorphic command types, finite-state transducers for commands like tr and cut, and optional concretization and annotations, and it classifies 954 programs with 91% accuracy at 0.02 s each.
researchArea: Programming Languages
keywords: type systems, shell, regular languages, finite-state transducers, static analysis, pipelines, polymorphism
version: 1.0
updatedAt: 2026-11-18
---

## Overview

Shell programs combine commands written in many languages that talk through untyped byte streams, so a pipeline can look right and still feed a stage lines it cannot handle. The consequences range from a long-running job that crashes to silent corruption, and the usual tools discover them only after execution. Modern programming languages catch such mistakes with types, with fast pre-execution checks, errors that the developer sees instead of the user, and counterexamples, and the shell has none of this. A state-of-the-practice linter such as ShellCheck matches syntax and does not model what the streams contain.

The authors, from Brown University and Rice University, introduce RT, an overlay type system, meaning a checker laid over the existing POSIX shell rather than a new language, for shell programs or fragments whose correctness depends on the line-level structure of the streams between commands. The running example is a modern version of McIlroy's classic word-frequency one-liner that counts correctly spelled words across all book files under the current directory. It fails with an error that some files do not exist and prints nothing, and ShellCheck is silent. RT, in 0.02 seconds, finds that the output of `grep` may be incompatible with `xargs cat`, giving a witness line with a space in the file name, which `xargs` splits into two arguments, and, after reading `dict.txt` to compute a precise type, that the dictionary patterns can never match because a `tr` with swapped arguments upper-cases the words instead of lower-casing them.

This OSDI 2026 paper, a Best Paper Runner-Up, presents the type system, its checking algorithm, extensions that keep it regular and an evaluation on hundreds of programs.

Terms to keep apart: a regular stream type is a regular language, written as an extended regular expression, describing the possible contents of each line, a command type pairs an input and an output stream type (for example `find .` has `ε → \.(/.+)?`), a type is sound if it accepts every possible content and precise if it accepts only contents that can occur, a counterexample witness is a line the upstream command may produce that the downstream command does not accept, and a finite-state transducer is an automaton that also emits output and lets a type operation such as translating characters be computed on languages.

Worth knowing first: regular languages, DFAs and NFAs and the decidability of language inclusion, and how the shell moves bytes through pipes. Two sibling papers from the same group handle other sides of the shell. [Ahead-of-Time Analysis of Shell Program Effects](/papers/ahead-of-time-analysis-of-shell-program-effects) analyzes effects of a script by symbolic execution, and [Controlling Opaque-Component Effects with Semisolates and Try](/papers/controlling-opaque-component-effects-with-semisolates-and-try) controls them at run time. RT works on what flows through pipes, which is why it can catch a pipeline that computes the wrong paths to delete without modeling the deletion.

## Contribution

- **Regular types.** Stream types are extended regular expressions (a superset of POSIX ERE with intersection `&` and negation `!`), without lookaround or backreferences so that language inclusion stays decidable. A pipeline is well typed when the output language of each stage is included in the input language of the next. The restriction is deliberate: not every behavior can be represented, in exchange for tractable checking and an interface that Unix developers already know.
- **Command types and a type database.** A command type pairs input and output types, and the database is a set of hand-written configuration files that say how to parse an invocation and how to build its type, for instance from `grep`'s pattern. Higher-order commands such as `xargs cat` are handled as one command, and unknown commands default to `.* → .*`. The database can be inspected and edited with the `rti` command.
- **Polymorphic command types.** Types can have a type variable, as in `∀α. α → α` for `cat`, and a bound, as for `sort -n`, which copies its input but expects each line to start with digits. RT instantiates the unique most precise type for the actual input before checking, so checks stay over simple types.
- **The checking algorithm.** For each stage it gets the command type, checks that the current stream type is included in the input type, reports a mismatch with a counterexample, and otherwise computes the output type. It generalizes from pipelines to directed acyclic command graphs in topological order.
- **Compositional operators on transducers.** Operations such as `reverse`, `translate-match` (for `sed` substitution), `line-extract`, `translate-chars` (for `tr`, with squeeze) and `field-select` (for `cut`) are computed by building a finite-state transducer and composing it with the input automaton. Deterministic transducers give precise results for `field-select` and `translate-chars`, functional non-deterministic ones cover special cases of matching, and general non-deterministic ones are sound but may over-approximate. A naive approximation with standard operations can be unsound, as modeling `tr -s ' '` with a negation under-approximates its output.
- **Optional extensions.** Concretization reads input files and environment variables available at analysis time to compute a precise type, after a normal pass has run. Five comment annotations (`@assume`, `@input`, `@assert`, `@expect`, `@output`) let developers state unknown inputs or expected outputs. Four heuristics flag well-typed but likely mistaken compositions: a stage with an empty output type, input given to a command that expects none such as `echo`, a stage that cannot change the stream, and a lexicographic `sort` on numeric input.
- **Implementation.** Built on the `dk.brics.automaton` library (the evaluation setup lists OpenJDK 17 and Python 3.10), MIT-licensed along with all benchmarks.

## Methodology

The benchmark has 954 programs in seven sets, 730 correct and 224 buggy. Three sets come from the literature and community: examples from the LadderTypes pipeline typing system, all of the Koala scripts, and the Intercode natural-language-to-code programs. While collecting them the authors found 2, 3 and 17 further bugs in them and labeled the programs accordingly. Four sets are buggy programs: GitHub, from the 20 top-starred shell repositories (47,080 commits filtered to 1,028 that edit shell files on a line with a pipe, 328 judged relevant by gpt-4o-mini and inspected by hand, leaving 57 bug-fix commits, each giving a buggy pre-commit and a correct post-commit program), StackOverflow questions picked manually, LLM-generated programs prompted to contain common shell mistakes, and handwritten tests of specific composition patterns.

Accuracy is the share of correct classifications over all programs. RT uses its bundled type database, which covers 71 of the 106 GNU coreutils commands and 86% of the invocations in the GitHub set. It is compared with ShellCheck, counting a program as buggy if ShellCheck gives any warning related to pipelines or stream contents (with a list of irrelevant warnings ignored), and with LadderTypes, given manually added versions of RT's type declarations. Ablations remove the heuristics, the transducers or concretization. Timing runs on Ubuntu 20.04, an 8-core AMD Ryzen 7 4800H with 16 GB of RAM, OpenJDK 17 and Python 3.10.

## Findings

These are the authors' reported results.

- **Accuracy.** 91% overall (864 of 954, with 27 false positives and 63 false negatives): 96% on correct programs (703 of 730) and 72% on buggy ones (161 of 224). With type annotations it is 97% overall, 98% on correct programs and 94% on buggy ones, with 14 false positives and 14 false negatives. On buggy programs RT is 52 percentage points more accurate than ShellCheck and LadderTypes, with comparable accuracy on correct programs. Warnings RT marks as definite are 100% accurate, and those marked possible are 86%.
- **Bugs others miss.** RT alone detects 87 bugs, against 5 unique to ShellCheck and none to LadderTypes, and 58 bugs are found by none of the three without annotations. The five ShellCheck-only cases are warnings unrelated to the actual bug, counted conservatively. RT's finds include new bugs in production programs previously considered correct.
- **Where the errors come from.** Of the 27 false positives, 11 come from heuristics flagging correct programs and 16 from over-approximation, such as `cat ${input} | sort -n` with an unknown file. Of the 63 false negatives, 49 come from the absence of an expected-output specification, since without an assertion the program is well typed, and 14 are bugs of a kind a type system cannot see. Annotations remove the 49, and 6 over-approximation false positives remain from complex `awk` and `sed` uses.
- **What each extension buys.** Disabling the transducers lowers accuracy to 80% (to 83% with annotations) and raises the false-positive rate from 4% to 20%. Disabling the heuristics leaves accuracy at 85% (91% with annotations), with 130 false negatives instead of 63 without annotations and 82 instead of 14 with them, an 83% reduction in the annotated case. Disabling concretization changes the result least, 90% (96% with annotations).
- **Speed.** 0.020 s per program on average (0.009 to 0.903 s), against 0.018 s for ShellCheck and 3.081 s for LadderTypes, whose slowness the authors attribute to an external script that looks up types. The average automaton has 11.03 states and the largest 201, and all but one program that takes over 0.2 s carry complex input annotations.

## Critical Analysis

The paper states several limits itself.

- **Deliberate limits of regularity.** Some behaviors are not regular, such as `sed -E "s/(.*)/\1\1/"`, which duplicates its input, and others such as `sort` and complex `awk` or `sed` are only approximated, which is sound but can cause false positives. Heuristics are about likely mistakes, not violations.
- **A manual type database.** Coverage is 71 of 106 coreutils, and unknown commands take the trivial type.
- **Annotations carry the hard cases.** Without expected-output specifications most missed bugs are invisible, and the authors say so.

The following points are a reading of the evidence, not claims of the paper.

- **The headline mixes classes.** The 91% is dominated by 730 correct programs, and on the 224 buggy ones RT finds 72% without annotations, so more than a quarter of the bugs go undetected out of the box. The 97% needs annotations, and the text I read does not say who wrote them. If the authors, who knew the bugs, wrote them, the number is an upper bound on what a user gets.
- **Part of the corpus fits the tool.** The StackOverflow, LLM-generated and handwritten sets contain only buggy programs chosen or built around pipeline composition mistakes, which is RT's target, and the correct sets (Koala, Intercode, the post-fix commits) are mostly small. Prevalence of these bugs in everyday scripts, and false-positive rates on large unlabeled codebases, are not measured, which matters because a checker lives or dies by noise.
- **The baselines are generous in one way and not designed for the task in another.** ShellCheck is credited for any related warning and still finds few bugs, but it is a syntactic linter, and LadderTypes needed hand-added declarations. The comparison shows what stream-content semantics add, not that tools with the same goal lose.
- **Speed is a property of small types.** The average automaton is tiny, and the slow cases come from long annotations, so determinization blow-up on complex regular expressions is a risk the evaluation does not stress.
- **Concretization trades soundness for precision.** Reading a file at analysis time gives exact types for that file, but the file can change before the script runs, so a result is a statement about the current environment.
- **Scope is pipelines.** The text I read describes pipelines and acyclic command graphs. Loops, functions and the interaction with shell expansion are left to other tools, which makes it natural to combine RT with an effect analysis rather than to compare them.

## Further Research

- Growing the type database automatically, from manuals, examples or by mining behavior, and certifying entries against real command behavior.
- Tracking types through variables, loops and functions, and combining stream types with effect and expansion analyses of the same script.
- Richer types for structured data such as CSV and JSON lines, and for commands like `awk` whose full behavior is not regular.
- Studying false-positive rates on large real-world codebases and with developers using annotations in their own scripts.
