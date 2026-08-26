---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

Understand Huffman coding — the greedy algorithm that builds an optimal *prefix-free* binary code for a set of characters from their frequencies, merging the two least-frequent symbols bottom-up with a min-priority queue until a single trie remains — and why that greedy trie-building process is provably optimal, not just a good heuristic.

## Use Cases

- Compacting a data file by giving frequent characters short binary codewords and infrequent characters long ones, instead of spending the same fixed number of bits on every character.
- General-purpose lossless compression of *any* bytestream (text, genomic data, bitmaps) — Sedgewick and Wayne note it is effective well beyond natural-language files because it only depends on the frequency distribution of the input's byte values, not on what those bytes mean.
- As one clear worked example (alongside activity-selection) of proving a greedy algorithm correct via the greedy-choice property and optimal substructure, rather than trusting the "seems right" intuition — Huffman's algorithm needs both an exchange-argument proof (Lemma 15.2) and an optimal-substructure argument (Lemma 15.3) before it can be trusted.

## Deep Dive

### Prefix-free codes: why "no codeword is a prefix of another" matters

Cormen, Leiserson, Rivest, and Stein's running example: a 100,000-character file over a 6-character alphabet `a–f`, with frequencies (in thousands) `a:45 b:13 c:12 d:16 e:9 f:5`. A fixed-length code needs `⌈lg 6⌉ = 3` bits per character (`a=000, b=001, c=010, d=011, e=100, f=101`), costing `300,000` bits total. A variable-length code that gives short codewords to frequent characters and long codewords to rare ones — `a=0, b=101, c=100, d=111, e=1101, f=1100` — costs only

```
(45·1 + 13·3 + 12·3 + 16·3 + 9·4 + 5·4) · 1,000 = 224,000 bits
```

a savings of about 25%, and (per Cormen) this is in fact the optimal character code for this file.

A code with this property — no codeword is a prefix of any other codeword — is called **prefix-free**. Sedgewick and Wayne motivate the same idea from the decoding side: encode `A B R A C A D A B R A !` by assigning `A=0, B=1, R=00, C=01, D=10, !=11`. Dropping the delimiting blanks, `0` (A's code) is a prefix of `00` (R's code), so the bitstring `01000010100100011` can be decoded as `C R R D D C R C B` or several other strings — it is genuinely ambiguous. Switch to a prefix-free assignment instead — `A=0, B=11111, C=110, D=100, R=1110, !=101` — and the 30-bit string `011111110011001000111111100101` decodes only one way: `A B R A C A D A B R A !`. No delimiters are ever needed, because the codeword that begins an encoded file is always unambiguous: identify it, translate it, and repeat on the remainder. Cormen's own decoding example works the same way — the string `100011001101` parses uniquely as `100 · 0 · 1100 · 1101`, decoding to `cafe`.

A binary tree whose leaves are the characters represents a prefix-free code directly: interpret a character's codeword as the root-to-leaf path, `0` for "go left" and `1` for "go right." An optimal code's tree is always a *full* binary tree (every non-leaf has exactly two children) — a tree with `|C|` leaves has exactly `|C| - 1` internal nodes. For a tree `T`, the number of bits needed to encode the file is its cost

```
B(T) = Σ (c.freq · dT(c))   over all characters c
```

where `dT(c)` is the depth of `c`'s leaf — also the length of `c`'s codeword.

### The trie in code: building it, encoding with it, decoding with it (Sedgewick)

Sedgewick and Wayne represent the code as a trie, using this node type (`freq` drives construction; `ch` is meaningful only at leaves):

```java
private static class Node implements Comparable<Node>
{ // Huffman trie node
   private char ch;   // unused for internal nodes
   private int freq; // unused for expand
   private final Node left, right;

    Node(char ch, int freq, Node left, Node right)
    {
       this.ch    = ch;
       this.freq = freq;
       this.left = left;
       this.right = right;
    }
    public boolean isLeaf()
    { return left == null && right == null; }
    public int compareTo(Node that)
    { return this.freq - that.freq; }
}
```

Building the coding table from a finished trie is a simple recursive walk, appending `'0'` going left and `'1'` going right until a leaf is reached:

```java
private static void buildCode(String[] st, Node x, String s)
{ // Make a lookup table from trie (recursive).
   if (x.isLeaf())
   { st[x.ch] = s; return; }
   buildCode(st, x.left, s + '0');
   buildCode(st, x.right, s + '1');
}
```

Expansion (decoding) is symmetric and needs no lookup table at all — just walk the trie bit by bit from the root, moving right on a `1` bit and left on a `0` bit, and output the character whenever a leaf is reached, then restart at the root:

```java
Node x = root;
while (!x.isLeaf())
    if (BinaryStdIn.readBoolean()) x = x.right;
    else x = x.left;
BinaryStdOut.write(x.ch);
```

Sedgewick and Wayne call this simplicity of expansion "one reason for the popularity of prefix-free codes in general and Huffman compression in particular."

### Huffman's greedy algorithm: merging the two least-frequent nodes with a min-priority queue

Huffman's algorithm builds the trie bottom-up: start with `|C|` leaves (one per character), and repeatedly extract the two lowest-frequency nodes from a min-priority queue, merge them under a new internal node whose frequency is their sum, and reinsert that node — until one node (the root) remains. Cormen's pseudocode:

```
HUFFMAN(C)
 1  n = |C|
 2  Q = C
 3  for i = 1 to n - 1
 4      allocate a new node z
 5      x = EXTRACT-MIN(Q)
 6      y = EXTRACT-MIN(Q)
 7      z.left = x
 8      z.right = y
 9      z.freq = x.freq + y.freq
10      INSERT(Q, z)
11  return EXTRACT-MIN(Q)   // the root of the tree is the only node left
```

Sedgewick and Wayne's `buildTrie()` is the same algorithm using a `MinPQ<Node>` (ordered by `compareTo`, i.e. by `freq`):

```java
private static Node buildTrie(int[] freq)
{
    // Initialize priority queue with singleton trees.
    MinPQ<Node> pq = new MinPQ<Node>();
    for (char c = 0; c < R; c++)
       if (freq[c] > 0)
          pq.insert(new Node(c, freq[c], null, null));

    while (pq.size() > 1)
    { // Merge two smallest trees.
       Node x = pq.delMin();
       Node y = pq.delMin();
       Node parent = new Node('\0', x.freq + y.freq, x, y);
       pq.insert(parent);
    }
    return pq.delMin();
}
```

With `Q` implemented as a binary min-heap (see the binary-heaps-and-heapsort concept), `BUILD-MIN-HEAP` initializes `Q` in `O(n)`, and each of the `n - 1` loop iterations does `O(1)` heap operations at `O(lg n)` each, so `HUFFMAN` runs in `O(n lg n)` total on `n` characters.

Working through Cormen's `a:45 b:13 c:12 d:16 e:9 f:5` example, the five merges (each step combining the two lowest-frequency nodes currently in the queue) are: `f:5 + e:9 = 14`, then `c:12 + b:13 = 25`, then `14 + d:16 = 30`, then `25 + 30 = 55`, then `a:45 + 55 = 100`. The resulting tree is exactly the optimal tree from Figure 15.5(b), giving codewords `a=0, b=101, c=100, d=111, e=1101, f=1100`:

```viz
type: tree
insert root 100 | Root — total frequency 100 (all 100,000 characters, in thousands). Formed by the final merge.
insert a a:45 parent=root side=left | Merged last (a:45 + 55 = 100) -- shortest codeword, "0".
insert r55 55 parent=root side=right | Merges the 25-node and the 30-node (55 = 25 + 30).
insert r25 25 parent=r55 side=left | Merges c and b (25 = c:12 + b:13).
insert r30 30 parent=r55 side=right | Merges the 14-node and d (30 = 14 + d:16).
insert c c:12 parent=r25 side=left | Codeword "100".
insert b b:13 parent=r25 side=right | Codeword "101".
insert r14 14 parent=r30 side=left | The very first merge -- f and e are the two lowest-frequency leaves (14 = f:5 + e:9).
insert d d:16 parent=r30 side=right | Codeword "111".
insert f f:5 parent=r14 side=left | Codeword "1100" -- longest codeword, tied with e.
insert e e:9 parent=r14 side=right | Codeword "1101".
```

### Proving optimality: greedy-choice property, optimal substructure, and an inductive proof

Cormen splits the correctness proof into two lemmas. **Lemma 15.2 (greedy-choice property)**: if `x` and `y` are the two lowest-frequency characters in `C`, there is an optimal prefix-free code in which `x` and `y` are sibling leaves of the same, maximum depth. The proof is an exchange argument: take any optimal tree `T`, let `a` and `b` be its two sibling leaves of maximum depth, and swap `x` into `a`'s position and `y` into `b`'s position. Each swap cannot increase cost — `(a.freq - x.freq)(dT(a) - dT(x)) ≥ 0` because `x` has minimum frequency and `a` has maximum depth — so the resulting tree `T''` is still optimal, and now has `x` and `y` as sibling leaves.

**Lemma 15.3 (optimal substructure)**: let `C'` be `C` with `x` and `y` replaced by a single merged character `z` (`z.freq = x.freq + y.freq`), and let `T'` be an optimal tree for `C'`. Then the tree `T` obtained by expanding `z` back into an internal node with children `x` and `y` is optimal for `C`. This follows because `B(T) = B(T') + x.freq + y.freq` — merging/unmerging a pair of sibling leaves changes the total cost by exactly the fixed amount `x.freq + y.freq`, so an optimal `T'` cannot fail to produce an optimal `T`. **Theorem 15.4**, that `HUFFMAN` produces an optimal prefix-free code, follows immediately from the two lemmas.

Sedgewick and Wayne give the same result as an induction (**Proposition U**), on the number of symbols `r`: assuming Huffman's algorithm is optimal for fewer than `r` symbols, let `(si, fi)` and `(sj, fj)` be the first two symbols merged into `(s*, fi + fj)` at depth `d`. Because merging changes weighted path length by exactly `fi + fj` regardless of which optimal tree it's done in (`W(TH) = W(TH*) + (fi + fj)` and `W(T) = W(T*) + (fi + fj)`), and `TH*` is optimal by the inductive hypothesis, it follows that `W(TH) ≤ W(T)` for any tree `T` — so `TH` is optimal. This rests on **Proposition T**: for any prefix-free code, the length of the encoded bitstring equals the tree's *weighted external path length* — frequency times depth, summed over all leaves. Sedgewick and Wayne verify this directly on the `it was the best of times it was the worst of times` example: one leaf at distance 2 (`SP`, frequency 11), three at distance 3 (`e s t`, total frequency 19), three at distance 4 (`w o i`, total frequency 10), five at distance 5 (`r f h m a`, total frequency 9), two at distance 6 (`LF b`, total frequency 2):

```
2·11 + 3·19 + 4·10 + 5·9 + 6·2 = 176 bits
```

exactly the length of the Huffman-encoded bitstring for that input.

### Compression ratios in practice

Because a compressed file cannot be decoded without the trie, Sedgewick and Wayne write the trie itself onto the bitstream (a preorder traversal: `0` for an internal node, `1` followed by the 8-bit character for a leaf), which the decoder reads back with a matching recursive `readTrie()`. That overhead matters most on small inputs:

- `ABRACADABRA!` (12 characters, 96 bits as 8-bit ASCII): the Huffman-compressed output is **120 bits** — a compression *ratio of 125%*, i.e. larger than the original, because 59 bits go to encoding the trie and 32 bits to the character count.
- `it was the best of times it was the worst of times` (51 characters, 408 bits as 8-bit ASCII): compressed to **352 bits**, ratio 86%, even after 137 bits of trie and 32 bits of count.
- A virus genome file (50,000 bits): Huffman compression uses 12,576 bits, just 40 bits more than a custom fixed 2-bit code (12,536 bits) — because the four genomic letters occur with nearly equal frequency, Huffman's trie ends up balanced and effectively rediscovers the 2-bit code on its own.
- A bitmap (1,536 bits): Huffman uses 816 bits versus 1,144 bits for run-length encoding, 29% fewer bits; on a higher-resolution bitmap (6,144 bits) the gap narrows to 11% (2,032 vs. 2,296 bits).
- The entire text of *Tale of Two Cities* (5,812,552 bits): compresses to 3,043,928 bits, a ratio of 52%.

## Trade-offs

- **Prefix-free doesn't happen by accident.** Assigning the shortest codewords to the most frequent characters is not automatically prefix-free — Sedgewick and Wayne's naive attempt (`A=0, R=00, ...`) fails because `0` is a prefix of `00`, making the encoded bitstring genuinely ambiguous without delimiters. Only an explicit trie construction, where every character sits at a leaf, guarantees the property.
- **Two-pass, not streaming.** Building the trie requires knowing every character's frequency in advance, so the input must be read once to tabulate frequencies and a second time to compress — Sedgewick and Wayne call this out explicitly: "Huffman encoding is a two-pass algorithm."
- **The code has to be paid for too.** A Huffman-compressed file must also carry its own trie, or it can't be decoded. For small inputs that overhead can outweigh the savings entirely — `ABRACADABRA!` compresses to 125% of its original size — while for large inputs (*Tale of Two Cities*, 52%) the trie's fixed cost is amortized away. The real savings figure is only accurate once the trie's encoding cost is counted alongside the compressed bitstring.
- **Optimal, but not unique.** Huffman's method doesn't specify how to break ties between nodes of equal frequency, nor which merged child goes left versus right; Cormen notes that swapping a node's children "yields a different code of the same cost." Different implementations can produce different Huffman codes for the same input, all equally optimal in total bit count.
- **"Optimal prefix-free code" is a narrower guarantee than "best possible compression."** On the genomic-data example, Huffman needs 40 more bits than a hand-built fixed 2-bit code, because Huffman's guarantee only covers prefix-free codes built with its own self-describing trie overhead — a domain-specific fixed scheme that doesn't need to transmit any code description at all can still edge it out.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 15.3 "Huffman codes", pp. 431-439](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
- [Robert Sedgewick, Kevin Wayne — Algorithms, 4th Edition, Section 5.5 "Data Compression" (Huffman coding), pp. 826-839](https://algs4.cs.princeton.edu/55compression/) — doc
- [java.util.zip.Deflater — Java's DEFLATE-based compressor, which uses Huffman coding as one of its two internal compression stages (alongside LZ77 duplicate-string elimination)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/zip/Deflater.html) — doc
