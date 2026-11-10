---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- State both parts of the Fundamental Theorem of Calculus with every hypothesis, and say which part answers "what is the derivative of an integral" and which answers "how do I evaluate an integral".
- Differentiate functions defined by integrals, including ones with variable limits, using the chain rule.
- Evaluate definite integrals as $F(b)-F(a)$ and explain why the constant of integration drops out.
- Separate displacement from total distance when a velocity changes sign.
- Show with a concrete case that dropping a hypothesis makes each part fail.
- Use accumulation functions for quantities with no elementary antiderivative, such as $\operatorname{erf}$.

## Context & Motivation

In `the-definite-integral-and-riemann-sums` an integral was a limit of sums, and the exact value of even $\int_0^b x^2\,dx$ needed a summation formula and a limit. Meanwhile `antiderivatives-and-initial-value-problems` reversed differentiation without any mention of area. The Fundamental Theorem of Calculus (FTC) says these two projects are the same project: accumulating a rate and undoing a derivative are inverse operations. It turns a limit of $n$ terms into two function evaluations.

In computing the theorem shows up in two ways. Any cumulative quantity (total bytes sent from a rate, a cumulative distribution function from a density) has the rate as its derivative. And when no antiderivative can be written down, as for the bell curve, the theorem still tells you the derivative of the accumulated quantity, which is what numerical methods and gradient-based fitting need.

A note on naming: OpenStax calls the derivative statement Part 1 and the evaluation statement Part 2, as this lesson does. MIT 18.01SC and Active Calculus call the evaluation statement the first theorem and the derivative statement the second. Check which convention a source uses before quoting "the first theorem".

## Core Theory

### Accumulation functions

For $f$ integrable on $[a,b]$, define $F(x) = \int_a^x f(t)\,dt$ for $x\in[a,b]$. The integration variable is a dummy, so use a different letter ($t$) from the upper limit ($x$). $F(x)$ is the net area accumulated from $a$ up to $x$.

### Part 1: the derivative of an accumulation

**Theorem.** If $f$ is continuous on $[a,b]$ and $F(x)=\int_a^x f(t)\,dt$, then $F$ is continuous on $[a,b]$, differentiable on $(a,b)$, and $F'(x) = f(x)$ for every $x\in(a,b)$ (one-sided at the endpoints).

The idea: $\frac{F(x+h)-F(x)}{h} = \frac1h\int_x^{x+h} f(t)\,dt$ is the average of $f$ on $[x,x+h]$. As $h\to0$ that interval collapses onto $x$, and continuity forces the average to approach $f(x)$. Numerically, for $f=\cos$ at $x=0.5$ the averages are 0.7241 ($h=0.5$), 0.8522 ($0.1$), 0.87517 ($0.01$), 0.87734 ($0.001$), heading to $\cos 0.5 = 0.87758$.

With variable limits, and $f$ continuous, $g,h$ differentiable:

$$\frac{d}{dx}\int_{h(x)}^{g(x)} f(t)\,dt = f(g(x))\,g'(x) - f(h(x))\,h'(x)$$

### Part 2: evaluation

**Theorem.** If $f$ is continuous on $[a,b]$ and $F$ is any antiderivative of $f$ on $[a,b]$ (that is, $F'=f$ there), then

$$\int_a^b f(x)\,dx = F(b) - F(a) = \big[F(x)\big]_a^b$$

Why: $G(x)=\int_a^x f$ is an antiderivative by Part 1. Two antiderivatives on an interval differ by a constant (a zero derivative on an interval means constant, see `the-mean-value-theorem-and-monotonicity`), so $F = G + C$, and $F(b)-F(a) = G(b)-G(a) = \int_a^b f$. If you write $F+C$ the $C$ cancels in the subtraction, so definite integrals need no constant.

Continuity of $f$ is the simple sufficient condition. The theorem holds more generally when $f$ is integrable and $F$ is continuous on $[a,b]$ with $F'=f$ except at finitely many points. For example, $F(x)=x^2\sin(1/x)$ with $F(0)=0$ has $F'(x)=2x\sin(1/x)-\cos(1/x)$ for $x\ne0$ and $F'(0)=0$, which is bounded but discontinuous at $0$, and $\int_0^1F'=F(1)-F(0)=\sin1\approx0.8415$.

### Net change

Read Part 2 with $F$ as a quantity and $f=F'$ as its rate: $\int_a^b F'(x)\,dx = F(b)-F(a)$, the net change. For velocity $v$, $\int_a^b v\,dt$ is **displacement** and $\int_a^b \lvert v\rvert\,dt$ is **distance travelled**. They differ whenever $v$ changes sign.

Programs use the discrete twin of this idea all the time. With a prefix-sum array $P[k]=\sum_{i\le k} a_i$, the sum of any range is $P[b]-P[a-1]$: the sum of the rate, taken as a difference of two cumulative values, with no loop over the range. Part 2 is the same trade for continuous $f$, and the difference $a_k = P[k]-P[k-1]$ plays the role of $F'=f$.

### When the hypotheses fail

- **Part 2 with an unbounded $f$.** On $[-1,1]$ take $f(x)=1/x^2$ and $F(x)=-1/x$. Then $F'=f$ for $x\ne0$, but $F$ is not continuous at $0$ and $f$ is unbounded there. The mechanical subtraction gives $F(1)-F(-1) = -1-1 = -2$, a negative number for a positive function. The function is unbounded at $0$, so it has no Riemann integral. Midpoint sums with $n=10, 100, 1000, 10000$ are 47.4, 491.5, 4932.8, 49346.0: they grow about like $n$ and never settle (sympy reports $\infty$).
- **Part 1 without continuity.** Let $f(x)=1$ for $x\ne0$ and $f(0)=0$. Changing one value does not change any integral, so $\int_0^x f = x$, whose derivative at $0$ is $1$, not $f(0)=0$. Likewise $f(t)=\operatorname{sgn}t$ gives $\int_0^x f=\lvert x\rvert$, with no derivative at $0$.

### Integrals with no elementary antiderivative

$e^{-t^2}$ is continuous, so $\int_0^x e^{-t^2}dt$ exists and Part 1 gives its derivative, but no combination of elementary functions has $e^{-x^2}$ as its derivative. The accumulation is a new function, $\operatorname{erf}(x) = \frac{2}{\sqrt\pi}\int_0^x e^{-t^2}dt$, with $\operatorname{erf}'(x) = \frac{2}{\sqrt\pi}e^{-x^2}$. Values come from numerical integration.

## Worked Examples

### Example 1: variable limits

Let $G(x)=\int_x^{x^2}\frac{dt}{1+t^4}$. Both limits depend on $x$:

$$G'(x) = \frac{2x}{1+x^8} - \frac{1}{1+x^4}$$

At $x=1.3$ the formula gives $0.02459688709$. A central difference of numerical integrals gives $0.02459688711$. For a single variable limit, $\frac{d}{dx}\int_0^{x^2}e^{-t^2}dt = 2x\,e^{-x^4}$, the factor $2x$ coming from the chain rule.

### Example 2: evaluating with an antiderivative

$$\int_1^4\Big(3\sqrt{x}+\frac2x\Big)dx = \Big[2x^{3/2} + 2\ln x\Big]_1^4 = (16 + 2\ln4) - 2 = 14 + 4\ln 2 \approx 16.7726$$

Differentiating $2x^{3/2}+2\ln x$ returns $3\sqrt x + 2/x$, and quadrature gives $16.77258872$. The $\ln$ is legitimate because $[1,4]$ lies in $x>0$, where $1/x$ is continuous.

### Example 3: displacement versus distance

A particle has $v(t)=t^2-4t+3=(t-1)(t-3)$ on $[0,4]$, with antiderivative $\frac{t^3}{3}-2t^2+3t$. The sign changes at $t=1$ and $t=3$, so split there:

$$\int_0^1 v = \tfrac43, \qquad \int_1^3 v = -\tfrac43, \qquad \int_3^4 v = \tfrac43$$

Displacement is $\frac43-\frac43+\frac43 = \frac43$; distance is $\frac43+\frac43+\frac43 = 4$. Integrating $v$ over the whole interval and calling it "distance" would report $\frac43$, off by a factor of 3.

### Example 4: reading an accumulation function

Let $F(x)=\int_0^x (t-1)(t-2)\,dt = \frac{x^3}{3}-\frac{3x^2}{2}+2x$. By Part 1, $F'(x)=(x-1)(x-2)$, which is positive for $x<1$, negative on $(1,2)$, and positive for $x>2$. So $F$ rises, then falls, then rises: a local maximum at $x=1$ with $F(1)=\frac56$ and a local minimum at $x=2$ with $F(2)=\frac23$. Numerical integration gives $0.8333$ and $0.6667$, and $F(3)=\frac32$. The shape of $F$ was read from the sign of $f$ without computing $F$.

### Example 5: a function without a formula

By Part 1, $\operatorname{erf}'(0.7) = \frac{2}{\sqrt\pi}e^{-0.49} = 0.69127486$, and a finite difference of the library $\operatorname{erf}$ agrees to $10^{-11}$. Midpoint sums of $\frac{2}{\sqrt\pi}\int_0^1 e^{-t^2}dt$ with $n=4, 8, 16, 64, 256$ give 0.84487, 0.84324, 0.84284, 0.842709, 0.842701, against $\operatorname{erf}(1)=0.8427007929$. Values like those in the Z-table of `the-normal-distribution` come from this kind of numerical integration: $P(\lvert Z\rvert<1) = \operatorname{erf}(1/\sqrt2) = 0.6827$, the roughly 68% of the 68-95-99.7 rule.

## Common Misconceptions & Pitfalls

- **"Any $F$ with $F'=f$ off a few points will do."** $F$ must also be continuous on $[a,b]$. Take $f=0$ and $F=\lfloor x\rfloor$ on $[0,2]$: $F'=f$ except at the integers, yet $F(2)-F(0)=2$ while $\int_0^2f=0$. The jump in $-1/x$ at $0$ (Core Theory) is the same failure. A corner is harmless: $F=\lvert x\rvert$ with $f=\operatorname{sgn}$ on $[-1,2]$ gives $F(2)-F(-1)=1=\int_{-1}^{2}\operatorname{sgn}$.
- **"The derivative of $\int_a^{g(x)} f$ is $f(g(x))$."** The inner derivative is missing: it is $f(g(x))\,g'(x)$. And if both limits are constants, the derivative is $0$, because the integral is a number.
- **"Definite integrals need $+C$."** The constant cancels. Writing it does no harm, but it is not part of the answer.
- **"Integral of velocity is distance."** It is displacement. Distance needs $\int\lvert v\rvert$, split at sign changes.
- **"Part 1 and Part 2 are the same fact."** Part 1 produces antiderivatives for every continuous $f$ (including ones with no formula); Part 2 uses an antiderivative you already have to compute a number.
- **Reusing $x$ as both limit and variable**, as in $\int_0^x f(x)\,dx$. It runs, but invites mistakes in differentiation. Rename the inner variable.

## Summary

For continuous $f$ on $[a,b]$, Part 1 says the accumulation $F(x)=\int_a^x f(t)\,dt$ is differentiable with $F'=f$, and with variable limits the chain rule adds $g'(x)$ factors. Part 2 says $\int_a^b f = F(b)-F(a)$ for any antiderivative $F$, so definite integrals become two evaluations and the constant of integration cancels. Read as net change, the integral of a rate is the change in the quantity, which is why velocity gives displacement and $\int\lvert v\rvert$ gives distance. Part 1 needs continuity of $f$ at the point in question (a single changed value breaks it there). Part 2 needs $f$ integrable and $F$ continuous on $[a,b]$: $1/x^2$ on $[-1,1]$ fails both, and $F=\lfloor x\rfloor$ with $f=0$ shows that a jump in $F$ breaks the formula. When no elementary antiderivative exists, as with $e^{-t^2}$, the accumulation function is still well defined and has a known derivative, and its values come from numerical integration. The next lesson, `integration-by-substitution-and-by-parts`, builds the techniques for finding antiderivatives.

## Documentation Links

- [OpenStax Calculus Volume 1, 5.3 The Fundamental Theorem of Calculus](https://openstax.org/books/calculus-volume-1/pages/5-3-the-fundamental-theorem-of-calculus): both parts, the mean value theorem for integrals, and the chain rule with variable limits.
- [OpenStax Calculus Volume 1, 5.4 Integration Formulas and the Net Change Theorem](https://openstax.org/books/calculus-volume-1/pages/5-4-integration-formulas-and-the-net-change-theorem): the net change theorem and displacement versus total distance.
- [Active Calculus, 4.4 The Fundamental Theorem of Calculus](https://activecalculus.org/single/sec-4-4-FTC.html): the evaluation theorem, motivated by velocity and distance.
- [Active Calculus, 5.2 The Second Fundamental Theorem of Calculus](https://activecalculus.org/single/sec-5-2-FTC2.html): accumulation functions and their derivatives.
- [MIT OCW 18.01SC, Unit 3 Part B](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-3-the-definite-integral-and-its-applications/part-b-second-fundamental-theorem-areas-volumes/): lectures on the second fundamental theorem and its proof.
