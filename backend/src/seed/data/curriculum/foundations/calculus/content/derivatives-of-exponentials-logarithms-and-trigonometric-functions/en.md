---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Explain why $e$ is the base whose exponential function is its own derivative, and derive $\frac{d}{dx} b^x = b^x \ln b$.
- Derive $\frac{d}{dx}\ln x = \frac{1}{x}$ from the exponential, and state its domain.
- State the derivatives of $\sin$, $\cos$, $\tan$ and the need for radians, and combine them with the chain rule.
- Differentiate an expression defined implicitly, and recognize the points where the method breaks down.
- Use logarithmic differentiation for expressions such as $x^x$ that the basic rules do not reach.

## Context & Motivation

The previous lesson, `differentiation-rules-and-the-chain-rule`, can differentiate any combination of powers, sums, products, quotients and compositions. Its reach stops at the first function that is not a power of $x$. Exponentials, logarithms and trigonometric functions are the functions that model growth, decay, scale and oscillation: compound interest, algorithm running times measured in $\log n$, probabilities in a classifier, a vibrating spring, a rotating coordinate frame. A differentiation toolkit that cannot handle them is not usable.

The exponential, sine and cosine have a property that polynomials lack: differentiating keeps them inside their family and never reduces them to $0$. The exponential's derivative is a multiple of itself, and $\sin$ and $\cos$ differentiate into each other, while differentiating a polynomial lowers its degree until nothing is left. The logarithm and the tangent do leave their family, giving $\frac{1}{x}$ and $\frac{1}{\cos^2 x}$, but the results are simple expressions in functions already known. The limit work differs from one to the next: the exponential needs one limit, sine and cosine need two, and the logarithm needs no new limit at all, because it follows from the exponential through the inverse relationship. Once a derivative is found, the chain rule carries it everywhere.

The lesson also covers two techniques that handle expressions where the variable sits where a basic rule does not expect it: **implicit differentiation**, for curves such as $x^2 + y^2 = 25$ that are not given as $y = f(x)$, and **logarithmic differentiation**, for expressions such as $x^x$.

## Core Theory

### The number $e$ and the exponential

For a base $b > 0$ the difference quotient of $b^x$ factors:

$$\frac{b^{x+h} - b^x}{h} = b^x \cdot \frac{b^h - 1}{h}.$$

The factor $b^x$ does not depend on $h$. If the limit $L(b) = \lim_{h \to 0} \frac{b^h - 1}{h}$ exists, then $\frac{d}{dx} b^x = L(b)\, b^x$: the derivative of an exponential is proportional to itself, and the whole question is the constant. Numerically, with $h = 10^{-6}$:

```text
b          L(b)
2          0.693147
2.5        0.916291
3          1.098613
10         2.302588
```

$L(2) < 1 < L(3)$. Three facts are taken as given here: the limit $L(b)$ exists for every $b > 0$, it changes continuously with $b$, and it is strictly increasing in $b$. Continuity and the Intermediate Value Theorem from `continuity-and-the-intermediate-value-theorem` then give a base between $2$ and $3$ with $L(b) = 1$, and the strict increase makes it the only one. That base is called $e \approx 2.718281828$. With $b = e$ the constant is $1$:

$$\frac{d}{dx} e^x = e^x.$$

So $e$ is not an arbitrary choice: it is the base for which the slope of the graph equals its height at every point. The same number is the limit of $\left(1 + \frac{1}{n}\right)^n$, which takes the values $2$, $2.5937$, $2.7048$, $2.71815$, $2.718280$ for $n = 1, 10, 100, 10^4, 10^6$ (the equivalence of the two descriptions is proved in the textbooks cited below).

The natural logarithm $\ln$ is the inverse of $e^x$, so $b = e^{\ln b}$ for any $b > 0$. Writing $b^x = e^{x \ln b}$ and using the chain rule:

$$\frac{d}{dx} b^x = b^x \ln b.$$

This also identifies the table's constant, $L(b) = \ln b$: indeed $\ln 2 = 0.693147$ and $\ln 10 = 2.302585$. Example: $\frac{d}{dx}2^x$ at $x = 3$ is $8 \ln 2 \approx 5.545$. A misapplied power rule would give $x \cdot 2^{x-1} = 12$ at $x = 3$, which is wrong because $2^x$ is not a power of $x$.

### The logarithm

Let $y = \ln x$ for $x > 0$, so that $e^y = x$. Differentiate both sides with respect to $x$. The right side gives $1$. The left side, by the chain rule, gives $e^y \cdot y'$. Therefore

$$\frac{d}{dx} \ln x = \frac{1}{e^y} = \frac{1}{x}, \qquad x > 0.$$

This step assumes $y$ is differentiable, which holds because the inverse of a differentiable function with nonzero derivative is differentiable; $e^y > 0$ ensures that. For $x \neq 0$, $\frac{d}{dx}\ln\lvert x \rvert = \frac{1}{x}$, which is why antiderivatives of $\frac{1}{x}$ later carry an absolute value. With the chain rule, $\frac{d}{dx} \ln g(x) = \frac{g'(x)}{g(x)}$ wherever $g(x) > 0$. For another base, $\log_b x = \frac{\ln x}{\ln b}$ gives $\frac{1}{x \ln b}$.

### Sine, cosine and tangent

The derivatives of $\sin$ and $\cos$ come from the angle-addition formula and two limits. The first, $\lim_{h \to 0} \frac{\sin h}{h} = 1$, is the squeeze-theorem result of `limit-laws-and-indeterminate-forms`. The second, $\lim_{h \to 0} \frac{\cos h - 1}{h} = 0$, follows from that lesson's $\frac{1 - \cos h}{h^2} \to \frac{1}{2}$, because $\frac{\cos h - 1}{h} = -h \cdot \frac{1 - \cos h}{h^2} \to 0 \cdot \frac{1}{2}$. Then:

$$\frac{\sin(x+h) - \sin x}{h} = \sin x \cdot \frac{\cos h - 1}{h} + \cos x \cdot \frac{\sin h}{h} \to \cos x.$$

The same computation for cosine gives $-\sin x$:

$$\frac{d}{dx}\sin x = \cos x, \qquad \frac{d}{dx}\cos x = -\sin x.$$

Both limits are statements about angles in **radians**. In degrees, $\sin h^\circ \approx \frac{\pi}{180} h$, so $\frac{d}{dx}\sin(x^\circ) = \frac{\pi}{180}\cos(x^\circ)$, about $0.017453$ at $x = 0$. Radians are what make the derivative formula clean. By the quotient rule, $\frac{d}{dx}\tan x = \frac{1}{\cos^2 x} = 1 + \tan^2 x$, valid wherever $\cos x \neq 0$. Two inverse functions follow from the same inverse argument used for the logarithm: $\frac{d}{dx}\arctan x = \frac{1}{1 + x^2}$ for all $x$, and $\frac{d}{dx}\arcsin x = \frac{1}{\sqrt{1 - x^2}}$ on $(-1, 1)$ only. The latter grows without bound toward the endpoints: it is $2.29$ at $x = 0.9$, $7.09$ at $0.99$ and $707$ at $0.999999$.

### Implicit differentiation

Sometimes a curve is given by an equation relating $x$ and $y$ rather than by a formula $y = f(x)$. If near a point $y$ is a differentiable function of $x$, differentiate both sides of the equation with respect to $x$, treating $y$ as $y(x)$ so that the chain rule contributes a factor $y'$ to every term containing $y$, then solve for $y'$.

For $x^2 + y^2 = 25$, differentiating gives $2x + 2y\,y' = 0$, so $y' = -\frac{x}{y}$, valid where $y \neq 0$. At $y = 0$ the circle has a vertical tangent and $y$ is not a function of $x$ near that point, so there is no $y'$ to find. The method silently assumes what it needs; it returns a formula even in places where the assumption is false, and the denominator is where to look.

### Logarithmic differentiation

When the variable is in both the base and the exponent, or an expression is a long product and quotient, take the logarithm first. For $y = f(x) > 0$:

$$\ln y = \ln f(x) \quad\Rightarrow\quad \frac{y'}{y} = \frac{d}{dx}\ln f(x) \quad\Rightarrow\quad y' = y \cdot \frac{d}{dx}\ln f(x).$$

If $y$ can be negative but not zero, use $\ln\lvert y \rvert$, whose derivative is also $\frac{y'}{y}$. The same idea proves the general power rule: for $x > 0$ and any real $r$, $x^r = e^{r \ln x}$ and $\frac{d}{dx} x^r = e^{r \ln x} \cdot \frac{r}{x} = r x^{r-1}$.

## Worked Examples

### Example 1: the sigmoid

The logistic function $\sigma(z) = \dfrac{1}{1 + e^{-z}}$ is defined for all real $z$ and turns any real score into a number in $(0, 1)$. By the chain rule applied to the reciprocal,

$$\sigma'(z) = \frac{e^{-z}}{(1 + e^{-z})^2} = \sigma(z)\big(1 - \sigma(z)\big).$$

The second form is obtained by writing $\frac{e^{-z}}{1 + e^{-z}} = 1 - \sigma(z)$. Values, checked against a central difference:

```text
z      sigma(z)   sigma'(z)
-5     0.006693   0.006648
 0     0.500000   0.250000
 2     0.880797   0.104994
 5     0.993307   0.006648
```

The derivative is largest at $z = 0$ with value $\frac{1}{4}$, because $p(1-p) \leq \frac{1}{4}$ for any $p$, and it decays on both sides. This is the factor each sigmoid layer contributes to the product in a backward pass: ten of them at their best multiply to at most $0.25^{10} \approx 9.5 \times 10^{-7}$, a concrete reason why deep stacks of sigmoids train slowly.

### Example 2: oscillation

A mass on a spring has position $x(t) = 3\cos(2t)$ (meters, $t$ in seconds). With the chain rule:

$$v(t) = x'(t) = -6\sin(2t), \qquad a(t) = v'(t) = -12\cos(2t).$$

Comparing, $a(t) = -4\,x(t)$: acceleration is proportional to displacement and opposite in sign, the signature of harmonic motion. At $t = 0.5$: $x = 1.6209$, $v = -5.0488$ m/s, $a = -6.4836$ m/s$^2$, and indeed $-4 \times 1.6209 = -6.4836$. Because the function is $\cos(2t)$, not $\cos t$, each derivative picks up a factor $2$ from the chain rule.

### Example 3: implicit differentiation

For $x^3 + y^3 = 6xy$ (a curve called the folium of Descartes), the point $(3, 3)$ lies on it since $27 + 27 = 54 = 6 \cdot 9$. Differentiate both sides, using the product rule on $6xy$:

$$3x^2 + 3y^2 y' = 6y + 6x y' \quad\Rightarrow\quad y' = \frac{2y - x^2}{y^2 - 2x}.$$

Solving requires $y^2 \neq 2x$. At $(3, 3)$: $y' = \frac{6 - 9}{9 - 6} = -1$. The tangent line is $y - 3 = -(x - 3)$. For the circle at $(3, 4)$ the same method gives $y' = -\frac{3}{4}$, and at $(5, 0)$ the denominator $y$ is zero, matching the vertical tangent.

### Example 4: logarithmic differentiation of $x^x$

For $x > 0$, let $y = x^x$. Then $\ln y = x \ln x$. Differentiate both sides, using the product rule on the right:

$$\frac{y'}{y} = \ln x + x \cdot \frac{1}{x} = \ln x + 1 \quad\Rightarrow\quad y' = x^x(\ln x + 1).$$

At $x = 2$: $y' = 4(\ln 2 + 1) \approx 6.7726$, and a central difference gives $6.77259$. The power rule would give $x \cdot x^{x-1} = x^x$ here, and the exponential rule alone would give $x^x \ln x$; each captures only one of the two places the variable appears, so the true derivative is the sum of both contributions.

## Common Misconceptions & Pitfalls

- **"$\frac{d}{dx} e^x = x e^{x-1}$."** The power rule is for a variable base with a constant exponent. In $e^x$ the variable is in the exponent, and the derivative is $e^x$.
- **"$\frac{d}{dx}\ln(x^2) = \frac{1}{x^2}$."** The chain rule gives $\frac{2x}{x^2} = \frac{2}{x}$, the same as the derivative of $2\ln\lvert x \rvert$.
- **"The derivative of $\cos x$ is $\sin x$."** The sign is negative. A quick check: $\cos$ is decreasing just after $x = 0$, so its slope there must be negative, and $-\sin x$ is negative for small $x > 0$.
- **"Trigonometric derivative formulas hold in any angle unit."** They hold in radians. Using degrees brings a factor $\frac{\pi}{180}$ into every derivative.
- **"Implicit differentiation always yields $y'$."** It yields $y'$ where $y$ is locally a differentiable function of $x$. Where the denominator vanishes, as at $(5, 0)$ on the circle, the curve may have a vertical tangent and no $y'$.
- **"Logarithmic differentiation works for any $y$."** It needs $y \neq 0$ (use $\ln\lvert y \rvert$ if $y < 0$), and $x^x$ is only defined as a real function for $x > 0$ here.

## Summary

The exponential $b^x$ has derivative $L(b)\,b^x$, and $e$ is the base for which $L(e) = 1$, so $\frac{d}{dx}e^x = e^x$ and, in general, $\frac{d}{dx} b^x = b^x \ln b$. The logarithm follows from the inverse relationship: $\frac{d}{dx}\ln x = \frac{1}{x}$ for $x > 0$, and $\frac{g'}{g}$ for $\ln g$ where $g > 0$. For trigonometric functions, $\sin' = \cos$, $\cos' = -\sin$ and $\tan' = \frac{1}{\cos^2}$ where $\cos \neq 0$, all in radians. With the chain rule these reach sigmoids, oscillations and growth laws. Implicit differentiation handles curves given by an equation, with the denominator showing where it fails, and logarithmic differentiation handles variable exponents, giving $\frac{d}{dx}x^x = x^x(\ln x + 1)$ for $x > 0$ and the general power rule for real exponents. These derivatives make the derivative toolkit complete for the elementary functions, and the next lesson, `the-mean-value-theorem-and-monotonicity`, begins using derivatives to draw conclusions about what a function does.

## Documentation Links

- [OpenStax Calculus Volume 1, 3.9 Derivatives of Exponential and Logarithmic Functions](https://openstax.org/books/calculus-volume-1/pages/3-9-derivatives-of-exponential-and-logarithmic-functions): derivatives of $e^x$, $\ln x$ and general bases, and logarithmic differentiation
- [OpenStax Calculus Volume 1, 3.5 Derivatives of Trigonometric Functions](https://openstax.org/books/calculus-volume-1/pages/3-5-derivatives-of-trigonometric-functions): derivatives of the six trigonometric functions
- [OpenStax Calculus Volume 1, 3.8 Implicit Differentiation](https://openstax.org/books/calculus-volume-1/pages/3-8-implicit-differentiation): implicit differentiation and tangent lines to implicitly defined curves
- [MIT OCW 18.01SC, Session 17: The Exponential Function, its Derivative, and its Inverse](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-b-implicit-differentiation-and-inverse-functions/session-17-the-exponential-function-its-derivative-and-its-inverse/): the exponential function, its derivative and its inverse in video clips and notes
- [MIT OCW 18.01SC, Session 19: An Interesting Limit Involving e](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-b-implicit-differentiation-and-inverse-functions/session-19-an-interesting-limit-involving-e/): the limit of $(1 + 1/n)^n$ and its link to $e$
- [Active Calculus, 2.7 Derivatives of functions given implicitly](https://activecalculus.org/single/sec-2-7-implicit.html): implicit differentiation with exercises
