---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

Understand how a regular expression can be turned into an abstract pattern-matching machine — a nondeterministic finite-state automaton (NFA) — and how *simulating* that machine (tracking the full set of states it could possibly be in, rather than guessing and backtracking on a wrong guess) lets Sedgewick & Wayne's algorithm decide whether an N-character text matches an M-character RE in time proportional to `NM` in the worst case, guaranteed, no matter how the RE is structured.

## Use Cases

- **Substring search generalized.** Searching for a literal substring `pat` in a text `txt` (Section 5.3's problem) is exactly the special case of asking whether `txt` is in the language described by the pattern `.*pat.*` — RE matching subsumes substring search rather than being a separate problem.
- **Validity checking of structured input** — phone numbers (`\([0-9]{3}\)\ [0-9]{3}-[0-9]{4}`), Java identifiers (`[$_A-Za-z][$_A-Za-z0-9]*`), or email addresses (`[a-z]+@([a-z]+\.)+(edu|com)`) — where writing an RE that describes the set of all legal strings is more precise and concise than hand-coding every case.
- **grep and genomics.** The Unix `grep` command prints every line matching a given RE; biologists use REs like `gcg(cgg)*ctg` to describe genomic regions where a short sequence repeats a variable number of times (a repeat count clinically associated with certain genetic conditions).

## Deep Dive

### Regular expressions as a language-description tool: concatenation, or, closure

A regular expression (RE) is built from three operations applied to characters: **concatenation** (`AB` denotes the one-string language `{AB}`), **or** (`A|B` denotes `{A, B}`, written with `|`), and **closure** (`A*` denotes the language formed by concatenating `A` with itself zero or more times, denoted with a trailing `*`). Concatenation has higher precedence than or, and closure has higher precedence than concatenation, so `AB*` means "an A followed by zero or more Bs" while `A*B` means "zero or more As followed by a B"; parentheses override the default precedence, so `C(AC|B)D` describes `{CACD, CBD}`. Formally, an RE is either empty, a single character, an RE in parentheses, two or more concatenated REs, two or more REs separated by `|`, or an RE followed by `*` — and each construct's *meaning* is defined recursively in exactly the same shape (concatenation's language is the cross product of its parts' languages, or's is their union, closure's is the union of the concatenation of any number of copies including zero).

Practical REs add shortcuts on top of these three primitives: `.` (wildcard, any single character), `[AEIOU]` (a specified set), `[A-Z]` (a range), `[^AEIOU]` (a complement), and closure shortcuts `+` (at least one copy, i.e. `(AB)+` is shorthand for `(AB)(AB)*`), `?` (zero or one copy), and `{n}`/`{n-m}` (an exact or ranged copy count). Every one of these is "simply a shortcut for a sequence of or operations" or a sequence of concatenation/closure — they don't add expressive power, only convenience.

### Representing a pattern as an NFA: one state per RE character, two kinds of edges

The key idea, by analogy with KMP's DFA from the previous section: build an abstract machine from the pattern, then simulate it against the text. The difference is that an RE's `|` and `*` operators mean the machine cannot always tell, from one character alone, whether the pattern could match — so the machine is given the power of **nondeterminism**: when faced with more than one possible transition, it can conceptually "guess" the right one, and it's said to recognize a text if *some* sequence of transitions consumes every text character and ends in the accept state.

By convention every pattern is enclosed in parentheses. Consider the RE `((A*B|AC)D)`, whose NFA has one state per character of the RE (indices 0 through 10, for the 11 characters) plus a virtual accept state 11:

```text
 0   1   2   3   4   5   6   7   8   9   10   11
 (   (   A   *   B   |   A   C   )   D   )   accept
```

- A state corresponding to an alphabet character (like `A`, `B`, `C`, `D`) has one outgoing **match transition** — a black edge in the book's diagrams — to the next state, taken only when the current text character equals that state's character; taking it consumes (scans past) that character.
- A state corresponding to a metacharacter (`(`, `)`, `|`, `*`) has one or more outgoing **ε-transitions** — red edges — to some other state, taken without consuming any text character at all (ε stands for matching the empty string).
- No state has more than one outgoing match transition, though a state can have several outgoing ε-transitions.

Because ε-transitions never depend on the text, they form a fixed digraph independent of any particular input — Sedgewick & Wayne call it `G`. For `((A*B|AC)D)`, `G` consists of exactly nine edges: `0→1, 1→2, 1→6, 2→3, 3→2, 3→4, 5→8, 8→9, 10→11`. (`2→3` lets `A*` match zero As by skipping straight from the `A` state to the `*` state; `3→2` loops back for another A; `1→2` and `1→6` are the two branches of the `|`; `5→8` and `8→9` skip past the `|`-branch machinery to the closing `)`; `10→11` reaches the accept state after the final `)`.) Match transitions are *not* part of `G` — they live implicitly in the RE's character array and only fire while scanning a specific text character.

### Simulating the NFA: track the whole set of reachable states, one multi-source reachability pass per input character

Rather than guess-and-backtrack, the algorithm keeps track of *every* state the NFA could possibly be in while examining the current input character — the set of all states reachable from the states matched so far via zero or more ε-transitions. This is exactly the multiple-source reachability computation (`DirectedDFS`) used earlier for digraph reachability: initialize the set as everything reachable via ε-transitions from state 0; for each input character, compute which of the current states have a match transition on that character (giving a new set of states just after the match), then take the ε-closure of that set (everything reachable from it via `G`) to get the states possible before the next character. If the accept state is ever in the set, the text is recognized.

Tracing `((A*B|AC)D)` against the input `AABD` reproduces the book's own worked example exactly:

```viz
type: graph
node 0 "0:(" 0 0
node 1 "1:(" 1 0
node 2 "2:A" 2 0
node 3 "3:*" 3 0
node 4 "4:B" 4 0
node 5 "5:|" 5 0
node 6 "6:A" 6 1
node 7 "7:C" 7 1
node 8 "8:)" 8 0
node 9 "9:D" 9 0
node 10 "10:)" 10 0
node 11 "11:acc" 11 0
edge 0 1 directed
edge 1 2 directed
edge 1 6 directed
edge 2 3 directed
edge 3 2 directed
edge 3 4 directed
edge 5 8 directed
edge 8 9 directed
edge 10 11 directed
---
mark 0 | Start the NFA at state 0, before reading any of the text "AABD".
traverse 0 1 | epsilon 0->1.
traverse 1 2 | epsilon 1->2: try the (A*B|...) branch.
traverse 1 6 | epsilon 1->6: the NFA can also try the (...|AC) branch -- nondeterminism means both are kept.
traverse 2 3 | epsilon 2->3: A* can match zero As, so state 2 reaches state 3 without consuming a character.
traverse 3 4 | epsilon 3->4: leaving the A* loop for B. Epsilon-closure of state 0 is now {0,1,2,3,4,6} -- matches the book's trace exactly.
mark 2 | Reading text[0] = 'A'. State 2 holds 'A' and matches: match transition 2->3 (not a graph edge -- match transitions consume a character and live outside digraph G).
mark 6 | State 6 also holds 'A' and matches: match transition 6->7. The set of states just after matching the first A is {3,7}.
traverse 3 2 | epsilon 3->2: loop back into the A* closure for another A.
traverse 3 4 | epsilon 3->4: or leave the loop for B. Epsilon-closure of {3,7} is {2,3,4,7} -- matches the book's trace.
mark 2 | Reading text[1] = 'A'. State 2 matches again: match transition 2->3. State 7 holds 'C', not 'A' -- the AC branch dies here.
traverse 3 2 | epsilon-closure of {3}: 3->2...
traverse 3 4 | ...and 3->4, giving {2,3,4} -- matches the book's trace after the second A.
mark 4 | Reading text[2] = 'B'. State 4 holds 'B' and matches: match transition 4->5. The set becomes {5}.
traverse 5 8 | epsilon 5->8.
traverse 8 9 | epsilon 8->9. Epsilon-closure of {5} is {5,8,9} -- matches the book's trace.
mark 9 | Reading text[3] = 'D'. State 9 holds 'D' and matches: match transition 9->10. The set becomes {10}.
traverse 10 11 | epsilon 10->11. Epsilon-closure of {10} is {10,11}.
visit 11 | State 11 is the accept state, and all of "AABD" has been scanned: the NFA recognizes "AABD" -- exactly the outcome Sedgewick & Wayne's own trace reaches.
```

The book's own hand trace confirms every intermediate set along the way: `{0,1,2,3,4,6}` (start), `{3,7}` then `{2,3,4,7}` (after the first A), `{3}` then `{2,3,4}` (after the second A), `{5}` then `{5,8,9}` (after B), `{10}` then `{10,11}` (after D) — accept. The same NFA can also *stall* on input it should recognize if it takes a wrong-seeming transition sequence too early — for instance, if it jumps to state 4 before scanning all the As, state 4's only way out is to match a B next, so an extra A leaves it stuck with nowhere to go. Simulating the *entire set* of reachable states side-steps this entirely: a stalling sequence simply drops out of the tracked set, while any surviving sequence that does reach the accept state is still being tracked in parallel.

The Java code (Sedgewick & Wayne's `NFA.recognizes`) is a direct translation of this description — `pc` ("possible current" states) holds the running set, recomputed each iteration via a fresh `DirectedDFS`:

```java
public boolean recognizes(String txt)
{ // Does the NFA recognize txt?
    Bag<Integer> pc = new Bag<Integer>();
    DirectedDFS dfs = new DirectedDFS(G, 0);
    for (int v = 0; v < G.V(); v++)
       if (dfs.marked(v)) pc.add(v);

    for (int i = 0; i < txt.length(); i++)
    { // Compute possible NFA states for txt[i+1].
       Bag<Integer> match = new Bag<Integer>();
       for (int v : pc)
          if (v < M)
             if (re[v] == txt.charAt(i) || re[v] == '.')
                 match.add(v+1);
       pc = new Bag<Integer>();
       dfs = new DirectedDFS(G, match);
       for (int v = 0; v < G.V(); v++)
          if (dfs.marked(v)) pc.add(v);
    }
    for (int v : pc) if (v == M) return true;
    return false;
}
```

**Proposition Q**: determining whether an N-character text is recognized by the NFA for an M-character RE takes time proportional to `NM` in the worst case. For each of the N text characters, the algorithm iterates through a set of at most M states and runs a DFS on the ε-transition digraph, whose edge count is at most `2M` (established by the construction below), so each per-character DFS costs time proportional to M.

### Building the NFA from the RE: a single stack, one pass over the characters

Translating an RE into its ε-transition digraph resembles Dijkstra's two-stack algorithm for evaluating arithmetic expressions (Section 1.3), adapted to REs' quirks: there's no explicit concatenation operator, `*` is a unary postfix operator, and `|` is the only binary operator — so only *one* stack is needed, tracking the positions of left parentheses and `|` operators.

- **Concatenation** needs no explicit construction — match transitions between adjacent character states implement it automatically.
- **Parentheses**: push the index of each `(` on the stack; each `)` pops back to (eventually) the matching `(`.
- **Closure (`*`)**: after a single character at index `i`, add ε-transitions `i→i+1` (skip it — zero occurrences) and `i+1→i` (loop back for more); after a `)` at index `i`, add the same two edges between `i+1` and the matching `(` on the stack.
- **Or (`A|B`)**: add an ε-transition from the `(`'s index to the first character of `B`, and one from the `|`'s index to the `)`'s index — these are what let the NFA choose either alternative. The `|`'s own index is pushed onto the stack alongside the `(` so both are available when the matching `)` is reached.

```java
public class NFA
{
   private char[] re;                    // match transitions
   private Digraph G;                    // epsilon transitions
   private int M;                        // number of states
    public NFA(String regexp)
    { // Create the NFA for the given regular expression.
       Stack<Integer> ops = new Stack<Integer>();
       re = regexp.toCharArray();
       M = re.length;
       G = new Digraph(M+1);
       for (int i = 0; i < M; i++)
       {
          int lp = i;
          if (re[i] == '(' || re[i] == '|')
             ops.push(i);
          else if (re[i] == ')')
          {
             int or = ops.pop();
             if (re[or] == '|')
             {
                lp = ops.pop();
                G.addEdge(lp, or+1);
                G.addEdge(or, i);
             }
             else lp = or;
          }
          if (i < M-1 && re[i+1] == '*') // lookahead
          {
             G.addEdge(lp, i+1);
             G.addEdge(i+1, lp);
          }
          if (re[i] == '(' || re[i] == '*' || re[i] == ')')
             G.addEdge(i, i+1);
       }
    }
    public boolean recognizes(String txt)
    // Does the NFA recognize txt?
}
```

**Proposition R**: building the NFA for an M-character RE takes time and space proportional to M in the worst case — for each of the M characters, the constructor adds at most three ε-transitions and performs at most one or two stack operations.

Put together, the two propositions give the full picture: an `NFA` is built in time proportional to M, and then `recognizes(txt)` runs in time proportional to `NM` — the classic "GREP" client (which wraps the given pattern as `(.*pattern.*)` and prints every matching line of standard input) is exactly this construction-then-simulation pipeline applied line by line.

## Trade-offs

- **Guaranteed `O(NM)` worst case — no exponential blowup, ever.** Because the algorithm tracks the *entire* set of possible states at each step (a multi-source reachability computation) instead of committing to one guess and backtracking when it's wrong, Proposition Q's bound holds unconditionally, for any RE and any text: the cost is exactly the product of text length and pattern length, the same worst-case bound as brute-force substring search.
- **This is not how `java.util.regex.Pattern` (or most production regex engines) actually work.** The Java standard library's regex engine is a *backtracking* matcher: it commits to one path through the pattern and only tries alternatives after a dead end, rather than tracking a state set the way this NFA simulation does. That backtracking design buys expressive power NFA simulation alone cannot offer — backreferences (matching "whatever the third group matched earlier") require remembering match history in a way a fixed set of NFA states can't represent — but it gives up the unconditional time bound: certain adversarial patterns (nested or overlapping repetition against a non-matching input) can make a backtracking engine's running time blow up exponentially in the input length, the phenomenon commonly called catastrophic backtracking or ReDoS. The NFA-simulation approach traced above is immune to that failure mode by construction, at the cost of not supporting backreferences at all.
- **Space is modest and predictable.** The ε-transition digraph for an M-character RE has at most `2M` edges (Proposition Q's proof), and the NFA itself is built in time and space proportional to M (Proposition R) — both independent of the text being searched.
- **Nondeterminism is resolved by tracking a set, not by search.** The conceptual trick that makes an NFA simulatable at all is refusing to ever actually "guess": instead of picking one transition and hoping, the algorithm carries every currently-possible state forward together, so a transition sequence that later stalls (as shown in the worked trace above) simply falls out of the tracked set without needing to be detected and undone.

## Documentation Links

- [Robert Sedgewick, Kevin Wayne — Algorithms, 4th Edition, Section 5.4 "Regular Expressions", pp. 788-809](https://algs4.cs.princeton.edu/54regexp/) — doc
- [Pattern — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html) — doc
