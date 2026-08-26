---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Learn to prove a rigorous *worst-case* bound on the average cost of an operation across any sequence of operations, even when a single operation in that sequence can be expensive — the technique that explains why "resize doubles the array, so isn't insertion sometimes O(N)?" still leaves `ArrayList.add` correctly described as O(1), and gives you three formal methods (aggregate, accounting, potential) to prove bounds like it yourself instead of hand-waving them.

## Use Cases

- Justifying the claim "`ArrayList.add` is O(1) amortized" precisely, instead of quoting it without being able to defend it against "but what about the resize?"
- Proving a data structure's *sequence*-level performance is good even though individual operations have wildly different costs — dynamic arrays, incremental hashing, splay trees, union-find with path compression.
- Recognizing, in a code review or a design discussion, when someone has conflated "amortized" with "average-case" — they sound similar but are different guarantees, and only one of them survives adversarial input.

## Deep Dive

### Amortized vs. average-case: a worst-case guarantee, not a probability

These two terms get confused constantly, and Cormen et al. are careful to separate them because the difference is load-bearing:

- **Average-case analysis** assumes a probability distribution over *inputs* (e.g., "assume keys are inserted in random order") and bounds the *expected* cost. It says nothing about what happens on an adversarially chosen input — a pathological input can still blow the bound.
- **Amortized analysis** makes no assumption about input distribution at all. It bounds the *total* cost of any sequence of `N` operations — chosen by an adversary, in any order — and divides by `N`. The result is a worst-case guarantee on the average cost per operation, over *every possible sequence*, not just typical ones.

So "amortized O(1)" is strictly stronger than "average-case O(1) assuming random input": it holds even if every operation in the sequence is deliberately picked to be as bad as possible, because the whole *point* of the proof is to show that expensive operations can't happen often enough, or can't be positioned densely enough, to break the bound — no matter how the sequence is chosen.

### Motivating example: a dynamic array that doubles

The canonical example — and the one used throughout this concept — is a dynamic array (Java's `ArrayList`, conceptually) that starts empty and doubles its capacity whenever an insert would overflow it:

```java
// Simplified model of ArrayList's growth strategy (real ArrayList grows ~1.5x;
// the amortized argument holds for any constant growth factor > 1).
class DynamicArray {
    private Object[] table = new Object[0];
    private int size = 0;

    void insert(Object x) {
        if (size == table.length) {
            int newCapacity = (table.length == 0) ? 1 : table.length * 2;
            table = Arrays.copyOf(table, newCapacity); // O(current size) — copies every element
        }
        table[size++] = x;
    }
}
```

A single call to `insert` that triggers a resize costs `Θ(size)` — every existing element gets copied. Taken in isolation, that looks like `insert` is `O(N)` in the worst case. But that expensive call can only happen when the array has *exactly* filled up, and because capacity just doubled the last time it filled up, at least half of the current capacity's worth of cheap `O(1)` inserts had to happen since the previous resize. The expensive operation is rare precisely *because* it was expensive last time — that self-limiting relationship is what amortized analysis makes precise.

Tracing `insert` on an initially empty array, capacity starting at 0 and doubling (1, 2, 4, 8, …), the actual cost of the `i`-th insert is `i` when `i − 1` is an exact power of 2 (a resize copies `i − 1` old elements plus inserts the new one), and `1` otherwise:

| insert # (i) | capacity before | resize? | actual cost cᵢ |
|---|---|---|---|
| 1 | 0 → 1 | yes (bootstrap) | 1 |
| 2 | 1 → 2 | yes | 2 |
| 3 | 2 → 4 | yes | 3 |
| 4 | 4 | no | 1 |
| 5 | 4 → 8 | yes | 5 |
| 6 | 8 | no | 1 |
| 7 | 8 | no | 1 |
| 8 | 8 | no | 1 |

Total actual cost for 8 inserts: `1+2+3+1+5+1+1+1 = 15`, for a raw average of `15/8 ≈ 1.9` — already close to constant, and the ratio only gets better as the sequence grows, because resize costs form a shrinking fraction of a geometric series. The rest of this Deep Dive proves that convergence to `O(1)` rigorously, three different ways, using this exact table.

### The aggregate method

The most direct technique: compute an upper bound `T(N)` on the *total* cost of **any** sequence of `N` operations, then divide by `N`. That quotient is the amortized cost assigned to *every* operation in the sequence — the aggregate method doesn't distinguish between operation types.

For the doubling array, sum the actual costs directly. Every insert costs at least `1` (the element itself), contributing `N` total. On top of that, resizes happen only when the array size passes a power of 2, so the resize costs form the geometric series `1 + 2 + 4 + ... + N/2 < N`. So:

```
T(N) = N (one unit per insert) + (1 + 2 + 4 + ... + N/2)   [resize costs]
     < N + N
     = 3N
```

Dividing by `N` gives an amortized cost per insert of `T(N)/N < 3 = O(1)`. Note this matches the worked table above almost exactly — `15 < 3 × 8 = 24` — the bound is deliberately loose (an upper bound), not a tight equality.

The aggregate method is the easiest to apply but the least flexible: it can only tell you the *same* amortized cost applies to every operation in the sequence, which is fine here (every `insert` call looks identical from the outside) but breaks down for data structures with several operation types that plausibly have different amortized costs (Cormen's other running example, a stack with `PUSH`/`POP`/`MULTIPOP`, is exactly this case).

### The accounting method

The accounting method assigns each operation an **amortized charge** — a fixed price you decide on, which may be more than the operation's actual cost — and proves that if every operation is charged that price, the payments always cover the actual costs. The surplus from overcharged (cheap) operations accumulates as **credit** stored on specific objects in the structure; undercharged (expensive) operations spend that stored credit instead of demanding it out of thin air. The one invariant you must maintain: the running credit balance can never go negative — if it did, some prefix of the sequence would have cost more than it was charged for, and the bound would be false for that prefix.

For the doubling array, charge every `insert` a flat **3 units**, split conceptually as: `1` unit pays for inserting this element right now, `1` unit is banked as credit *on this element* to prepay its own copy during the next resize, and `1` unit is banked as credit *on some existing element* to prepay *its* copy during the next resize. Since a resize copies exactly the elements present at that moment, and each of them was credited `1` unit by a later insert before the resize happened, the resize is fully paid for out of the bank — it never needs to charge the caller anything extra.

Running the charge-3 rule against the worked table (`balanceᵢ = balanceᵢ₋₁ + 3 − cᵢ`, `balance₀ = 0`):

| i | actual cost cᵢ | charge | balance after |
|---|---|---|---|
| 1 | 1 | 3 | 2 |
| 2 | 2 | 3 | 3 |
| 3 | 3 | 3 | 3 |
| 4 | 1 | 3 | 5 |
| 5 | 5 | 3 | 3 |
| 6 | 1 | 3 | 5 |
| 7 | 1 | 3 | 7 |
| 8 | 1 | 3 | 9 |

The balance never dips below zero — including at `i = 5`, the resize, where the actual cost (`5`) exceeds the charge (`3`) and the deficit is covered entirely by the `2` units already banked. That's the proof: total charged (`3 × 8 = 24`) is a valid upper bound on total actual cost (`15`), so the amortized cost per operation is `3 = O(1)`.

### The potential method

The potential method is the most general of the three, and the one used most often in practice for structures more complex than a stack or a counter. Instead of tracking credit on individual objects, define a single **potential function** `Φ` that maps the *entire* data structure's current state to a real number — "stored energy" available to pay for future expensive operations. The amortized cost of the `i`-th operation is defined as:

```
ĉᵢ = cᵢ + Φ(Dᵢ) − Φ(Dᵢ₋₁)        (actual cost, plus the change in potential it caused)
```

Summing over a whole sequence, the `Φ(Dᵢ)` terms telescope:

```
Σ ĉᵢ = Σ cᵢ + Φ(Dₙ) − Φ(D₀)
```

So if `Φ(D₀) = 0` and `Φ(Dᵢ) ≥ 0` for every `i` (potential never goes negative), then `Σ ĉᵢ ≥ Σ cᵢ` — the sum of amortized costs is a valid upper bound on the sum of actual costs, for *any* sequence, which is exactly what the definition requires.

For the doubling array, Cormen's potential function is `Φ(T) = 2 × num − capacity`, where `num` is the element count and `capacity` is the array's current length. Intuitively: it's `0` right after a resize (when the array is exactly half full), and it climbs by `2` with every subsequent cheap insert, reaching exactly `capacity` — enough to fully prepay the next copy — right when the array fills up again.

Applying `Φ` to the worked table (`num`, `capacity` measured *after* each insert):

| i | num | capacity | Φ = 2·num − capacity |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 1 | 1 | 1 | 1 |
| 2 | 2 | 2 | 2 |
| 3 | 3 | 4 | 2 |
| 4 | 4 | 4 | 4 |
| 5 | 5 | 8 | 2 |
| 6 | 6 | 8 | 4 |
| 7 | 7 | 8 | 6 |
| 8 | 8 | 8 | 8 |

Now apply `ĉᵢ = cᵢ + Φᵢ − Φᵢ₋₁` to one cheap operation and one expensive (resizing) one:

- **Cheap insert, `i = 4`** (no resize): actual cost `c₄ = 1`, potential change `Φ₄ − Φ₃ = 4 − 2 = 2`. Amortized cost `= 1 + 2 = 3`.
- **Expensive insert, `i = 5`** (triggers the resize from capacity 4 to 8): actual cost `c₅ = 5`, potential change `Φ₅ − Φ₄ = 2 − 4 = −2`. Amortized cost `= 5 + (−2) = 3`.

Both land on the same amortized cost of `3` — the potential *drop* on the expensive operation exactly absorbs the extra actual cost, the same role the banked credit played in the accounting method. (The very first insert, `i = 1`, is a minor boundary case — amortized cost `2`, not `3`, because it grows the array from capacity `0` rather than doubling an existing one — but it's still `O(1)` and doesn't affect the asymptotic result.) Since `Φ` never goes negative, the total amortized cost over any sequence upper-bounds the total actual cost, giving the same `O(1)` amortized bound as the other two methods — by a technique general enough to extend to structures where "bank a credit on this object" doesn't obviously make sense, which is why it's the one reached for most often in the literature.

### Where this matters in practice

Any structure with an "occasionally expensive, usually cheap" operation profile is a candidate for amortized analysis, and several show up constantly in day-to-day engineering:

- **Dynamic arrays** — `java.util.ArrayList`, C++'s `std::vector`, Python's `list`, Go slices — all rely on exactly this doubling (or 1.5x-style) growth argument for their documented `O(1)` amortized `add`/`append`.
- **Hash table resizing** — the sibling concept on hash tables (chaining and open addressing) defers its dynamic-resizing discussion to this concept for exactly this reason: growing a hash table's bucket array is structurally the same doubling-and-copying problem as the dynamic array above, and the same three methods apply directly.
- **Amortized structures more broadly** — splay trees (potential method, credit tied to subtree sizes) and union-find with path compression (a more elaborate potential argument) both lean on amortized analysis for bounds that would be false, or much harder to state, as plain worst-case-per-operation claims.

## Trade-offs

- **An amortized bound is not a per-call latency guarantee** — "amortized O(1)" means the *average* over a long sequence is constant, but any individual call can still be the expensive one. A latency-sensitive system (a real-time audio callback, a request handler with a hard SLA) can be broken by exactly the resize that the amortized bound is busy proving is "rare" — rare is not the same as "never happens on your hot path."
- **The three methods trade rigor-per-effort for flexibility** — aggregate is the fastest to apply but forces one amortized cost onto every operation type; accounting is intuitive (a bank-account story) but the charges are chosen ad hoc and offer no guidance for structures more complex than a stack or counter; potential is the most work to set up (you have to invent a correct `Φ`) but is the most general and composable, and is what you reach for once "assign credit to individual objects" stops being a natural fit.
- **Choosing the wrong potential function doesn't just give a worse bound, it can produce a false proof** — `Φ` must never go negative and must genuinely capture "stored capacity to pay for the next expensive step," or the telescoping-sum argument silently stops being valid; verifying `Φ(D₀) = 0` and `Φ(Dᵢ) ≥ 0` for all `i` is not optional bookkeeping, it's the load-bearing part of the proof.
- **Amortized ≠ average-case, and treating them as interchangeable is a real bug in reasoning** — an amortized bound holds for *every* adversarial sequence; an average-case bound only holds if the input actually matches the assumed distribution. Code that's fast "on average" under a random-input assumption can be trivially broken by a crafted worst-case sequence in a way that amortized-bound code cannot.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 16 "Amortized Analysis," Sections 16.1–16.3, pp. 447–459 — book
- [Oracle Java SE Documentation — ArrayList](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ArrayList.html) — doc
