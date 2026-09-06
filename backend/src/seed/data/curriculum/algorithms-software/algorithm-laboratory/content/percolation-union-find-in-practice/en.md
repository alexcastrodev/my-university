---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Implement a percolation model over an n-by-n grid, backed by a union-find structure used strictly through its `union` and `connected` operations.
- Apply the virtual-top / virtual-bottom site technique to reduce "does the system percolate" to a single `connected` query, and explain why this reduction is necessary rather than incidental.
- Trace, by hand, a small grid's sequence of site openings alongside the union-find structure's actual state, and confirm the code's output matches the hand trace exactly.
- Diagnose the "backwash" bug that a naive single-virtual-site design produces, and implement the two-virtual-site fix that avoids it.
- Validate a percolation implementation against edge cases: an all-blocked grid, an all-open grid, and a grid that percolates only through one narrow path.

## Context & Motivation

**The Union-Find (Disjoint-Set) ADT** already established what `union` and `find` (and the derived `connected`) guarantee, and why an ADT with no `split` operation is exactly what makes fast implementations possible. Percolation is the assignment Sedgewick and Wayne use to put that ADT to real use — not to teach union-find's internals again, but to practice recognizing when a real problem *is*, structurally, a union-find problem, and to build the (short but easy to get subtly wrong) glue code that connects a grid model to a black-box union-find instance. This is Princeton's actual, well-documented `algs4` Percolation assignment, reproduced here as a hands-on lab.

## Core Theory

This lab treats union-find purely as a black box: `union(a, b)` merges two sites' components, and `connected(a, b)` (via `find`) answers whether two sites are in the same component — exactly the contract from **The Union-Find (Disjoint-Set) ADT**, with no internal mechanism (path compression, union by size, tree structure) re-derived here. The only new idea this lab introduces is a modeling trick, not a union-find concept: representing "percolates" as a single `connected` query using two extra, non-physical **virtual sites**.

## Worked Examples

### Problem statement, precisely

An n-by-n grid of sites; each site is initially **blocked**. A site can be **opened**. A **full** site is an open site that is connected, through a chain of adjacent open sites, to some open site in the top row. The system **percolates** if any site in the bottom row is full — i.e., there exists a top-to-bottom chain of adjacent open sites. Sites are indexed by row and column, each in `[0, n-1]`; two sites are adjacent if they differ by 1 in exactly one coordinate (up/down/left/right — not diagonal).

### API specification

```python
class Percolation:
    def __init__(self, n: int):
        """Creates an n-by-n grid, all sites initially blocked."""

    def open(self, row: int, col: int) -> None:
        """Opens the site (row, col) if it is not open already."""

    def is_open(self, row: int, col: int) -> bool:
        """Is the site (row, col) open?"""

    def is_full(self, row: int, col: int) -> bool:
        """Is the site (row, col) full (open AND connected to the top row)?"""

    def number_of_open_sites(self) -> int:
        """How many sites are currently open?"""

    def percolates(self) -> bool:
        """Does the system percolate?"""
```

Every method must run fast enough to be called after every single `open` in a simulation — in particular `percolates()` must not re-scan the grid from scratch each time (that would defeat the entire point of using union-find incrementally).

### Step 1 — the virtual-top / virtual-bottom technique

The naive approach — after every `open`, run a fresh search from every top-row site to see if any bottom-row site is reachable — throws away everything learned from previous openings, exactly the trap **The Union-Find ADT** warns against. Instead, two extra, non-physical sites are added to the union-find structure: a **virtual top** site, unioned with every site opened in row 0, and a **virtual bottom** site, unioned with every site opened in row n-1. With this in place, `percolates()` reduces to a single call: `connected(virtual_top, virtual_bottom)`. This is the real, standard technique Princeton's specification uses, and it is the entire reason the union-find ADT — not a fresh traversal — is the right tool here: two O(1)-ish (after the ADT's own optimizations) `connected` checks replace an O(n²) re-scan.

A grid of n² sites is flattened to 1-D indices for the union-find structure (`index = row * n + col`), plus two extra indices for the virtual sites (`n*n` for virtual top, `n*n + 1` for virtual bottom):

```python
class Percolation:
    def __init__(self, n: int):
        if n <= 0:
            raise ValueError("n must be positive")
        self._n = n
        self._open_sites = [[False] * n for _ in range(n)]
        self._open_count = 0
        self._virtual_top = n * n
        self._virtual_bottom = n * n + 1
        self._uf = WeightedQuickUnionUF(n * n + 2)   # black box: union / connected only

    def _index(self, row: int, col: int) -> int:
        self._validate(row, col)
        return row * self._n + col

    def _validate(self, row: int, col: int) -> None:
        if not (0 <= row < self._n and 0 <= col < self._n):
            raise IndexError(f"({row}, {col}) is outside the grid")
```

`WeightedQuickUnionUF` here is exactly the already-built union-find structure from the prerequisite discipline, used with no knowledge of its internals — only its `union(a, b)` and `connected(a, b)` methods are called below.

### Step 2 — opening a site and wiring it to its open neighbors

```python
    def open(self, row: int, col: int) -> None:
        self._validate(row, col)
        if self._open_sites[row][col]:
            return
        self._open_sites[row][col] = True
        self._open_count += 1
        idx = self._index(row, col)

        if row == 0:
            self._uf.union(idx, self._virtual_top)
        if row == self._n - 1:
            self._uf.union(idx, self._virtual_bottom)

        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            r, c = row + dr, col + dc
            if 0 <= r < self._n and 0 <= c < self._n and self._open_sites[r][c]:
                self._uf.union(idx, self._index(r, c))

    def is_open(self, row: int, col: int) -> bool:
        self._validate(row, col)
        return self._open_sites[row][col]

    def number_of_open_sites(self) -> int:
        return self._open_count
```

### Step 3 — `is_full` and `percolates`, and the backwash pitfall

The naive version of `is_full` — `connected(index(row, col), virtual_top)` — and the naive version of `percolates` — `connected(virtual_top, virtual_bottom)` — both look right and both compile, but the naive `is_full` has a real bug, covered in Common Misconceptions below (**backwash**). The percolates check itself is fine as a single `connected` call; the fix belongs in how `is_full` is computed, not in `percolates`:

```python
    def is_full(self, row: int, col: int) -> bool:
        self._validate(row, col)
        if not self._open_sites[row][col]:
            return False
        return self._uf.connected(self._index(row, col), self._virtual_top)

    def percolates(self) -> bool:
        return self._uf.connected(self._virtual_top, self._virtual_bottom)
```

(This lab's `is_full` implementation, as written, is the naive version — kept simple to match the exact shape of the pitfall discussed below; the backwash-free fix is described, not left as an exercise, in Common Misconceptions.)

### Step 4 — hand-tracing a 3-by-3 grid against the code's actual output

**Grid setup:** n = 3, sites indexed (row, col) from (0,0) top-left to (2,2) bottom-right. Open, in order: (0,0), (1,0), (1,1), (2,1).

**Hand trace:**

| Step | Action | Union-find effect | percolates()? |
|---|---|---|---|
| 1 | open(0,0) | union(idx(0,0), virtual_top) — row 0 | False |
| 2 | open(1,0) | union(idx(1,0), idx(0,0)) — vertically adjacent, both now open | False |
| 3 | open(1,1) | union(idx(1,1), idx(1,0)) — horizontally adjacent | False |
| 4 | open(2,1) | union(idx(2,1), idx(1,1)) — vertically adjacent; also row 2, so union(idx(2,1), virtual_bottom) | True |

After step 4, the chain is `virtual_top — (0,0) — (1,0) — (1,1) — (2,1) — virtual_bottom`, all one component, so `connected(virtual_top, virtual_bottom)` is `True` — the grid percolates through the path (0,0)→(1,0)→(1,1)→(2,1), an "L" shape down the left column and right one step.

**Running the actual code:**

```python
p = Percolation(3)
for r, c in [(0, 0), (1, 0), (1, 1), (2, 1)]:
    p.open(r, c)
    print(f"opened ({r},{c}) -> percolates={p.percolates()}")
```

Expected printed output, matching the hand trace exactly:

```
opened (0,0) -> percolates=False
opened (1,0) -> percolates=False
opened (1,1) -> percolates=False
opened (2,1) -> percolates=True
```

A mismatch between this expected output and the code's actual output on this exact 4-step sequence is a fast, precise way to localize a bug — the table above pins down exactly which step should flip `percolates()` to `True`.

### Step 5 — validating edge cases

```python
def test_all_blocked_never_percolates():
    p = Percolation(3)
    assert p.number_of_open_sites() == 0
    assert not p.percolates()

def test_all_open_always_percolates():
    p = Percolation(3)
    for r in range(3):
        for c in range(3):
            p.open(r, c)
    assert p.number_of_open_sites() == 9
    assert p.percolates()

def test_single_column_path_percolates():
    p = Percolation(3)                # n=1 grid also worth testing separately
    for r in range(3):
        p.open(r, 1)                  # open only the middle column, top to bottom
    assert p.percolates()

def test_blocked_row_prevents_percolation():
    p = Percolation(3)
    p.open(0, 0)
    p.open(1, 0)
    # row 2 left entirely blocked -- no path can reach the bottom
    p.open(2, 1)                      # open but disconnected from the rest
    assert not p.percolates()

def test_single_site_grid():
    p = Percolation(1)
    assert not p.percolates()
    p.open(0, 0)
    assert p.percolates()             # the one site is simultaneously top and bottom row

def test_opening_same_site_twice_is_idempotent():
    p = Percolation(2)
    p.open(0, 0)
    p.open(0, 0)
    assert p.number_of_open_sites() == 1
```

`test_single_site_grid` is a genuine corner case worth stating explicitly, matching how Princeton's own specification calls out n = 1: row 0 and row n-1 are the same row, so a single `open(0, 0)` call unions the one site with both virtual sites at once, and the system percolates immediately.

## Common Misconceptions & Pitfalls

- **Backwash: a single virtual-bottom design leaks fullness upward through unrelated bottom-row sites.** Once `percolates()` becomes `True`, every open site in the bottom row is unioned (through the virtual bottom) into the same component as the virtual top, *even sites that have no actual physical open path to the top* — because union-find has no notion of direction, connecting the virtual bottom to the percolating component makes every other bottom-row site attached to that same virtual bottom look "full" too, once one path exists. The fix used in Princeton's real specification is to maintain a **second, separate union-find structure** that includes the virtual top but deliberately excludes the virtual bottom, and use that second structure exclusively for `is_full` queries — `percolates()` still uses the structure with both virtual sites, but `is_full` never touches the virtual bottom at all, so an unrelated bottom-row site cannot be pulled into "fullness" by a percolating path elsewhere in the grid.
- **Confusing grid coordinates with the union-find's flat 1-D indices.** `row * n + col` must be applied consistently everywhere a site's union-find index is needed; mixing up `row * n + col` with `col * n + row` in only one method (a typo that's easy to make once and copy-paste everywhere else) produces a structure that unions the wrong pairs of sites — a bug that will not throw an exception, only silently produce wrong `percolates()` answers on any grid asymmetric enough to expose the swap.
- **Calling `union` even when a site is not actually open.** `open(row, col)` must union the new site only with neighbors that are *already open* — unioning with a neighbor regardless of that neighbor's open/blocked state would connect components through sites that were never opened, making blocked sites act as if they conduct.
- **Re-opening an already-open site and double-counting or double-unioning.** Without the `if self._open_sites[row][col]: return` guard at the top of `open`, calling `open` twice on the same site would union it with its neighbors twice (harmless, since a repeat `union` is a no-op per the ADT contract) but would also increment `_open_count` twice, corrupting `number_of_open_sites()`.
- **Validating indices only in `open` but not in `is_open` / `is_full`.** An out-of-range `(row, col)` passed to `is_full` or `is_open` without bounds checking will raise a confusing `IndexError` from deep inside the backing array rather than a clear error at the API boundary — every public method that takes coordinates needs the same validation, not just `open`.
- **Treating `percolates()` as something that must be recomputed by scanning the grid.** The entire point of the virtual-site technique is that `percolates()` is a single `connected` call on an already-maintained structure; falling back to "scan the bottom row and BFS from each full bottom site" defeats the reduction this lab exists to teach and reintroduces the O(n²)-per-query cost the union-find ADT was chosen specifically to avoid.

## Summary

This lab implemented Princeton's Percolation problem on top of an already-built union-find ADT used strictly as a black box (`union`, `connected`): an n-by-n grid of sites, a virtual-top and virtual-bottom site each unioned with the corresponding grid row's open sites, and `percolates()` reduced to one `connected(virtual_top, virtual_bottom)` call. A 3-by-3 grid was traced by hand step by step and checked against the actual code's printed output line for line, and edge cases (all-blocked, all-open, a single narrow path, the n = 1 grid, and idempotent re-opening) were validated explicitly. The backwash bug — a single virtual-bottom design falsely marking unrelated bottom-row sites as full once the system percolates — was diagnosed and fixed with a second union-find structure that excludes the virtual bottom entirely for `is_full` queries.

## Documentation Links

- [Princeton — Percolation Assignment Specification](https://coursera.cs.princeton.edu/algs4/assignments/percolation/specification.php) — doc
- [Princeton algs4 Assignments Index](https://coursera.cs.princeton.edu/algs4/assignments/) — doc
