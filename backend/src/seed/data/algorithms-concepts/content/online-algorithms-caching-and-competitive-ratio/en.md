---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Learn to evaluate algorithms that must commit to a decision *before* seeing the rest of the input — cache eviction, list reordering, wait-or-give-up choices — using the **competitive ratio**, which measures an online algorithm against a hypothetical algorithm that knows the entire future. You'll work through the three problems Cormen et al. use to build the technique: the elevator-versus-stairs decision (where the definition comes from), MOVE-TO-FRONT list maintenance (provably 4-competitive), and online caching (where LRU and FIFO are Θ(k), LIFO and LFU are unboundedly bad, *every* deterministic policy is stuck at Ω(k), and randomization gets you down to O(lg k)).

## Use Cases

- Choosing an eviction policy for a bounded cache and being able to defend it with a worst-case argument instead of folklore — knowing *why* LRU and FIFO are in a different class from LIFO and LFU, not just that they "feel better."
- Reordering the linked list in a chaining hash table's bucket (the motivating application in the book, tying back to the `hash-tables-chaining-and-open-addressing` concept) so that hot elements drift toward the front, with no advance knowledge of the access distribution and a proven bound on how bad it can get.
- Recognizing "wait for the fast path, but fall back after a bounded time" as a deliberate hedging strategy with a provable guarantee, rather than an arbitrary timeout — the elevator problem is exactly this shape.
- Knowing when to *stop* tuning a deterministic heuristic: once you know every deterministic caching policy has competitive ratio Ω(k), a proposed "smarter" deterministic eviction rule can always be defeated by an adversary that knows your code, and randomization is the only escape.

## Deep Dive

### What "online" means, and the definition of the competitive ratio

An **online algorithm** receives its input piece by piece and must act on each piece without knowing what comes next. The book's first example is deliberately mundane: you enter a building and need to reach an office `k` floors up. You climb stairs at one floor per minute, so the stairs always cost exactly `k` minutes. The elevator ascends all `k` floors in just one minute — but you don't know how long it will take to arrive. You do know it arrives within at most `B − 1` minutes (with `B` considerably larger than `k`), and that the number of minutes it takes is an integer. So waiting for the elevator and riding it up costs anywhere from 1 minute (it's already here) to `(B − 1) + 1 = B` minutes in the worst case.

Compare yourself against a **seer** — an algorithm that knows the future. Letting `m` be the number of minutes until the elevator arrives, the seer waits if and only if waiting is cheaper, giving cost:

```
t(m) = m + 1   if m ≤ k − 1
       k       if m ≥ k
```

Now the definition everything else hangs on. Let `U` be the set (universe) of all possible inputs and consider some input `I ∈ U`. For a **minimization** problem, if an online algorithm `A` produces a solution with value `A(I)` on input `I`, and an algorithm `F` **that knows the future** produces value `F(I)` on the same input, then the competitive ratio of `A` is:

> **competitive ratio of `A` = max { A(I) / F(I) : I ∈ U }**

If an online algorithm has competitive ratio `c`, we say it is **`c`-competitive**. The competitive ratio is always at least 1, and we want it as close to 1 as possible.

Note what this is *not*: it isn't an average over typical inputs, and it isn't an absolute cost bound. It's the single worst ratio, over every input in the universe, between what you pay and what a seer would have paid on that same input.

Here the only input is `m`, the elevator's arrival time. Three strategies, in Java:

```java
// All costs in minutes. k = floors to climb. The elevator takes m minutes to arrive
// (an integer with 0 <= m <= B - 1) and then 1 more minute to carry you up all k floors.

static int seer(int m, int k) {              // F: knows m in advance
    return (m <= k - 1) ? m + 1 : k;         // waits iff waiting actually beats the stairs
}

static int alwaysStairs(int m, int k)   { return k; }        // ignores the elevator entirely
static int alwaysElevator(int m, int k) { return m + 1; }    // waits however long it takes

// Competitive ratio = the WORST ratio over every possible input m.
static double competitiveRatio(IntBinaryOperator online, int k, int B) {
    double worst = 0;
    for (int m = 0; m <= B - 1; m++) {
        worst = Math.max(worst, (double) online.applyAsInt(m, k) / seer(m, k));
    }
    return worst;
}
```

Enumerating `max { k / t(m) : 0 ≤ m ≤ B − 1 }` for "always take the stairs" gives the ratios `k/1, k/2, k/3, …, k/(k−1), k/k, k/k, …`, whose maximum is **`k`** — achieved when the elevator arrives immediately: you spend `k` minutes on the stairs where the optimal solution took just 1.

Enumerating `max { (m + 1) / t(m) : 0 ≤ m ≤ B − 1 }` for "always take the elevator" gives `1/1, 2/2, …, k/k, (k+1)/k, (k+2)/k, …, B/k`, whose maximum is **`B/k`** — achieved when the elevator takes the full `B − 1` minutes, against the seer's choice of the stairs at cost `k`.

So with `k = 10` and `B = 300`, "always take the stairs" (ratio 10) beats "always take the elevator" (ratio 30). And the book is careful about what that does *not* mean: taking the stairs is not always better, nor even necessarily more often better. It just guards better against the worst-case future.

### Hedging: a ratio that doesn't depend on the input parameters

Both of those are extreme strategies. You can instead **hedge your bets**: wait for the elevator for a while, and if it hasn't come, take the stairs. Let "a while" be `k` minutes:

```java
static int hedge(int m, int k) {             // wait up to k minutes, then give up and climb
    return (m <= k) ? m + 1 : 2 * k;         // 2k = k minutes waiting + k minutes climbing
}

// With k = 10, B = 300:
//   alwaysStairs   -> 10   ( = k,   worst at m = 0:     10 minutes vs. the seer's 1  )
//   alwaysElevator -> 30   ( = B/k, worst at m = B - 1: 300 minutes vs. the seer's 10 )
//   hedge          ->  2   ( independent of BOTH k and B )
```

Enumerating `max { h(m) / t(m) }` gives `1/1, 2/2, …, k/k, (k+1)/k, 2k/k, 2k/k, …, 2k/k`, whose maximum is **2**. The competitive ratio is now independent of both `k` and `B` — a strictly better guarantee than either extreme, and one that doesn't degrade as the problem parameters grow.

This illustrates the philosophy running through the whole chapter: build an algorithm that guards against *any* possible worst case. Initially waiting for the elevator guards against the case where it arrives quickly; eventually switching to the stairs guards against the case where it takes a long time.

### Maintaining a search list: MOVE-TO-FRONT

The second problem is keeping the elements of a linked list in a good order for searching. This arises in practice for hash tables that resolve collisions by chaining, since each slot holds a linked list — reordering that per-slot list can measurably boost search performance.

The setup: a doubly linked list `L` of `n` elements, where `r_L(x)` denotes the position of element `x` (with `1 ≤ r_L(x) ≤ n`), so a search for `x` takes `Θ(r_L(x))` time. To ease analysis the book drops asymptotic notation: **searching for the element at position `i` costs exactly `i`**, and the only way to reorder is by **swapping two adjacent elements, at a cost of 1 per swap**. So searching for the sixth element and then moving it forward two places costs `6 + 2 = 8`. The goal is to minimize the total search cost plus the total number of swaps.

If you knew the distribution of search requests in advance, you'd just arrange the list once with the frequently-searched elements near the front. If you know nothing, then no matter how you arrange it, every search could be for whatever element sits at the tail — total time `Θ(nm)` for `m` searches. But some sequences are genuinely "easier" than others, so rather than measuring against the worst possible sequence, measure against what an optimal *offline* algorithm would do knowing the sequence in advance. Hard sequences are hard for the seer too; easy sequences let you do well.

**MOVE-TO-FRONT(L, x)** searches for `x`, then swaps it forward one position at a time until it reaches the front. Calling `MOVE-TO-FRONT(L, 8)` on `L = ⟨5, 3, 12, 4, 8, 9, 22⟩` yields `⟨8, 5, 3, 12, 4, 9, 22⟩`. Its cost is `2·r_L(x) − 1`: `r_L(x)` to find `x`, plus 1 for each of the `r_L(x) − 1` swaps that walk it to the front.

```java
// Cost model from the book: searching the element at 1-based position r costs r,
// and each swap of two ADJACENT elements costs 1. Total: 2*r - 1.
static int moveToFront(List<Integer> list, int x) {
    int r = list.indexOf(x) + 1;              // 1-based position = the search cost
    for (int i = r - 1; i > 0; i--) {         // exactly r - 1 adjacent swaps, cost 1 each
        Collections.swap(list, i, i - 1);
    }
    return 2 * r - 1;
}
```

Here is the book's own worked example (Figure 27.1) traced move by move — starting from `⟨1, 2, 3, 4, 5⟩` with searches for 5, 3, 4, and 4. Every step below is one adjacent swap costing exactly 1:

```viz
type: moves
mark 4 | Search for 5: it sits at position 5, so the search alone costs 5.
swap 3 4 | Walk "5" forward one slot (swap cost 1).
swap 2 3 | Still walking "5" forward.
swap 1 2 | Still walking "5" forward.
swap 0 1 | "5" reaches the front. Call cost = 2·5 − 1 = 9. List is now ⟨5,1,2,3,4⟩.
mark 3 | Search for 3: it is at position 4, so the search costs 4.
swap 2 3 | Walk "3" forward (swap cost 1).
swap 1 2 | Still walking "3" forward.
swap 0 1 | "3" reaches the front. Call cost = 2·4 − 1 = 7. Cumulative 16. List is ⟨3,5,1,2,4⟩.
mark 4 | Search for 4: it has been pushed to position 5, so the search costs 5.
swap 3 4 | Walk "4" forward (swap cost 1).
swap 2 3 | Still walking "4" forward.
swap 1 2 | Still walking "4" forward.
swap 0 1 | "4" reaches the front. Call cost = 2·5 − 1 = 9. Cumulative 25. List is ⟨4,3,5,1,2⟩.
mark 0 | Search for 4 again: it is already at the front. Cost 1, no swaps. Cumulative 26.
---
1
2
3
4
5
```

Contrast that with **FORESEE**, the hypothetical procedure that knows the future: it also searches and reorders, but after each call it optimally rearranges its list for what's coming. After searching for 3, FORESEE moves 4 to the front, *paying to move an element before it is accessed* because it knows a search for 4 is imminent. It pays a swap cost of 3 on that second call and then never pays another swap cost:

| search | FORESEE's list before | search + swap cost | cumulative | MOVE-TO-FRONT's list before | search + swap cost | cumulative |
|---|---|---|---|---|---|---|
| 5 | ⟨1,2,3,4,5⟩ | 5 + 0 = 5 | 5 | ⟨1,2,3,4,5⟩ | 5 + 4 = 9 | 9 |
| 3 | ⟨1,2,3,4,5⟩ | 3 + 3 = 6 | 11 | ⟨5,1,2,3,4⟩ | 4 + 3 = 7 | 16 |
| 4 | ⟨4,1,2,3,5⟩ | 1 + 0 = 1 | 12 | ⟨3,5,1,2,4⟩ | 5 + 4 = 9 | 25 |
| 4 | ⟨4,1,2,3,5⟩ | 1 + 0 = 1 | 13 | ⟨4,3,5,1,2⟩ | 1 + 0 = 1 | 26 |

Note that FORESEE and MOVE-TO-FRONT maintain *different* lists of the same elements, and there may be more than one optimal order. In this particular example MOVE-TO-FRONT costs more at every step, but that is not necessarily always the case.

### Why MOVE-TO-FRONT is 4-competitive

The remarkable part: we can bound MOVE-TO-FRONT's cost relative to FORESEE *without knowing what swaps FORESEE performs*. The tool is an **inversion** — a pair of elements `a` and `b` where `a` appears before `b` in one list but `b` appears before `a` in the other. For two lists `L` and `L'`, the **inversion count** `I(L, L')` is the number of such pairs. For `L = ⟨5, 3, 1, 4, 2⟩` and `L' = ⟨3, 1, 2, 4, 5⟩`, exactly five of the ten pairs — `(1,5)`, `(2,4)`, `(2,5)`, `(3,5)`, `(4,5)` — appear in different orders, so `I(L, L') = 5`.

The key structural fact: if two *consecutive* elements swap positions in a list `L`, then for any other list `L'`, the value of `I(L, L')` either increases by 1 or decreases by 1 — because the swapped pair's inversion status with respect to `L'` must flip, and no other pair's does.

Let `L^M_i` and `L^F_i` be the lists held by MOVE-TO-FRONT and FORESEE immediately after the `i`-th search, and `c^M_i`, `c^F_i` their costs on the `i`-th call. We don't know how many swaps FORESEE performs; call it `t_i`. Then for a search for element `x`:

```
c^M_i = 2 · r(L^M_{i−1}, x) − 1                (search + all the swaps to the front)
c^F_i = r(L^F_{i−1}, x) + t_i                  (search + however many swaps FORESEE chose)
```

Now partition the elements by where they sit relative to `x` in the two lists *before* the `i`-th search:

- `BB` = elements before `x` in **b**oth `L^M_{i−1}` and `L^F_{i−1}`
- `BA` = elements **b**efore `x` in `L^M_{i−1}` but **a**fter `x` in `L^F_{i−1}`
- `AB` = elements **a**fter `x` in `L^M_{i−1}` but **b**efore `x` in `L^F_{i−1}`

which immediately gives the two positions in terms of set sizes:

```
r(L^M_{i−1}, x) = |BB| + |BA| + 1
r(L^F_{i−1}, x) = |BB| + |AB| + 1
```

MOVE-TO-FRONT performs `|BB| + |BA|` swaps (one per element preceding `x` in its own list). Each swap with a `y ∈ BB` puts `x` before `y` in `L^M` while `L^F` is unchanged, *creating* an inversion. Each swap with a `z ∈ BA` puts `x` before `z` in both lists, *destroying* one. So:

```
I(L^M_i, L^F_{i−1}) − I(L^M_{i−1}, L^F_{i−1}) = |BB| − |BA|
```

**Theorem 27.1: MOVE-TO-FRONT has a competitive ratio of 4.** The proof is a potential-function argument, exactly the technique from the `amortized-analysis` concept, with the potential defined on the inversion count:

```
Φ_i = 2 · I(L^M_i, L^F_i)
```

The factor of 2 encodes the intuition that each inversion represents a cost of 2 for MOVE-TO-FRONT relative to FORESEE: 1 for searching and 1 for swapping. Since the inversion count is nonnegative, `Φ_i ≥ 0` for all `i`; and assuming both algorithms start with the same list, `Φ_0 = 0`, so `Φ_i ≥ Φ_0` for every `i` — the two conditions the potential method requires. The amortized cost is `ĉ^M_i = c^M_i + Φ_i − Φ_{i−1}`, where MOVE-TO-FRONT's own swaps raise the potential by exactly `2(|BB| − |BA|)` and FORESEE's `t_i` swaps each move it by ±2, so FORESEE contributes at most `2t_i`:

```
ĉ^M_i = c^M_i + Φ_i − Φ_{i−1}
      ≤ 2·r(L^M_{i−1}, x) − 1 + 2(|BB| − |BA| + t_i)
      = 2·r(L^M_{i−1}, x) − 1 + 2(|BB| − (r(L^M_{i−1}, x) − 1 − |BB|) + t_i)   [|BA| = r − 1 − |BB|]
      = 4|BB| + 1 + 2·t_i
      ≤ 4|BB| + 4|AB| + 4 + 4·t_i                                              [increasing some terms]
      = 4(|BB| + |AB| + 1 + t_i)
      = 4(r(L^F_{i−1}, x) + t_i)
      = 4·c^F_i
```

Because `Φ_0 = 0` and `Φ` never goes negative, the total amortized cost upper-bounds the total actual cost, so for any sequence of `m` operations `Σ c^M_i ≤ Σ ĉ^M_i ≤ 4 · Σ c^F_i`. MOVE-TO-FRONT is 4-competitive.

The technique is worth internalizing beyond this one result: we related an online algorithm to an optimal one by capturing how a particular property (here, swaps and the inversions they flip) *must* evolve relative to the optimum, without ever knowing what the optimum actually does. Note also the family resemblance the book points out between MOVE-TO-FRONT and the path-compression heuristic behind the `union-find-disjoint-sets` concept — though path compression is more accurately "move-to-next-to-front," and unlike MOVE-TO-FRONT in a doubly linked list it can relocate multiple elements at once.

### Online caching: the deterministic policies

The caching problem: a sequence of `n` memory requests for blocks `b_1, b_2, …, b_n` (not necessarily distinct) arrives, and a cache holds up to `k` blocks. A request for a block already cached is a **cache hit** and leaves the cache unchanged; otherwise it's a **cache miss**, and if the cache is already full some block must be **evicted** before the requested one enters. Caching algorithms differ *only* in which block they evict on a miss with a full cache. The goal is to minimize total misses. (Prefetching — pulling a block in ahead of its request — is out of scope here.) Assume `n > k`, that at least `k` distinct blocks are requested, and that the cache starts empty, so the first `k` requests are all misses and no evictions occur during them.

The book lists four online policies:

- **FIFO** — evict the block that has been in the cache the longest time.
- **LIFO** — evict the block that has been in the cache the shortest time.
- **LRU (Least Recently Used)** — evict the block whose last use is furthest in the past.
- **LFU (Least Frequently Used)** — evict the block accessed the fewest times, breaking ties by choosing the block that has been in the cache the longest.

All four share one skeleton and differ in a single comparator:

```java
final class BlockCache {
    private final int k;
    private final List<Integer> cached = new ArrayList<>();
    private final Map<Integer, Integer> enteredAt = new HashMap<>();  // when the block entered
    private final Map<Integer, Integer> lastUsed  = new HashMap<>();  // when it was last requested
    private final Map<Integer, Integer> useCount  = new HashMap<>();  // how often it was requested
    private int clock = 0, misses = 0;

    BlockCache(int k) { this.k = k; }

    void request(int b) {
        clock++;
        if (cached.contains(b)) {                       // cache hit: cache is unchanged
            lastUsed.put(b, clock);
            useCount.merge(b, 1, Integer::sum);
            return;
        }
        misses++;                                       // cache miss
        if (cached.size() == k) {                       // full: something must go
            int victim = chooseVictim();
            cached.remove(Integer.valueOf(victim));
            enteredAt.remove(victim); lastUsed.remove(victim); useCount.remove(victim);
        }
        cached.add(b);
        enteredAt.put(b, clock); lastUsed.put(b, clock); useCount.put(b, 1);
    }

    // The ONLY thing that distinguishes the four policies:
    //   FIFO -> Comparator.comparingInt(enteredAt::get)                      then take min
    //   LIFO -> Comparator.comparingInt(enteredAt::get)                      then take max
    //   LFU  -> comparingInt(useCount::get).thenComparingInt(enteredAt::get) then take min
    //   LRU  -> Comparator.comparingInt(lastUsed::get)                       then take min
    private int chooseVictim() {
        return Collections.min(cached, Comparator.comparingInt(lastUsed::get));   // LRU
    }

    int misses() { return misses; }
}
```

**Theorem 27.2: LIFO has a competitive ratio of Θ(n/k).** For the lower bound, take `k + 1` blocks numbered `1..k+1` and the request sequence `1, 2, 3, …, k, k+1, k, k+1, k, k+1, …` for `n` requests total. After the first `k` requests (all misses) the cache holds `1..k`. Request `k+1` evicts block `k`, because block `k` has been in the cache the shortest time. Request `k` then evicts `k+1`, which was just placed in. This alternation continues, so **LIFO misses on every one of the `n` requests**. The optimal offline algorithm, on the first request for `k+1`, evicts any block *except* block `k` and never evicts again — total misses `k + 1`. The ratio is `n/(k+1)`, i.e. `Ω(n/k)`. For the upper bound: any algorithm incurs at most `n` misses, and because at least `k` distinct blocks are requested, *any* algorithm (including the optimal offline one) incurs at least `k` misses — so the ratio is `O(n/k)`.

A ratio like this is called **unbounded**, because it grows with the input size. Exercise 27.3-2 asks you to show LFU is unbounded too.

**Theorem 27.3: LRU has a competitive ratio of O(k).** The proof divides the request sequence into **epochs**: epoch 1 begins with the first request, and epoch `i` (for `i > 1`) begins upon encountering the `(k+1)`-st distinct request since the beginning of epoch `i − 1`. For `k = 3` and the sequence

```
1, 2, 1, 5, 4, 4, 1, 2, 4, 2, 3, 4, 5, 2, 2, 1, 2, 2
```

the first 3 distinct requests are 1, 2 and 5, so epoch 2 begins at the first request for 4; within epoch 2 the first 3 distinct requests are 4, 1 and 2, and the request for 3 opens epoch 3. Four epochs result:

```
| 1, 2, 1, 5 | 4, 4, 1, 2, 4, 2 | 3, 4, 5 | 2, 2, 1, 2, 2 |
```

Within an epoch, the *first* request for a block may miss, but subsequent requests for that same block within the epoch cannot — the block is now among the `k` most recently used, so LRU won't evict it. In epoch 2, the first request for 4 misses and the later ones don't; in epoch 3, blocks 3 and 5 miss but block 4 doesn't, because it was recently accessed in epoch 2. Since only a block's first request in an epoch can miss and the cache holds `k` blocks, **each epoch incurs at most `k` misses**. Meanwhile the first request of each epoch must miss *even for the optimal algorithm*, because by the definition of an epoch there have been `k` other blocks accessed since that block's last access — so **the optimal algorithm incurs at least one miss per epoch**. Ratio at most `k/1 = O(k)`. Exercise 27.3-3 asks you to show FIFO is `O(k)` as well.

The difference between `Θ(n/k)` and `Θ(k)` is exactly the difference that matters: `k` is fixed by your hardware and does not grow as more requests arrive, while a ratio depending on `n` grows without limit as the request sequence gets longer.

### The Ω(k) barrier that no deterministic policy escapes

We could prove `Ω(k)` lower bounds specifically for LRU and FIFO, but a much stronger statement holds: **any** deterministic online caching algorithm has competitive ratio `Ω(k)`. The proof uses an **adversary** who knows the online algorithm being used and tailors future requests against it.

Cache size `k`, possible blocks `{1, 2, …, k+1}`. The first `k` requests are for `1..k`, filling both caches. The next request is for `k+1`; to make room, the online algorithm evicts some block `b_1`. The adversary, knowing this, makes the next request `b_1`, forcing eviction of some `b_2`; the next request is `b_2`, forcing eviction of `b_3`; and so on. **The online algorithm misses on every request** — `n` misses over `n` requests.

The optimal offline algorithm is furthest-in-future: always evict the block whose next request is furthest away. Since only `k + 1` distinct blocks exist, whenever furthest-in-future evicts a block, that block will not be accessed for at least the next `k` requests. So after the initial `k` misses, it misses at most once every `k` requests — at most `k + n/k` misses in total. The ratio is therefore at least

```
      n            n·k
 ───────────  =  ───────── ,   and for n ≥ k²:   n·k / (n + k²)  ≥  n·k / 2n  =  k/2
   k + n/k        n + k²
```

**Theorem 27.4: any deterministic online algorithm for caching with cache size `k` has competitive ratio Ω(k).** Combined with Theorem 27.3, LRU and FIFO are `Θ(k)` — they're optimal *among deterministic policies*, and no deterministic cleverness will do better. The results are, as the book puts it, somewhat unsatisfying: we can separate `Θ(k)` policies from unbounded ones, but all these ratios are still rather high. Determinism is precisely the property the adversary exploits.

### Randomization and the oblivious adversary: RANDOMIZED-MARKING

Dropping determinism changes the picture. But first: when an online algorithm makes random choices, does the adversary know them? An adversary that does **not** know the random choices is **oblivious**; one that does is **nonoblivious**. We'd prefer to guarantee results against a nonoblivious adversary since it's stronger, but a nonoblivious adversary mitigates most of the power of randomness — knowing the outcomes of the coin flips, it can act as if the algorithm were deterministic. So the oblivious adversary is the one typically used. The book's illustration: if you flip a fair coin `n` times, a nonoblivious adversary knows after each flip whether it was heads, and so knows the exact count; an oblivious adversary knows only that you're flipping a fair coin `n` times, and can reason that the number of heads is binomially distributed with expectation `n/2` and variance `n/4` — but has no way to know how many heads you actually flipped.

The algorithm is **MARKING**, an approximation of LRU — think of it as simply "recently used" rather than "*least* recently used." It keeps a 1-bit `mark` per cached block, all initially unmarked. A request for a cached block marks it. On a miss, if all cached blocks are marked they are all unmarked; either way at least one unmarked block now exists, an arbitrary unmarked block is evicted, and the requested block enters the cache marked. **RANDOMIZED-MARKING** chooses that victim uniformly at random among the unmarked blocks:

```java
// RANDOMIZED-MARKING(b), transcribed from the book's pseudocode.
// (The analysis assumes the cache has already filled, so every miss evicts.)
void randomizedMarking(int b) {
    if (cached.contains(b)) {                        // 1  block b resides in the cache
        mark.put(b, 1);                              // 2
        return;
    }
    if (cached.stream().allMatch(x -> mark.get(x) == 1)) {   // 4  all blocks marked?
        cached.forEach(x -> mark.put(x, 0));                 // 5  unmark all — a NEW EPOCH starts here
    }
    List<Integer> unmarked = cached.stream().filter(x -> mark.get(x) == 0).toList();
    int u = unmarked.get(random.nextInt(unmarked.size()));    // 6  uniformly at random
    cached.remove(Integer.valueOf(u));                        // 7  evict u
    cached.add(b);                                            // 8
    mark.put(b, 1);                                           // 9
}
```

An **epoch** begins immediately after line 5 executes, with no marked blocks in the cache. The number of marked blocks increases by 1 on a block's first request in the epoch and never decreases within it, so an epoch comprises requests for `k` distinct blocks (possibly fewer in the final epoch), and the next epoch begins on a request for a block outside those `k` — the same notion of epoch as in Theorem 27.3.

For a randomized algorithm we measure the **expected competitive ratio**: algorithm `A` has expected competitive ratio `c` if for all inputs `I`, `E[A(I)] ≤ c · F(I)`, where the expectation is over `A`'s random choices. The deterministic MARKING algorithm has competitive ratio `Θ(k)` (Theorem 27.4 supplies the lower bound; Exercise 27.3-4 the upper). The randomized version does far better, because an oblivious adversary can't reliably request a block that isn't in the cache — it doesn't know which blocks are there.

**Theorem 27.5: RANDOMIZED-MARKING has expected competitive ratio O(lg k) against an oblivious adversary.** The proof runs epoch by epoch. Within an epoch, only a block's *first* request can miss (afterwards it's cached and marked, so it can't be evicted during the epoch), so only first requests are counted; assume each epoch has exactly `k` requests for `k` distinct blocks (pad the last epoch with dummy requests). Classify each as **old** (the block was in the cache at the start of the epoch — i.e. it was requested in the previous epoch) or **new**. On the earlier example, collapsing each epoch to its first requests gives `|1,2,5| 4,1,2 | 3,4,5 | 2,1|`: all of epoch 1 is new; in epoch 2, blocks 1 and 2 are old and 4 is new; in epoch 3, block 4 is old while 3 and 5 are new; both requests in epoch 4 are new.

A new request always misses, by definition. An old request may or may not — the block was cached at the epoch's start, but an earlier request in the epoch might have evicted it, and each successive old request has an increasing chance of having been evicted. Bounding that probability needs one probabilistic fact:

> **Lemma 27.6.** A bag contains `x + y` balls: `x − 1` blue, `y` white, and 1 red. You repeatedly choose a ball at random and remove it, setting aside each white ball, until you have chosen `m` balls that are blue or red, where `m ≤ x`. Then one of the chosen balls is the red ball with probability `m/x`.

(White balls don't affect how many blue-or-red balls get chosen, so they can be ignored; the remaining conditional probabilities `(x−1)/x · (x−2)/(x−1) · … · (x−m)/(x−m+1)` telescope to `(x−m)/x` for "red never chosen," leaving `m/x`.)

Let epoch `i` contain `r_i ≥ 1` new requests and therefore `k − r_i` old ones, and consider the `j`-th old request, for block `b_ij`. Let `n_ij` and `o_ij` be the numbers of new and old requests occurring in epoch `i` before it; since `j − 1` old requests precede it, `o_ij = j − 1`. Applying Lemma 27.6 with the `k` cached blocks as balls — `b_ij` as the red ball, the blocks already excluded by prior old requests as white balls, the rest as blue — gives the miss probability for the `j`-th old request as

```
n_ij / (k − o_ij) = n_ij / (k − j + 1)  ≤  r_i / (k − j + 1)      (since n_ij ≤ r_i)
```

With indicator random variables `Y_ij` for "the `j`-th old request in epoch `i` misses" and `Z_ij` for the `j`-th new request (always 1), the expected number of misses `X_i` in epoch `i` is:

```
E[X_i] = Σ_{j=1}^{k−r_i} E[Y_ij] + Σ_{j=1}^{r_i} E[Z_ij]        (linearity of expectation)
       ≤ Σ_{j=1}^{k−r_i} r_i/(k − j + 1) + r_i
       ≤ r_i · ( Σ_{j=1}^{k−1} 1/(k − j + 1) + 1 )
       = r_i · H_k
```

where `H_k` is the `k`-th harmonic number. Summing over all `p` epochs gives `E[X] ≤ H_k · Σ r_i`.

Now the offline side. Focusing on one epoch won't do — the offline algorithm might begin an epoch with exactly the blocks that epoch will request, and suffer nothing. But consider two consecutive epochs `i − 1` and `i`: each contains `k` requests for `k` different blocks, and epoch `i` contains `r_i` requests for blocks *not* requested in epoch `i − 1`, so the two epochs together contain exactly `k + r_i` distinct requests. Whatever the cache held at the start of epoch `i − 1`, `k + r_i` distinct requests force at least `r_i` misses. Letting `m_i` be the offline algorithm's misses in epoch `i`, that gives `m_{i−1} + m_i ≥ r_i`, and pairing terms:

```
Σ m_i = ½ · Σ 2m_i  =  ½ · ( m_1 + Σ_{i=2}^{p} (m_{i−1} + m_i) + m_p )
      ≥ ½ · ( m_1 + Σ_{i=2}^{p} (m_{i−1} + m_i) )
      ≥ ½ · ( m_1 + Σ_{i=2}^{p} r_i )
      = ½ · Σ_{i=1}^{p} r_i                          (because m_1 = r_1)
```

The last equality holds because the cache starts empty, so every first request in epoch 1 misses even for the optimal offline algorithm. Dividing the upper bound on the randomized algorithm by the lower bound on the offline one:

```
   H_k · Σ r_i
  ───────────── = 2·H_k = 2 ln k + O(1) = O(lg k)
   ½  · Σ r_i
```

From `Θ(k)` to `Θ(lg k)` — for a realistic `k` that is an enormous improvement, and the *only* thing that bought it was the adversary's inability to see the coin flips.

## Trade-offs

- **A competitive ratio is a worst-case guarantee, not a performance prediction.** MOVE-TO-FRONT being 4-competitive means it never costs more than 4× the optimum on *any* sequence — but on a particular sequence it could cost far less, perhaps even matching the optimum exactly. The same asymmetry runs through the elevator example: "always take the stairs" wins on competitive ratio at `k = 10, B = 300`, yet the book is explicit that this doesn't make it better on average, or even more often better. It guards better against the worst case, and nothing more is claimed.
- **The bounds are only as meaningful as the cost model.** MOVE-TO-FRONT's 4-competitiveness is proven under a specific model: cost `i` to search position `i`, cost 1 per adjacent swap. Exercise 27.2-4 poses an alternative model where, after accessing `x`, you may move it anywhere earlier in the list for free and only accesses cost anything — and there MOVE-TO-FRONT is 2-competitive (for a sufficiently large number of requests). Before quoting a competitive ratio, check that the model's accounting matches what your system actually pays for. The proof also assumes MOVE-TO-FRONT and FORESEE start from the same list, which is what makes the initial potential `Φ_0 = 0`.
- **Deterministic caching has a hard floor, and it isn't a tuning problem.** Every deterministic policy is `Ω(k)` (Theorem 27.4), so no amount of heuristic refinement escapes it — the adversary is assumed to know your algorithm and can always request exactly the block you just evicted. Exercise 27.3-5 pushes this further: even a deterministic `l`-lookahead algorithm, allowed to see the next `l` requests, is still `Ω(k)` for every constant `l ≥ 0`. Choosing between LRU/FIFO (`Θ(k)`) and LIFO/LFU (unbounded, `Θ(n/k)`) is a real decision; squeezing a deterministic policy below `Θ(k)` is not.
- **Randomization's `O(lg k)` guarantee rests entirely on the adversary being oblivious, and it's an expectation.** Against a nonoblivious adversary who sees the random choices, the adversary can act as if the algorithm were deterministic and the advantage evaporates. And `E[A(I)] ≤ c·F(I)` bounds the *expected* number of misses over the algorithm's coin flips — an individual run can be worse, so this is not a per-execution guarantee any more than an amortized bound is a per-operation latency guarantee.
- **A ratio that depends on `n` is qualitatively worse than one that depends on `k`.** `k` is fixed and doesn't grow as requests keep arriving; `n` grows without limit, so an "unbounded" `Θ(n/k)` ratio degrades over the lifetime of a long-running process. And even the good ratios here are, in the book's own assessment, rather high — competitive analysis is sharp enough to separate policy classes, but it won't tell you which of two `Θ(k)` policies will actually be faster on your traffic.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 27 "Online Algorithms", Sections 27.1-27.3, pp. 792-815](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 27.3 "Online caching" (deterministic bounds, RANDOMIZED-MARKING), pp. 802-814](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
