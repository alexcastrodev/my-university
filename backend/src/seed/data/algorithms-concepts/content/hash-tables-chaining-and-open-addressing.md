---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand hash tables as an algorithmic idea, not a Java class: a hash function turns a key into an array index so lookup can be near-constant time, collisions between different keys are mathematically unavoidable once the key universe exceeds the table size, and a hash table's whole design is really a choice of *how* to resolve those collisions — separate chaining or open addressing — plus how to keep the load factor bounded as the table grows.

## Use Cases

- Implementing an unordered symbol table (map/set) where O(1)-average lookup matters more than sorted order — the theoretical basis for `HashMap`/`HashSet`, though this concept covers the collision-resolution algorithms themselves, not the JDK class.
- Deduplication, frequency counting, and membership testing over large key sets where a linked-list or BST search would be too slow.
- Any system (compiler symbol table, cache, database index) that needs to trade memory for near-constant-time search, per Sedgewick & Wayne's framing of hashing as "a classic example of a time-space tradeoff."
- Understanding why an adversary who knows your hash function can attack it — relevant to any hash table exposed to untrusted input (e.g., HTTP form-field names), which is exactly what universal hashing is designed to prevent.

## Deep Dive

### The core hashing idea, and why collisions are unavoidable

A hash function `h` maps a (usually huge) key universe down to `{0, 1, ..., M-1}`, the indices of an array of size `M`. Cormen states the basic mechanism plainly: with *direct addressing* you'd need one array slot per possible key, which is wasteful or outright impossible when the universe is huge; hashing fixes that by computing the slot from the key instead of using the key as the index directly, so the table only needs to be proportional to the number of keys actually stored, Θ(N) instead of Θ(|universe|).

```java
private int hash(Object key, int m) {
    // Java convention: combine hashCode() with modular hashing to land in [0, m-1].
    return (key.hashCode() & 0x7fffffff) % m;
}
```

Because the key universe is (almost) always larger than `M`, the pigeonhole principle guarantees that two different keys will eventually hash to the same slot — a **collision**. Cormen is explicit about this: "there must be at least two keys that have the same hash value, and avoiding collisions altogether is impossible." So every real hash table design is fundamentally about *collision resolution* — Sedgewick & Wayne frame the whole section around exactly two strategies: **separate chaining** and **linear probing**.

### Separate chaining: a list per slot, cost bounded by the load factor

Separate chaining keeps, at each of the `M` array slots, a linked list (or any small symbol table) of every key-value pair that hashed there:

```java
public class SeparateChainingHashST<Key, Value> {
    private int M;                              // number of chains
    private Node<Key, Value>[] chains;

    @SuppressWarnings("unchecked")
    public SeparateChainingHashST(int m) {
        this.M = m;
        chains = new Node[m];
    }

    private int hash(Key key) {
        return (key.hashCode() & 0x7fffffff) % M;
    }

    public void put(Key key, Value val) {
        int i = hash(key);
        for (Node<Key, Value> x = chains[i]; x != null; x = x.next)
            if (x.key.equals(key)) { x.val = val; return; }
        chains[i] = new Node<>(key, val, chains[i]);   // prepend — O(1)
    }

    public Value get(Key key) {
        int i = hash(key);
        for (Node<Key, Value> x = chains[i]; x != null; x = x.next)
            if (x.key.equals(key)) return x.val;
        return null;
    }

    private static class Node<K, V> {
        K key; V val; Node<K, V> next;
        Node(K key, V val, Node<K, V> next) { this.key = key; this.val = val; this.next = next; }
    }
}
```

Define the **load factor** α = N/M (N keys, M slots — this α is the same symbol both books use, though they interpret it slightly differently for the two schemes, see below). Sedgewick & Wayne's own argument for why chain length is bounded is disarmingly simple: "since we have M lists and N keys, the average length of the lists is always N/M, no matter how the keys are distributed among the lists" — that's just arithmetic (Property L / Proposition K), independent of any assumption about the hash function.

The precision comes from what both books call the **uniform hashing assumption** (Sedgewick & Wayne's "Assumption J": every key is independently, uniformly likely to land in any slot — Cormen's "independent uniform hashing"). Under that assumption, Cormen proves it exactly:

> **Theorem 11.1 / 11.2 (Cormen).** In a hash table with collisions resolved by chaining, both an unsuccessful search and a successful search take **Θ(1 + α)** time on average.

The `1` is the fixed cost of computing the hash function and indexing into the array; the `α` is the expected chain length to walk through. When N is kept proportional to M (α = O(1)), every operation is O(1) on average — "you can implement search and insert for symbol tables that require constant (amortized) time per operation," as Sedgewick & Wayne put it. Worst case is still Θ(N) — a pathological hash function that sends every key to the same slot degenerates chaining into one long linked list — which is exactly the gap universal hashing (below) closes.

### Open addressing / linear probing: no lists, probe for the next open slot

Open addressing (linear probing is Sedgewick & Wayne's — and Cormen's simplest — variant of it) stores the key-value pair directly in the table itself: no lists, no pointers outside the array. On a collision, walk forward to the next slot, wrapping around at the end, until an empty slot or the key is found:

```java
public class LinearProbingHashST<Key, Value> {
    private int N, M = 16;
    private Key[] keys;
    private Value[] vals;

    @SuppressWarnings("unchecked")
    public LinearProbingHashST() {
        keys = (Key[]) new Object[M];
        vals = (Value[]) new Object[M];
    }

    private int hash(Key key) { return (key.hashCode() & 0x7fffffff) % M; }

    public void put(Key key, Value val) {
        if (N >= M / 2) resize(2 * M);              // keep load factor < 1/2
        int i;
        for (i = hash(key); keys[i] != null; i = (i + 1) % M)
            if (keys[i].equals(key)) { vals[i] = val; return; }
        keys[i] = key;
        vals[i] = val;
        N++;
    }

    public Value get(Key key) {
        for (int i = hash(key); keys[i] != null; i = (i + 1) % M)
            if (keys[i].equals(key)) return vals[i];
        return null;   // hit a null slot — the key was never inserted (or was deleted)
    }
}
```

Because every key lives directly in the table, **the table can never be completely full** — `α = N/M` cannot exceed 1, and a search miss in a totally full table would loop forever. Both books insist the load factor must stay *well below* 1, and give real numbers for why. Sedgewick & Wayne's Proposition M (Knuth's 1962 analysis) states the average probe counts as functions of α:

> search hit ≈ ½(1 + 1/(1-α)), search miss/insert ≈ ½(1 + 1/(1-α)²)

Concretely: at α ≈ 1/2, a hit costs ~1.5 probes and a miss ~2.5. At α = 3/4, a hit costs ~2.5 and a miss ~8.5. At α = 7/8, a miss balloons to ~32.5 probes. This is why Sedgewick & Wayne's `LinearProbingHashST` doubles the table (`resize(2*M)`) the moment `N >= M/2`, guaranteeing α never exceeds one-half — and why Cormen's chapter states flatly that with open addressing, unlike chaining, "the load factor α can never exceed 1" at all, by construction.

**Deletion is genuinely tricky.** You cannot simply null out a deleted key's slot. Cormen explains exactly why: "it would be a mistake to mark that slot as empty by simply storing NIL in it… you might be unable to retrieve any key k for which slot q was probed and found occupied when k was inserted" — because `get`/search stops as soon as it hits a `null` slot, treating it as proof the key was never inserted. If a later key's probe sequence walked *through* the deleted slot to land somewhere past it, nulling that slot breaks the chain of probes and makes the later key unreachable. Sedgewick & Wayne's own worked example: delete `C` (which sits at slot 4 in their trace, but was displaced there via probing), naively null out its slot, then search for `H` (which probed *past* C's slot when it was inserted) — the search hits the null hole where `C` used to be and incorrectly reports a miss, even though `H` is still in the table.

The standard fix Cormen presents is **lazy deletion via a tombstone**: mark the slot with a special `DELETED` sentinel instead of `null`.

```java
// Cormen's tombstone approach: a sentinel distinct from both a real key and null.
static final Object DELETED = new Object();

public void delete(Key key) {
    for (int i = hash(key); keys[i] != null; i = (i + 1) % M) {
        if (keys[i] != DELETED && keys[i].equals(key)) {
            keys[i] = (Key) DELETED;   // NOT null — preserves the probe chain
            vals[i] = null;
            N--;
            return;
        }
    }
}
```

`get`/search must then treat `DELETED` as "occupied, keep probing" (not "empty, stop"), while `put` may reuse a `DELETED` slot for a fresh insert. The cost: search time stops depending cleanly on α, since tombstones accumulate and are never actually reclaimed until a resize — which is exactly why Cormen notes chaining is often preferred whenever deletions are frequent. Sedgewick & Wayne solve the same problem differently, without tombstones: their `delete()` removes the key, then walks forward through the rest of that cluster, pulling every subsequent key-value pair out and *reinserting* it via `put()` — more code, but no permanent tombstone buildup.

### Hash function design: the division method and universal hashing

Both books converge on the **division method** as the default: `h(k) = k mod M`. It's one CPU instruction, but the choice of `M` matters enormously. Sedgewick & Wayne's concrete warning: US telephone area codes cluster with a middle digit of 0 or 1, so hashing them with `M = 100` (a power of 10, only looking at the low-order digits) "strongly favors the values less than 20" — while `M = 97`, a prime not close to a power of 10, disperses them far more evenly. Cormen generalizes the same warning to binary: pick `M` **prime and not close to a power of 2**, because a power-of-2 modulus only examines the low-order bits of the key, and real-world keys (IP addresses, area codes, memory addresses) often have structured, non-random low-order bits.

Cormen's **multiplication method** is the other classic static option: `h(k) = ⌊M · (kA mod 1)⌋` for a constant `0 < A < 1` — multiply the key by `A`, keep only the fractional part, scale by `M`. Its practical variant, the *multiply-shift method*, needs only multiply/subtract/shift and doesn't require `M` to be prime.

But both the division and multiplication methods are **static hashing**: one fixed function, chosen in advance. Cormen's key insight — and the one most often missed — is that *any fixed hash function has a pathological input*: "Suppose that a malicious adversary chooses the keys to be hashed by some fixed hash function. Then the adversary can choose n keys that all hash to the same slot, yielding an average retrieval time of Θ(n)... any static hash function is vulnerable to such terrible worst-case behavior." This isn't hypothetical: Sedgewick & Wayne note that Java's own `String.hashCode()` produces the value `0` for the string `"polygenelubricants"`, and finding other strings that collide with it "has turned into an amusing algorithm-puzzle pastime" — a fixed, known hash function is always attackable once its formula is public.

**Universal hashing** is the fix, and it's a precise idea, not a vague appeal to "randomness": instead of committing to one fixed `h`, pick `h` *at runtime*, uniformly at random, from a family `H` of hash functions with the property that for any two distinct keys, the fraction of functions in `H` under which they collide is at most `1/M`. Cormen's Theorem 11.4 constructs one such family from modular arithmetic — `h(k) = ((a·k + b) mod p) mod M` for a prime `p` larger than any key and randomly chosen `a, b` — and proves it universal. Because the *function itself* is chosen after (or independent of) any adversary's strategy, no fixed sequence of keys can be pre-built to collide against it: "the algorithm can behave differently on each execution, even for the same set of keys to be hashed, guaranteeing good average-case performance" (Corollary 11.3 restates Theorem 11.2's Θ(1+α) bound, now as an unconditional guarantee independent of what keys are thrown at it).

### A worked trace: separate chaining with a real collision

Trace inserting the keys `S E A R C H` (Sedgewick & Wayne's own running example alphabet) into a chaining table of `M = 8`, using Java's real `String.hashCode()` (each is a single character, so `hashCode()` is just its UTF-16 code point) combined with `HashMap`'s bit-spreading step and `(M-1) & spread(h)` as the index — the same hash-to-index mechanics used throughout the JDK:

```viz
type: formula
capacity = 8
slot = (capacity - 1) & spread(hash(item))
---
S
E
A
R
C
H
```

Hand-verified: `hash("S")=83 → slot 3`, `hash("E")=69 → slot 5`, `hash("A")=65 → slot 1`, `hash("R")=82 → slot 2`, `hash("C")=67 → slot 3` — **a real collision with `S`** — `hash("H")=72 → slot 0`.

Walking the chain at slot 3 by hand, the way `CHAINED-HASH-INSERT`/`put()` actually build it (both books prepend new nodes to the front of the list):

```
insert S:  slot 3 -> [S]
...
insert C:  slot 3 already holds S -> C is prepended -> slot 3 -> [C -> S]
```

A `get("S")` after this still succeeds — the chain at slot 3 is walked (`C`, then `S`) until the key matches — it just costs one extra compare than it would have if C had landed anywhere else. That extra compare *is* the load-factor cost: this table has α = 6/8 = 0.75, so on average every lookup pays for about 0.75 extra comparisons beyond the fixed hash-and-index cost, matching Property L's ~N/M prediction almost exactly.

### Resizing keeps the load factor bounded — and it's O(1) amortized

Neither chaining nor open addressing works well if α drifts arbitrarily high (chaining) or approaches 1 (open addressing must never reach it). Both books use the same fix: **dynamic resizing** — when `N` grows past a threshold (Sedgewick & Wayne's `LinearProbingHashST.put()` doubles the table the moment `N >= M/2`), allocate a bigger table and rehash every key into it. This keeps α bounded within a constant range no matter how many keys arrive.

Rehashing the whole table is an expensive O(M) operation whenever it happens — but it happens rarely enough (each doubling roughly doubles the "budget" before the next one is needed) that the *cost per insertion, averaged over a long sequence of insertions*, is still O(1). Sedgewick & Wayne state this formally as Proposition N: "any sequence of t search, insert, and delete operations is executed in expected time proportional to t." The technique behind that claim — spreading an occasional expensive resize over many cheap operations to get a constant bound per operation — is **amortized analysis**, a general algorithmic-analysis tool covered in its own right elsewhere; the resizing principle here is the same one this section leans on without re-deriving it.

## Trade-offs

- **Chaining degrades gracefully; open addressing does not.** A chaining table with α = 5 is just slower (average chain length 5), still correct. An open-addressing table cannot even accept an insert once it's completely full, and gets sharply slower well before that — Sedgewick & Wayne's numbers (2.5 probes at α=3/4 vs. 32.5 at α=7/8) show the cliff is steep, not gradual.
- **Deletion is cheap with chaining, genuinely awkward with open addressing.** Chaining deletion is a normal linked-list removal. Open-addressing deletion needs tombstones (extra bookkeeping, permanent-until-resize slot loss) or Sedgewick & Wayne's reinsert-the-rest-of-the-cluster approach (extra work per delete) — never a plain `null`.
- **Memory shape differs.** Sedgewick & Wayne's own space table: chaining uses ~48N + 64M references; linear probing uses between ~32N and ~128N (two large parallel arrays, no per-node overhead). For huge tables this is a real systems-level tradeoff, not just an algorithmic one.
- **No fixed hash function is ever provably safe** — only a randomly-chosen-per-run function from a universal family closes the adversarial gap Cormen identifies; a single static `hashCode()` implementation, however well-tuned, is always theoretically attackable by an adversary who has seen its source.
- **Hashing gives up order.** Both books are explicit: once keys are hashed, any notion of "next largest key" or range query is gone — that's the tradeoff a BST-based ordered symbol table doesn't have to make.

## Documentation Links

- [Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 3.4 "Hash Tables," pp. 458-483](https://algs4.cs.princeton.edu/34hash/) — doc
- [Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 11 "Hash Tables," Sections 11.1-11.4, pp. 272-299](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
- [Object.hashCode() — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#hashCode()) — doc
- [Hash table — Wikipedia](https://en.wikipedia.org/wiki/Hash_table) — doc
