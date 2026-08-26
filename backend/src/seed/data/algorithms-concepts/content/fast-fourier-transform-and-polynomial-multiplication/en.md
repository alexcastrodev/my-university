---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Understand how two polynomials of degree-bound `n` can be multiplied in `Θ(n lg n)` time instead of the obvious `Θ(n²)`. The trick is not a cleverer way to multiply coefficients — it is a change of *representation*: polynomials in point-value form multiply in `Θ(n)` time, so the whole problem collapses to converting quickly between coefficient form and point-value form. CLRS shows that if the evaluation points are the complex roots of unity, that conversion is exactly the discrete Fourier transform (DFT) and its inverse, and the fast Fourier transform (FFT) computes both in `Θ(n lg n)` by a divide-and-conquer split into even-indexed and odd-indexed coefficients.

## Use Cases

- Multiplying two polynomials given in coefficient form, and computing convolutions — the coefficient vector `c` of the product is exactly the convolution `a ⊗ b` of the two input coefficient vectors. CLRS calls polynomial multiplication and convolution "fundamental computational problems of considerable practical importance", which is why the chapter concentrates on efficient algorithms for them.
- Evaluating a polynomial of degree-bound `n` at all `n` complex `n`th roots of unity at once, in `Θ(n lg n)` — versus `Θ(n²)` if you just call Horner's rule `n` times.
- Interpolating a polynomial back from `n` point-value pairs, when the points are the roots of unity: the inverse DFT does it in `Θ(n lg n)`, versus `O(n³)` for solving the Vandermonde linear system directly or `Θ(n²)` for Lagrange's formula.
- Hardware implementations: CLRS notes that many of the FFT's applications in signal processing require the utmost speed, so the FFT is often built as a circuit — and its divide-and-conquer structure gives a parallel circuit of depth only `Θ(lg n)`.

## Deep Dive

### Two representations of the same polynomial

A **coefficient representation** of a polynomial `A(x) = Σ_{j=0}^{n-1} a_j x^j` of degree-bound `n` is just the vector `a = (a0, a1, ..., a_{n-1})`. This form is convenient for some operations and terrible for others:

| operation | cost in coefficient form |
|---|---|
| evaluate `A(x0)` at one point (Horner's rule) | `Θ(n)` |
| add two polynomials (`c_j = a_j + b_j`) | `Θ(n)` |
| multiply two polynomials | `Θ(n²)` |

Evaluation at a single point is linear thanks to Horner's rule, which nests the multiplications:

```
A(x0) = a0 + x0*(a1 + x0*(a2 + ... + x0*(a_{n-2} + x0*(a_{n-1}))...))
```

Multiplication is the odd one out. The straightforward method multiplies each coefficient of `a` by each coefficient of `b`, so it costs `Θ(n²)`. The resulting coefficient vector `c` is also called the **convolution** of the input vectors, written `c = a ⊗ b`.

A **point-value representation** of a polynomial of degree-bound `n` is a set of `n` point-value pairs `{(x0, y0), (x1, y1), ..., (x_{n-1}, y_{n-1})}` where all the `x_k` are distinct and `y_k = A(x_k)`. A polynomial has many point-value representations, since any set of `n` distinct points can serve as the basis.

The two forms are genuinely equivalent — a polynomial in point-value form has a unique counterpart in coefficient form:

> **Theorem 30.1 (Uniqueness of an interpolating polynomial).** For any set of `n` point-value pairs with all `x_k` distinct, there is a unique polynomial `A(x)` of degree-bound `n` such that `y_k = A(x_k)` for all `k`.

The proof writes `y_k = A(x_k)` as the matrix equation `V(x0, ..., x_{n-1}) · a = y`, where `V` is the **Vandermonde matrix** whose row `k` is `(1, x_k, x_k², ..., x_k^{n-1})`. That matrix's determinant is the product of `(x_k - x_j)` over all `j < k`, so it is nonzero — the matrix is invertible — exactly when the `x_k` are distinct, and `a = V^{-1} y` recovers the coefficients uniquely.

So *evaluation* (coefficient form → point-value form) and *interpolation* (point-value form → coefficient form) are well-defined inverse operations. The obvious algorithms for both are quadratic or worse: Horner's rule at `n` points is `Θ(n²)`; interpolation by solving the Vandermonde system is `O(n³)` (Section 28.1) and by Lagrange's formula is `Θ(n²)` (Exercise 30.1-5).

### Why point-value form makes multiplication trivial — and the degree-bound catch

In point-value form, both addition and multiplication are pointwise, provided both polynomials are evaluated at the *same* points. If `C(x) = A(x)·B(x)`, then `C(x_k) = A(x_k)·B(x_k)` for every point `x_k`, so multiplying is just `n` scalar multiplications: `Θ(n)`.

There is one catch. `degree(C) = degree(A) + degree(B)`, so if `A` and `B` have degree-bound `n`, then `C` has degree-bound `2n` — and `2n` point-value pairs are needed to pin down a unique polynomial of degree-bound `2n`, not `n` (Exercise 30.1-4). The fix is to work with **extended** point-value representations of `2n` pairs each for `A` and `B` from the start, obtained by first padding both coefficient vectors with `n` high-order zero coefficients.

### The strategy: evaluate, multiply pointwise, interpolate

The `Θ(n)` multiplication in point-value form only pays off if converting between representations is cheap. Any points can serve as evaluation points, but certain points allow conversion in only `Θ(n lg n)` time — the complex roots of unity, where evaluation *is* the DFT and interpolation *is* the inverse DFT. That gives the four-step algorithm (assuming `n` is an exact power of 2; if not, pad with high-order zero coefficients):

1. **Double degree-bound** — create coefficient representations of `A(x)` and `B(x)` as degree-bound `2n` polynomials by adding `n` high-order zero coefficients to each. `Θ(n)`
2. **Evaluate** — compute point-value representations of length `2n` by applying the FFT of order `2n` to each, giving the values of both polynomials at the `(2n)`th roots of unity. `Θ(n lg n)`
3. **Pointwise multiply** — multiply the two value vectors componentwise to get a point-value representation of `C(x) = A(x)B(x)` at each `(2n)`th root of unity. `Θ(n)`
4. **Interpolate** — apply the FFT to the `2n` point-value pairs to compute the inverse DFT, producing the coefficient representation of `C(x)`. `Θ(n lg n)`

> **Theorem 30.2.** Two polynomials of degree-bound `n`, with both input and output representations in coefficient form, can be multiplied in `Θ(n lg n)` time.

### Complex roots of unity: the three properties that make it work

A complex `n`th root of unity is a complex number `ω` with `ω^n = 1`. There are exactly `n` of them, `e^(2πik/n)` for `k = 0, 1, ..., n-1`, interpreted through `e^(iu) = cos(u) + i·sin(u)`. They sit equally spaced around the unit circle in the complex plane. The value

```
ω_n = e^(2πi/n)
```

is the **principal `n`th root of unity**; all the others are powers of it, so the `n` roots are `ω_n^0, ω_n^1, ..., ω_n^{n-1}`. (CLRS notes that many authors instead define `ω_n = e^(-2πi/n)`, the convention typically used for signal-processing applications; the underlying mathematics is substantially the same either way. Every formula here uses the book's `e^(2πi/n)`.) They form a group under multiplication with the same structure as the additive group of integers modulo `n`: `ω_n^j · ω_n^k = ω_n^{(j+k) mod n}`, and `ω_n^{-1} = ω_n^{n-1}`.

Three lemmas carry the whole algorithm:

- **Cancellation lemma (30.3).** For integers `n > 0`, `k ≥ 0`, `d > 0`: `ω_{dn}^{dk} = ω_n^k`. It follows directly from the definition, since `(e^(2πi/dn))^{dk} = (e^(2πi/n))^k`.
- **Corollary 30.4.** For any even `n > 0`: `ω_n^{n/2} = ω_2 = -1`. This is what makes each butterfly's second output a *subtraction* rather than a separate multiplication — `ω_n^{k+n/2} = -ω_n^k`.
- **Halving lemma (30.5).** If `n > 0` is even, the squares of the `n` complex `n`th roots of unity are the `n/2` complex `(n/2)`th roots of unity, with each one occurring exactly twice — because `ω_n^k` and `ω_n^{k+n/2}` have the same square. CLRS calls this lemma essential to the divide-and-conquer approach: it is what guarantees the recursive subproblems are only *half* as large.
- **Summation lemma (30.6).** For any integer `n ≥ 1` and nonzero integer `k` not divisible by `n`, the sum `Σ_{j=0}^{n-1} (ω_n^k)^j = 0`. The geometric-series formula gives `((ω_n^k)^n - 1) / (ω_n^k - 1) = ((ω_n^n)^k - 1) / (ω_n^k - 1) = (1^k - 1) / (ω_n^k - 1) = 0`, and the denominator is nonzero precisely because `ω_n^k = 1` only when `k` is divisible by `n`. This lemma is what makes the inverse DFT matrix work out.

### The DFT and the FFT's even/odd split

Evaluating `A(x) = Σ a_j x^j` at the `n` complex `n`th roots of unity defines

```
y_k = A(ω_n^k) = Σ_{j=0}^{n-1} a_j · ω_n^{kj}     for k = 0, 1, ..., n-1
```

The vector `y = (y0, ..., y_{n-1})` is the **discrete Fourier transform** of `a`, written `y = DFT_n(a)`. Computed straight from that definition it costs `Θ(n²)`.

The FFT gets it to `Θ(n lg n)` by splitting `A` by coefficient *index parity* — even-indexed coefficients into one polynomial, odd-indexed into the other, each of degree-bound `n/2`:

```
A_even(x) = a0 + a2·x + a4·x² + ... + a_{n-2}·x^(n/2-1)
A_odd(x)  = a1 + a3·x + a5·x² + ... + a_{n-1}·x^(n/2-1)
```

which recombine as the key identity

```
A(x) = A_even(x²) + x · A_odd(x²)          (equation 30.9)
```

So evaluating `A` at `ω_n^0, ..., ω_n^{n-1}` reduces to (1) evaluating `A_even` and `A_odd` at the *squares* `(ω_n^0)², ..., (ω_n^{n-1})²`, then (2) combining with equation 30.9. And by the halving lemma, that list of squares is not `n` distinct values at all — it is the `n/2` complex `(n/2)`th roots of unity, each appearing twice. The subproblems therefore have exactly the same form as the original, at half the size: one `DFT_n` becomes two `DFT_{n/2}`s.

```java
// A complex number, since the FFT evaluates at complex roots of unity.
record Complex(double re, double im) {
    Complex plus(Complex o)  { return new Complex(re + o.re, im + o.im); }
    Complex minus(Complex o) { return new Complex(re - o.re, im - o.im); }
    Complex times(Complex o) { return new Complex(re * o.re - im * o.im, re * o.im + im * o.re); }
}

// FFT(a, n) — n must be an exact power of 2, and a.length == n.
static Complex[] fft(Complex[] a, int n) {
    if (n == 1) {
        return a;                       // the DFT of 1 element is the element itself
    }
    // ωn = e^(2πi/n) = cos(2π/n) + i·sin(2π/n), the principal nth root of unity
    Complex wn = new Complex(Math.cos(2 * Math.PI / n), Math.sin(2 * Math.PI / n));
    Complex w = new Complex(1, 0);      // running value of ωn^k, k = 0 at the start

    Complex[] aEven = new Complex[n / 2];
    Complex[] aOdd  = new Complex[n / 2];
    for (int j = 0; j < n / 2; j++) {
        aEven[j] = a[2 * j];             // (a0, a2, ..., a_{n-2})
        aOdd[j]  = a[2 * j + 1];         // (a1, a3, ..., a_{n-1})
    }
    Complex[] yEven = fft(aEven, n / 2); // conquer: two DFTs of half the size
    Complex[] yOdd  = fft(aOdd,  n / 2);

    Complex[] y = new Complex[n];
    for (int k = 0; k < n / 2; k++) {    // at this point, w == ωn^k
        Complex t = w.times(yOdd[k]);     // the twiddled term, computed once (a butterfly)
        y[k]         = yEven[k].plus(t);  // yk = y_even_k + ωn^k · y_odd_k
        y[k + n / 2] = yEven[k].minus(t); // y_{k+n/2}, using ωn^{k+n/2} = -ωn^k
        w = w.times(wn);                  // advance the running twiddle factor
    }
    return y;
}
```

The base case is the `n = 1` line: the DFT of one element is the element itself, since `y0 = a0·ω_1^0 = a0`. The combine loop is where equation 30.9 is applied. The recursive calls compute `y_even_k = A_even(ω_{n/2}^k)` and `y_odd_k = A_odd(ω_{n/2}^k)`, which by the cancellation lemma equal `A_even(ω_n^{2k})` and `A_odd(ω_n^{2k})`. So the first output line yields `y_k = A_even(ω_n^{2k}) + ω_n^k·A_odd(ω_n^{2k}) = A(ω_n^k)`, and the second yields `A(ω_n^{k+n/2})` — using `ω_n^{k+n/2} = -ω_n^k` and `ω_n^{2k+n} = ω_n^{2k}`. Because each factor `ω_n^k` appears in both its positive and negative forms, CLRS calls those factors **twiddle factors**.

Exclusive of the recursive calls, each invocation does `Θ(n)` work, so the recurrence is the familiar one:

```
T(n) = 2·T(n/2) + Θ(n) = Θ(n lg n)
```

by case 2 of the master theorem. Note the running-`w` optimization has a cost: CLRS points out that iteratively updating `ω` lets round-off errors accumulate, especially at larger sizes, and suggests directly precomputing a table of all `n/2` values of `ω_n^k` when several FFTs will run on inputs of the same size.

### Watch the divide step: the recursion tree for n = 8

Figure 30.5 arranges the input vectors of every recursive call into a tree — the initial call at the root, each node's two recursive calls as its left (even-indexed) and right (odd-indexed) children, down to 1-element leaves:

```viz
type: tree
insert r a0..a7 | The initial call, n = 8. Split by index parity, not by position.
insert e (a0,a2,a4,a6) parent=r side=left | Even-indexed coefficients — binary index ends in 0.
insert o (a1,a3,a5,a7) parent=r side=right | Odd-indexed coefficients — binary index ends in 1.
insert ee (a0,a4) parent=e side=left | Split again by parity of position within (a0,a2,a4,a6).
insert eo (a2,a6) parent=e side=right | The odd half of the even half.
insert oe (a1,a5) parent=o side=left | The even half of the odd half.
insert oo (a3,a7) parent=o side=right | The odd half of the odd half.
insert a0 (a0) parent=ee side=left | Base case: n = 1, the DFT of one element is itself.
insert a4 (a4) parent=ee side=right | Base case.
insert a2 (a2) parent=eo side=left | Base case.
insert a6 (a6) parent=eo side=right | Base case.
insert a1 (a1) parent=oe side=left | Base case.
insert a5 (a5) parent=oe side=right | Base case.
insert a3 (a3) parent=oo side=left | Base case.
insert a7 (a7) parent=oo side=right | Base case.
```

Read the leaves left to right and they come out in the order `0, 4, 2, 6, 1, 5, 3, 7` — in binary, `000, 100, 010, 110, 001, 101, 011, 111`, which is exactly the sequence `000, 001, 010, 011, 100, 101, 110, 111` with the bits of each index *reversed*. That ordering is the **bit-reversal permutation**: element `a_k` moves to position `rev(k)`, where `rev(k)` reverses the `lg n` bits of `k`. It falls out of the divide step directly — at the top level, indices whose low-order bit is 0 go left and whose low-order bit is 1 go right, and stripping off one more low-order bit at each level down produces the bit-reversed order at the leaves.

That matters because it means the recursion can be run *bottom-up*: start from the vector permuted into leaf order, combine adjacent pairs with one butterfly each to get `n/2` two-element DFTs, combine those in pairs to get `n/4` four-element DFTs, and so on until two `(n/2)`-element DFTs are combined into the final `n`-element DFT.

### A worked trace: the DFT of (0, 1, 2, 3)

Take `a = (0, 1, 2, 3)`, so `n = 4` and `ω_4 = e^(2πi/4) = i`. Trace `fft(a, 4)` by hand:

| step | computation | result |
|---|---|---|
| divide | `a_even = (a0, a2)`, `a_odd = (a1, a3)` | `(0, 2)` and `(1, 3)` |
| conquer left | `fft((0,2), 2)`: `ω_2 = -1`, so `y0 = 0 + 2`, `y1 = 0 - 2` | `y_even = (2, -2)` |
| conquer right | `fft((1,3), 2)`: `y0 = 1 + 3`, `y1 = 1 - 3` | `y_odd = (4, -2)` |
| combine `k = 0` | `w = ω_4^0 = 1`, `t = 1·4 = 4`; `y0 = 2 + 4`, `y2 = 2 - 4` | `y0 = 6`, `y2 = -2` |
| combine `k = 1` | `w = ω_4^1 = i`, `t = i·(-2) = -2i`; `y1 = -2 + (-2i)`, `y3 = -2 - (-2i)` | `y1 = -2 - 2i`, `y3 = -2 + 2i` |

So `DFT_4(0, 1, 2, 3) = (6, -2-2i, -2, -2+2i)`. Checking directly against the definition `y_k = Σ a_j ω_4^{kj}` with `ω_4 = i` confirms each entry — e.g. `y1 = 0 + 1·i + 2·i² + 3·i³ = i - 2 - 3i = -2 - 2i`. Six element-level operations at the two leaves' combines plus four in the top combine, instead of the 16 products the definition's double sum would take.

### Interpolation: the inverse DFT is the same algorithm, twice modified

Written as a matrix product, the DFT is `y = V_n · a`, where `V_n` is the Vandermonde matrix of powers of `ω_n`: its `(k, j)` entry is `ω_n^{kj}`, so the exponents form a multiplication table for the factors `0` through `n-1`. Interpolation is therefore `a = V_n^{-1} · y`, and the inverse has a strikingly simple closed form:

> **Theorem 30.7.** For `j, k = 0, 1, ..., n-1`, the `(j, k)` entry of `V_n^{-1}` is `ω_n^{-kj} / n`.

The proof shows `V_n^{-1} V_n = I_n` by computing the `(k', k)` entry as `Σ_{j=0}^{n-1} ω_n^{j(k'-k)} / n`, which is `1` when `k' = k` and `0` otherwise by the summation lemma — the lemma applies because `k' - k` lies strictly between `-(n-1)` and `n-1` and so is never a nonzero multiple of `n`. Written out:

```
a_j = (1/n) · Σ_{k=0}^{n-1} y_k · ω_n^{-kj}     for j = 0, 1, ..., n-1     (equation 30.11)
```

Compare that with the forward DFT `y_k = Σ_j a_j ω_n^{kj}` and the recipe for the inverse falls out: **switch the roles of `a` and `y`, replace `ω_n` by `ω_n^{-1}`, and divide each element of the result by `n`.** Nothing else about the FFT changes, so `DFT_n^{-1}` is also computable in `Θ(n lg n)`. (CLRS leaves writing that pseudocode as Exercise 30.2-4; the modification is exactly the three changes above.)

Putting the forward and inverse transforms together gives the chapter's headline result about convolution:

> **Theorem 30.8 (Convolution theorem).** For any two vectors `a` and `b` of length `n`, where `n` is an exact power of 2, `a ⊗ b = DFT_{2n}^{-1}(DFT_{2n}(a) · DFT_{2n}(b))`, where `a` and `b` are padded with 0s to length `2n` and `·` denotes the componentwise product of two `2n`-element vectors.

### End to end: multiplying (1 + 2x) by (3 + 4x)

Two degree-bound 2 polynomials, so pad both to length `2n = 4` and use `ω_4 = i`. The answer by hand is `(1 + 2x)(3 + 4x) = 3 + 10x + 8x²`; here is the same result through the four-step algorithm:

| step | from `A(x) = 1 + 2x` | from `B(x) = 3 + 4x` | combined |
|---|---|---|---|
| 1. double degree-bound | `a = (1, 2, 0, 0)` | `b = (3, 4, 0, 0)` | — |
| 2. evaluate at `ω_4^k = 1, i, -1, -i` | `(3, 1+2i, -1, 1-2i)` | `(7, 3+4i, -1, 3-4i)` | — |
| 3. pointwise multiply | — | — | `(21, -5+10i, 1, -5-10i)` |
| 4. inverse DFT, divide by 4 | — | — | `c = (3, 10, 8, 0)` |

Step 4 spelled out for one entry: `c0 = (21 + (-5+10i) + 1 + (-5-10i)) / 4 = 12 / 4 = 3`. The final coefficient vector `(3, 10, 8, 0)` reads back as `3 + 10x + 8x² + 0x³` — the correct product, and the trailing zero confirms the padded degree-bound 4 was more than enough room.

### FFT circuits: butterflies and Θ(lg n) depth

Section 30.3 recasts the same algorithm as hardware. Notice that the combine loop computes `ω_n^k · y_odd_k` twice — once for the sum, once for the difference — so a good optimizing compiler hoists it into a temporary, turning the two output lines into three:

```
t = ω · y_odd_k
y_k       = y_even_k + t
y_{k+n/2} = y_even_k - t
```

This — multiply the twiddle factor by `y_odd_k`, store it in `t`, then add and subtract `t` from `y_even_k` — is a **butterfly operation**, named for the shape of its circuit diagram. (CLRS jokes it could equally have been called a "bowtie" operation.) The Java code above already writes it in this hoisted form.

In circuit terms the divide-and-conquer structure reads as: **divide** the `n`-element input into its `n/2` even-indexed and `n/2` odd-indexed elements; **conquer** by recursively computing two DFTs of size `n/2`; **combine** with `n/2` butterfly operations using twiddle factors `ω_n^0, ω_n^1, ..., ω_n^{n/2-1}`. The base case `FFT_1` does nothing at all (one input wire equals one output wire), so the smallest nontrivial circuit is `FFT_2`: a single butterfly whose twiddle factor is `ω_2^0 = 1`.

The full circuit begins with the bit-reversal permutation of the inputs, then runs `lg n` stages, each stage consisting of `n/2` butterflies executed **in parallel** — the butterfly operations at a given level of recursion are independent of one another. For `s = 1, 2, ..., lg n`, stage `s` consists of `n/2^s` groups of butterflies with `2^{s-1}` butterflies per group, and its twiddle factors are `ω_m^0, ω_m^1, ..., ω_m^{m/2-1}` where `m = 2^s`. Assuming each butterfly has constant depth, the whole circuit has depth `Θ(lg n)` while still performing `Θ(n lg n)` butterfly operations in total.

## Trade-offs

- **The 4th edition dropped the iterative FFT — don't go looking for it here.** CLRS's preface states that the *iterative* FFT implementation was removed from the 4th edition and moved to the publisher's website; the printed Chapter 30 contains only the recursive divide-and-conquer `FFT` procedure plus the circuit view of Section 30.3. That is why this concept shows no iterative, in-place, bit-reversal-then-`lg n`-stages implementation: the material for it is in the text only as the *circuit* schema (Figures 30.4 and 30.6) and as Exercise 30.3-4, which asks the reader to write `BIT-REVERSE-PERMUTATION` themselves. The bottom-up reading of the recursion tree in the Deep Dive is the conceptual bridge, not a substitute for that removed code.
- **`Θ(n lg n)` only pays off past a crossover.** The FFT route replaces a single tight `Θ(n²)` double loop over integer or double coefficients with four phases involving complex arithmetic, padding, and two full transforms. Nothing in the chapter claims it is faster at small `n` — the asymptotic win is what is proven (Theorem 30.2), and the constant factors of complex multiply-add work against it until `n` is large enough.
- **`n` must be an exact power of 2.** The `FFT` procedure assumes it throughout, and the polynomial-multiplication procedure assumes it too, telling you to add high-order zero coefficients when it does not hold. CLRS states that strategies for handling sizes that are not exact powers of 2 are known but **beyond the scope of the book** — that is a genuine gap in this text, not an omission here.
- **Floating-point round-off is a real hazard, and largely unaddressed.** Two separate warnings appear. First, interpolation is described as "a notoriously tricky problem from the point of view of numerical stability": the approaches given are mathematically correct, but small differences in the inputs or round-off during computation can cause large differences in the result. Second, the running-`ω` update inside the combine loop accumulates round-off, especially at larger input sizes; several techniques to limit FFT round-off error have been proposed but are also beyond the book's scope. The one concrete mitigation offered is to precompute a table of all `n/2` values of `ω_n^k` when running several same-size FFTs.
- **Point-value form is not a universally better representation.** It makes addition and multiplication `Θ(n)`, but it is worse at other things. Evaluating a point-value polynomial at a *new* point has no better approach known than converting back to coefficient form first and then evaluating there. Polynomial *division* by dividing the corresponding `y` values is explicitly flagged as wrong (Exercise 30.1-6). And an extended representation of `2n` pairs must be chosen up front, before the multiplication, because `n` pairs cannot pin down the degree-bound `2n` product.
- **The choice of `ω_n` sign is a convention you have to keep straight.** This chapter uses `ω_n = e^(2πi/n)`; many other authors, particularly in signal processing, define `ω_n = e^(-2πi/n)`. CLRS says the underlying mathematics is substantially the same either way, but the transform values you compute will differ, so mixing sources without checking the convention will produce results that disagree entry by entry.

## Documentation Links

- [Introduction to Algorithms, 4th Edition](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Cormen, Leiserson, Rivest, Stein — Chapter 30 "Polynomials and the FFT", Sections 30.1-30.3, pp. 879-898 — doc
