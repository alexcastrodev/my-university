---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Implement a depth-first search over a letter grid that finds every valid dictionary word reachable by a path of adjacent, non-repeated cells.
- Prune a grid search using a trie's prefix structure, stopping exploration the instant a partial path is not a prefix of any dictionary word.
- Implement a naive hash-set-of-words baseline that cannot prune early, and measure its actual cost against the trie-pruned version on the same grid and dictionary.
- Validate a word-search implementation against a small, fully hand-traced grid and word list, checking both which words are found and which plausible-looking candidates are correctly rejected.
- Explain, with a concrete before/after measurement, why the trie's prefix-pruning is the specific property that makes it the right structure for this problem, not merely "a tree instead of a hash set."

## Context & Motivation

**Tries: Prefix Trees for String Keys** already established the core fact this lab exploits: a trie's `insert` and prefix-walk operations preserve the relationship between a string and its prefixes, in a way a hash-based dictionary structurally cannot. Boggle-style word search is the natural place to put that fact to work, because the search itself generates one candidate prefix at a time as it walks the grid — the question "should I keep extending this path?" is, exactly, a prefix-membership question, and answering it cheaply is the entire difference between a search that explores intelligently and one that explores blindly and checks only at the very end.

## Core Theory

This lab uses the trie purely as an already-understood tool: `insert(word)` to build the dictionary, and a prefix-walk operation (`has_prefix(prefix) -> bool`, built the same way `search` and `keys_with_prefix` were built in **Tries: Prefix Trees for String Keys** — walk the trie one character at a time, following `children`, returning `False` the moment a needed character edge is missing) to ask, in O(length of the path so far), whether the grid path explored so far could still extend into a real word. No trie internals are re-derived here; the grid-search algorithm built around it is the new material.

## Worked Examples

### Problem statement

Given an `n`-by-`m` grid of letters and a dictionary of valid words, find every word in the dictionary that can be spelled out by a path through the grid, where each step moves to one of the (up to) 8 neighboring cells (up/down/left/right/diagonal), no cell is reused within a single word's path, and a word must be at least length 3 to count (the conventional Boggle minimum, adopted here to keep the example output manageable).

### API specification

```python
class Trie:
    def insert(self, word: str) -> None: ...
    def has_prefix(self, prefix: str) -> bool: ...   # True if some word starts with prefix
    def is_word(self, word: str) -> bool: ...         # True if word itself is a complete stored word

def find_words(grid: list[list[str]], dictionary_trie: Trie, min_length: int = 3) -> set[str]:
    """Returns the set of distinct dictionary words reachable by a valid grid path."""
```

`has_prefix` and `is_word` are the two trie queries this lab needs; both are thin wrappers around the walk-the-tree pattern already built in **Tries: Prefix Trees for String Keys**:

```python
def has_prefix(self, prefix: str) -> bool:
    node = self.root
    for ch in prefix:
        if ch not in node.children:
            return False
        node = node.children[ch]
    return True

def is_word(self, word: str) -> bool:
    node = self.root
    for ch in word:
        if ch not in node.children:
            return False
        node = node.children[ch]
    return node.is_end_of_word
```

### Step 1 — the small concrete example: grid and dictionary

**Grid** (3x3, uppercase for readability):

```
C A T
O R N
D E S
```

As coordinates: `(0,0)=C (0,1)=A (0,2)=T`, `(1,0)=O (1,1)=R (1,2)=N`, `(2,0)=D (2,1)=E (2,2)=S`.

**Dictionary:** `{"CAT", "CAR", "CARD", "CARE", "CARES", "CARTON", "ORE", "TAR", "TARE", "RAT", "ARC", "TORN"}`.

**Adjacency check by hand for a few candidates:**

- `CAT`: C(0,0)→A(0,1)→T(0,2). A and T are horizontally adjacent, C and A are horizontally adjacent. Valid path. **Found.**
- `CAR`: C(0,0)→A(0,1)→R(1,1). A(0,1) and R(1,1) are vertically adjacent. Valid path. **Found.**
- `CARD`: C(0,0)→A(0,1)→R(1,1)→D(2,0). R(1,1) and D(2,0) are diagonally adjacent. Valid path, no cell reused. **Found.**
- `CARE`: C(0,0)→A(0,1)→R(1,1)→E(2,1). R(1,1) and E(2,1) are vertically adjacent. **Found.**
- `CARES`: continuing from E(2,1)→S(2,2), horizontally adjacent. **Found.**
- `CARTON`: needs a second `R` after `CART..` that this specific 3x3 grid does not have adjacent in the right place, and reuses letters the grid layout cannot supply in sequence — **not found**, correctly rejected despite being a plausible-looking longer word sharing the `CAR` prefix.
- `ORE`: O(1,0)→R(1,1)→E(2,1). Both adjacencies valid. **Found.**
- `TORN`: T(0,2)→O(1,0)? T(0,2) and O(1,0) are not adjacent (they differ by 1 in row and 2 in column). **Not found** — a word present in the dictionary but not reachable on this particular grid.

**Expected `find_words` output on this exact grid and dictionary:** `{"CAT", "CAR", "CARD", "CARE", "CARES", "ORE"}` — six words, with `CARTON` and `TORN` correctly absent despite being valid dictionary entries, because the grid's actual letter adjacency does not support a path spelling them out.

### Step 2 — the trie-pruned depth-first search

```python
def find_words(grid, dictionary_trie, min_length=3):
    rows, cols = len(grid), len(grid[0])
    found = set()

    def neighbors(r, c):
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols:
                    yield nr, nc

    def dfs(r, c, path_word, visited):
        # Prune immediately if no dictionary word has this prefix at all --
        # this single check is the entire reason a trie is used here.
        if not dictionary_trie.has_prefix(path_word):
            return
        if len(path_word) >= min_length and dictionary_trie.is_word(path_word):
            found.add(path_word)
        for nr, nc in neighbors(r, c):
            if (nr, nc) not in visited:
                visited.add((nr, nc))
                dfs(nr, nc, path_word + grid[nr][nc], visited)
                visited.remove((nr, nc))   # backtrack: this cell is free again for other paths

    for r in range(rows):
        for c in range(cols):
            dfs(r, c, grid[r][c], {(r, c)})

    return found
```

The `if not dictionary_trie.has_prefix(path_word): return` line at the top of `dfs` is the pruning step: the moment the letters visited so far (e.g., `"CAX"`) are not a prefix of *any* stored word, the function returns immediately rather than continuing to explore the (potentially large) subtree of grid paths extending from that dead end. Backtracking (`visited.remove`) after the recursive call is what allows a cell to participate in multiple different word paths starting from different cells, while still forbidding a single word's path from reusing a cell.

### Step 3 — the naive hash-set baseline, and why it cannot prune

A hash-set-of-words version of `is_word` — `word in word_set` — answers exact membership in O(1) average, exactly as **Hashing and Hash Functions** would predict. The problem is `has_prefix`: a hash set has no operation that answers "is this partial string a prefix of anything in the set" without, in the worst case, checking every stored word's `startswith`:

```python
def naive_has_prefix(prefix: str, word_set: set[str]) -> bool:
    return any(w.startswith(prefix) for w in word_set)   # O(number of words), every single call
```

A naive DFS built around this cannot prune early in the trie sense at all — every call to `naive_has_prefix` costs time proportional to the *entire dictionary size*, not the prefix length, so checking it at every single grid cell visited (which is the only way to prune without a trie) is often slower than not pruning at all. The realistic naive baseline instead generates every possible grid path up to some maximum length first, and only then checks each complete candidate string against the word set:

```python
def find_words_naive(grid, word_set, max_length=8, min_length=3):
    rows, cols = len(grid), len(grid[0])
    found = set()

    def neighbors(r, c):
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols:
                    yield nr, nc

    def dfs(r, c, path_word, visited):
        if min_length <= len(path_word) and path_word in word_set:
            found.add(path_word)
        if len(path_word) >= max_length:
            return
        for nr, nc in neighbors(r, c):        # no pruning -- explores every path fully
            if (nr, nc) not in visited:
                visited.add((nr, nc))
                dfs(nr, nc, path_word + grid[nr][nc], visited)
                visited.remove((nr, nc))

    for r in range(rows):
        for c in range(cols):
            dfs(r, c, grid[r][c], {(r, c)})

    return found
```

This naive version has to explore and fully build *every* grid path up to `max_length` (bounded only by neighbor branching, up to 8 directions per step) regardless of whether any dictionary word shares that path's letters at all, checking `path_word in word_set` only once each full-length candidate is built — the exact "explore fully, then filter" pattern the lab's own guidance warns against, contrasted directly against the trie version's "stop the instant it's not a prefix of anything" pattern.

### Step 4 — measuring the difference

```python
import random
import string
import timeit

def random_grid(size: int) -> list[list[str]]:
    return [[random.choice(string.ascii_uppercase) for _ in range(size)] for _ in range(size)]

def build_trie(words) -> Trie:
    t = Trie()
    for w in words:
        t.insert(w)
    return t

for size in (3, 4, 5, 6):
    grid = random_grid(size)
    trie = build_trie(DICTIONARY)
    word_set = set(DICTIONARY)

    trie_time = timeit.timeit(lambda: find_words(grid, trie), number=3) / 3
    naive_time = timeit.timeit(lambda: find_words_naive(grid, word_set, max_length=size * size), number=3) / 3
    print(f"grid={size}x{size}  trie={trie_time*1000:8.3f} ms  naive={naive_time*1000:8.3f} ms")
```

Expected output shape: at small grid sizes (3x3, 4x4) the two approaches may be close, but the naive version's cost grows sharply with grid size — the number of possible paths grows roughly exponentially with `max_length` and branching factor (up to 8), while the trie-pruned version's actual work stays close to the number of paths that are *genuine dictionary prefixes*, which for a real dictionary and a random grid is a small fraction of all possible letter sequences. A representative pattern: something like `trie=1.2ms naive=3.1ms` at 3x3, widening to `trie=4ms naive=800ms` or worse by 6x6 — the specific numbers depend on dictionary size and branching, but the qualitative widening gap, not any single number, is the empirical demonstration the pruning claim is measured against.

### Step 5 — validating correctness

```python
def build_test_setup():
    grid = [["C", "A", "T"], ["O", "R", "N"], ["D", "E", "S"]]
    words = ["CAT", "CAR", "CARD", "CARE", "CARES", "CARTON", "ORE", "TAR", "TARE", "RAT", "ARC", "TORN"]
    trie = build_trie(words)
    return grid, trie

def test_finds_expected_words():
    grid, trie = build_test_setup()
    result = find_words(grid, trie)
    assert result == {"CAT", "CAR", "CARD", "CARE", "CARES", "ORE"}

def test_rejects_unreachable_dictionary_word():
    grid, trie = build_test_setup()
    result = find_words(grid, trie)
    assert "TORN" not in result       # in the dictionary, but T and O are not adjacent here
    assert "CARTON" not in result

def test_no_cell_reused_within_one_word():
    # A grid where a naive (non-visited-tracking) search could "find" a word
    # only by revisiting a cell -- confirms visited-set enforcement works.
    grid = [["A", "B"], ["C", "D"]]
    words = ["ABAB"]      # would require reusing A and B
    trie = build_trie(words)
    result = find_words(grid, trie, min_length=3)
    assert "ABAB" not in result

def test_minimum_length_enforced():
    grid, trie = build_test_setup()
    result = find_words(grid, trie, min_length=3)
    assert all(len(w) >= 3 for w in result)

def test_empty_dictionary_finds_nothing():
    grid, _ = build_test_setup()
    empty_trie = Trie()
    assert find_words(grid, empty_trie) == set()

def test_trie_and_naive_agree_on_small_grid():
    grid, trie = build_test_setup()
    words = ["CAT", "CAR", "CARD", "CARE", "CARES", "CARTON", "ORE", "TAR", "TARE", "RAT", "ARC", "TORN"]
    word_set = set(words)
    assert find_words(grid, trie) == find_words_naive(grid, word_set, max_length=9)
```

`test_trie_and_naive_agree_on_small_grid` is the most important correctness check of all: the trie-pruned version and the naive full-exploration version must return the *identical* set of words on the same input, since pruning is only a performance optimization — any divergence between the two means the pruning logic is incorrectly rejecting (or, less likely, incorrectly accepting) some path, not that the two algorithms are legitimately allowed to disagree.

## Common Misconceptions & Pitfalls

- **Pruning on `is_word` instead of `has_prefix`.** Checking `dictionary_trie.is_word(path_word)` and stopping the search when it's `False` is wrong — `"CA"` is not a complete word in the example dictionary, but it is a valid prefix of `"CAT"` and `"CAR"`, and cutting the search off there would silently miss every longer word sharing that prefix. Pruning must be driven by `has_prefix`, and `is_word` is checked separately, only to decide whether to *record* the current path, never to decide whether to *continue* it.
- **Forgetting the `visited` set entirely, or sharing one `visited` set across separate starting cells.** Without a per-path `visited` set, a single word's path could loop back through a cell already used earlier in that same path — e.g., spelling `"ORO"` by reusing the `O` cell twice with no letter actually repeated at another cell. Using one shared `visited` set across the outer loop over starting cells (rather than a fresh one, or careful backtracking, per starting cell) instead causes cells used by an *earlier* starting cell's search to remain incorrectly marked unavailable for a *later* starting cell's search.
- **Forgetting to backtrack (`visited.remove(...)`) after the recursive call returns.** Omitting the backtrack step means a cell, once visited by any path from any direction, stays marked visited for the rest of that DFS call tree — collapsing the search to a single path per starting cell instead of exploring every path a starting cell can reach.
- **Treating "not a prefix" and "not a word" as the same signal.** `has_prefix("CARTO")` can be `True` (some word might start that way) even though `is_word("CARTO")` is `False` — conflating the two leads either to stopping too early (as in the first pitfall) or to incorrectly recording non-words as found, depending on which check gets swapped for which.
- **Benchmarking the trie version against a naive version that also prunes, accidentally.** If the "naive" baseline's `path_word in word_set` check is, for some reason, moved inside the neighbor loop and used to gate recursion (rather than only to record found words at the end), it stops being a fair naive baseline — a hash-set membership check used *as a stopping condition* mid-path is not equivalent to a trie's prefix check, since `path_word` mid-search often isn't itself a complete word yet and would incorrectly halt promising paths; the two baselines must differ only in *whether* they can check partial-prefix membership cheaply, not in when each check is applied.
- **Assuming a larger dictionary always makes the trie's advantage bigger in a fixed way.** The pruning advantage scales with how many *grid-plausible* prefixes are dead ends relative to the total dictionary size and grid branching — a dictionary of words sharing very few common prefixes with the grid's actual letters may show a smaller gap than the numbers in Step 4, so the specific magnitude of the speedup is workload-dependent, even though the qualitative direction (trie prunes, naive explores fully) always holds.

## Summary

This lab loaded a small, concrete dictionary into a trie (citing **Tries: Prefix Trees for String Keys** for `insert` and the prefix-walk pattern, extended here into `has_prefix` and `is_word`) and searched a 3x3 letter grid by depth-first search, pruning any path the instant it stopped being a prefix of any dictionary word — finding `{"CAT", "CAR", "CARD", "CARE", "CARES", "ORE"}` and correctly rejecting `"CARTON"` and `"TORN"` despite both being valid dictionary words, because the grid's actual adjacency does not support spelling them. A naive hash-set-of-words baseline was built and shown to be structurally unable to prune mid-path the way the trie does, and both were correctness-checked against each other and timed across growing grid sizes, showing the naive version's cost widening sharply relative to the trie-pruned version as the grid (and the space of candidate paths) grows.

## Documentation Links

- [Princeton algs4 Assignments Index](https://coursera.cs.princeton.edu/algs4/assignments/) — doc
- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
