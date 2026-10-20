---
version: 1.0
updatedAt: 2026-10-20
---
## Learning Objectives

- Trace a shift-reduce parse using a stack of automaton states and an ACTION/GOTO table, and say what a handle is.
- Build the LR(0) item sets of a small grammar with `closure` and `goto`, and fill in an SLR(1) table from them.
- Explain where shift/reduce and reduce/reduce conflicts come from, and resolve them with precedence declarations or by rewriting the grammar.
- Compare SLR(1), LALR(1), and canonical LR(1), and compare LR parsing with recursive descent.

## Context & Motivation

`software-distributed/programming-languages` parsed expressions with recursive descent, a top-down method that predicts a production before reading its input, and `algorithms-software/formal-languages-automata` showed that a pushdown automaton recognizes exactly the context-free languages. **LR parsing** is the bottom-up counterpart: the parser reads input left to right ("L"), builds the rightmost derivation in reverse ("R"), and decides what to do from the symbols already seen plus a bounded lookahead. Where a top-down parser must guess which rule to expand, an LR parser waits until it has seen the whole right-hand side and only then reduces it.

Knuth introduced LR(k) parsing in 1965, and it remains the engine of **parser generators** such as yacc, Bison, and their descendants. PostgreSQL's SQL grammar and PHP's grammar are Bison files. Many production compilers (GCC's C and C++ front ends, Clang, Go) use hand-written recursive descent instead, for better error messages and context-sensitive tricks, but anyone who has met the message "shift/reduce conflict" needs to understand the tables behind it. Stanford CS143 and the "dragon book" present this algorithm as the standard way to turn a grammar specification into a parser.

## Core Theory

### Shift-reduce parsing

The parser keeps a stack of grammar symbols and a rest of input. It repeats two kinds of action:

- **Shift**: move the next input token onto the stack.
- **Reduce** by $A \to \alpha$: when the top of the stack is $\alpha$, replace it by $A$.

Reading the actions backward gives a rightmost derivation. The substring that is ready to be reduced at each step is called the **handle**. The whole difficulty is choosing correctly between shifting and reducing, and between several possible reductions, without backtracking.

### LR(0) items and the automaton

An **item** is a production with a dot marking how much of the right-hand side has been seen: $E \to E + {\cdot}\,T$ means "$E +$ is on the stack and a $T$ is expected next". A **state** is a set of items. Two operations build the states:

- $\text{closure}(I)$: if $A \to \alpha \cdot B \beta$ is in $I$, add $B \to \cdot\,\gamma$ for every production of $B$, repeatedly.
- $\text{goto}(I, X)$: move the dot over $X$ in every item that has $X$ after the dot, then close.

Starting from the augmented production $S' \to E$ gives a deterministic automaton whose states are the **viable prefixes** of the grammar. The parser stack stores these states. A table has two parts: ACTION[state, token] is shift, reduce, accept, or error, and GOTO[state, nonterminal] says where to go after a reduction.

### Grammar classes and lookahead

- **LR(0)** reduces whenever a complete item is present, ignoring lookahead, and works on very few grammars.
- **SLR(1)** reduces by $A \to \alpha$ only when the lookahead is in $\text{FOLLOW}(A)$. Easy to build, but it uses a coarse global approximation.
- **Canonical LR(1)** puts the exact lookahead inside each item, $[A \to \alpha \cdot \beta,\ a]$. It accepts every LR(1) grammar, which are exactly the grammars of the deterministic context-free languages, but its tables can be very large.
- **LALR(1)** merges canonical LR(1) states that have the same core (items without lookaheads). Tables are the size of the LR(0) automaton, and almost all real language grammars are LALR(1). Merging can introduce a reduce/reduce conflict that canonical LR(1) does not have. Bison builds LALR(1) tables by default and can build canonical LR(1) or IELR(1) ones on request.

The inclusions are $\text{LR}(0) \subset \text{SLR}(1) \subset \text{LALR}(1) \subset \text{LR}(1)$, and $\text{LL}(k) \subset \text{LR}(k)$. LR handles left recursion directly, which LL grammars must rewrite away.

### Conflicts and how tools resolve them

A **shift/reduce** conflict means a state allows both actions on the same token. A **reduce/reduce** conflict means two different reductions are possible. Both point at an ambiguity in the grammar or at insufficient lookahead. Bison reports the conflict, resolves shift/reduce in favor of shifting and reduce/reduce in favor of the earlier rule, and lets the author override with precedence and associativity declarations (`%left`, `%right`, `%nonassoc`). For truly ambiguous input, `%glr-parser` explores all parses in parallel.

## Worked Examples

### Example 1: a complete parse

**Problem:** Parse `id + id` with the augmented grammar $S' \to E$, $E \to E + T \mid T$, $T \to \mathbf{id}$.

**Automaton:** $I_0$ = {$S' \to \cdot E$, $E \to \cdot E + T$, $E \to \cdot T$, $T \to \cdot \mathbf{id}$}. Then $\text{goto}(I_0,E) = I_1$ = {$S' \to E \cdot$, $E \to E \cdot + T$}, $\text{goto}(I_0,T) = I_2$ = {$E \to T \cdot$}, $\text{goto}(I_0,\mathbf{id}) = I_3$ = {$T \to \mathbf{id} \cdot$}, $\text{goto}(I_1,+) = I_4$ = {$E \to E + \cdot T$, $T \to \cdot \mathbf{id}$}, and $\text{goto}(I_4,T) = I_5$ = {$E \to E + T \cdot$}. With $\text{FOLLOW}(E) = \text{FOLLOW}(T) = \{+, \$\}$ the table needs no conflict resolution.

**Trace (state stack, input, action):**

```text
0            id + id $   shift 3
0 3          + id $      reduce T -> id      (pop 1, goto(0,T) = 2)
0 2          + id $      reduce E -> T       (pop 1, goto(0,E) = 1)
0 1          + id $      shift 4
0 1 4        id $        shift 3
0 1 4 3      $           reduce T -> id      (pop 1, goto(4,T) = 5)
0 1 4 5      $           reduce E -> E + T   (pop 3, goto(0,E) = 1)
0 1          $           accept
```

### Example 2: the dangling else

**Problem:** The grammar $S \to \texttt{if}\ E\ \texttt{then}\ S \mid \texttt{if}\ E\ \texttt{then}\ S\ \texttt{else}\ S \mid \texttt{other}$ is ambiguous: in `if a then if b then x else y`, which `if` owns the `else`?

**Analysis:** After the parser has read `if E then S` with `else` as the next token, one state contains both $S \to \texttt{if}\ E\ \texttt{then}\ S \cdot$ and $S \to \texttt{if}\ E\ \texttt{then}\ S \cdot \texttt{else}\ S$. Reducing is legal because `else` can follow $S$ inside an enclosing `if`, and shifting is legal because the `else` can belong to this `if`. That is the shift/reduce conflict. Bison's default (shift) attaches `else` to the nearest `if`, which is the rule of C and Java, so the conflict is benign here; the clean fix is a grammar that splits statements into *matched* and *unmatched* forms.

### Example 3: precedence declarations

**Problem:** The grammar $E \to E + E \mid E * E \mid \mathbf{id}$ has shift/reduce conflicts in the states after `E + E` and `E * E`. Make `*` bind tighter than `+`, and both left-associative.

**Solution:** Declare `%left '+'` and then `%left '*'`; later declarations have higher precedence. In the state with $E \to E + E \cdot$ and lookahead `*`, Bison compares the precedence of the rule (that of its last terminal, `+`) with that of the lookahead: `*` is higher, so it shifts, parsing `a + b * c` as `a + (b * c)`. With lookahead `+`, the precedences are equal and `%left` says reduce, so `a + b + c` parses as `(a + b) + c`. No grammar rewrite is needed.

## Common Misconceptions & Pitfalls

- **"A conflict is a bug in the generator."** It is a fact about the grammar: some input has two valid parse actions with the lookahead available. Fix the grammar, add a precedence rule, or accept the default after checking it does what you intend.
- **"LALR(1) accepts everything LR(1) does."** It accepts a subset: merging states can create a reduce/reduce conflict that the canonical construction avoids. In practice real grammars rarely hit this.
- **"LR parsers cannot give good error messages."** The tables detect the error at the earliest token that cannot continue any valid prefix, which is a strength. Poor messages come from the generic "syntax error" action; production compilers add error productions or use hand-written parsers for tailored recovery.
- **"Precedence is a property of the grammar."** In `%left` declarations it is a property of the table construction. Writing the precedence into the grammar as separate nonterminals ($E \to E + T$, $T \to T * F$) gives the same result with no declarations.

## Summary

An LR parser maintains a stack of states of the LR(0) item automaton and uses ACTION and GOTO tables to shift tokens and reduce handles, reconstructing a rightmost derivation backward. SLR, LALR, and canonical LR(1) differ in how precisely they compute lookahead, trading table size for the set of grammars they accept; LALR(1) is the practical default in yacc and Bison. Conflicts expose real ambiguities, and precedence declarations or grammar rewrites resolve them. Hand-written recursive descent remains common in production compilers for diagnostics and flexibility. The next concept moves from the front end to the middle: the intermediate representation that LLVM uses to separate languages from targets.

## Documentation Links

- [GNU Bison manual: the Bison parser algorithm and conflicts](https://www.gnu.org/software/bison/manual/bison.html): doc
- [Knuth: On the Translation of Languages from Left to Right (Information and Control, 1965)](https://www.sciencedirect.com/science/article/pii/S0019995865904262): doc
- [Stanford CS143: Compilers](https://web.stanford.edu/class/cs143/): doc
- [Grune, Jacobs: Parsing Techniques: A Practical Guide (2nd ed.)](https://dickgrune.com/Books/PTAPG_2nd_Edition/): doc
