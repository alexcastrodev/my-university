---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Define the sum of an infinite series as the limit of its sequence of partial sums, and say when a series converges or diverges.
- Sum a geometric series, state exactly when the formula applies, and turn a repeating decimal into a fraction.
- Find the partial sums of a telescoping series by cancellation and take their limit.
- State the divergence test in the correct direction and show with an example why its converse is false.
- Prove that the harmonic series diverges, say how slowly it does, and recognize when floating-point summation hides a divergence.

## Context & Motivation

The previous lesson, `arithmetic-and-geometric-progressions`, gave closed forms for the sum of the first $n$ terms. Now let the number of terms grow forever. Adding infinitely many numbers cannot be done by adding them one after another, so the sum has to be defined, and the definition reuses what you know from `sequences-and-convergence`: look at the sequence of partial sums and ask whether it converges.

The same question appeared for areas in `improper-integrals`, where an infinite tail of area either added up to a finite number or did not. Series are the discrete version of that story, and the two will meet again below, because the integral from $1$ to $\infty$ of $1/x$ decides the fate of the harmonic series. In computing, series appear whenever a quantity is built by adding corrections: a numerical approximation, a running total of costs, the probabilities of the successive outcomes of a repeated trial. Whether the total is finite is not a technicality.

## Core Theory

### Partial sums and the meaning of an infinite sum

Given a sequence $(a_n)$, the **$N$-th partial sum** is $S_N = a_1 + a_2 + \dots + a_N$. The **infinite series** $\sum_{n=1}^{\infty} a_n$ **converges** to $S$ if the sequence $(S_N)$ converges to $S$, and **diverges** if $(S_N)$ does not converge. The number $S$ is called the sum of the series. Nothing is "added infinitely many times"; the sum is a limit of finite sums.

Where the series starts affects the value but not whether it converges, since removing finitely many terms shifts the sum by a fixed amount. If $\sum a_n$ and $\sum b_n$ both converge, then $\sum (a_n + b_n) = \sum a_n + \sum b_n$ and $\sum c\,a_n = c \sum a_n$. If one converges and the other diverges, the sum of the two diverges. If both diverge, anything can happen: with $a_n = 1$ and $b_n = -1$ the combined series $\sum (a_n + b_n) = 0 + 0 + \dots$ converges.

### The geometric series

For $a \neq 0$,

$$\sum_{n=0}^{\infty} a\,r^n = \frac{a}{1 - r} \quad \text{if } \lvert r \rvert < 1, \qquad \text{and the series diverges if } \lvert r \rvert \ge 1$$

The proof is the closed form from the previous lesson: $S_N = a(1 - r^{N+1})/(1 - r)$, and for $\lvert r \rvert < 1$ we have $r^{N+1} \to 0$, so $S_N \to a/(1-r)$. For $\lvert r \rvert \ge 1$ the terms $a r^n$ do not tend to $0$, which rules out convergence by the divergence test below. The formula $a/(1-r)$ is a statement about the case $\lvert r \rvert < 1$ only. Plugging $r = 2$ into it to "sum" $1 + 2 + 4 + \dots$ gives $-1$, a meaningless answer for a series whose partial sums are $2^{N+1} - 1 \to \infty$.

### Telescoping series

If $a_n = b_n - b_{n+1}$ for some sequence $(b_n)$, then consecutive terms cancel and

$$S_N = (b_1 - b_2) + (b_2 - b_3) + \dots + (b_N - b_{N+1}) = b_1 - b_{N+1}$$

So the series converges exactly when $(b_n)$ converges, and then its sum is $b_1 - \lim b_n$. The work is in finding the $b_n$, often by partial fractions.

### The divergence test

> If $\sum a_n$ converges, then $a_n \to 0$.

The reason: $a_N = S_N - S_{N-1}$, and if $S_N \to S$ then also $S_{N-1} \to S$, so $a_N \to S - S = 0$. The useful form is the contrapositive. If $a_n$ does not tend to $0$ (it tends to something else, or has no limit), the series diverges. The test can only prove divergence. The converse is false: $a_n \to 0$ does not make the series converge, and the harmonic series is the standard counterexample.

### The harmonic series

The harmonic series is $\sum_{n=1}^{\infty} 1/n$, with partial sums $H_N = 1 + \tfrac12 + \dots + \tfrac1N$. Compare each term with an area. For $n \ge 1$ the function $1/x$ is at most $1/n$ on $[n, n+1]$, so $1/n \ge \int_n^{n+1} dx/x$. Adding these inequalities for $n = 1, \dots, N$,

$$H_N \ge \int_1^{N+1} \frac{dx}{x} = \ln(N+1) \to \infty$$

so the series diverges. This is the $p = 1$ borderline of the $p$-test from `improper-integrals`. A matching upper bound comes from $1/n \le \int_{n-1}^{n} dx/x$ for $n \ge 2$, giving $H_N \le 1 + \ln N$. Together,

$$\ln(N+1) \le H_N \le 1 + \ln N$$

so $H_N$ grows like $\ln N$: unboundedly, but very slowly.

### Series with non-negative terms

If every $a_n \ge 0$, the partial sums are nondecreasing, so by the monotone convergence theorem the series converges if and only if $(S_N)$ is bounded above. This is the tool behind comparison arguments, and it fails for terms of mixed sign. For example, since $1/n^2 \le 1/(n(n-1)) = 1/(n-1) - 1/n$ for $n \ge 2$, a telescoping sum shows $\sum_{n=1}^{N} 1/n^2 \le 1 + (1 - 1/N) < 2$. The partial sums are bounded, so $\sum 1/n^2$ converges. (Its sum is $\pi^2/6 \approx 1.6449$, a value that needs a different argument.) The next lesson, `convergence-tests`, collects more of these comparison ideas.

## Worked Examples

### Example 1: geometric series, a decimal, and the cases that fail

For $\sum_{n=0}^{\infty} (2/3)^n$ we have $a = 1$, $r = 2/3$, so the sum is $1/(1 - 2/3) = 3$. The partial sums approach it:

```text
last index m    S_m
0               1.0000
1               1.6667
2               2.1111
5               2.7366
10              2.9653
20              2.9994
```

The repeating decimal $0.272727\dots = \dfrac{27}{100} + \dfrac{27}{100^2} + \dots$ is geometric with $a = 27/100$ and $r = 1/100$, so it equals $\dfrac{27/100}{1 - 1/100} = \dfrac{27}{99} = \dfrac{3}{11}$. A direct sum of the first six terms gives $0.272727272727$, in agreement with $3/11$ (the exact six-term sum is $0.272727272727$, short of $3/11$ by about $2.7 \times 10^{-13}$).

Cases that fail: for $r = -1$ the partial sums are $1, 0, 1, 0, \dots$ and do not converge, so $\sum (-1)^n$ has no sum. For $r = 1.1$ the terms grow and the divergence test applies. And the starting index matters for the value: $\sum_{n=0}^{\infty} (1/2)^n = 2$ while $\sum_{n=1}^{\infty} (1/2)^n = 1$.

### Example 2: two telescoping sums, one convergent and one not

**Convergent.** Partial fractions give $\dfrac{1}{n(n+2)} = \dfrac12\left(\dfrac1n - \dfrac1{n+2}\right)$. The terms cancel two steps apart, so only the first two and the last two $b$-values survive:

$$S_N = \frac12\left(1 + \frac12 - \frac1{N+1} - \frac1{N+2}\right) \to \frac34$$

Checking in exact fractions for $N = 1, 2, 5, 10, 100$ confirms the formula and gives $S_N = 0.3333,\ 0.4583,\ 0.5952,\ 0.6629,\ 0.7401$, climbing toward $0.75$.

**Divergent, although the terms go to zero.** Since $\ln(1 + 1/n) = \ln(n+1) - \ln n$, the partial sums telescope to $S_N = \ln(N+1)$, which is $2.398$ at $N = 10$, $6.909$ at $N = 1000$, and $13.816$ at $N = 10^6$. The series diverges even though $\ln(1 + 1/n) \to 0$.

### Example 3: how slowly the harmonic series diverges

Direct computation and the bounds from Core Theory:

```text
N          ln(N+1)    H_N        1 + ln N
10         2.398      2.929      3.303
100        4.615      5.187      5.605
1000       6.909      7.485      7.908
1000000    13.816     14.393     14.816
```

Each value of $H_N$ sits between the bounds. The partial sum first exceeds $10$ at $N = 12367$. To pass $100$, use the approximation $H_N \approx \ln N + \gamma$ with $\gamma \approx 0.5772$ (the Euler-Mascheroni constant): the partial sum passes $100$ near $N \approx e^{100 - \gamma} \approx 1.5 \times 10^{43}$. The sum is unbounded, and no computation could observe it. Divergence here is a statement about the limit, not about anything a machine will ever reach.

### Example 4: floating point can make a divergent series look convergent

Sum $1/k$ in single precision until adding a term no longer changes the total:

```python
import numpy as np

total, k = np.float32(0), 0
while True:
    k += 1
    new = np.float32(total + np.float32(1) / np.float32(k))
    if new == total:        # adding 1/k no longer changes the float32 sum
        break
    total = new
print(k, total)
```

It prints `2097152 15.403683`. The spacing of single-precision numbers near $15.4$ is about $9.5 \times 10^{-7}$, and the term $1/2^{21} \approx 4.8 \times 10^{-7}$ is half of that, so from $k = 2097152 = 2^{21}$ onward each added term is rounded away and the computed sum stops at $15.403683$. The true partial sum, computed in double precision, is $H_{2097152} \approx 15.1333$, and it keeps growing without bound. The float32 total also differs from it, because rounding errors accumulated over two million additions. A stopping rule "quit when the next term is below the resolution" would report a finite value for a series that diverges. Double precision pushes the stall much later but does not remove it.

## Common Misconceptions & Pitfalls

- **"If $a_n \to 0$, the series converges."** The harmonic series and $\sum \ln(1 + 1/n)$ both have terms tending to $0$ and diverge. The divergence test only works in one direction.
- **"The formula $a/(1-r)$ works for any ratio."** It requires $\lvert r \rvert < 1$. For $r = 2$ it returns $-1$ for a series whose partial sums go to infinity.
- **Mixing up the starting index.** The same terms summed from $n = 0$ or from $n = 1$ differ by the first term. Write the first term out before using a formula.
- **"A series with tiny terms has converged."** Example 4 sums terms smaller than $10^{-6}$ and gets stuck at a finite value, while the true series diverges. Tiny terms and a stalled floating-point total are not evidence of convergence.
- **"Parentheses and rearrangements are always safe."** Grouping the terms of $1 - 1 + 1 - 1 + \dots$ as $(1-1) + (1-1) + \dots$ gives $0$, while $1 + (-1+1) + (-1+1) + \dots$ gives $1$, and the series has no sum at all (its partial sums alternate between $1$ and $0$). Rearranging the terms of a convergent series can also change its sum for some series, which requires the notion of absolute convergence to sort out.
- **"If the partial sums are bounded the series converges."** This holds for non-negative terms, where the partial sums are monotone. For $1 - 1 + 1 - 1 + \dots$ the partial sums are bounded and the series diverges.
- **Splitting a series into two divergent pieces.** Linearity needs both series to converge.

## Summary

An infinite series is the limit of its partial sums $S_N$: it converges when $(S_N)$ does, and diverges otherwise. The geometric series $\sum_{n=0}^{\infty} a r^n$ converges to $a/(1-r)$ exactly when $\lvert r \rvert < 1$. Telescoping series collapse to $S_N = b_1 - b_{N+1}$, so their convergence reduces to that of a sequence. The divergence test says that if $a_n \not\to 0$ the series diverges, but $a_n \to 0$ guarantees nothing, as the harmonic series shows: $\ln(N+1) \le H_N \le 1 + \ln N$, so it diverges, but so slowly that $H_N$ passes $10$ only at $N = 12367$. For non-negative terms, convergence is the same as bounded partial sums. Floating-point summation can stall on a divergent series, so numerical behavior alone proves nothing. The next lesson, `convergence-tests`, builds general criteria for deciding convergence without computing partial sums in closed form.

## Documentation Links

- [OpenStax Calculus Volume 2: 5.2 Infinite Series](https://openstax.org/books/calculus-volume-2/pages/5-2-infinite-series): partial sums, the harmonic series, geometric series, the divergence test, and telescoping series.
- [Active Calculus: 8.3 Geometric sums](https://activecalculus.org/single/sec-8-3-geometric.html): finite and infinite geometric series and when the infinite sum exists.
- [MIT OCW 18.01SC: Unit 5, Exploring the Infinite](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/): the sessions on infinite series and series comparison, with notes and videos.
