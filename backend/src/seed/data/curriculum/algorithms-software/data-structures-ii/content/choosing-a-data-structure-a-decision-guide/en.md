---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Summarize, for each of the six major structures covered across Data Structures I and II, the operations it supports well and the Big-O guarantees it actually offers.
- Distinguish an *average-case* guarantee (hash table lookup) from a *worst-case* guarantee (AVL/red-black tree operations, heap operations), and explain why that distinction sometimes decides which structure is correct for a given problem.
- Match a realistic problem description to the single most appropriate structure among hash table, plain BST, AVL/red-black tree, heap, union-find, and trie, citing the specific operation the problem needs.
- Identify situations where more than one structure is defensible, and articulate the actual trade-off between the candidates rather than declaring a single "best" answer.
- Use this concept's comparison table as a working reference when approaching a new, unfamiliar problem — recognizing which operation the problem's core requirement maps to.

## Context & Motivation

Every concept in Data Structures I and II has made a version of the same argument: a structure is fast at some operations because it has committed, structurally, to a particular way of organizing data, and that same commitment is exactly what makes it slow (or simply incapable) at other operations. A hash table commits to scrambling keys for O(1) average exact lookup, and gives up all ordering and all prefix relationships in exchange. An AVL or red-black tree commits to a balance invariant enforced on every insertion, buying guaranteed O(log n) worst-case ordered operations at the cost of insert/delete work a plain BST or hash table never has to do. A heap commits to a much weaker invariant (parent ≤ or ≥ children, not a total order) in exchange for O(1) access to the current extreme value and O(log n) insert/extract — but gives up the ability to search for an arbitrary element efficiently at all. Union-find commits to answering only two questions (are these connected, merge these) but answers both in near-constant amortized time, faster than any general-purpose graph traversal could manage per query. A trie commits to spelling keys out character by character, buying native prefix operations that a hash table cannot offer, at the cost of per-key operations that are no faster (and often slower in practice) than a hash table's.

None of these six structures is "the best" in any general sense, and a large part of genuine competence with data structures is exactly the skill this concept is built around: given a problem, correctly identifying which specific operation is the bottleneck, and then picking the one structure whose fundamental commitment matches that operation. This is deliberately the capstone of this discipline — every other concept in Data Structures I and II built one structure's internals in depth; this one asks you to hold all of them in your head at once and make the comparative judgment a working engineer or a technical interview actually demands: not "explain how a heap works," but "given this problem, why a heap and not a BST?"

## Core Theory

### The six structures at a glance

| Structure | Best at | Typical Big-O | Ordering / extra guarantee |
|---|---|---|---|
| **Hash table** | Exact-key insert / lookup / delete | O(1) average; O(n) worst case | No ordering at all |
| **Plain BST** | Ordered insert / lookup / delete, in-order traversal | O(log n) average; **O(n) worst case** (degenerates on sorted/adversarial input) | Full ordering, but no balance guarantee |
| **AVL / red-black tree** | Ordered insert / lookup / delete with a guarantee | O(log n) **worst case**, always | Full ordering, worst-case guaranteed |
| **Heap (binary)** | Repeated access to the current min or max | O(1) peek; O(log n) insert / extract | Only the extreme is ordered — no efficient arbitrary search |
| **Union-find** | Merge two groups; ask if two elements are connected | O(α(n)) amortized per operation (effectively constant) | No ordering, no traversal — only connectivity |
| **Trie (incl. TST)** | Prefix-based string queries (`keysWithPrefix`) | O(L) insert/search (L = key length); O(P + matches) prefix query | Keys are strings/sequences; shared prefixes share structure |

This table is the single most useful artifact in this concept — the rest of Core Theory exists to justify why each row says what it says, and the Worked Examples exist to practice reading a problem and finding the correct row.

### Reading the table correctly: guarantee type matters as much as the exponent

The most consequential distinction in this table is not between O(1) and O(log n) — it's between *average-case* and *worst-case* guarantees, and between *amortized* and *per-operation* guarantees, because these determine what a structure promises you can actually rely on:

- **Hash table — O(1) average, O(n) worst case.** A pathological sequence of keys that all collide (or a deliberately crafted adversarial workload) can degrade a hash table to linear-time operations. For most applications this risk is negligible, but it is real, and it is precisely why systems with adversarial inputs (e.g., web servers accepting untrusted keys) sometimes need randomized hash functions or fall back to balanced trees for worst-case protection.
- **Plain BST — O(log n) average, O(n) worst case.** A BST built from already-sorted input degenerates into a linked list, with every operation costing O(n). This is not a rare edge case to be dismissed — sorted or near-sorted input is common in practice (log files, timestamped records, IDs assigned in order) — which is exactly the motivation for self-balancing trees.
- **AVL and red-black trees — O(log n), guaranteed, always.** The entire purpose of the balance invariant enforced on every insertion is to rule out the plain BST's worst case entirely. This guarantee is what makes AVL/red-black trees the right choice whenever a workload cannot tolerate an occasional slow operation, not merely a fast one on average.
- **Heap — O(log n) insert/extract, worst case, but only for the extreme element.** A heap's guarantee is narrower in scope than a balanced tree's: it says nothing about finding an arbitrary element (that's O(n), a full scan, since the heap property only orders parent against child, not siblings against each other) — the guarantee applies only to accessing and removing the current minimum or maximum.
- **Union-find — O(α(n)) amortized, with path compression and union by rank/size.** α is the inverse Ackermann function, which grows so slowly it is effectively a constant (under 5) for any n that could ever be represented in a real computer — "amortized" here means the bound holds over a whole sequence of operations, not necessarily on any single operation in isolation, though in practice it behaves as close to O(1) as any structure in this table gets.
- **Trie — O(L) per key operation, independent of n (the number of stored keys).** This is a genuinely different shape of guarantee than the others: trie costs scale with key length, not with how many keys are stored, which is why a trie's performance does not degrade as more keys are added, unlike a BST or hash table where n appears directly in the cost formula (inside a logarithm, or as a worst-case term).

### The one operation each structure uniquely enables

Beyond raw speed, each structure is often the right choice not because it's faster but because it's the *only* one on this list that supports the needed operation *at all*, efficiently:

- Only a trie efficiently answers "give me every key starting with this prefix."
- Only a heap efficiently answers "what's the current minimum/maximum, and let me remove it, repeatedly, as the set changes."
- Only union-find efficiently answers "have these two elements ever been merged into the same group?" across a long stream of merge and query operations.
- Only an ordered structure (BST, AVL, or red-black tree) efficiently answers "give me all elements between X and Y, in order" (range queries and in-order traversal) — a hash table and a trie (for prefix-only queries) cannot do this at all, and a heap can only cheaply reach the single extreme, not an arbitrary range.
- Only a hash table (among these six) achieves O(1) *average* for a pure "is this exact key present" query with no ordering requirement at all — every ordered structure pays at least O(log n) for the privilege of maintaining order alongside lookup.

## Worked Examples

### Example 1 — matching six realistic scenarios to a structure

**Problem:** For each scenario below, name the correct structure and the specific operation that makes it correct.

1. *"I need to process a huge stream of `union(a, b)` and `connected(a, b)` calls as fast as possible, and I never need to list the members of a group or undo a merge."* → **Union-find.** The operations named are exactly union-find's two supported operations, and nothing else on the list matches "merge" and "connectivity query" as primitives — a BST or hash table could simulate this with a graph traversal per query, but at far worse than O(α(n)) amortized cost per operation.
2. *"I need a priority queue for a task scheduler — always process the highest-priority task next, and new tasks arrive continuously."* → **Heap.** "Always the current highest, with continuous inserts" is precisely a heap's O(1) peek / O(log n) insert-extract contract; a balanced tree could also support this (its minimum/maximum is reachable in O(log n)) but at strictly worse peek cost and no benefit, since nothing here needs ordering among the non-extreme elements.
3. *"I need to store user records keyed by user ID and support fast exact lookups; I never need them in any particular order."* → **Hash table.** No ordering requirement is stated at all, so paying O(log n) for a balanced tree's ordering guarantee buys nothing useful here — the hash table's O(1) average lookup is strictly the better fit when ordering is genuinely irrelevant.
4. *"I need to support a search box that suggests completions as the user types."* → **Trie.** This is autocomplete, covered in the previous concept — `keysWithPrefix` is the operation, and it is the operation only a trie (or TST, for a large alphabet) offers natively.
5. *"I need an in-memory index that supports fast range queries ('give me every order between these two timestamps') and I cannot tolerate an occasional slow operation, even a rare one, because this runs in a latency-sensitive trading system."* → **AVL or red-black tree**, not a plain BST. The range-query need points at an ordered structure; the "cannot tolerate even a rare slow operation" requirement rules out a plain BST (O(n) worst case) and points specifically at the guaranteed-worst-case variant.
6. *"I need to deduplicate a list of arbitrary objects, checking 'have I seen this before' repeatedly, with no need to ever iterate them in order."* → **Hash table.** Same reasoning as scenario 3 — no ordering need, so the plain O(1)-average exact-membership check is the right and simplest tool; reaching for a trie or tree here would only be justified if the objects were strings and prefix relationships mattered, which this scenario does not mention.

### Example 2 — a case where two structures are both defensible, and choosing correctly

**Problem:** A system needs to maintain a leaderboard of the top 10 scores out of millions of submissions, updated continuously, with frequent queries for "what is the current 10th-highest score" (the cutoff to make the leaderboard). Compare a heap-based approach against a balanced-tree-based approach and determine which is preferable.

**Solution.** A **min-heap of size 10** is the natural fit: keep only the 10 current leaders in the heap, with the *smallest* of the 10 at the root; on a new submission, compare it against the root, and if it's larger, pop the root and push the new score, an O(log 10) = O(1)-ish operation (log of a constant is a constant). The current cutoff (10th place) is always the O(1) peek at the root. This approach uses O(1) additional space beyond the 10 tracked scores and touches nothing outside the tiny heap on each update.

A **balanced tree (AVL/red-black) holding all scores** could also answer "what's the 10th-highest" by walking from the maximum, but this requires the tree to actually store *all* submissions (not just the top 10), costing O(log n) per insert where n is the *total* number of submissions (potentially millions), and finding the 10th-highest requires a bounded in-order traversal from the max, which is more machinery than the question needs.

The heap wins decisively here, and the reason maps directly to Core Theory's "one operation each structure uniquely enables": the actual need is repeated access to a bounded extreme set, which is a heap's specialty, not a general ordered-range or full-membership need, which is what a balanced tree is built for. Reaching for the more powerful, more general structure (the balanced tree) when a narrower, cheaper one (the small fixed-size heap) answers the exact question asked is a common overengineering mistake this comparison is meant to head off.

### Example 3 — working backward from an operation to the structure, without being told the domain

**Problem:** A structure is needed that supports: insert a string key, and later — given only a few leading characters of a key — retrieve every stored key that starts with those characters, quickly, even when millions of keys are stored and only a handful match. No other operations (no deletion in this scenario, no numeric priority, no connectivity) are required. Identify the structure, independent of any stated real-world application.

**Solution.** The described requirement — "insert string keys, retrieve by prefix, cost proportional to matches found and prefix length, not to total keys stored" — is, word for word, the defining guarantee of a **trie** (a TST if the key alphabet is large or sparse, per that concept's memory trade-off). No other structure on this list offers a native prefix-collection operation at all: a hash table would require scanning every key; a BST or balanced tree could locate a *range* of keys lexicographically near the prefix but has no built-in notion of "prefix" as distinct from "value range," making it an awkward, non-native fit; a heap and union-find don't support key-based retrieval of this kind at all. This example is included specifically to demonstrate the decision process independent of a named domain (autocomplete, routing) — the operation described is the signal, not the application it happens to belong to.

## Common Misconceptions & Pitfalls

- **"One structure is objectively the best overall, so I should default to it."** No structure in this table dominates the others across every operation — each one's speed at its specialty is bought by a specific, named weakness elsewhere (a hash table's lack of ordering, a heap's lack of arbitrary search, a trie's lack of any advantage for exact non-prefix lookup). Defaulting to a single "favorite" structure regardless of the problem is precisely the habit this capstone concept is meant to correct.
- **"If ordering isn't explicitly required, a hash table is always fine — I don't need to think about whether I'll need range queries later."** This is often true in the moment but is a common source of costly rewrites: a system that starts with "just exact lookup" frequently grows a need for range queries, sorted iteration, or nearest-neighbor lookups as requirements evolve, at which point a hash table offers no partial credit at all (it cannot be adapted to ordering; the underlying data must be re-indexed into an ordered structure from scratch). Anticipating a genuinely likely future ordering need is a legitimate reason to choose a balanced tree over a hash table even when only exact lookup is required today.
- **"AVL and red-black trees are strictly better than a plain BST, so a plain BST is never the right choice."** A plain BST is simpler to implement and has slightly less per-operation overhead (no rotations, no balance bookkeeping) than a self-balancing variant, and remains entirely adequate whenever the insertion order is known to be sufficiently random or otherwise non-adversarial — a plain BST built from genuinely randomized input performs close to O(log n) on average in practice. The self-balancing guarantee matters specifically when input order is untrusted, adversarial, or already sorted; it is not a free upgrade with zero cost in every situation.
- **"Union-find can be used to check adjacency or list a group's members, since it tracks which elements are connected."** Union-find answers exactly two questions — "merge these two groups" and "are these two elements in the same group" — and does not efficiently support listing all members of a group, finding a path between two connected elements, or answering "connected via how many hops"; those require an actual graph traversal structure. Union-find's speed comes specifically from *not* maintaining that extra information, and reaching for it to answer a question it wasn't built for either fails outright or requires bolting on a separate structure alongside it.
- **"A trie is the right choice any time the keys happen to be strings."** The keys being strings is necessary but not sufficient — a trie earns its place specifically when prefix-based queries matter. A system that only ever needs exact-string lookup (no prefix queries, no autocomplete, no routing-style longest-match) gains nothing from a trie over a hash table and typically pays more per-key overhead for a capability (prefix search) it never actually uses.

## Summary

Across Data Structures I and II, six structures each answer a genuinely different question fastest: a hash table answers "is this exact key present?" in O(1) average time by discarding ordering entirely; a plain BST answers ordered queries in O(log n) average but degrades to O(n) on adversarial or sorted input; an AVL or red-black tree closes that gap with a worst-case O(log n) guarantee, at the cost of balancing overhead on every insert; a heap answers "what's the current extreme, and let me remove it" in O(1) peek / O(log n) update, without supporting arbitrary search at all; union-find answers "merge these" and "are these connected?" in near-constant amortized time by deliberately not tracking anything more than group membership; and a trie answers "what keys share this prefix?" in time proportional to the prefix and the match count, independent of how many other keys exist, by spelling keys out character by character. Choosing correctly among them means identifying the actual bottleneck operation a problem needs — exact lookup, ordered range, extreme-value access, connectivity, or prefix search — and matching it to the one structure built around exactly that operation, rather than defaulting to a familiar favorite or assuming a more general-purpose structure is automatically the safer choice.

## Documentation Links

- [MIT 6.006 — Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/) — doc
- [Sedgewick & Wayne — Algorithms Lectures (Princeton)](https://algs4.cs.princeton.edu/lectures/) — doc
