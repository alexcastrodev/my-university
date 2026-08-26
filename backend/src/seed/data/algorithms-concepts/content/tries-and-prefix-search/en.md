---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the trie (retrieval tree): a symbol-table structure built specifically for string keys, where a key is represented implicitly by the *path* from the root to a node — never stored explicitly anywhere — and why that design makes trie search/insert cost depend only on the length of the key, not on how many keys are in the table.

## Use Cases

- Implementing prefix-based lookups — "give me every key starting with `pre`" or "what's the longest key that is a prefix of this query string" — operations a BST or hash table doesn't naturally support at all.
- Autocomplete/typeahead, spell-checkers, and IP routing tables (longest-prefix match), all of which are really `keysWithPrefix()` or `longestPrefixOf()` in disguise.
- Understanding the space/time trade-off that motivates the ternary search trie (TST) once the alphabet or key set gets large — the same trade-off that shows up any time a "wide but sparse" array gets replaced with an embedded search tree.

## Deep Dive

### The core idea: a key is a path, not a stored value

A trie node holds an array of `R` links (one slot per possible next character) plus a value, which is `null` unless a key actually ends at that node. Nothing in the structure stores a character or a string — the key only exists as the sequence of link choices you followed to get there. Insert `"cat"`, `"car"`, `"cup"`, and `"cats"` (in that order) into an initially empty trie:

```
insert("cat", 1); insert("car", 2); insert("cup", 3); insert("cats", 4);

root
 └── 'c' → node
             ├── 'a' → node
             │          ├── 't' → node [val=1]   ("cat")
             │          │           └── 's' → node [val=4]   ("cats")
             │          └── 'r' → node [val=2]   ("car")
             └── 'u' → node
                        └── 'p' → node [val=3]   ("cup")
```

Note the node reached by `'t'`: it has a non-null value (1, for `"cat"`) *and* a child link for `'s'` (continuing on to `"cats"`) — a single node can simultaneously be the end of one key and a waypoint toward another. All other links at every node (the other 253+ letters at the root, the 24 other letters under `'c'`, and so on) are null; real diagrams simply omit them.

Search and insert both just walk the key character by character, following (or creating) links:

```java
public class TrieST<Value> {
    private static final int R = 256; // extended-ASCII radix
    private Node root;

    private static class Node {
        private Object val;
        private Node[] next = new Node[R];
    }

    public Value get(String key) {
        Node x = get(root, key, 0);
        if (x == null) return null;
        return (Value) x.val;
    }

    private Node get(Node x, String key, int d) {
        if (x == null) return null;                 // fell off the trie -- miss
        if (d == key.length()) return x;             // consumed the whole key
        char c = key.charAt(d);
        return get(x.next[c], key, d + 1);
    }

    public void put(String key, Value val) {
        root = put(root, key, val, 0);
    }

    private Node put(Node x, String key, Value val, int d) {
        if (x == null) x = new Node();               // create nodes as needed
        if (d == key.length()) { x.val = val; return x; }
        char c = key.charAt(d);
        x.next[c] = put(x.next[c], key, val, d + 1);
        return x;
    }
}
```

`get` walks down one character at a time; if it consumes the whole key it returns the node it landed on (whose `val` may still be `null` — a search miss even though every character matched a link, e.g. searching `"ca"` above). `put` does the identical walk, creating a new `Node` wherever a link is missing, and sets the value on whichever node corresponds to the last character.

### Why search time depends on key length, not key count

This is the trie's headline property, and it is exact, not asymptotic hand-waving: searching or inserting a key touches **at most `1 + key.length()` nodes**, full stop — regardless of how many other keys are in the trie. The recursive `d` parameter above starts at 0, advances one per call, and the recursion always stops at `d == key.length()`; nothing about that bound involves `N`, the number of keys stored.

Contrast that with a binary search tree (see the companion BST concept): every BST operation costs time proportional to the tree's *height*, and height is a function of `N` — `Θ(log N)` if the tree happens to be balanced, `Θ(N)` in the worst case. Even in the best case, a BST's cost genuinely grows as more keys are added. A trie's cost does not: a trie holding 10 seven-character keys and a trie holding 10 million seven-character keys both resolve `get("license")` in at most 8 node visits. The two structures are not just "both roughly logarithmic" — one bounds cost by key length, the other bounds cost by key count, and those are different variables.

(A related average-case fact worth knowing: an unsuccessful search in a trie built from `N` random keys over an alphabet of size `R` examines only about `log_R(N)` nodes on average, because a single missing link near the root usually ends the search immediately — search misses are typically even cheaper than the length bound suggests.)

### The space problem, and the ternary search trie (TST) fix

The R-way trie's weakness is space: every single node allocates an array of `R` links, even though for any real dataset almost all of those links are null (a node under `'q'` still reserves 256 slots to hold, realistically, one or two live links). The number of links in a trie built from `N` keys of average length `w` falls between `R·N` and `R·N·w` — for a large alphabet (say `R = 256` or Unicode's 65,536) and long keys (URLs, account numbers), that constant `R` factor dominates and can burn gigabytes of links for a modest key set.

The ternary search trie (TST) fixes this by giving each node just **three** links — `left`, `mid`, `right` — plus a character and a value, instead of an `R`-slot array. It's equivalent to replacing the R-way array at each trie position with a tiny embedded binary search tree over just the characters that actually occur there: compare the current key character to the node's character; go `left` if smaller, `right` if larger, or take `mid` (and advance to the next key character) on a match.

```java
public class TST<Value> {
    private Node root;

    private class Node {
        char c;                        // character at this node
        Node left, mid, right;         // smaller / equal / larger
        Value val;
    }

    public Value get(String key) {
        Node x = get(root, key, 0);
        return (x == null) ? null : x.val;
    }

    private Node get(Node x, String key, int d) {
        if (x == null) return null;
        char c = key.charAt(d);
        if      (c < x.c) return get(x.left, key, d);
        else if (c > x.c) return get(x.right, key, d);
        else if (d < key.length() - 1) return get(x.mid, key, d + 1);
        else return x;
    }

    public void put(String key, Value val) {
        root = put(root, key, val, 0);
    }

    private Node put(Node x, String key, Value val, int d) {
        char c = key.charAt(d);
        if (x == null) { x = new Node(); x.c = c; }
        if      (c < x.c) x.left  = put(x.left,  key, val, d);
        else if (c > x.c) x.right = put(x.right, key, val, d);
        else if (d < key.length() - 1) x.mid = put(x.mid, key, val, d + 1);
        else x.val = val;
        return x;
    }
}
```

The payoff: a TST built from `N` keys of average length `w` needs only `3N` to `3Nw` links — no `R` multiplier at all, so it scales with the number of *characters*, not with the size of the alphabet. The cost is a modest slowdown: because each "character step" now walks a small BST instead of a single array access, search picks up roughly a `ln R` multiplicative factor per character on average. For any alphabet large enough to make R-way trie space a real problem (ASCII, and especially Unicode), that's a good trade — dramatically less wasted memory for a search that's still, in practice, close to as fast.

### What tries (and TSTs) are good for that BSTs and hash tables aren't

A hash table gives fast exact-match lookup but destroys any relationship between similar keys — once hashed, `"shell"` and `"shells"` have nothing in common. A BST keeps keys ordered and supports range/floor/ceiling queries, but "all keys starting with this prefix" still means scanning a range with no structural shortcut tied to the prefix itself.

In a trie, a prefix *is* a subtrie: walking the trie along the characters of `prefix` lands you at exactly the node that roots the subtrie of every key beginning with `prefix` — nothing else needs comparing.

```java
public Iterable<String> keysWithPrefix(String prefix) {
    Queue<String> results = new LinkedList<>();
    Node x = get(root, prefix, 0);           // subtrie for every key starting with prefix
    collect(x, prefix, results);
    return results;
}

private void collect(Node x, String prefix, Queue<String> q) {
    if (x == null) return;
    if (x.val != null) q.add(prefix);
    for (char c = 0; c < R; c++)
        collect(x.next[c], prefix + c, q);
}
```

`longestPrefixOf(query)` is the mirror image: walk down along `query`'s characters, remembering the last depth at which a node had a non-null value, and stop at the first `null` link or the end of the string. This is exactly the shape of a spell-checker suggestion, an autocomplete dropdown, or an IP routing table's longest-prefix match — none of which a plain hash table or BST can express without an expensive full scan.

## Trade-offs

- **R-way tries are the fastest option, if you can afford the space.** Search and insert cost at most `1 + key.length()` array accesses no matter how many keys are stored — hard to beat — but every node pays for `R` links whether or not they're used, so this only makes sense for short keys and/or small alphabets.
- **TSTs trade a little time for a lot of space.** Replacing the R-slot array with 3 links per node turns `R·N·w` worst-case links into `3·N·w`, at the cost of an extra `ln R` factor per character compare — the right default once the alphabet is large or the keys are long (Unicode text, URLs).
- **A trie's shape is unique for a given key set, independent of insertion order** — unlike a BST (or a TST, whose per-node structure *is* an ordinary BST and therefore does depend on insertion order the same way a plain BST does).
- **Neither trie nor TST beats a hash table on raw exact-match throughput**, and that's not their job: you accept somewhat more per-lookup work in exchange for prefix operations (`keysWithPrefix`, `longestPrefixOf`) that hashing cannot support at all, because hashing deliberately discards any relationship between similar keys.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 5.2 "Tries", pp. 730-753 — book
- [Princeton Algorithms, 4th Ed. — Tries (companion site)](https://algs4.cs.princeton.edu/52trie/) — doc
