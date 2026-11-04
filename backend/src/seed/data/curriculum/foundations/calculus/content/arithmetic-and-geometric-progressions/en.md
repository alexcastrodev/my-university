---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Recognize an arithmetic or geometric progression from a constant difference or a constant ratio, and write its $n$-th term.
- Derive and use the closed forms for the sum of the first $n$ terms of each, including the special case $r = 1$ and the correct count of terms.
- Decide the long-run behavior of $r^n$ for every real ratio $r$, and tie it to convergence of a sequence.
- Translate loops into sums: nested loops give arithmetic sums, halving and doubling give geometric ones.
- Use a geometric sum to explain the cost of a doubling array and of compound growth, and contrast them with their arithmetic counterparts.

## Context & Motivation

Among all sequences, two families have closed forms simple enough to handle exactly and common enough to appear in almost every cost analysis. In an **arithmetic progression** each term differs from the previous one by a fixed amount $d$. In a **geometric progression** each term is a fixed multiple $r$ of the previous one. The first describes linear growth, the second exponential growth, and the contrast between them is the contrast between a loop that does a little more work each pass and a process that multiplies its size.

In the previous lesson, `sequences-and-convergence`, you learned what it means for a sequence to settle down. A progression is the easiest place to practice that definition, since the answer is known in closed form. The sums of progressions are also where the sequence $(a_n)$ turns into a new sequence of partial sums, the idea that the next lesson, `infinite-series-and-partial-sums`, builds on. The data-structures lesson `dynamic-arrays-and-amortized-resizing` argues that doubling a full array keeps appends cheap on average and that adding a fixed amount does not. This lesson supplies the arithmetic behind both claims and checks them with an actual count.

## Core Theory

### Arithmetic progressions

A sequence with $a_{n+1} - a_n = d$ for every $n$ is an arithmetic progression with first term $a_1$ and common difference $d$. Its terms are

$$a_n = a_1 + (n-1)\,d$$

Its sum $S_n = a_1 + a_2 + \dots + a_n$ can be found by writing the sum twice, once forward and once backward, and adding the columns: every column adds to $a_1 + a_n$, and there are $n$ columns, so $2S_n = n(a_1 + a_n)$. Hence

$$S_n = \frac{n\,(a_1 + a_n)}{2} = \frac{n\,\bigl(2a_1 + (n-1)d\bigr)}{2}$$

The same formula can be proved by induction, as in `mathematical-induction`. The special case $a_1 = 1$, $d = 1$ gives $1 + 2 + \dots + n = n(n+1)/2$. For $d \neq 0$ the terms grow linearly in $n$ and the sums quadratically. If $d \neq 0$ the sequence $(a_n)$ diverges (it grows without bound, upward or downward), and if $d = 0$ it is constant.

### Geometric progressions

A sequence with $a_{n+1} = r\,a_n$ is a geometric progression with ratio $r$:

$$a_n = a_1\, r^{\,n-1}$$

For the sum, subtract $r S_n$ from $S_n$. Every term cancels except the first and the last, leaving $S_n(1 - r) = a_1(1 - r^n)$, so

$$S_n = a_1\,\frac{1 - r^n}{1 - r} \qquad (r \neq 1)$$

This formula divides by $1 - r$, so it does not apply when $r = 1$. In that case every term equals $a_1$ and $S_n = n\,a_1$. When the sum starts at the exponent $0$, as in $1 + r + \dots + r^n$, there are $n + 1$ terms and the formula reads $(1 - r^{n+1})/(1 - r)$. Counting terms wrongly is the most common error in applying it.

### What $r^n$ does

The behavior of the sequence $(r^n)$ is the whole story for convergence of geometric progressions:

- If $\lvert r \rvert < 1$, then $r^n \to 0$.
- If $r = 1$, the sequence is constant $1$.
- If $r = -1$, it alternates between $-1$ and $1$ and diverges.
- If $r > 1$, then $r^n \to \infty$. If $r < -1$, the terms alternate in sign and their size grows without bound, so it diverges.

To see the first case, note that $r = 0$ is immediate; for $r \neq 0$, write $\lvert r \rvert = 1/(1+h)$ with $h > 0$. Bernoulli's inequality gives $(1+h)^n \ge 1 + nh$, so $0 \le \lvert r \rvert^n \le 1/(1 + nh) \to 0$, and the squeeze theorem finishes the proof. Consequently a geometric progression $a_1 r^{n-1}$ converges exactly when $\lvert r \rvert < 1$ (to $0$) or $r = 1$ (to $a_1$), provided $a_1 \neq 0$. And when $\lvert r \rvert < 1$, the closed form shows the partial sums settling at $a_1/(1-r)$, since $r^n \to 0$ (the next lesson turns this into a theorem about infinite series).

### Loops, halving, and doubling

Counting the iterations of a program often means summing a progression. An inner loop whose bound grows by one each outer pass gives an arithmetic sum, hence $\Theta(n^2)$ in total. A quantity that is halved at each step, as in a loop `while n > 1: n //= 2`, runs $\lfloor \log_2 n \rfloor$ times, and in a recursion that does work proportional to its input size and then recurses on half of it, the successive amounts $n, n/2, n/4, \dots$ form a geometric progression. In a geometric sum with $r > 1$ the last term dominates: $1 + 2 + \dots + 2^{k-1} = 2^k - 1$ is less than twice the last term $2^{k-1}$. That fact is what makes doubling cheap.

## Worked Examples

### Example 1: arithmetic sums from loops

The loop `for i in range(n): for j in range(i): count += 1` runs the inner body $0 + 1 + \dots + (n-1) = n(n-1)/2$ times. Running it gives $45$ for $n = 10$, $4950$ for $n = 100$, and $499500$ for $n = 1000$, matching the formula each time. It is about half of $n^2$, yet still quadratic.

Now invert the question. For the progression $5, 8, 11, 14, \dots$ (so $a_1 = 5$, $d = 3$), find the smallest $n$ with $S_n > 1000$. Here $S_n = n(3n + 7)/2$, so we need $3n^2 + 7n - 2000 > 0$. The positive root is $(-7 + \sqrt{24049})/6 \approx 24.68$. Check the neighbors: $S_{24} = 948$ and $S_{25} = 1025$. The answer is $n = 25$, whose last term is $a_{25} = 77$.

### Example 2: geometric sums and the count of terms

For $3 + 6 + 12 + \dots$ with $10$ terms, $a_1 = 3$, $r = 2$:

$$S_{10} = 3\,\frac{1 - 2^{10}}{1 - 2} = 3 \cdot 1023 = 3069$$

For $1 + \tfrac12 + \tfrac14 + \dots$ with $10$ terms, $S_{10} = \dfrac{1 - 2^{-10}}{1 - 1/2} = 2 - 2^{-9} = 1.998046875$. Adding the ten terms directly gives the same number. The sum $1 + 2 + 4 + \dots + 2^9$ is $1023 = 2^{10} - 1$, the largest number that fits in ten bits, since every bit set to $1$ contributes one power of two. The exponents $0$ through $9$ make $10$ terms, not $9$.

### Example 3: counting the copies of a doubling array

Each append to a full array copies every stored element into a larger array. The script below counts only those copies, starting from capacity $1$, for two growth rules: doubling the capacity, and adding $16$ slots.

```python
def count_copies(n, grow):
    capacity, length, copies = 1, 0, 0
    for _ in range(n):
        if length == capacity:          # full: allocate a bigger array and copy
            copies += length
            capacity = grow(capacity)
        length += 1                     # the append itself (one write)
    return copies

for n in (10, 1_000, 10_000, 100_000, 1_000_000):
    dbl = count_copies(n, lambda c: 2 * c)
    inc = count_copies(n, lambda c: c + 16)
    print(f"{n:>9}  doubling: {dbl:>9} ({dbl / n:.2f} per append)   +16: {inc:>12} ({inc / n:.1f} per append)")
```

Its output:

```text
       10  doubling:        15 (1.50 per append)   +16:            1 (0.1 per append)
     1000  doubling:      1023 (1.02 per append)   +16:        31311 (31.3 per append)
    10000  doubling:     16383 (1.64 per append)   +16:      3120625 (312.1 per append)
   100000  doubling:    131071 (1.31 per append)   +16:    312456250 (3124.6 per append)
  1000000  doubling:   1048575 (1.05 per append)   +16:  31249562500 (31249.6 per append)
```

**Doubling.** The resizes happen when the length is $1, 2, 4, \dots$, so the copies form the geometric sum $1 + 2 + \dots + 2^{k-1} = 2^k - 1$, where $2^k$ is the final capacity, the smallest power of two that is at least $n$. For $n = 10^6$ that is $2^{20} - 1 = 1048575$, exactly the count. Since $2^k < 2n$, the copies are always below $2n$, which is the bound used in `dynamic-arrays-and-amortized-resizing`. The ratio per append is not constant: it is $1.02$ at $n = 1000$ and $1.64$ at $n = 10^4$, because the array doubled to capacity $16384$ at append $8193$, and the $16383$ copies so far are spread over only $10^4$ appends. It stays under $2$ throughout.

**Adding 16.** The resizes happen at lengths $1, 17, 33, \dots$, an arithmetic progression with $d = 16$. With $m = \lfloor (n-2)/16 \rfloor$, the copies total $(m+1) + 16\,m(m+1)/2$. For $n = 1000$, $m = 62$ and the total is $63 + 31248 = 31311$, as counted. The cost per append grows like $n/32$, so it keeps getting worse with $n$.

This compares copies only. Doubling pays in memory: right after a resize up to half the array is unused, whereas adding $16$ wastes at most $15$ slots. And the factor $2$ is not special. Growing the capacity by any fixed factor $r > 1$ keeps copies per append bounded by about $r/(r-1)$, so factor $1.5$ (rounded up) measures $2.10$ per append at $n = 10^6$ and factor $1.125$ measures $8.68$. A smaller factor trades fewer unused slots for more copying.

### Example 4: compound growth versus simple growth

Take an account holding $1000$ with a fixed $5\%$ annual rate and annual compounding. Simple interest adds $50$ each year, an arithmetic progression: $1000 + 50k$, which is $2500$ after $30$ years. Compound interest multiplies by $1.05$, a geometric one: $1000 \cdot 1.05^k$ equals $1050$ after $1$ year, $1628.89$ after $10$, and $4321.94$ after $30$. The balance doubles when $1.05^k = 2$, at $k = \ln 2 / \ln 1.05 \approx 14.21$ years (the rule of thumb $72/5 = 14.4$ is close).

Regular deposits form a geometric sum. Depositing $100$ at the end of each month for $120$ months at monthly rate $i = 0.05/12$ gives $100\,\dfrac{(1+i)^{120} - 1}{i} \approx 15528.23$, while the deposits themselves total $12000$. Applying the deposits one month at a time in a loop reproduces $15528.23$.

## Common Misconceptions & Pitfalls

- **Off-by-one in the number of terms.** The sum $r^0 + r^1 + \dots + r^n$ has $n + 1$ terms, and using $n$ in the exponent of the formula gives the wrong answer. Write the first and last exponent, count, and then substitute.
- **Applying the geometric formula at $r = 1$.** It divides by zero. The sum is $n\,a_1$, and this case matters because a loop with ratio exactly $1$ is just a loop.
- **"The sum of an arithmetic progression is linear."** For $d \neq 0$ the terms are linear in $n$ and the sum is quadratic. A nested loop with a bound that grows with the outer counter is $\Theta(n^2)$, even though the inner count is "only" $i$.
- **"A geometric progression with $r>1$ is dominated by its first terms."** For $r > 1$ the last term dominates, and the sum is a bounded multiple of it. For $\lvert r \rvert < 1$ the first term dominates. That is why the copy costs of a doubling array add up to a small multiple of $n$.
- **"Amortized O(1) means each append is cheap."** In Example 3 the append at length $2^{19} = 524288$ copies that many elements at once. The claim concerns the average over many appends, not any single one.
- **"A ratio $r < -1$ makes the terms tend to $-\infty$."** The terms alternate in sign with growing size, so the sequence has no limit at all, finite or infinite.

## Summary

An arithmetic progression adds a fixed difference: $a_n = a_1 + (n-1)d$ and $S_n = n(a_1 + a_n)/2$, so for $d \neq 0$ terms grow linearly and sums quadratically. A geometric progression multiplies by a fixed ratio: $a_n = a_1 r^{n-1}$ and $S_n = a_1(1 - r^n)/(1 - r)$ for $r \neq 1$, with $S_n = n\,a_1$ at $r = 1$. The sequence $(r^n)$ tends to $0$ exactly when $\lvert r \rvert < 1$, which settles when a geometric progression converges. Counting terms carefully matters, because the same pattern gives $n$ or $n+1$ terms depending on where the exponent starts. In computing, nested loops produce arithmetic sums, halving produces $\log_2 n$ steps, and doubling produces a geometric sum dominated by its last term, which is why a doubling array copies fewer than $2n$ elements over $n$ appends while a fixed increment of $16$ copies about $n^2/32$. Compound growth is the same geometric structure with money in place of memory. The next lesson, `infinite-series-and-partial-sums`, asks what happens to these sums when the number of terms is allowed to grow forever.

## Documentation Links

- [OpenStax Calculus Volume 2: 5.1 Sequences](https://openstax.org/books/calculus-volume-2/pages/5-1-sequences): explicit and recursive formulas, with arithmetic and geometric sequences among the examples.
- [OpenStax Calculus Volume 2: 5.2 Infinite Series](https://openstax.org/books/calculus-volume-2/pages/5-2-infinite-series): partial sums and the geometric series, including the ratio and the closed form.
- [Active Calculus: 8.3 Geometric sums](https://activecalculus.org/single/sec-8-3-geometric.html): finite geometric sums and their closed form, extended to infinite geometric series.
