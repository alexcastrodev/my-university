---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the three number-theoretic algorithms that quietly run underneath every RSA key exchange and TLS handshake: Euclid's algorithm for the greatest common divisor, its "extended" variant for computing modular multiplicative inverses, and modular exponentiation by repeated squaring — plus the modular-arithmetic rules that make all three practical on numbers with hundreds of digits.

## Use Cases

- Implementing or reviewing any RSA-style key generation step, where the private exponent is computed as the modular inverse of the public exponent — via the extended Euclidean algorithm — and knowing why that step is fast rather than a brute-force search.
- Recognizing `a.modPow(b, n)` (Java's `BigInteger` method) or any "fast exponentiation" / "binary exponentiation" helper in a codebase as an implementation of the same repeated-squaring recursion, so a naive `for` loop of `b` multiplications doesn't get proposed as a "simpler" replacement.
- Explaining why cryptographic and hashing code reduces intermediate values `mod n` at every step instead of computing a huge exact result first — the congruence properties of modular arithmetic guarantee that's safe, and it's the only way to keep numbers from overflowing during a computation that would otherwise produce a result thousands of bits long.

## Deep Dive

### Euclid's algorithm: gcd via `gcd(a, b) = gcd(b, a mod b)`

Euclid's algorithm (Cormen's `EUCLID`, going back to Euclid's *Elements*, circa 300 B.C.E.) computes the greatest common divisor with a two-line recursion:

```java
static long gcd(long a, long b) {
    return b == 0 ? a : gcd(b, a % b);
}
```

It works because of one non-obvious fact — Cormen's GCD recursion theorem:

> For any nonnegative integer `a` and any positive integer `b`, `gcd(a, b) = gcd(b, a mod b)`.

The justification is short: write `a mod b = a - q·b` where `q = ⌊a/b⌋`. Since `a mod b` is a linear combination of `a` and `b`, any common divisor of `a` and `b` also divides `a mod b` — so it's a common divisor of `b` and `a mod b` too. Symmetrically, since `a = q·b + (a mod b)`, any common divisor of `b` and `a mod b` also divides `a`. The two pairs `{a, b}` and `{b, a mod b}` therefore have *exactly the same set of common divisors*, so their greatest common divisors are equal. The base case `gcd(a, 0) = a` is immediate. Because the second argument strictly decreases (and stays nonnegative) on every call, the recursion always terminates with the correct answer.

For example, `gcd(30, 21)` unwinds as `gcd(30,21) = gcd(21,9) = gcd(9,3) = gcd(3,0) = 3` — three recursive calls.

This is dramatically faster than the naive approach of testing every integer up to `min(a, b)` as a candidate divisor, which is `O(min(a, b))`. Cormen proves (Lamé's theorem, Theorem 31.11) that the number of recursive calls `EUCLID(a, b)` makes is `O(log b)`, and by extension `O(log(min(a, b)))` — a call on two β-bit numbers performs `O(β)` arithmetic operations. The proof runs through the Fibonacci numbers: Cormen shows that if `EUCLID(a, b)` makes `k` recursive calls, then `a ≥ F_{k+2}` and `b ≥ F_{k+1}`, and — crucially — that this bound is *tight*: the call `EUCLID(F_{k+1}, F_k)` on two **consecutive Fibonacci numbers** makes exactly `k - 1` recursive calls, matching the upper bound exactly. Consecutive Fibonacci numbers are therefore the genuine worst-case input for Euclid's algorithm for their size — not just a folklore claim, but the case Cormen's own tightness proof constructs.

### The extended Euclidean algorithm and modular inverses

Rewriting Euclid's algorithm to also track two integer coefficients gives you more than the gcd — it gives you **Bezout's identity**:

> For any nonnegative integers `a` and `b`, there exist integers `x` and `y` such that `d = gcd(a, b) = a·x + b·y`.

Cormen's `EXTENDED-EUCLID` computes the triple `(d, x, y)` directly, by unwinding the recursion one level and rewriting the inner solution in terms of the outer inputs:

```java
record Bezout(long d, long x, long y) {}

static Bezout extendedGcd(long a, long b) {
    if (b == 0) {
        return new Bezout(a, 1, 0);
    }
    Bezout inner = extendedGcd(b, a % b);          // d = b*x' + (a mod b)*y'
    long q = a / b;
    return new Bezout(inner.d(), inner.y(), inner.x() - q * inner.y());
}
```

Tracing `extendedGcd(99, 78)` (Cormen's own worked example) level by level:

| a | b | ⌊a/b⌋ | d | x | y |
|---|---|-------|---|-----|-----|
| 99 | 78 | 1 | 3 | -11 | 14 |
| 78 | 21 | 3 | 3 | 3 | -11 |
| 21 | 15 | 1 | 3 | -2 | 3 |
| 15 | 6 | 2 | 3 | 1 | -2 |
| 6 | 3 | 2 | 3 | 0 | 1 |
| 3 | 0 | — | 3 | 1 | 0 |

The top row is the final answer: `extendedGcd(99, 78) = (3, -11, 14)`, and indeed `99×(-11) + 78×14 = -1089 + 1092 = 3`. Since `EXTENDED-EUCLID` makes exactly as many recursive calls as plain `EUCLID`, it has the same `O(log(min(a,b)))` running time — Bezout's coefficients come essentially for free.

This is the tool that makes **modular multiplicative inverses** computable. If `gcd(a, n) = 1`, Bezout's identity gives `a·x + n·y = 1`, which read modulo `n` is `a·x ≡ 1 (mod n)` — exactly the definition of `x` being `a`'s multiplicative inverse mod `n`. For example, `extendedGcd(5, 11)` returns `(1, -2, 1)`, so `5×(-2) + 11×1 = 1`, and reducing `-2` into `[0, n)` gives `5⁻¹ mod 11 = 9` (check: `5×9 = 45 = 4×11 + 1`). This is *the* real, practically important use of the extended algorithm: **RSA key generation** computes the private exponent as the modular inverse of the public exponent, mod `φ(n)`, using exactly this algorithm — not a search.

```java
static long modInverse(long a, long n) {
    Bezout b = extendedGcd(a, n);
    if (b.d() != 1) {
        throw new ArithmeticException(a + " has no inverse mod " + n);
    }
    return ((b.x() % n) + n) % n; // normalize into [0, n)
}
```

### Modular arithmetic and fast exponentiation by repeated squaring

Modular arithmetic behaves like ordinary "clock" arithmetic over the finite set `Z_n = {0, 1, ..., n-1}`: every result is replaced by its representative in that range. The reason cryptographic and hashing computations can work entirely inside this finite universe — rather than letting intermediate values grow to thousands of digits — is that congruence is preserved under addition and multiplication:

> If `a ≡ b (mod n)` and `c ≡ d (mod n)`, then `a + c ≡ b + d (mod n)` and `a·c ≡ b·d (mod n)`.

That single fact licenses reducing `mod n` after *every* intermediate step of a computation instead of only at the end — the final answer is identical either way, but the numbers involved never grow beyond `n²` in size. This is what keeps `long`/`BigInteger` arithmetic tractable for numbers with hundreds of digits.

**Modular exponentiation** — computing `aᵇ mod n` — is where this pays off most. Cormen's `MODULAR-EXPONENTIATION` exploits the recursive structure of exponentiation itself:

```
aᵇ = 1                if b == 0
aᵇ = (a^(b/2))²        if b > 0 and b is even
aᵇ = a · a^(b-1)       if b > 0 and b is odd
```

translated directly to Java, reducing mod `n` at every step:

```java
static long modPow(long a, long b, long n) {
    if (b == 0) {
        return 1;
    } else if (b % 2 == 0) {
        long d = modPow(a, b / 2, n);
        return (d * d) % n;
    } else {
        long d = modPow(a, b - 1, n);
        return (a * d) % n;
    }
}
```

The complexity contrast is the entire point. For a β-bit exponent `b`, there are between `β` and `2β - 1` recursive calls, so this runs in `O(β)` arithmetic operations (`O(β³)` bit operations, since multiplying two β-bit numbers costs `O(β²)` bit operations). The naive alternative — `b - 1` successive multiplications by `a` — is `O(b)` arithmetic operations, and since `b` is a β-bit number, `b` itself can be as large as `2^β - 1`. That's `O(2^β)`: **exponential** in the bit-length, versus repeated squaring's linear `O(β)`. For a 2048-bit RSA exponent, that's the difference between roughly 2,048 multiplications and roughly 2²⁰⁴⁸ of them — the naive approach is not just slower, it's physically uncomputable.

Cormen traces `MODULAR-EXPONENTIATION(7, 560, 561)` by hand; the recursion unwinds as follows (`d` is the value returned by the recursive subcall one level deeper; "returned" is what that row's call hands back to its caller):

| b (this call) | d (subcall's result) | returned |
|---|---|---|
| 560 | 67 | 1 |
| 280 | 166 | 67 |
| 140 | 298 | 166 |
| 70 | 241 | 298 |
| 35 | 355 | 241 |
| 34 | 160 | 355 |
| 17 | 103 | 160 |
| 16 | 526 | 103 |
| 8 | 157 | 526 |
| 4 | 49 | 157 |
| 2 | 7 | 49 |
| 1 | 1 | 7 |
| 0 | — | 1 |

Reading from the bottom up (the actual order of execution — deepest call first): `modPow(7, 0, 561) = 1`, then squaring/multiplying back up through each level, until the outermost call `modPow(7, 560, 561)` returns `1`. Thirteen recursive calls total for a 10-bit exponent — consistent with the `O(β)` bound — versus 559 multiplications for the naive approach.

### The practical payoff: RSA and Diffie-Hellman

None of this is academic. **RSA** encryption and decryption *are*, computationally, a single call to modular exponentiation — encrypting a message `m` under public key `(e, n)` computes `mᵉ mod n`, and decrypting computes `c^d mod n`; both are exactly the `MODULAR-EXPONENTIATION` recursion above, with `e`, `d`, and `n` hundreds or thousands of bits long. **Diffie-Hellman key exchange** computes shared secrets the same way — each party raises a large public base to their own secret exponent, mod a large prime, and repeated squaring is what makes that instant instead of astronomically slow. On the key-generation side, RSA computes the private exponent `d` as the modular inverse of the public exponent `e` mod `φ(n)` — precisely the extended Euclidean algorithm's job. These three algorithms, not some more exotic machinery, are the actual arithmetic engine underneath both protocols.

## Trade-offs

- **`long` overflows long before real cryptographic sizes are reached** — RSA moduli are 2048+ bits, far past `long`'s 64 bits. The recursive Java above is correct and pedagogically exact, but production code uses `java.math.BigInteger`, whose own `modPow` method implements this same repeated-squaring algorithm (with further optimizations like Montgomery reduction) over arbitrary-precision integers.
- **Extended Euclid's `(x, y)` are *a* solution to Bezout's identity, not *the* canonical one** — they can be negative, and aren't unique (any `x + k·(n/d)`, `y - k·(a/d)` pair also works). Always normalize a computed inverse into `[0, n)` with `((x % n) + n) % n` before using it — passing around a raw negative "inverse" is a common, silent bug.
- **The clean recursive translation of `MODULAR-EXPONENTIATION` still costs a stack frame per level** — asymptotically optimal at `O(β)` multiplications, but real implementations (including `BigInteger.modPow` and OpenSSL) use an iterative left-to-right or right-to-left bit-scan instead of recursion, avoiding call overhead for exponents that may be thousands of bits long.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, "Introduction to Algorithms", 4th Edition (MIT Press, 2022) — Chapter 31 "Number-Theoretic Algorithms", Sections 31.2 "Greatest common divisor", 31.3 "Modular arithmetic", and the repeated-squaring portion of 31.6 "Powers of an element", pp. 911-924, 932-936 — book
- [Java Platform SE — `BigInteger.modPow(BigInteger, BigInteger)`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigInteger.html#modPow(java.math.BigInteger,java.math.BigInteger)) — doc
