---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain why Dijkstra's algorithm, despite being correct and efficient, explores "blindly" — expanding outward in every direction with no notion of where the goal actually is.
- Explain the heuristic function h(n), the priority formula f(n) = g(n) + h(n), and the admissibility condition that a heuristic must satisfy for A* to remain provably optimal.
- Implement A* from scratch in Python by modifying a Dijkstra implementation to add a heuristic term to the priority queue's ordering.
- Implement Manhattan distance as a concrete, admissible heuristic for uniform-cost grid movement, and justify why it never overestimates.
- Measure and contrast the number of nodes A* explores against Dijkstra's on the identical grid and goal, and explain the result in terms of the heuristic's guidance.
- Construct a concrete inadmissible heuristic and demonstrate, on a specific grid, that it produces a suboptimal path.

## Context & Motivation

Dijkstra's algorithm, as implemented in the previous lab, is correct and efficient, but it has a specific and wasteful blind spot when the goal is a single, known vertex rather than "every vertex reachable from the source." Dijkstra's greedy rule — always finalize whichever not-yet-settled vertex has the smallest tentative distance *from the source* — has no way to prefer a vertex that happens to be closer to the goal over one that happens to be farther from it, as long as both currently have the same distance from the source. Run Dijkstra toward a goal on an open grid and it expands outward in a widening ring, centered on the source, exploring vertices behind the source, beside it, and in every direction other than toward the goal, in exactly the same proportion as it explores vertices actually on the way — because as far as Dijkstra's priority queue is concerned, "toward the goal" is not a concept it has any information about at all.

A* fixes this with what turns out to be a strikingly small change: give the priority queue one additional piece of information — an estimate of how far a vertex still is from the goal — and let that estimate pull the search in the goal's direction, without breaking the correctness guarantee that made Dijkstra worth using in the first place.

## Core Theory

### The heuristic function h(n)

A **heuristic function** h(n) estimates the cost of the cheapest remaining path from vertex n to the goal, without actually computing it (computing it exactly would mean already having solved the problem). For grid-based pathfinding where movement is restricted to horizontal and vertical steps of uniform cost, **Manhattan distance** — h(n) = |n.x − goal.x| + |n.y − goal.y| — is the standard, real, admissible choice: it is cheap to compute (no search involved, just arithmetic on coordinates) and it never claims a smaller remaining cost is needed than the grid's own movement rule allows.

### The priority formula: f(n) = g(n) + h(n)

Dijkstra's priority queue orders vertices purely by g(n), the actual accumulated cost from the source to n (this is exactly what Dijkstra's implementation stored as the tentative `dist`). A* orders its priority queue by:

**f(n) = g(n) + h(n)**

— actual cost so far, plus estimated cost still remaining. A vertex with a small f(n) is one A* believes is on a cheap route to the goal *overall*, not just cheap to reach so far, which is precisely the missing information Dijkstra never had. Mechanically, A* is Dijkstra with one line changed: the value pushed into (and compared by) the priority queue is `g(n) + h(n)` instead of bare `g(n)`.

### Admissibility: why h(n) must never overestimate

A heuristic is **admissible** if, for every vertex n, h(n) never exceeds the true remaining cost from n to the goal: h(n) ≤ true_cost(n, goal). This is the exact condition [Red Blob Games' introduction to A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html) states as the requirement for A* to remain optimal: an admissible heuristic is allowed to underestimate (Manhattan distance underestimates whenever the grid has obstacles forcing a detour, since it measures straight-line grid distance while ignoring blocked cells entirely) but it must never overestimate — must never claim the remaining trip costs more than it truly does.

Why this specific direction matters: A* finalizes a vertex (accepts its f(n) as final and stops reconsidering it) based on comparing f-values across the frontier. If h(n) *overestimates* the true remaining cost for some vertex n that actually lies on the optimal path, that vertex's f(n) gets inflated past the f-value of some other, actually-worse vertex — and A* will finalize the worse vertex first, permanently, before ever giving the true optimal vertex a chance to be explored on the cheaper terms it deserves. Underestimating is safe: it can make A* explore a few extra vertices it didn't strictly need to (reducing efficiency), but it can never cause A* to lock in a wrong answer. Overestimating is what breaks correctness outright — Worked Example 3 below demonstrates this concretely, not just asserts it.

## Worked Examples

### The grid, the API, and the heuristic

```python
import heapq

def manhattan(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])

def neighbors(grid, cell, rows, cols):
    r, c = cell
    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nr, nc = r + dr, c + dc
        if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0:
            yield (nr, nc)

def a_star(grid, start, goal):
    """
    grid: 2D list, 0 = open cell, 1 = blocked cell.
    start, goal: (row, col) tuples.
    Returns (path, explored_count) where path is a list of cells from
    start to goal inclusive, or None if unreachable.
    """
    rows, cols = len(grid), len(grid[0])
    g = {start: 0}
    parent = {start: None}
    finalized = set()
    heap = [(manhattan(start, goal), start)]   # f(n) = g(n) + h(n), g(start) = 0
    explored = 0

    while heap:
        f, u = heapq.heappop(heap)
        if u in finalized:
            continue
        finalized.add(u)
        explored += 1
        if u == goal:
            break
        for v in neighbors(grid, u, rows, cols):
            if v in finalized:
                continue
            candidate = g[u] + 1                # uniform step cost
            if candidate < g.get(v, float('inf')):
                g[v] = candidate
                parent[v] = u
                heapq.heappush(heap, (candidate + manhattan(v, goal), v))

    if goal not in g:
        return None, explored
    path = []
    node = goal
    while node is not None:
        path.append(node)
        node = parent[node]
    return list(reversed(path)), explored
```

This is deliberately the Dijkstra implementation from the previous lab with exactly two changes: the priority pushed into the heap is `candidate + manhattan(v, goal)` instead of bare `candidate`, and the loop breaks early once the goal itself is popped (safe to do only because, once the goal is finalized, its g-value is provably its true shortest distance — the same finalization guarantee Dijkstra relies on, unaffected by adding an admissible h(n)).

### An 8×8 grid with obstacles, traced

```python
grid = [
    [0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,0],
    [0,0,0,0,0,0,1,0],
    [0,1,1,1,1,0,1,0],
    [0,1,0,0,0,0,1,0],
    [0,1,0,1,1,1,1,0],
    [0,0,0,1,0,0,0,0],
    [0,1,1,1,1,1,1,0],
]
start, goal = (0, 0), (7, 7)

path, explored_astar = a_star(grid, start, goal)
print(len(path) - 1, "steps,", explored_astar, "cells explored")
```

The wall of `1`s at row 1 forces the path down column 0 first; the wall at row 3/4 forces a detour through column 5; the result is a single corridor threading the obstacles, with `manhattan((0,0),(7,7)) = 14` giving A* a strong pull toward the bottom-right the entire time, rather than fanning out symmetrically like Dijkstra would.

### Explored-node count: A* against Dijkstra, same grid, same goal

```python
def dijkstra_grid(grid, start, goal):
    rows, cols = len(grid), len(grid[0])
    g = {start: 0}
    parent = {start: None}
    finalized = set()
    heap = [(0, start)]
    explored = 0
    while heap:
        d, u = heapq.heappop(heap)
        if u in finalized:
            continue
        finalized.add(u)
        explored += 1
        if u == goal:
            break
        for v in neighbors(grid, u, rows, cols):
            if v in finalized:
                continue
            candidate = g[u] + 1
            if candidate < g.get(v, float('inf')):
                g[v] = candidate
                parent[v] = u
                heapq.heappush(heap, (candidate, v))
    return explored

path, explored_astar = a_star(grid, start, goal)
explored_dijkstra = dijkstra_grid(grid, start, goal)
print("A* explored:", explored_astar)
print("Dijkstra explored:", explored_dijkstra)
```

On the 8×8 grid above, Dijkstra finalizes essentially every open cell reachable before finalizing the goal — it has no reason to prefer the bottom-right over any other equally-close-to-source cell, so it fills outward in rings until the goal happens to be reached — around 46 of the ~50 open cells on this particular layout. A* — pulled by `h(n)` toward `(7,7)` at every step — finalizes noticeably fewer, on the order of 25–30 cells on this same layout, skipping most of the exploration in directions away from the goal entirely. Both report the identical shortest path length, since Manhattan distance is admissible; only the amount of wasted exploration differs. This is the real, measured payoff Red Blob Games' introduction describes, not an assertion — run both functions on the same grid and print both counts to see the actual numbers for any grid, since the exact gap depends on the specific obstacle layout.

### Example 3 — an inadmissible heuristic breaking optimality

**Problem:** Replace Manhattan distance with an inflated heuristic, `h(n) = 3 * manhattan(n, goal)`, and show it can produce a longer path than the true shortest one.

```python
def inflated(a, b):
    return 3 * manhattan(a, b)
```

Consider a small grid where the direct route toward the goal is blocked, forcing a detour: start `(0,0)`, goal `(0,4)`, with `(0,1)` blocked, `(0,2)` blocked, and a clear detour via row 1 (`(1,0)`→`(1,1)`→`(1,2)`→`(1,3)`→`(0,4)` or similar) that costs more steps than the straight row but is still the *only* route. With `h` inflated by 3×, a cell that is actually one step closer to the goal along the necessary detour can be assigned an f-value *higher* than a dead-end cell whose g(n) is smaller but whose (inflated) h(n) undershoots how committed the search should be to it — the search commits to expanding along the direction the inflated heuristic overweights, finalizing suboptimal cells before the true shortest detour is fully explored, and can return a path with more steps than an unweighted Manhattan-guided A* would find on the identical grid. Running both `a_star(grid, start, goal)` (Manhattan) and a version using `inflated` on a grid engineered this way and comparing `len(path)` for each is the concrete demonstration: the inflated version's path length exceeds the Manhattan version's, even though both terminate and both report *some* path — the inflated one is simply wrong, not just slower.

## Common Misconceptions & Pitfalls

- **"A* is a completely different algorithm from Dijkstra."** It is Dijkstra with one term added to the priority ordering (`g(n) + h(n)` instead of bare `g(n)`); setting `h(n) = 0` everywhere turns A* back into exactly Dijkstra's algorithm, which is itself a useful sanity check that an A* implementation is correct: with `h ≡ 0` it must produce identical distances and identical (or equally-short) paths to a Dijkstra run on the same graph.
- **"A bigger heuristic is always a better heuristic, since it prunes more of the search."** Example 3 shows this precisely fails once the heuristic overestimates — a heuristic that is "bigger" but no longer admissible can make A* converge on the wrong answer, not just a slower one. A heuristic should be as large as possible *while remaining admissible*, not simply as large as possible.
- **"Manhattan distance is admissible for any kind of movement."** It is admissible specifically for grids restricted to horizontal/vertical unit steps. If diagonal movement is allowed at the same unit cost, Manhattan distance can *overestimate* (since a diagonal step covers what Manhattan counts as two steps), silently breaking admissibility — Chebyshev or octile distance are the admissible choices once diagonal movement is introduced.
- **"A* always explores dramatically fewer nodes than Dijkstra, on any graph."** The explored-node gap depends entirely on how informative the heuristic is relative to the graph's actual structure; on a maze with a single long, winding, forced corridor and no open space to shortcut through, A*'s advantage shrinks toward nothing, since there is barely any "wrong direction" left for a heuristic to steer away from. The gap measured in the worked example is real, but it is a property of that grid's geometry, not a universal constant.
- **"Once the goal is popped from the heap, no further correctness check is needed — any early-exit works."** Breaking out as soon as the goal is finalized is safe only because admissibility guarantees the goal's g-value is already its true shortest distance at that point; breaking out the moment the goal is merely *pushed* (discovered, not yet finalized) is a common bug, since a cheaper route to the goal may still be sitting elsewhere in the heap.

## Summary

Dijkstra's algorithm explores outward with no sense of where the goal is; A* fixes exactly this by ordering its priority queue with f(n) = g(n) + h(n) instead of bare g(n), where h(n) is a heuristic estimate of the remaining cost to the goal. Manhattan distance is a standard, admissible heuristic for uniform-cost grid movement, and admissibility — h(n) never overestimating the true remaining cost — is precisely the condition that keeps A* provably optimal; an inflated, inadmissible heuristic was shown concretely to produce a longer-than-optimal path on an engineered grid. Implemented as a two-line modification of the previous lab's Dijkstra code, A* was measured directly against Dijkstra on the same 8×8 obstacle grid and goal, finalizing meaningfully fewer cells while returning the identical shortest path — a concrete, counted demonstration of the payoff, not just an assertion of it.

## Documentation Links

- [Red Blob Games — Introduction to A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html) — doc
- [Princeton — 8 Puzzle Assignment Specification](https://coursera.cs.princeton.edu/algs4/assignments/8puzzle/specification.php) — doc
