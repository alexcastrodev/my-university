---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Describe a sequence as a function on the natural numbers, given by an explicit formula or by a recurrence.
- State the $\varepsilon$-$N$ definition of convergence, read its quantifiers correctly, and use it to find $N$ for a given tolerance.
- Compute limits of sequences with the limit laws, the squeeze theorem, and continuous functions, checking each hypothesis.
- State the monotone convergence theorem, use it on a recursively defined sequence, and show that dropping either hypothesis breaks the conclusion.
- Explain why "consecutive terms get close together" does not imply convergence, and what that means for stopping rules in iterative algorithms.

## Context & Motivation

The previous lesson, `improper-integrals`, took a limit as a continuous variable $b$ grew without bound. Much of computing replaces that continuous variable by a step counter: Newton's method refines an estimate one iteration at a time, gradient descent produces a list of parameter vectors, a running average is recomputed as data arrives. In each case the question is the same: does the list of numbers settle down, and to what?

A **sequence** is a list $a_1, a_2, a_3, \dots$ of real numbers, formally a function from $\{1, 2, 3, \dots\}$ to $\mathbb{R}$, written $(a_n)$. The terms may be given by a formula, such as $a_n = 1/n$, or by a rule that builds each term from the previous ones, such as $a_{n+1} = \sqrt{2 + a_n}$ with $a_1 = 1$. Where the sequence starts (index $0$ or $1$) is a matter of convenience and does not affect anything below. Limits of functions as $x \to \infty$ were studied in `limits-at-infinity-and-asymptotic-growth`; here the variable only takes integer values, which makes some arguments easier and a few statements different.

## Core Theory

### The definition of convergence

The sequence $(a_n)$ **converges** to $L$ if for every $\varepsilon > 0$ there is an index $N$ such that

$$\lvert a_n - L \rvert < \varepsilon \quad \text{for every } n \ge N$$

In words: whatever tolerance you demand, the terms are eventually inside it and stay inside. The order of the quantifiers matters. The index $N$ is allowed to depend on $\varepsilon$, and it usually must, since a smaller tolerance needs a later start. A sequence that does not converge to any real number **diverges**. This includes sequences that grow without bound (we may write $a_n \to \infty$ as shorthand, but the limit is not a real number) and sequences that oscillate, like $(-1)^n$.

Two basic facts follow. A limit is unique. And a convergent sequence is bounded, because after index $N$ all terms lie within $1$ of $L$, and only finitely many terms come before. The converse is false: $(-1)^n$ is bounded and diverges.

Changing finitely many terms never changes whether a sequence converges, or its limit. This is why statements such as "the sequence is monotone from some point on" are enough in proofs.

### Computing limits

If $a_n \to L$ and $b_n \to M$, then $a_n + b_n \to L + M$, $a_n b_n \to LM$, and $a_n / b_n \to L/M$ provided $M \neq 0$ (and $b_n \neq 0$). For a constant $c$, $c \cdot a_n \to cL$. These mirror the limit laws for functions, and they are only valid when both limits exist: splitting a sum into two divergent pieces proves nothing.

**Squeeze theorem.** If $a_n \le c_n \le b_n$ for all $n \ge n_0$ and $a_n \to L$, $b_n \to L$, then $c_n \to L$.

**Continuous functions.** If $a_n \to L$, every $a_n$ lies in the domain of $f$, and $f$ is continuous at $L$, then $f(a_n) \to f(L)$. Continuity at $L$ is essential. Let $f(x) = 0$ for $x \neq 0$ and $f(0) = 1$. Then $a_n = 1/n \to 0$ and $f(a_n) = 0$ for all $n$, so $f(a_n) \to 0 \neq f(0)$.

**From functions to sequences.** If $f(x) \to L$ as $x \to \infty$ and $a_n = f(n)$, then $a_n \to L$. The converse fails: $a_n = \sin(\pi n) = 0$ converges, while $\sin(\pi x)$ has no limit as $x \to \infty$.

### The monotone convergence theorem

A sequence is **nondecreasing** if $a_{n+1} \ge a_n$ for all $n$, and **nonincreasing** if $a_{n+1} \le a_n$. The theorem:

> If $(a_n)$ is nondecreasing and bounded above, it converges. If it is nonincreasing and bounded below, it converges.

When it converges, the limit of a nondecreasing sequence is the least upper bound of its terms. This is the great convenience of the theorem: it proves a limit exists without knowing what it is. Both hypotheses are needed. The sequence $a_n = n$ is monotone and not bounded, and it diverges. The sequence $(-1)^n$ is bounded and not monotone, and it also diverges. The upper bound is also not the limit in general: $a_n = 1 - 1/n$ is bounded above by $2$ and converges to $1$.

The theorem depends on the real numbers having no gaps. Inside the rational numbers it fails: the sequence of fractions in Example 3 below is monotone from the second term on and bounded, but its limit $\sqrt{2}$ is not rational.

A classic use: the sequence $(1 + 1/n)^n$ is increasing and bounded above by $3$ (both facts can be proved with the binomial theorem), so it converges, and its limit is the number $e$:

```text
n          (1 + 1/n)^n
1          2.0
10         2.5937
100        2.7048
1000       2.7169
1000000    2.7183
```

## Worked Examples

### Example 1: finding $N$ from $\varepsilon$

Show that $a_n = \dfrac{3n+1}{n+2} \to 3$. Compute the distance to the proposed limit:

$$\lvert a_n - 3 \rvert = \left\lvert \frac{3n + 1 - 3(n+2)}{n+2} \right\rvert = \frac{5}{n+2}$$

This is below $\varepsilon$ exactly when $n > 5/\varepsilon - 2$. So for any $\varepsilon$, any integer $N > 5/\varepsilon - 2$ works.

```text
epsilon    n must exceed    smallest N
0.1        48               49
0.01       498              499
0.001      4998             4999
```

Check $\varepsilon = 0.01$: at $n = 499$ the distance is $5/501 \approx 0.00998 < 0.01$, while at $n = 498$ it is exactly $0.01$, which is not less than $0.01$. The proof is complete because the same algebra works for every $\varepsilon$, not because three values were tested.

### Example 2: a recurrence and the monotone convergence theorem

Let $a_1 = 1$ and $a_{n+1} = \sqrt{2 + a_n}$. The first terms are $1,\ 1.7321,\ 1.9319,\ 1.9829,\ 1.9957,\ 1.9989$.

**Bounded.** If $0 < a_n < 2$ then $a_{n+1} < \sqrt{4} = 2$, and $a_{n+1} > 0$. Since $a_1 = 1$, induction gives $0 < a_n < 2$ for all $n$.

**Increasing.** From $a_{n+1}^2 = 2 + a_n$,

$$a_{n+1}^2 - a_n^2 = 2 + a_n - a_n^2 = (2 - a_n)(1 + a_n) > 0$$

and since the terms are positive, $a_{n+1} > a_n$.

**The limit.** By the monotone convergence theorem $a_n \to L$ for some $L$. Only now is it legitimate to take limits on both sides of the recurrence. Because the square root is continuous, $L = \sqrt{2 + L}$, so $L^2 - L - 2 = 0$ and $L = 2$ or $L = -1$. Every term is at least $1$, so $L = 2$.

The distance $2 - a_n$ is $0.268,\ 0.0681,\ 0.0171,\ 0.00428$ for $n = 2, 3, 4, 5$, shrinking by a factor close to $1/4$ each step (the ratios are $0.254,\ 0.251,\ 0.250$).

### Example 3: Newton's iteration for $\sqrt{2}$

Start with $a_1 = 1$ and set $a_{n+1} = \tfrac12\left(a_n + \dfrac{2}{a_n}\right)$. In exact fractions the terms are $1,\ \tfrac32,\ \tfrac{17}{12},\ \tfrac{577}{408}$. The error $a_n - \sqrt{2}$, computed to high precision, is:

```text
n    a_n                     a_n - sqrt(2)
1    1                       -0.4142
2    1.5                      0.0858
3    1.416667                 2.45e-3
4    1.4142157                2.12e-6
5    1.41421356237469         1.59e-12
6    1.41421356237309505      9.0e-25
```

The number of correct digits roughly doubles at each step. To prove convergence, note that for $a_n > 0$ the arithmetic-geometric mean inequality gives $a_{n+1} \ge \sqrt{a_n \cdot 2/a_n} = \sqrt{2}$ for every $n \ge 1$. Then for $n \ge 2$ we have $a_n \ge \sqrt{2}$, so

$$a_{n+1} - a_n = \frac{2 - a_n^2}{2 a_n} \le 0$$

The sequence is nonincreasing from $n = 2$ and bounded below by $\sqrt{2}$, so it converges. (The first term $1$ is below $\sqrt{2}$, which is why monotonicity starts at $n = 2$.) The limit satisfies $L = \tfrac12 (L + 2/L)$, hence $L^2 = 2$.

In double-precision arithmetic the computed iterates stop changing at the sixth term, so the program reaches a fixed point, a concrete version of a sequence that is eventually constant. An exact-fraction version never stops, since the denominators keep growing.

### Example 4: squeezing a factorial

Show that $n!/n^n \to 0$. Write $\dfrac{n!}{n^n} = \dfrac{1}{n} \cdot \dfrac{2}{n} \cdot \dfrac{3}{n} \cdots \dfrac{n}{n}$. Every factor except the first is at most $1$, so $0 \le n!/n^n \le 1/n$, and both bounds tend to $0$. The squeeze theorem gives the limit. The actual values fall far faster than the bound:

```text
n     n!/n^n         1/n
5     0.0384         0.2
10    3.6288e-04     0.1
20    2.3202e-08     0.05
50    3.4243e-21     0.02
```

The bound is valid but crude, and a valid crude bound is all the squeeze theorem needs.

## Common Misconceptions & Pitfalls

- **"A bounded sequence converges."** The sequence $(-1)^n$ is bounded by $1$ and diverges. Boundedness is half of the monotone convergence theorem, never the whole of it.
- **"If $a_{n+1} - a_n \to 0$ the sequence converges."** Take $a_n = \sqrt{n}$. The step $\sqrt{10^6 + 1} - \sqrt{10^6}$ is about $0.0005$, and the sequence reaches $1000$ at $n = 10^6$ with no ceiling. A loop that stops "when successive values differ by less than a tolerance" can stop on a sequence that diverges. The rule is a heuristic; it is justified when the convergence rate is known, as in Example 3.
- **"Solve $L = f(L)$ to find the limit."** This is valid only after convergence is established. Let $a_1 = 1$ and $a_{n+1} = 2a_n + 1$. Solving $L = 2L + 1$ gives $L = -1$, but the terms are $1, 3, 7, 15, 31, 63, \dots$, which grow without bound.
- **"The upper bound is the limit."** The sequence $(1 + 1/n)^n$ is bounded by $3$ and converges to $2.71828\dots$. Only the least upper bound is the limit of a nondecreasing sequence.
- **"$N$ does not depend on $\varepsilon$."** In general it must. In Example 1, $N$ goes from $49$ to $4999$ as $\varepsilon$ shrinks from $0.1$ to $0.001$.
- **"If $f(n) \to L$ then $f(x) \to L$."** False, as $\sin(\pi n)$ shows. The implication runs from the function to the sequence only.
- **"The limit laws split any limit."** They apply when each piece converges. For $a_n = n$ and $b_n = -n$, both diverge, yet $a_n + b_n = 0$ converges.

## Summary

A sequence is a function on the natural numbers, and it converges to $L$ when for every tolerance $\varepsilon$ the terms eventually stay within $\varepsilon$ of $L$. Convergent sequences have a unique limit and are bounded, though bounded sequences need not converge. Limits are computed with the limit laws (only when each piece converges), the squeeze theorem, and continuous functions (continuous at the limit). The monotone convergence theorem says that a nondecreasing sequence bounded above, or a nonincreasing sequence bounded below, converges, and it is the tool for recurrences whose limit is not known in advance: first prove existence, then solve for the value. Successive terms getting close together is not enough, which matters for stopping criteria. The next lesson, `arithmetic-and-geometric-progressions`, studies the two simplest families of sequences in closed form and decides exactly when the geometric one converges.

## Documentation Links

- [OpenStax Calculus Volume 2: 5.1 Sequences](https://openstax.org/books/calculus-volume-2/pages/5-1-sequences): general terms, limits of sequences, the squeeze theorem, and the monotone convergence theorem.
- [OpenStax Calculus Volume 1: 2.5 The Precise Definition of a Limit](https://openstax.org/books/calculus-volume-1/pages/2-5-the-precise-definition-of-a-limit): the epsilon-delta idea for functions, which the epsilon-N definition mirrors.
- [OpenStax Calculus Volume 1: 2.3 The Limit Laws](https://openstax.org/books/calculus-volume-1/pages/2-3-the-limit-laws): the algebraic laws and the squeeze theorem that carry over to sequences.
