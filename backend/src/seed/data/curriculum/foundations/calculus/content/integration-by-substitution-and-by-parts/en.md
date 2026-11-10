---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Derive substitution from the chain rule and parts from the product rule, and state the hypotheses each one needs.
- Evaluate definite integrals by substitution, converting the limits to the new variable and never returning to the old one.
- Recognize an invalid substitution (a change of variable that is undefined or non-continuous inside the interval) and a dropped absolute value after a square root.
- Choose $u$ and $dv$ for integration by parts, and handle repeated and cyclic applications.
- Use $\int\ln x\,dx$ to bound a sum of logarithms, the calculus behind $\log(n!)=\Theta(n\log n)$.

## Context & Motivation

`the-fundamental-theorem-of-calculus` reduced a definite integral to finding an antiderivative, but gave no method for finding one. Differentiation has a rule for every composition and product; integration has no rule of the same completeness. What it has instead are two techniques that each run a differentiation rule backwards. Substitution undoes the chain rule and integration by parts undoes the product rule. Between them they handle most integrals met in practice.

The techniques also matter where no closed-form integral is the goal. Bounding $\ln(n!)$, the heart of the $\Omega(n\log n)$ lower bound for comparison sorting, gives sharp bounds via $\int\ln x\,dx$, a natural job for parts.

## Core Theory

### Substitution: the chain rule backwards

If $F'=f$, the chain rule gives $\frac{d}{dx}F(g(x)) = f(g(x))\,g'(x)$. Reading that right to left:

$$\int f(g(x))\,g'(x)\,dx = F(g(x)) + C$$

The shorthand is $u=g(x)$, $du = g'(x)\,dx$, turning the integral into $\int f(u)\,du$. The method works when the integrand contains an inner function together with (a constant multiple of) its derivative.

**Theorem (definite form).** Let $g$ have a continuous derivative on $[a,b]$ and let $f$ be continuous on an interval containing $g([a,b])$. Then

$$\int_a^b f(g(x))\,g'(x)\,dx = \int_{g(a)}^{g(b)} f(u)\,du$$

The proof is Part 2 of the FTC on both sides: each equals $F(g(b))-F(g(a))$. Three consequences. The new limits are $g(a)$ and $g(b)$, not $a$ and $b$. They may come out reversed ($g(a)>g(b)$) or equal. And $g$ does not have to be one-to-one or monotone. Once the limits are converted, the answer is computed entirely in $u$; substituting back to $x$ is unnecessary, and mixing the two is the classic error.

### Substitution in the other direction

Trigonometric substitution writes $x=\varphi(\theta)$ and uses $\int_a^b f(x)\,dx = \int_\alpha^\beta f(\varphi(\theta))\,\varphi'(\theta)\,d\theta$ with $\varphi(\alpha)=a$, $\varphi(\beta)=b$. The hypotheses are now strict: $\varphi'$ continuous on $[\alpha,\beta]$ and $\varphi$ staying inside the domain of $f$ on the whole way from $\alpha$ to $\beta$. Two things go wrong in practice. First, $\sqrt{\cos^2\theta}=\lvert\cos\theta\rvert$, which equals $\cos\theta$ only where $\cos\theta\ge0$, so the range chosen for $\theta$ must be stated. Second, $\varphi$ may be undefined at some point between the endpoints (Example 4).

### Integration by parts: the product rule backwards

From $(uv)'=u'v+uv'$, integrating gives

$$\int u\,v'\,dx = uv - \int u'\,v\,dx, \qquad \int_a^b u\,v'\,dx = \big[uv\big]_a^b - \int_a^b u'\,v\,dx$$

The definite form needs $u$ and $v$ to have continuous derivatives on $[a,b]$. The point is to trade $\int uv'$ for an easier $\int u'v$. Pick $u$ to be the factor that gets simpler on differentiation ($\ln x$, $\arctan x$, a polynomial) and $v'$ the factor whose antiderivative is easy ($e^x$, $\sin x$, $\cos x$, a power). The mnemonic LIATE (logarithmic, inverse trig, algebraic, trig, exponential, in order of preference for $u$) encodes this; it is a heuristic, not a theorem. Three patterns recur: a polynomial times $e^x$ or $\sin x$ needs one application per degree; a lone $\ln x$ or $\arctan x$ uses $v'=1$; and $e^x\sin x$ returns to itself after two applications, so it is solved for algebraically.

## Worked Examples

### Example 1: a standard substitution

$\int_0^2 \frac{x}{x^2+1}\,dx$. Let $u=x^2+1$, so $du=2x\,dx$ and $x\,dx=\tfrac12du$. When $x=0$, $u=1$; when $x=2$, $u=5$.

$$\int_0^2 \frac{x}{x^2+1}\,dx = \frac12\int_1^5\frac{du}{u} = \frac12\ln 5 \approx 0.80472$$

Symbolic evaluation and quadrature both give $0.804718956$. The $\ln$ is safe because $u\ge1>0$ on the whole path.

### Example 2: the limits are the whole job

$\int_0^2 2x\cos(x^2)\,dx$ with $u=x^2$: the limits become $0$ and $4$, giving $\int_0^4\cos u\,du = \sin4 \approx -0.7568$. Applying the old limits to the new antiderivative gives $\sin 2 \approx +0.9093$, which has the wrong sign as well as the wrong size. A case where $g$ is not monotone: $\int_0^\pi \cos x\,\sin^2x\,dx$ with $u=\sin x$ has limits $\sin0=0$ and $\sin\pi=0$, so the integral is $\int_0^0u^2du=0$. This is correct: $\sin^2 x\cos x$ is positive on $[0,\pi/2]$ and the mirror-image negative on $[\pi/2,\pi]$. Compare $\int_0^{\pi/2}\sin^2x\cos x\,dx=\int_0^1u^2du=\tfrac13$, where the same $u=\sin x$ runs from $0$ to $1$ and the sign never changes.

### Example 3: a trigonometric substitution

$\int_0^1\sqrt{1-x^2}\,dx$ is a quarter of the unit disk. Let $x=\sin\theta$, $dx=\cos\theta\,d\theta$, and $\theta$ runs from $0$ to $\pi/2$. On that range $\cos\theta\ge0$, so $\sqrt{1-\sin^2\theta}=\cos\theta$:

$$\int_0^{\pi/2}\cos^2\theta\,d\theta = \frac{\pi}{4}\approx0.7854$$

Matching the area of a quarter circle is a built-in check. The simplification $\sqrt{1-\sin^2\theta}=\cos\theta$ holds only where $\cos\theta\ge0$. Over $[0,\pi]$ it breaks: $\int_0^\pi\sqrt{1-\sin^2\theta}\,d\theta=\int_0^\pi\lvert\cos\theta\rvert\,d\theta=2$, while $\int_0^\pi\cos\theta\,d\theta=0$. That range would also be wrong for this substitution, since $\sin\theta$ rises to $1$ and returns to $0$ instead of tracing $[0,1]$ once.

### Example 4: a substitution that is not allowed

$\int_{-1}^{1}\frac{dx}{1+x^2}=2\arctan1=\frac\pi2\approx1.5708$. Try $u=1/x$: $dx=-du/u^2$, and $\frac{1}{1+x^2}=\frac{u^2}{u^2+1}$, so the integrand becomes $-\frac{du}{1+u^2}$, with limits $u=-1$ to $u=1$. The result would be $-\frac\pi2$, a negative number for a positive integrand. The map $x\mapsto1/x$ is undefined at $x=0$, which lies inside $[-1,1]$, so the hypotheses fail. On $[1,2]$ the same substitution is valid.

### Example 5: parts, three ways

$\int_0^1 xe^x\,dx$: $u=x$, $v'=e^x$, so $[xe^x]_0^1-\int_0^1e^x\,dx = e-(e-1)=1$.

$\int_1^e\ln x\,dx$: $u=\ln x$, $v'=1$, so $[x\ln x]_1^e-\int_1^e1\,dx = e-(e-1)=1$. This gives the antiderivative $x\ln x-x$.

$\int_0^1x^2e^x\,dx$: two applications give $[x^2e^x-2xe^x+2e^x]_0^1 = e-2\approx0.71828$. Each pass lowers the power of $x$ by one.

All three match symbolic and numerical evaluation.

### Example 6: a cyclic integral

Let $I=\int e^x\sin x\,dx$. With $u=\sin x$, $v'=e^x$: $I=e^x\sin x-\int e^x\cos x\,dx$. Applying parts again with the same roles ($u=\cos x$): $\int e^x\cos x\,dx = e^x\cos x+I$. Therefore $I=e^x\sin x-e^x\cos x-I$, so $I=\tfrac12e^x(\sin x-\cos x)+C$. On $[0,\pi]$ the value is $\frac{e^\pi+1}{2}\approx12.0703$, confirmed numerically. Swapping the roles on the second pass would undo the first and return $0=0$.

### Example 7: bounding $\ln(n!)$

Since $\ln x$ is increasing, each term satisfies $\int_{k-1}^{k}\ln x\,dx\le\ln k\le\int_k^{k+1}\ln x\,dx$. Summing $k=2,\dots,n$ and using $\int\ln x\,dx = x\ln x-x$:

$$n\ln n-n+1\ \le\ \ln(n!)\ \le\ (n+1)\ln(n+1)-(n+1)-2\ln2+2$$

| n | lower bound | ln(n!) | upper bound |
|---|---|---|---|
| 10 | 14.026 | 15.104 | 15.991 |
| 100 | 361.52 | 363.74 | 365.74 |
| 1000 | 5908.76 | 5912.13 | 5915.28 |

So $\ln(n!)=\Theta(n\ln n)$. A comparison sort must tell $n!$ possible orderings apart using yes/no answers, so it needs at least $\log_2(n!)=\ln(n!)/\ln2$ comparisons in the worst case, which is $\Theta(n\log n)$.

## Common Misconceptions & Pitfalls

- **Keeping the old limits after substituting.** The limits belong to the variable. After $u=g(x)$ they are $g(a)$ and $g(b)$ (Example 2).
- **Mixing variables.** An integral with both $x$ and $u$ in the integrand is not finished. Express the whole integrand in one variable, or the change of variable has not happened.
- **Substituting across a singularity.** $u=1/x$ or $u=\tan x$ on an interval containing a point where the map blows up is invalid (Example 4). Check that the map is defined and continuous along the whole path.
- **Dropping the absolute value.** $\sqrt{u^2}=\lvert u\rvert$. State the range of the angle in a trig substitution.
- **Expecting an antiderivative to exist in closed form.** Every continuous function has one (the accumulation function), but $e^{-x^2}$ and $\frac{\sin x}{x}$ have none among elementary functions, and no technique here will produce one.
- **Parts that go in circles.** If the new integral is harder, swap the roles. In cyclic problems keep the same roles on both passes.
- **Constants differ.** $\int\sin x\cos x\,dx$ is $\frac12\sin^2x$ by $u=\sin x$ and $-\frac12\cos^2x$ by $u=\cos x$. Both are right: they differ by the constant $\frac12$.

## Summary

Substitution is the chain rule run backwards: $\int_a^b f(g(x))g'(x)\,dx=\int_{g(a)}^{g(b)}f(u)\,du$ when $g'$ is continuous on $[a,b]$ and $f$ is continuous on the range of $g$, and the converted limits are part of the answer. In the other direction (trigonometric substitution) the map must also be defined and continuous across the interval, and a square root forces an absolute value unless the sign is known. Integration by parts is the product rule run backwards: $\int_a^b uv'=[uv]_a^b-\int_a^bu'v$ for continuously differentiable $u,v$. Choose $u$ to simplify when differentiated, repeat for polynomial factors, use $v'=1$ for lone $\ln$ and $\arctan$, and solve algebraically when the integral reappears. The antiderivative of $\ln x$ also bounds $\ln(n!)$, giving the $\Omega(n\log n)$ lower bound for comparison sorting. The next lesson, `applications-area-volume-and-average-value`, puts these tools to work on geometry.

## Documentation Links

- [OpenStax Calculus Volume 1, 5.5 Substitution](https://openstax.org/books/calculus-volume-1/pages/5-5-substitution): the substitution rule for indefinite and definite integrals, with worked examples.
- [OpenStax Calculus Volume 2, 3.1 Integration by Parts](https://openstax.org/books/calculus-volume-2/pages/3-1-integration-by-parts): the formula, choosing $u$ and $dv$, repeated and cyclic parts.
- [Active Calculus, 5.3 Integration by substitution](https://activecalculus.org/single/sec-5-3-substitution.html): substitution motivated by the chain rule, including definite integrals.
- [Active Calculus, 5.4 Integration by parts](https://activecalculus.org/single/sec-5-4-parts.html): parts as the product rule in reverse, with practice problems.
- [MIT OCW 18.01SC, Unit 4 Part B](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-4-techniques-of-integration/part-b-partial-fractions-integration-by-parts-arc-length-and-surface-area/): lectures on integration by parts alongside partial fractions.
