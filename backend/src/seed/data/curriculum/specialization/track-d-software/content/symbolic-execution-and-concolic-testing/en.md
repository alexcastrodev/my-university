---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- Describe symbolic execution: symbolic state, path conditions, forking at branches, and the use of an SMT solver to decide path feasibility and produce a concrete test input.
- Execute a small program symbolically by hand and enumerate its path conditions.
- Explain concolic testing (DART, CUTE, SAGE) as concrete execution plus symbolic bookkeeping, and run its "negate the last branch" loop.
- Name the main obstacles (path explosion, loops, memory, the environment) and the mitigations that real tools use.

## Context & Motivation

`ai-theory/formal-methods` introduced SMT solvers as decision procedures for logical formulas, and `algorithms-software/software-construction` presented coverage as a measure of how much of a program the tests exercise. A random test generator has a coverage problem: in `if (x == 123456789)` the branch is taken by one input in $2^{32}$, so random inputs never reach the code behind it. A human tester reads the condition and picks the value. **Symbolic execution** automates that reading: instead of running the program on a concrete value, it runs it on a symbolic one, records the condition under which each path is taken, and asks a solver for an input that satisfies it.

King proposed the technique in 1976, but it became practical only when solvers got fast and a new idea (mixing concrete and symbolic execution) removed most of its weak points. The tools that followed include DART and CUTE (2005), KLEE (2008, built on LLVM bitcode), Microsoft's SAGE (whitebox fuzzing, used on Windows and Office file parsers), angr (for binaries), and Symbolic PathFinder (for Java bytecode). The survey by Baldoni et al. maps the field.

## Core Theory

### Symbolic state and path conditions

A symbolic executor keeps a **symbolic store** that maps each variable to an expression over the input symbols, and a **path condition** $\pi$, a formula over the inputs that must hold for execution to be on the current path. Inputs start as symbols, $x \mapsto \alpha$, $y \mapsto \beta$. An assignment `z = 2 * y` updates the store: $z \mapsto 2\beta$. A branch `if (c)` forks the state in two: one with $\pi \wedge c[\text{store}]$, the other with $\pi \wedge \neg c[\text{store}]$. Before continuing a branch the executor asks the **SMT solver** whether the new path condition is satisfiable; if not, the path is infeasible and is abandoned.

When a path ends (return, assertion failure, crash), the solver is asked for a **model** of $\pi$, concrete values for the inputs that drive the program down exactly that path. One test per path gives high coverage automatically, and checking at each risky operation (division, array index, assertion) whether the path condition together with the error condition is satisfiable finds real bugs with a witness.

### The obstacles

- **Path explosion**: the number of paths is exponential in the number of branches, and unbounded with loops. Tools use search heuristics (depth-first, random, coverage-guided), state merging, bounded loop unrolling, and time limits.
- **Solver cost and expressiveness**: non-linear arithmetic, floating point, and strings are expensive, and hash functions are intractable by design.
- **Memory**: pointers with symbolic values. A symbolic index into an array becomes an SMT array theory term; a symbolic pointer might refer to many objects and forces the executor to fork or model them (KLEE represents memory as byte arrays with symbolic contents).
- **The environment**: system calls, files, and library code cannot all be executed symbolically, so tools replace them with *models* (KLEE's uclibc and POSIX models) or run them concretely.

### Concolic testing

**Concolic** (concrete + symbolic) testing, introduced by DART (Godefroid, Klarlund, Sen, PLDI 2005), runs the program on a concrete input and builds the symbolic path condition along that single run. Then it searches for the next input:

1. Run with some input and record the branch conditions $c_1, \ldots, c_k$ actually taken.
2. Pick a branch $i$, form $c_1 \wedge \ldots \wedge c_{i-1} \wedge \neg c_i$ and ask the solver for a model.
3. Run again with that model: it follows the same prefix and diverges at branch $i$. Repeat, exploring the tree of paths.

Whenever the symbolic reasoning cannot cope (a hash call, an unmodeled system call), the concrete values of the actual run are used instead, so the technique degrades gracefully rather than failing. This is why concolic tools handle real programs that pure symbolic executors cannot. SAGE applies the same loop to file parsers and, according to its authors, found many security bugs in Windows and Office, which led to its description as *whitebox fuzzing*.

### Relation to other techniques

Symbolic execution is *precise per path* and *incomplete across paths*; abstract interpretation is the opposite, covering all paths imprecisely. Bugs it reports come with a concrete failing input, so there are no false positives from the path logic (apart from modeling gaps). It complements coverage-guided fuzzing, covered in a later concept: a fuzzer is fast at shallow paths and weak at narrow conditions like checksums and magic numbers, while symbolic reasoning solves those conditions directly. Hybrid tools (Driller, QSym) run both.

## Worked Examples

### Example 1: enumerating paths by hand

**Problem:** Execute the following function symbolically and list the path conditions.

```c
int f(int x, int y) { return 2 * y; }

void h(int x, int y) {
    int z = f(x, y);
    if (z == x) {
        if (x > y + 10) {
            abort();
        }
    }
}
```

**Solution:** Start with $x \mapsto \alpha$, $y \mapsto \beta$. The call gives $z \mapsto 2\beta$. The first branch compares $2\beta$ with $\alpha$ and forks: path 1 has $\pi_1 = (2\beta \neq \alpha)$ and returns. Path 2 has $\pi_2 = (2\beta = \alpha) \wedge (\alpha \leq \beta + 10)$ and returns. Path 3 has $\pi_3 = (2\beta = \alpha) \wedge (\alpha > \beta + 10)$ and reaches `abort()`. To find an input that triggers the abort, ask the solver for a model of $\pi_3$: substituting $\alpha = 2\beta$ gives $2\beta > \beta + 10$, i.e. $\beta > 10$. The model $\beta = 11$, $\alpha = 22$ is one answer, so `h(22, 11)` aborts. A random tester would need to guess $x = 2y$ among $2^{32}$ values of $x$ for every $y$.

### Example 2: a concolic run

**Problem:** Run the DART loop on `h` above, starting from the random input $x = 269167349$, $y = 889801541$.

**Solution:** Run 1 (concrete): $z = 2y = 1779603082 \neq x$, so the branch `z == x` is false. The recorded condition is $c_1 = (2y \neq x)$. Negate it: $2y = x$. The solver returns, say, $x = 0, y = 0$. Run 2: now `z == x` is true, then `x > y + 10` is false; the recorded path is $(2y = x) \wedge (x \leq y + 10)$. Negate the last condition: $(2y = x) \wedge (x > y + 10)$. The solver returns $x = 22, y = 11$ (or any other solution). Run 3 reaches `abort()`. Three runs found the bug, each guided by one solver query, and no run needed to understand the program structure. (In real 32-bit arithmetic, the solver also models overflow of `2 * y`, which adds more solutions.)

### Example 3: where the technique stalls

**Problem:** Why can a pure symbolic executor not solve `if (sha256(input) == target) bug();`, and what does a concolic tool do?

**Solution:** Writing the path condition requires expressing the hash computation as constraints, and inverting it is a preimage problem the solver cannot do efficiently, by design of the hash. A pure symbolic executor stalls on that branch. A concolic tool treats the hash call as an opaque function: it runs it with the concrete input and uses the concrete result, losing the symbolic dependency, and moves on to other branches. The `bug()` path remains unreached, a limitation that no technique removes, but the rest of the program is still explored instead of the whole analysis failing.

## Common Misconceptions & Pitfalls

- **"Symbolic execution proves a program correct."** Only if it explores all feasible paths to completion, which is possible only for programs with finitely many paths (bounded loops, small inputs). Otherwise it is a bug finder with strong evidence of what it did not cover.
- **"It produces no false positives."** A reported failing input is a real execution if the model of the environment is faithful. Imprecise models of library calls, floating point, or memory layout can yield inputs that do not reproduce on the real system, so reports must be replayed.
- **"A faster solver fixes path explosion."** The exponential number of paths is the problem, not the cost per query. Search strategies, state merging, summaries of functions, and restricting symbolic inputs matter more than solver speed.
- **"Concolic and symbolic execution are different tools."** They are the same idea with different handling of what the symbolic engine cannot represent: pure symbolic executors stop or approximate, concolic ones fall back to the concrete value.

## Summary

Symbolic execution runs a program on symbolic inputs, maintaining a symbolic store and a path condition that an SMT solver checks for feasibility and turns into a concrete test input for each path. It finds deep bugs that random testing misses, but suffers from path explosion, solver limits, symbolic memory, and the environment. Concolic testing runs concretely while recording the symbolic path condition, then negates a branch to steer the next run, and falls back to concrete values where reasoning fails; DART, SAGE, and KLEE are its best-known realizations. The next concept turns from analysis of the program's meaning to proving it against a specification: separation logic, the tool for reasoning about programs that use pointers.

## Documentation Links

- [King: Symbolic Execution and Program Testing (Communications of the ACM, 1976)](https://dl.acm.org/doi/10.1145/360248.360252): doc
- [Cadar, Dunbar, Engler: KLEE: Unassisted and Automatic Generation of High-Coverage Tests for Complex Systems Programs (OSDI 2008)](https://www.usenix.org/legacy/event/osdi08/tech/full_papers/cadar/cadar.pdf): doc
- [Godefroid, Klarlund, Sen: DART: Directed Automated Random Testing (PLDI 2005)](https://dl.acm.org/doi/10.1145/1065010.1065036): doc
- [Baldoni et al.: A Survey of Symbolic Execution Techniques (ACM Computing Surveys, 2018)](https://arxiv.org/abs/1610.00502): doc
