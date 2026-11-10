---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Read a problem statement and name the calculus tool it calls for before computing anything.
- State the check that comes first for each tool, which is usually a hypothesis of a theorem.
- Solve one problem with each main tool of the discipline, and verify the answer by a second route.
- Recognize when the right next step is a computation or a bound, and not an exact formula.

## Context & Motivation

Thirty-two lessons in this discipline each answered a specific question. A real problem arrives without a chapter heading: a loop whose cost must be estimated, a batch size to tune, a value to compute within a tolerance. The difficult step is usually not the computation. It is deciding what kind of problem this is, then noticing the hypothesis that would make the tool fail.

The lessons kept showing the same pattern. `the-fundamental-theorem-of-calculus` gives a wrong finite answer for $\frac{1}{x^2}$ on $[-1,1]$. `lhopitals-rule` gives a wrong limit when the form is not indeterminate. `taylor-and-maclaurin-series-with-error-bounds` shows a series that converges to the wrong function. In each case the tool ran normally, and the error sat in a check that was skipped. This guide organizes the discipline around that first check.

## Core Theory

### From the question to the tool

| The problem asks | Reach for | Check first |
|---|---|---|
| What happens as the input grows? | Limit at infinity, ratio of two functions | Is the form indeterminate? Is the claim only for large inputs? |
| How fast is it changing here? | Derivative | Is the function differentiable at that point? What are the units? |
| What is the best value of a parameter? | Critical points and endpoints | Is the domain closed? Is the extremum global? |
| What is the total of a changing rate? | Definite integral, Fundamental Theorem | Is the integrand continuous on the whole interval? |
| What does a sum of many terms come to? | Closed form, or integral bounds | Are the terms monotone? |
| Is this infinite total finite? | Improper integral, convergence tests | Does each end converge alone? Does the test apply? |
| What is this value within a tolerance? | Taylor polynomial with a remainder bound | Is the point inside the interval of convergence? Is the bound valid? |
| How does an output depend on several inputs? | Gradient, Hessian, multiple integrals | Is it differentiable? Which Jacobian factor applies? |
| Does the change depend on the current state? | Differential equation | Which equilibria does dividing lose? On which interval does it hold? |

### Three habits

**Name the hypothesis out loud.** Every theorem in this discipline has one that can fail: continuity on a closed interval for the Extreme Value Theorem, differentiability on the open interval for the Mean Value Theorem, a nonzero derivative of the denominator for L'Hôpital's Rule, absolute convergence for rearranging a series.

**Separate an exact answer from a bound.** Many useful results are inequalities: integral bounds on a sum, the Lagrange remainder, a comparison test. A bound that holds is often worth more than a formula that does not exist, as `the-mean-value-theorem-and-monotonicity` shows when it brackets a square root.

**Verify by a second route.** Differentiate an antiderivative, substitute a solution back, evaluate a limit numerically at a large input, or compare a symbolic integral with a quadrature. Agreement between two independent routes catches most errors. A numerical check alone can mislead, as the floating-point tables in `limit-laws-and-indeterminate-forms` show, so it is evidence and not proof.

## Worked Examples

Each example names the recognition step first. All values were computed in a script.

### Example 1: comparing growth

Does $n \ln n$ grow more slowly than $n^{3/2}$? The question is about large inputs, so take the limit of the ratio, which reduces to $\frac{\ln n}{\sqrt{n}}$. That is $\frac{\infty}{\infty}$, so L'Hôpital's Rule applies and gives

$$\lim_{n\to\infty}\frac{\ln n}{\sqrt n}=\lim_{n\to\infty}\frac{1/n}{1/(2\sqrt n)}=\lim_{n\to\infty}\frac{2}{\sqrt n}=0.$$

The trap is reading this as a statement about a given size. Here the ratio never reaches 1, peaking at about $0.736$ at $n=e^2$, so $n\ln n$ is the smaller one at every $n\ge1$. Add a constant, as in $100\,n\ln n$ against $n^{3/2}$, and the limit does not change, yet the first is the larger one for every $n$ from $2$ to about $2.1\times10^6$. The limit settles the asymptotic order, and it says nothing about which algorithm wins at a given size, as `limits-at-infinity-and-asymptotic-growth` explains.

### Example 2: a best parameter

Batching $n$ items costs a fixed setup per batch plus a delay that grows with batch size, modeled here as $T(b)=\frac{1000}{b}+0.1\,b$ for $b>0$. The question asks for a best value, so look for critical points:

$$T'(b)=-\frac{1000}{b^2}+0.1=0 \quad\Longrightarrow\quad b=100,\qquad T(100)=20.$$

The trap is the domain. It is open, so the Extreme Value Theorem does not apply, and a critical point alone proves nothing. Here $T''(b)=\frac{2000}{b^3}>0$ on all of $(0,\infty)$, so $T$ is concave up everywhere and $b=100$ is the global minimum. Checking the neighbors confirms it: $T(99)\approx 20.0010$ and $T(101)\approx 20.0010$.

### Example 3: a sum you cannot close

What does $\sum_{k=1}^{1000}\sqrt{k}$ come to? There is no elementary closed form, so use integrals. Because $\sqrt{x}$ is increasing, the sum lies between two integrals:

$$\int_0^{1000}\sqrt{x}\,dx \;\le\; \sum_{k=1}^{1000}\sqrt{k} \;\le\; \int_1^{1001}\sqrt{x}\,dx.$$

The Fundamental Theorem gives $21081.85$ and $21112.82$. The true sum is $21097.46$, inside the bounds as required. The trap is that the argument needs monotone terms. For a function that oscillates, these inequalities are not available.

### Example 4: a value within a tolerance

Compute $\ln(1.1)$ within $10^{-6}$. This calls for a Taylor polynomial, and $x=0.1$ lies inside the interval $(-1,1]$ where $\ln(1+x)=\sum_{k\ge1}(-1)^{k+1}\frac{x^k}{k}$ holds. The series alternates with decreasing terms, so the error is at most the first omitted term:

```text
terms  estimate      actual error  first omitted term
4      0.09530833    1.85e-06      2.00e-06
5      0.09531033    1.54e-07      1.67e-07
```

Four terms miss the target and five meet it. The trap is the interval: at $x=2$ the same series has partial sums $5.07$, $-64.83$, and $-34359.71$ after 5, 10, and 20 terms, because that point lies outside the interval of convergence.

### Example 5: is the total finite?

Response times follow a Pareto density $f(x)=\alpha x^{-\alpha-1}$ on $[1,\infty)$. Is the mean finite? The question is about an infinite total, so this is an improper integral:

$$\int_1^\infty x\cdot\alpha x^{-\alpha-1}\,dx=\alpha\int_1^\infty x^{-\alpha}\,dx.$$

By the $p$-test this converges exactly when $\alpha>1$. For $\alpha=1.5$ the mean is $3$, for $\alpha=2$ it is $2$, and for $\alpha=1$ the integral diverges. The trap is that a sample average always returns a finite number. The density integrates to 1 in every case, and the infinite mean does not show up in any finite log.

### Example 6: several inputs

Minimize $f(x,y)=x^2+4y^2-2x$. There are two inputs, so use the gradient: $\nabla f=(2x-2,\,8y)$ vanishes only at $(1,0)$. The Hessian has entries $2$ and $8$ on the diagonal and $0$ elsewhere, so its determinant is $16>0$ with a positive leading entry, which makes $(1,0)$ a local minimum. Since $f$ is a sum of convex terms, it is also the global one.

At $(0,1)$ the gradient is $(-2,8)$, with length about $8.25$, so the steepest descent direction is $(2,-8)$ divided by that length. The trap is that this direction does not aim at the minimizer: from $(0,1)$ the minimizer lies along $(1,-1)$. Steepest is a local statement, as `directional-derivatives-and-the-direction-of-steepest-ascent` shows.

### Example 7: change that depends on the state

A cache warms at a rate proportional to what is still missing: $y'=0.2(100-y)$ with $y(0)=0$, for $t$ in minutes and $y$ in percent. The rate depends on the current value, so this is a differential equation, and a separable one. Dividing by $100-y$ gives

$$y(t)=100-100e^{-0.2t},$$

and substituting back confirms it, with $y'=20e^{-0.2t}=0.2(100-y)$. The cache reaches $95\%$ at $t=\frac{\ln 20}{0.2}\approx 14.98$ minutes. The trap is the division, which assumes $y\ne100$. Nothing is lost here, because the general solution $y=100+(y_0-100)e^{-0.2t}$ contains the equilibrium at $y_0=100$. That is not guaranteed: the usual form of the logistic solution in `separable-differential-equations` misses one equilibrium, so check the roots of the right-hand side separately.

## Common Misconceptions & Pitfalls

- **"If the steps ran without error, the answer is right."** A formula applied outside its hypotheses still produces a number. Example 4 at $x=2$ produces partial sums, and they mean nothing.
- **"A critical point is the answer."** It is a candidate. Example 2 needed concavity to conclude, and a closed interval would also need its endpoints.
- **"Limits describe what happens at realistic sizes."** Example 1 shows a constant factor moving the crossover past two million. Asymptotics answers a different question from a benchmark.
- **"No closed form means no answer."** Example 3 pinned a sum within about $31$ out of $21{,}000$ using two integrals.
- **"A numerical check proves it."** It is evidence. A finite sample never reveals the infinite mean in Example 5, and floating point can round a true limit away.
- **"Steepest descent points at the minimum."** Example 6 shows it does not in general. With elliptical level curves, it does only on the axes.

## Summary

Before computing, identify the question: growth, rate, best value, total, finite or infinite, value within a tolerance, several inputs, or change depending on state. Then state the hypothesis that the matching tool needs, because that is where calculus goes wrong. Prefer a bound that holds over a formula that does not exist, and verify by a second route. The seven examples use one tool each, and each comes with a check that the computation alone would not supply.

## Documentation Links

- [OpenStax: Calculus Volume 1](https://openstax.org/details/books/calculus-volume-1): open textbook for limits, derivatives, and integrals.
- [OpenStax: Calculus Volume 2](https://openstax.org/details/books/calculus-volume-2): open textbook for integration, differential equations, sequences, and series.
- [OpenStax: Calculus Volume 3](https://openstax.org/details/books/calculus-volume-3): open textbook for multivariable calculus.
- [MIT OpenCourseWare 18.01SC: Single Variable Calculus](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/): open course for the single-variable material.
- [MIT OpenCourseWare 18.02SC: Multivariable Calculus](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/): open course for the multivariable material.
