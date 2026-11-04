---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Apply the constant-multiple, sum, power, product and quotient rules, and state the domain on which each is valid.
- Derive the power, product and quotient rules from the limit definition of the derivative.
- State the chain rule with its hypotheses, and read it as the composition of two local linear approximations.
- Differentiate nested compositions layer by layer, and avoid the usual errors (forgetting the inner derivative, using $(fg)' = f'g'$).
- Explain how the product and chain rules let a program compute exact derivatives automatically, and why the chain rule is what backpropagation applies.

## Context & Motivation

The previous lesson, `the-derivative-as-a-rate-of-change`, defined $f'(a)$ as a limit and computed it for $x^2$, $\frac{1}{x}$ and $\sqrt{x}$ with a separate piece of algebra each time. That does not scale. A function such as $\sqrt{1 + (3x^2 - x)^2}$ would need a page of algebra under the limit sign, and a function defined by a program with thousands of operations is out of the question.

The way out is to differentiate a function by its structure. Almost every function in this course is built from a small supply of basic functions joined by arithmetic (sums, products, quotients) and by composition ($f$ applied to the output of $g$). If the derivative of each joining operation is known, the derivative of the whole follows mechanically. The rules of this lesson are those operations' derivatives, the sum, power, product and quotient rules each proved from the definition once, and the chain rule justified by a linear-approximation argument, then used forever.

The chain rule, the rule for composition, is the one with the most reach. A deep neural network is a long composition of simple layers, and the derivative of its loss with respect to an early parameter is obtained by multiplying local derivatives layer by layer (in the multivariable form of the rule, `partial-derivatives-and-the-multivariable-chain-rule`). Organizing that product efficiently is what backpropagation does. This lesson only teaches the rule that makes it possible, not the algorithm.

## Core Theory

### Linearity and the power rule

If $f$ and $g$ are differentiable at $x$ and $c$ is a constant, then $(cf)' = c f'$ and $(f + g)' = f' + g'$. Both follow at once from the limit laws applied to the difference quotient. The derivative of a constant is $0$.

**Power rule.** For a positive integer $n$, $\frac{d}{dx} x^n = n x^{n-1}$. Expand with the binomial theorem:

$$\frac{(x+h)^n - x^n}{h} = \frac{n x^{n-1} h + \binom{n}{2} x^{n-2} h^2 + \cdots + h^n}{h} = n x^{n-1} + \binom{n}{2} x^{n-2} h + \cdots + h^{n-1}.$$

Every term after the first still contains a factor of $h$, so it vanishes in the limit. The rule extends to negative integers through the quotient rule below, valid for $x \neq 0$. For other real exponents it is proved in `derivatives-of-exponentials-logarithms-and-trigonometric-functions`, where it holds for $x > 0$. Until then, use it for integer exponents only.

### The product rule

If $f$ and $g$ are differentiable at $x$, then

$$(fg)' = f'g + fg'.$$

Derivation: add and subtract $f(x+h)\,g(x)$ in the numerator,

$$\frac{f(x+h)g(x+h) - f(x)g(x)}{h} = f(x+h)\,\frac{g(x+h) - g(x)}{h} + g(x)\,\frac{f(x+h) - f(x)}{h}.$$

As $h \to 0$ the quotients become $g'(x)$ and $f'(x)$, and $f(x+h) \to f(x)$ because a differentiable function is continuous. That step is essential: the argument needs $\lim_{h \to 0} f(x+h) = f(x)$, and it holds because $f$ is differentiable at $x$. The rule is not $f'g'$: with $f = g = x$, the product is $x^2$ with derivative $2x$, while $f'g' = 1$.

### The quotient rule

If $f$ and $g$ are differentiable at $x$ and $g(x) \neq 0$, then

$$\left(\frac{f}{g}\right)' = \frac{f'g - fg'}{g^2}.$$

First the reciprocal: $\frac{1}{h}\left(\frac{1}{g(x+h)} - \frac{1}{g(x)}\right) = -\frac{g(x+h) - g(x)}{h}\cdot\frac{1}{g(x+h)\,g(x)} \to -\frac{g'(x)}{g(x)^2}$, which uses $g(x) \neq 0$ and continuity of $g$. Then $\frac{f}{g} = f \cdot \frac{1}{g}$ and the product rule give the formula. The order in the numerator matters, because the difference is not symmetric. The condition $g(x) \neq 0$ is not enough on its own: with $f(x) = \lvert x \rvert$ and $g(x) = 1$ at $x = 0$, the denominator is $1$, yet $\frac{f}{g} = \lvert x \rvert$ has no derivative there, because $f$ does not.

### The chain rule

**Theorem.** If $g$ is differentiable at $x$ and $f$ is differentiable at $g(x)$, then $f \circ g$ is differentiable at $x$ and

$$(f \circ g)'(x) = f'\big(g(x)\big)\, g'(x).$$

In Leibniz form, with $u = g(x)$ and $y = f(u)$: $\frac{dy}{dx} = \frac{dy}{du}\cdot\frac{du}{dx}$.

**Why it is true.** Use the linear-approximation reading from the previous lesson. A small step $h$ in $x$ moves the inner output by about $g'(x)\,h$. A small step of size $k$ in $u$ moves the outer output by about $f'(u)\,k$. Chaining the two, with $k = g'(x)\,h$, gives a change of about $f'(g(x))\,g'(x)\,h$ in the final output. Composing two local linear maps multiplies their slopes. A line with slope $3$ followed by a line with slope $4$ is a line with slope $12$.

The naive proof, multiplying and dividing by $g(x+h) - g(x)$, divides by zero whenever $g$ takes the same value at nearby points. A complete proof rewrites the approximation as an equality with an error function that goes to $0$. The statement above is the standard theorem.

**The hypotheses matter, but neither is necessary for the conclusion.** Let $g(x) = x^2$ and $f(u) = \sqrt{u}$, so $f(g(x)) = \sqrt{x^2} = \lvert x \rvert$. For $x \neq 0$ the chain rule gives $\frac{1}{2\sqrt{x^2}} \cdot 2x = \frac{x}{\lvert x \rvert}$, which is $\pm 1$ as it should be. At $x = 0$ the outer function $\sqrt{u}$ is not differentiable at $u = g(0) = 0$, so the theorem does not apply, and the conclusion fails: $\lvert x \rvert$ has a corner at $0$. The inner hypothesis can fail the same way: with $g(x) = \lvert x \rvert$ and $f(u) = u$, $g$ is not differentiable at $0$ and neither is $f \circ g = \lvert x \rvert$. But failing a hypothesis only removes the guarantee. With $g(x) = \lvert x \rvert$ and $f(u) = u^2$, $g$ is not differentiable at $0$, yet $f \circ g = x^2$ is.

### Layer by layer

For a composition of several functions, differentiate from the outside in, multiplying as you go. For $y = f(g(h(x)))$:

$$\frac{dy}{dx} = f'\big(g(h(x))\big)\cdot g'\big(h(x)\big)\cdot h'(x).$$

A program evaluates a composition from the inside out and can multiply the local derivatives in the same pass. That observation is the basis of forward-mode automatic differentiation, shown in Example 3.

## Worked Examples

### Example 1: quotient rule, domain and tangent line

Differentiate $f(x) = \dfrac{3x^2 + 1}{x^2 - 2}$.

The domain excludes $x = \pm\sqrt{2}$, where the denominator vanishes. Applying the quotient rule:

$$f'(x) = \frac{6x(x^2 - 2) - (3x^2 + 1)(2x)}{(x^2 - 2)^2} = \frac{6x^3 - 12x - 6x^3 - 2x}{(x^2 - 2)^2} = \frac{-14x}{(x^2 - 2)^2}.$$

At $x = 1$: $f(1) = \frac{4}{-1} = -4$ and $f'(1) = -14$. A central difference with step $10^{-6}$ gives $-14.000000$, confirming the algebra. The tangent line is $y = -4 - 14(x - 1)$. It predicts $f(1.01) \approx -4.14$, and the true value is $-4.1436$. At $x = 1.1$ it predicts $-5.4$ while the true value is $-5.8608$: the function is heading toward the vertical asymptote at $\sqrt{2} \approx 1.414$, and the line cannot follow it.

### Example 2: a three-layer chain

Differentiate $F(x) = \sqrt{1 + (3x^2 - x)^2}$.

Name the layers: $u = 3x^2 - x$, then $v = 1 + u^2$, then $F = \sqrt{v}$. Multiply the local derivatives:

$$F'(x) = \frac{1}{2\sqrt{v}} \cdot 2u \cdot (6x - 1) = \frac{(3x^2 - x)(6x - 1)}{\sqrt{1 + (3x^2 - x)^2}}.$$

Here $v \geq 1 > 0$ for every $x$, so the outer square root is always evaluated at a point where it is differentiable, and $F'$ exists on all of $\mathbb{R}$. At $x = 1$: $u = 2$, $v = 5$, so $F'(1) = \frac{2 \cdot 5}{\sqrt{5}} = 2\sqrt{5} \approx 4.4721$. A central difference gives $4.47214$.

### Example 3: the chain rule inside a program

Forward-mode automatic differentiation carries a pair (value, derivative) through every operation. The product rule defines multiplication of pairs, and the chain rule defines how a function such as $\sqrt{\cdot}$ transforms them:

```python
import math

class Dual:
    def __init__(self, v, d=0.0):
        self.v, self.d = v, d                      # value and derivative
    def __add__(self, o):
        o = o if isinstance(o, Dual) else Dual(o)
        return Dual(self.v + o.v, self.d + o.d)    # sum rule
    __radd__ = __add__
    def __sub__(self, o):
        o = o if isinstance(o, Dual) else Dual(o)
        return Dual(self.v - o.v, self.d - o.d)
    def __mul__(self, o):
        o = o if isinstance(o, Dual) else Dual(o)
        return Dual(self.v * o.v, self.d * o.v + self.v * o.d)   # product rule
    __rmul__ = __mul__

def dsqrt(a):
    r = math.sqrt(a.v)
    return Dual(r, a.d / (2 * r))                  # chain rule with outer derivative 1/(2 sqrt)

def F(x):
    u = 3 * x * x - x
    return dsqrt(1 + u * u)

out = F(Dual(1.0, 1.0))        # seed: dx/dx = 1
print(out.v, out.d)            # 2.23606797749979 4.47213595499958
```

The program prints $\sqrt{5}$ and $2\sqrt{5}$, matching Example 2 without any symbolic algebra and without a step size, so the trade-off between truncation and cancellation error seen in the previous lesson's numerical differences does not arise. Only ordinary rounding remains.

## Common Misconceptions & Pitfalls

- **"The derivative of a product is the product of the derivatives."** It is $f'g + fg'$. The counter-example $x \cdot x$ has derivative $2x$, not $1$.
- **"Differentiating $(x^2 + 1)^3$ gives $3(x^2 + 1)^2$."** That omits the inner derivative. The correct answer is $3(x^2+1)^2 \cdot 2x = 6x^5 + 12x^3 + 6x$, which at $x = 1$ is $24$, twice the wrong value $12$.
- **"The quotient rule numerator can be written in either order."** It is $f'g - fg'$. Swapping the two terms flips the sign of the result.
- **"The power rule works for any exponent, including a variable one."** $\frac{d}{dx}x^n = n x^{n-1}$ holds when the exponent is a constant. For $2^x$ the variable is in the exponent and the rule gives the wrong answer, a case treated in the next lesson.
- **"Rules apply anywhere the formula can be written down."** They apply where the hypotheses hold. Take $f(u) = u^{2/3}$ and $g(x) = x^3$ at $x = 0$: the outer function is not differentiable at $g(0) = 0$, and the chain-rule expression $\frac{2}{3}(x^3)^{-1/3} \cdot 3x^2$ is undefined at $0$, although it equals $2x$ for $x \neq 0$. The theorem says nothing at $0$ here, and the composite $x^2$ happens to be differentiable there, so the value has to be found from the definition.
- **"In a long chain, the local derivatives are harmless factors."** Their product is the whole answer. Fifty factors of $0.9$ multiply to about $0.005$, and fifty factors of $1.1$ to about $117$. This is the arithmetic behind vanishing and exploding gradients in deep networks, and it is a consequence of the chain rule, not a flaw in an implementation.

## Summary

Derivatives can be computed from structure: constants and sums by linearity, $x^n$ by $n x^{n-1}$ for integer exponents, products by $f'g + fg'$, and quotients by $\frac{f'g - fg'}{g^2}$ where $f$ and $g$ are differentiable and $g \neq 0$. The sum, power, product and quotient rules are proved once from the limit definition, and the chain rule is justified by a linear-approximation argument. The chain rule, $(f \circ g)'(x) = f'(g(x))\,g'(x)$, requires $g$ differentiable at $x$ and $f$ differentiable at $g(x)$, and says that slopes of composed local linear approximations multiply. A composition is differentiated from the outside in, multiplying a factor per layer. The same bookkeeping run by a program gives exact derivatives (up to rounding) without symbolic algebra or a step size, which is the principle behind automatic differentiation and, in deep learning, backpropagation. The next lesson, `derivatives-of-exponentials-logarithms-and-trigonometric-functions`, supplies the derivatives of the remaining basic functions, so that these rules reach almost every function in practice.

## Documentation Links

- [OpenStax Calculus Volume 1, 3.3 Differentiation Rules](https://openstax.org/books/calculus-volume-1/pages/3-3-differentiation-rules): constant, power, sum, product and quotient rules
- [OpenStax Calculus Volume 1, 3.6 The Chain Rule](https://openstax.org/books/calculus-volume-1/pages/3-6-the-chain-rule): the chain rule, compositions of several functions, and worked examples
- [MIT OCW 18.01SC, Session 11: Chain Rule](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-11-chain-rule/): the chain rule in video clips and notes
- [MIT OCW 18.01SC, Session 9: Product Rule](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/session-9-product-rule/): the product rule in video clips and notes
- [Active Calculus, 2.5 The chain rule](https://activecalculus.org/single/sec-2-5-chain.html): the chain rule with exercises
