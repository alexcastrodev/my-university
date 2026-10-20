---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- Classify a bug-finding or assurance need by the property to establish, the language and scale of the code, and the tolerance for false alarms.
- Select the matching technique from this track (pluggable types and ownership, abstract interpretation, separation-logic analysis, symbolic execution, fuzzing, deductive proof) and state precisely what guarantee it provides.
- Identify what each guarantee does not cover, and layer techniques so the cheap ones run at edit time and the expensive ones run off the critical path.
- Explain why adoption (speed, noise, placement in the workflow) is a first-class part of the choice.

## Context & Motivation

The concepts of this track each gave a different way to know something about a program before or without running it in production. Types and ownership reject whole classes of programs at compile time. Abstract interpretation proves the absence of run-time errors by over-approximating all executions. Separation logic reasons about the heap compositionally, and Infer turns that into a scalable bug finder. Symbolic execution explores individual paths exactly, and fuzzing generates inputs that no one thought of. Proof assistants and dependent types give the strongest guarantee at the highest price. Language servers and incremental computation decide how fast any of it can answer.

None of these is best in general. They sit at different points between **soundness** (never miss a bug of the kind being checked), **precision** (few false alarms), **scalability**, and **adoption cost**. The papers that describe industrial experience, Bessey et al. on commercial static analysis at Coverity, Sadowski et al. on the Tricorder program at Google, and Calcagno and Distefano et al. on Infer at Facebook, agree on a lesson that pure theory understates: a tool that developers ignore finds nothing. This capstone practices choosing a technique for a concrete situation and stating its guarantee and its gap, in the spirit of the project work in MIT's 6.820 and Aarhus's static analysis course.

## Core Theory

### What each technique guarantees

| Technique | Guarantee | Typical weakness | Best fit |
|---|---|---|---|
| Pluggable types, ownership | Sound for the annotated property, modular, fast | Annotation effort, trusted libraries | Nullness, resource ownership, units, in the compiler |
| Abstract interpretation | Sound in its domain: no missed error of the modeled class | False alarms, domain tuning, scale | Absence of run-time errors in embedded numeric code |
| Separation-logic analysis (Infer) | Compositional, scales to millions of lines, tuned to find real bugs | Not a proof of absence, loop and library gaps | Memory and resource bugs on every code change |
| Symbolic or concolic execution | Exact per path, each report has a failing input | Path explosion, environment models | Unit-level test generation, deep logic bugs |
| Fuzzing | Every crash is real and reproducible | No guarantee of absence, shallow on magic values | Parsers and decoders of untrusted data |
| Deductive proof | Strongest: the code meets the written specification | Highest cost, specification may be wrong | Small critical cores: crypto, kernels, compilers |

### A diagnostic checklist

1. **What is the property?** "No null dereference", "no out-of-bounds access", "no crash on any input", and "the output equals the specification" call for different tools.
2. **Does a missed bug cost more than a false alarm?** If a miss is catastrophic (flight control, medical devices), insist on soundness and accept alarms; if developer attention is the scarce resource, prefer a precise bug finder.
3. **How big is the code, and how fast must the answer come?** Seconds in the editor means types and linting through a language server; minutes at code review means incremental analysis of the diff; hours overnight allows whole-program analysis and long fuzzing.
4. **Is there an annotation or specification budget?** Types and proofs need it; fuzzing and Infer largely do not.
5. **Who sees the result, and when?** Findings shown in code review, with a clear message and, where possible, a suggested fix, get acted on; a nightly report of thousands of items does not. Google's Tricorder set a goal of under 10% effective false positives for exactly this reason.

### Layering

The techniques are complementary. A common arrangement is **defense in depth by cost**: types and fast linters at edit time (language server), incremental static analysis and tests on every pull request, continuous fuzzing on the code that parses untrusted input, whole-program abstract interpretation or proof for the small component whose failure is unacceptable. Each layer catches what the cheaper one cannot, and the cheap layers stay fast because the expensive ones run elsewhere.

### Stating the guarantee and the gap

For any chosen tool, write down: the **property** it establishes, the **assumptions** it needs (annotated code, a model of the environment, input ranges, the compiler), and the **coverage** it does not reach (paths, inputs, libraries, reflection). The gap is not a defect in the writing-up. It tells the team where to put the next layer, and what a clean report does and does not mean.

## Worked Examples

### Example 1: nullness in a large Java monorepo

**Request:** A company has two million lines of Java and hundreds of developers. `NullPointerException` is a leading cause of production incidents. They want to prevent new ones without a big-bang migration.

**Analysis:** The property is local and structural (can this expression be null?), the language is Java, the scale is large, and the answer must be fast enough for every build. A **pluggable nullness type system** is the best fit: developers mark `@Nullable` where null is allowed, and a checker such as NullAway (an Error Prone plugin) verifies the rest in a modular way, at a cost low enough to run on every build. It can be adopted package by package, with models for unannotated libraries. For deeper inter-procedural cases that the annotations do not capture, run Infer on each pull request's diff as a second layer. Abstract interpretation of the full codebase would be heavy for a property that types express cheaply, and tests alone only find the paths someone exercised.

**Guarantee and gap:** In the annotated packages, no dereference of a value the checker considers non-null can raise a `NullPointerException`. The gap is in the assumptions: unannotated third-party code is trusted through models, reflection and serialization frameworks bypass the checker, and the checker documents deliberate unsound choices for usability. The tool prevents new defects in annotated code; it does not clean up old code or prove the absence of every null-related failure.

### Example 2: a C decoder for untrusted network input

**Request:** A team maintains an image or protocol decoder in C that processes files from the Internet. A memory-safety bug is a remote-code-execution vulnerability.

**Analysis:** The property is "no memory corruption on any input", the code is parser-shaped, and the entry point is a single function that takes bytes. This is the ideal fit for **coverage-guided fuzzing** with ASan and UBSan, run continuously (OSS-Fuzz or fuzzing in CI), seeded with the test-suite files and a dictionary of format keywords. Branches guarded by checksums or magic numbers that stall the fuzzer can be unblocked with comparison logging or by a hybrid tool using concolic execution. A static analyzer on the diff catches the shallow cases at review time, and long-term, the most dangerous parsing code is a candidate for rewriting in a memory-safe language, where ownership types give the guarantee at compile time.

**Guarantee and gap:** There is no guarantee of absence: every crash found is real and reproducible, but a clean run only means the explored inputs are clean. The coverage report shows which code the fuzzer never reached, which is the concrete list of the gap. Logic errors that do not crash (a wrong pixel, a wrongly accepted malformed file) need properties such as round-trip and differential checks, since the crash oracle cannot see them.

### Example 3: a controller that must never raise a run-time error

**Request:** A 100,000-line C controller for a safety-critical device uses no dynamic memory and mostly integer and floating-point arithmetic. A run-time error (division by zero, overflow, out-of-bounds index) is unacceptable, and certification requires evidence.

**Analysis:** Here a miss costs far more than a false alarm, so a **sound** technique is required. Abstract interpretation is the match: a sound analyzer of the Astrée or Frama-C Eva class, configured with the input ranges from the hardware specification, either proves the absence of the modeled run-time errors or shows an alarm to resolve. A coding standard such as MISRA C keeps the code in the fragment the analyzer handles precisely, and precision is improved by choosing domains, partitioning, and annotations. For one small, critical function (a saturating arithmetic routine, a scheduler decision) a **deductive proof** with a tool such as Frama-C's WP plugin against a written specification adds functional correctness that the analyzer does not claim.

**Guarantee and gap:** For every input in the declared ranges and under the declared floating-point model, none of the listed run-time errors occurs. It does not cover functional correctness outside the proved functions, inputs outside the assumed ranges, hardware faults, timing, or bugs in the compiler (unless a verified compiler is also used). The ranges and the environment model are themselves part of what has to be reviewed.

## Common Misconceptions & Pitfalls

- **"Choose the most powerful technique."** Power is paid for in annotation effort, tuning, and run time. A nullness checker that runs on every build prevents more bugs than a proof that is never written.
- **"If the tool reports nothing, the code is clean."** It means no finding within the guarantee. A fuzzer's silence says nothing about unreached paths, and an unsound bug finder's silence says nothing about the bugs it was designed to miss.
- **"A sound tool is automatically useful."** Soundness with hundreds of false alarms per release gets switched off. Placement in the workflow, message quality, and the false-alarm rate decide whether the findings are read.
- **"Static and dynamic techniques compete."** They find different bugs. A fuzzer finds an input; a static analyzer prevents the whole class from recurring; a proof settles the small core. Mature teams use all three at different points.

## Summary

Each technique in this track gives a different guarantee at a different cost: types and ownership are sound for what they track and fast; abstract interpretation is sound within its domain at the price of false alarms; separation-logic analysis scales and finds real heap bugs without proving absence; symbolic execution and fuzzing produce failing inputs but not completeness; proof gives the strongest assurance at the highest cost. The choice follows from the property to establish, the cost of a miss versus a false alarm, the scale and the speed required, and where the findings reach developers. Layering the cheap techniques at edit time and the expensive ones off the critical path covers more than any one of them, and stating the guarantee and the gap for each layer tells the team what a clean report means.

## Documentation Links

- [Moller, Schwartzbach: Static Program Analysis (lecture notes, Aarhus University)](https://cs.au.dk/~amoeller/spa/): doc
- [Bessey et al.: A Few Billion Lines of Code Later: Using Static Analysis to Find Bugs in the Real World (Communications of the ACM, 2010)](https://dl.acm.org/doi/10.1145/1646353.1646374): doc
- [Sadowski et al.: Lessons from Building Static Analysis Tools at Google (Communications of the ACM, 2018)](https://dl.acm.org/doi/10.1145/3188720): doc
- [NullAway: a fast annotation-based null checker for Java](https://github.com/uber/NullAway): doc
