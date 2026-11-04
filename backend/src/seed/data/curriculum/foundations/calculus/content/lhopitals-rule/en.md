---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State L'Hôpital's Rule for $\frac00$ and $\frac{\infty}{\infty}$ with all of its hypotheses, including the one that is most often forgotten: the limit of the derivative quotient must exist.
- Recognize limits where the rule does not apply, and limits where it applies but does not help.
- Rewrite the forms $0 \cdot \infty$, $\infty - \infty$, $1^\infty$, $0^0$, and $\infty^0$ so that the rule becomes usable.
- Prove that logarithms grow slower than any positive power, and powers slower than exponentials, and connect this to comparing algorithm running times.

## Context & Motivation

The limit laws in `limit-laws-and-indeterminate-forms` say nothing when a quotient has the form $\frac00$ or $\frac{\infty}{\infty}$. Factoring and rationalizing work for algebraic expressions, but they are hopeless for something like $\frac{e^x - 1 - x}{x^2}$ as $x \to 0$. L'Hôpital's Rule replaces the quotient of two functions by the quotient of their derivatives, which is often much simpler. The idea is that near the limit point a differentiable function behaves like its tangent line, so the ratio of the functions behaves like the ratio of the slopes.

The rule is also the standard tool for the dominance hierarchy in `limits-at-infinity-and-asymptotic-growth`, which is the calculus under `big-o-and-asymptotic-complexity`: it proves that $n \ln n$ grows more slowly than $n^{1.5}$ and that polynomials grow more slowly than exponentials. But the rule is a theorem with hypotheses, and treating it as a mechanical "differentiate top and bottom" habit is a reliable source of wrong answers. This lesson spends as much time on when it fails as on when it works.

## Core Theory

### The statement

**L'Hôpital's Rule.** Let $f$ and $g$ be differentiable on an open interval containing $a$, except possibly at $a$ itself, with $g'(x) \ne 0$ for $x \ne a$ in that interval. Suppose

1. $\lim_{x \to a} f(x) = 0$ and $\lim_{x \to a} g(x) = 0$, or both $\lvert f\rvert$ and $\lvert g\rvert$ tend to $\infty$; and
2. $\lim_{x \to a} \frac{f'(x)}{g'(x)}$ exists, as a finite number or as $\pm\infty$.

Then

$$\lim_{x \to a} \frac{f(x)}{g(x)} = \lim_{x \to a} \frac{f'(x)}{g'(x)}.$$

The same statement holds for one-sided limits and for $x \to \pm\infty$. The proof is a refinement of the Mean Value Theorem (the Cauchy form, which compares two functions at the same intermediate point). A quick plausibility check for $\frac00$: if $f(a) = g(a) = 0$ and both are differentiable at $a$ with $g'(a) \ne 0$, then $\frac{f(x)}{g(x)} = \frac{f(x) - f(a)}{g(x) - g(a)}$, and dividing top and bottom by $x - a$ gives $\frac{f'(a)}{g'(a)}$ in the limit.

Notice the direction of the implication. If the derivative quotient has a limit, so does the original. The converse is false. Condition 1 says the rule is for indeterminate forms only. Condition 2 says that a derivative quotient that wanders tells you nothing.

### Rewriting the other indeterminate forms

The rule needs a quotient. Other forms are converted first.

- **$0 \cdot \infty$:** write $f \cdot g$ as $\frac{f}{1/g}$ or $\frac{g}{1/f}$, whichever has simpler derivatives.
- **$\infty - \infty$:** combine into one fraction, or factor.
- **$1^\infty$, $0^0$, $\infty^0$:** for $y = f(x)^{g(x)}$ with $f > 0$, take logarithms: $\ln y = g(x)\ln f(x)$ is a $0 \cdot \infty$ form. If $\ln y \to \ell$, then $y \to e^\ell$ because the exponential is continuous. The positivity of $f$ is what makes the logarithm legal.

## Worked Examples

### Example 1: the rule at work

Evaluate $\lim_{x \to 0} \frac{e^x - 1 - x}{x^2}$. Both numerator and denominator tend to $0$, so the form is $\frac00$. Differentiating gives $\frac{e^x - 1}{2x}$, which is again $\frac00$. Differentiating once more gives $\frac{e^x}{2}$, which tends to $\frac12$. The second application was legal only because the first result was still indeterminate. Stop the moment the form is no longer indeterminate: applying the rule to $\frac{e^x}{2}$ would be an error. A numerical check agrees: at $x = 0.1, 0.01, 0.001$ the quotient is $0.51709$, $0.50167$, $0.50017$.

### Example 2: three ways the rule fails

**It does not apply: not an indeterminate form.** Take $\lim_{x \to 1} \frac{x^2 + 1}{x + 1}$. The numerator tends to $2$ and the denominator to $2$, so continuity gives the limit $1$. Differentiating anyway gives $\frac{2x}{1} \to 2$, a wrong answer.

**It does not apply: the derivative quotient has no limit.** Take $\lim_{x \to \infty} \frac{x + \sin x}{x}$. The form is $\frac{\infty}{\infty}$ and the functions are differentiable, but the derivative quotient is $\frac{1 + \cos x}{1}$, which keeps oscillating between $0$ and $2$ and has no limit. Condition 2 fails, so the rule says nothing. The original limit exists anyway: $\frac{x + \sin x}{x} = 1 + \frac{\sin x}{x}$ and $\frac{\lvert\sin x\rvert}{x} \le \frac1x \to 0$ by the squeeze theorem, so the limit is $1$. A second example of the same disease is $\lim_{x \to 0} \frac{x^2 \sin(1/x)}{\sin x}$. It is $\frac00$, but the derivative quotient $\frac{2x\sin(1/x) - \cos(1/x)}{\cos x}$ oscillates near $0$. Yet the original equals $\frac{x}{\sin x} \cdot x\sin\frac1x \to 1 \cdot 0 = 0$.

**It applies but does not help.** Take $\lim_{x \to \infty} \frac{x}{\sqrt{x^2 + 1}}$. It is $\frac{\infty}{\infty}$ and the hypotheses hold. The derivative quotient is $\frac{1}{x/\sqrt{x^2 + 1}} = \frac{\sqrt{x^2 + 1}}{x}$, the reciprocal of what we started with. Apply the rule again and you get the original expression back, forever. The right tool is algebra: divide top and bottom by $x$, giving $\frac{1}{\sqrt{1 + 1/x^2}} \to 1$. (For $x > 0$, $\sqrt{x^2} = x$; for $x \to -\infty$ the same trick gives $-1$.)

### Example 3: other indeterminate forms

**$0 \cdot \infty$.** $\lim_{x \to 0^+} x\ln x$. Write it as $\frac{\ln x}{1/x}$, a $\frac{-\infty}{\infty}$ form. The derivative quotient is $\frac{1/x}{-1/x^2} = -x \to 0$, so the limit is $0$. The other rewrite, $\frac{x}{1/\ln x}$, is legal but produces $-x\ln^2 x$, another $0 \cdot \infty$ form that is harder than the one you started with. Choose the rewrite whose derivative simplifies.

**$\infty - \infty$.** $\lim_{x \to 0} \left(\frac{1}{\sin x} - \frac1x\right) = \lim \frac{x - \sin x}{x\sin x}$, which is $\frac00$. One application gives $\frac{1 - \cos x}{\sin x + x\cos x}$, still $\frac00$. A second gives $\frac{\sin x}{2\cos x - x\sin x} \to \frac02 = 0$. The values at $x = 0.1, 0.01$ are $0.016686$ and $0.001667$, consistent with a limit of $0$.

**$0^0$.** $\lim_{x \to 0^+} x^x$. For $x > 0$, $\ln(x^x) = x\ln x \to 0$ by the first part, so $x^x \to e^0 = 1$. The restriction to $x \to 0^+$ matters: $x^x$ is not defined for negative $x$ in general, so there is no two-sided limit.

**$1^\infty$.** $\lim_{x \to \infty} \left(1 + \frac1x\right)^x$ has $\ln y = x\ln\left(1 + \frac1x\right) = \frac{\ln(1 + 1/x)}{1/x}$, a $\frac00$ form whose derivative quotient is $\frac{1}{1 + 1/x} \to 1$. So the limit is $e^1 = e$.

### Example 4: comparing growth rates

For any $p > 0$, $\lim_{x \to \infty} \frac{\ln x}{x^p}$ is $\frac{\infty}{\infty}$, and the derivative quotient is $\frac{1/x}{p\,x^{p-1}} = \frac{1}{p\,x^p} \to 0$. So every positive power eventually beats the logarithm. Similarly $\lim_{x \to \infty} \frac{x^n}{e^x}$ becomes $\frac{n\,x^{n-1}}{e^x}$, then $\frac{n(n-1)x^{n-2}}{e^x}$, and after $n$ applications $\frac{n!}{e^x} \to 0$, for any positive integer $n$. For a real exponent $p > 0$ and $x \ge 1$, $x^p \le x^{\lceil p\rceil}$, so $\frac{x^p}{e^x} \le \frac{x^{\lceil p\rceil}}{e^x} \to 0$. So $e^x$ eventually beats every power of $x$.

Consequence for algorithms: $\frac{n \ln n}{n^{1.5}} = \frac{\ln n}{\sqrt n} \to 0$, so $n \ln n$ grows more slowly than $n^{1.5}$. For this pair there is no crossover to hunt for: $\frac{\ln x}{\sqrt x}$ peaks at $x = e^2$ with value $\frac2e \approx 0.736$ and then falls, so $n \ln n < n^{1.5}$ for every $n \ge 1$. The convergence to $0$ is slow, though:

```text
n          ln(n)/sqrt(n)
10         0.7281
100        0.4605
10^4       0.0921
10^6       0.0138
10^8       0.0018
```

The limit of a real variable $x$ gives the limit of the integer sequence $n$ by restricting. A far-off crossover does occur for other pairs, such as polynomial against exponential. $n^{10}$ is larger than $2^n$ for every $n$ from $2$ to $58$ (at $n = 58$: $2^{58} \approx 2.88 \times 10^{17}$ against $58^{10} \approx 4.31 \times 10^{17}$), and $2^n$ takes over from $n = 59$ ($2^{59} \approx 5.76 \times 10^{17}$ against $59^{10} \approx 5.11 \times 10^{17}$). The limit says who wins eventually, not where the crossover is.

## Common Misconceptions & Pitfalls

- **Differentiating the quotient instead of top and bottom.** The rule uses $\frac{f'}{g'}$, not $\left(\frac fg\right)'$.
- **Applying it when the form is not indeterminate.** Example 2 gives $2$ instead of $1$. Substitute first.
- **"No limit for $\frac{f'}{g'}$ means no limit for $\frac fg$."** The oscillation examples refute this; the rule is silent, not negative.
- **Stopping too late or too early.** Re-check the form after every application and simplify before differentiating again.
- **Using it on sequences directly.** A sequence $a_n$ has no derivative. Extend to a function of a real variable $x$, apply the rule, and conclude about the sequence from the function's limit.
- **Circular reasoning.** Using the rule to prove $\lim_{x \to 0}\frac{\sin x}{x} = 1$ assumes the derivative of $\sin x$, which in the usual development is proved from that very limit.
- **Reaching for it by reflex.** When algebra works (dividing by the highest power, factoring) it is usually shorter and safer.

## Summary

L'Hôpital's Rule says that if $\frac{f}{g}$ is of the form $\frac00$ or $\frac{\infty}{\infty}$ near $a$, the functions are differentiable with $g' \ne 0$, and $\frac{f'}{g'}$ has a limit (finite or infinite), then $\frac fg$ has the same limit. The hypotheses are all load-bearing. A non-indeterminate form gives wrong answers, as in $\frac{x^2 + 1}{x + 1}$ at $1$. A wandering derivative quotient makes the rule silent, as in $\frac{x + \sin x}{x}$, whose limit is $1$ by squeezing. And a limit like $\frac{x}{\sqrt{x^2 + 1}}$ cycles without progress and yields to algebra. Other indeterminate forms are rewritten as quotients, powers by taking logarithms of a positive base. Applied to growth rates, the rule shows that $\ln x \ll x^p \ll e^x$ as $x \to \infty$, which is the calculus beneath comparing running times such as $n\ln n$ against $n^{1.5}$. The limit says who wins in the end, not where a crossover falls, as $n^{10}$ against $2^n$ shows. The next lesson, `antiderivatives-and-initial-value-problems`, runs differentiation in reverse.

## Documentation Links

- [OpenStax Calculus Volume 1, 4.8: L'Hôpital's Rule](https://openstax.org/books/calculus-volume-1/pages/4-8-lhopitals-rule): the rule for $\frac00$ and $\frac{\infty}{\infty}$, the other indeterminate forms, and comparing growth rates.
- [MIT OCW 18.01SC, Unit 5, Part A: L'Hospital's Rule and Improper Integrals](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-5-exploring-the-infinite/part-a-lhospitals-rule-and-improper-integrals/): lecture sessions on the rule and its applications.
