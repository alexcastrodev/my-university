---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Recognize a separable equation $y' = g(t)\,h(y)$ and carry out separation of variables, including the justification behind the notation.
- Find the constant (equilibrium) solutions of $h(y) = 0$ and explain why dividing by $h(y)$ can lose them.
- Solve the logistic equation, identify its equilibria and carrying capacity, and say which solution the formula misses.
- Solve Newton's law of cooling and fit its rate constant from a measurement.
- Check any solution by substituting it back, and state the interval on which it is valid.

## Context & Motivation

The previous lesson, `differential-equations-and-initial-value-problems`, solved $y' = ky$ by guessing the exponential and proving it was the only solution. Guessing does not scale. A population cannot grow exponentially forever, and a cooling cup does not lose heat at a fixed rate: the rate depends on the current value in a way that is not simply proportional to it. A large family of such equations can be solved with two integrals.

That family is the **separable** equations, where the right-hand side factors into a part that depends only on $t$ and a part that depends only on $y$. Two famous members are the logistic equation, which models growth that saturates, and Newton's law of cooling. The logistic curve also appears in computing as the sigmoid used in logistic regression and neural networks. Along the way you will meet the main hazard of the method: a division that quietly discards a solution.

## Core Theory

### The separable form and the method

An equation is **separable** if it can be written as

$$y' = g(t)\,h(y),$$

with $g$ continuous on an interval and $h$ continuous. Then:

1. Solve $h(y) = 0$. Each root $y^*$ gives a constant solution $y \equiv y^*$, because both sides are $0$.
2. Where $h(y) \neq 0$, divide: $\dfrac{y'}{h(y)} = g(t)$.
3. Integrate both sides with respect to $t$. Let $H$ be an antiderivative of $1/h$ and $G$ one of $g$. By the chain rule, $\frac{d}{dt}H(y(t)) = H'(y)\,y' = y'/h(y) = g(t)$, so $H(y(t)) - G(t)$ has zero derivative.
4. On an **interval** a function with zero derivative is constant, so $H(y(t)) = G(t) + C$.
5. Solve for $y$ if you can; otherwise leave the relation implicit. Use the initial condition to fix $C$.
6. Substitute the result back into the equation and the initial condition, and state the interval.

Step 4 in one line:

$$H(y(t)) = G(t) + C.$$

The familiar shorthand $\frac{dy}{h(y)} = g(t)\,dt$, integrated on each side, compresses steps 2 to 4, and the left integral is a substitution (`integration-by-substitution-and-by-parts`). The chain-rule argument is what makes the shorthand legitimate, because $dy/dt$ is a limit of quotients, not a fraction you may split freely. It needs $h(y(t)) \neq 0$ for every $t$ in the interval, which is what step 2 assumed.

### Solutions lost by dividing

Step 2 is a division by $h(y)$, so it silently excludes the solutions where $h(y) = 0$. Those are the constant solutions from step 1, called **equilibria**, and the general formula from steps 3 to 5 may or may not contain them.

- Sometimes a special value of the constant recovers the equilibrium. For $y' = 2ty$, the formula $y = Ae^{t^2}$ contains $y \equiv 0$ at $A = 0$.
- Sometimes it does not. In the logistic equation below, no finite value of the constant gives $P \equiv 0$.

So always list the roots of $h$ first and decide, one by one, whether the final formula covers them. If it does not, the answer is the formula **plus** the extra solution.

When is the division safe on the rest of the plane? Suppose $g$ is continuous and $h$ has a continuous derivative, so that $g(t)h(y)$ and its $y$-derivative $g(t)h'(y)$ are continuous and the uniqueness theorem of the previous lesson applies. Then a non-constant solution can never reach an equilibrium, because that would put two solutions through one point. Each solution stays in a band between consecutive roots of $h$, where $h \neq 0$, and the division is justified. Without that hypothesis, solutions can leave an equilibrium, as in $y' = 3y^{2/3}$ from the previous lesson.

### The logistic equation

Exponential growth $P' = kP$ has no ceiling. The **logistic equation** adds one:

$$P' = kP\left(1 - \frac{P}{M}\right), \qquad k > 0,\ M > 0.$$

When $P$ is small compared with $M$, the factor in parentheses is close to $1$ and growth is nearly exponential. As $P$ approaches $M$, the factor approaches $0$ and growth stops. The number $M$ is the **carrying capacity**. This is separable with $h(P) = kP(1 - P/M)$, so the equilibria are $P = 0$ and $P = M$.

For $0 < P < M$ (the same steps work in the other bands, with $A$ of either sign), partial fractions give $\dfrac{1}{P(1 - P/M)} = \dfrac{1}{P} + \dfrac{1}{M - P}$. Separating and integrating:

$$\ln\lvert P\rvert - \ln\lvert M - P\rvert = kt + c \quad\Longrightarrow\quad \frac{P}{M - P} = Ae^{kt}, \quad A = \pm e^{c} \neq 0.$$

Solving for $P$ and writing $C = 1/A$:

$$P(t) = \frac{M}{1 + Ce^{-kt}}, \qquad C = \frac{M - P_0}{P_0}.$$

**What the formula covers and misses.** $C = 0$ gives the equilibrium $P \equiv M$. No finite $C$ gives $P \equiv 0$, which was removed when we divided by $P$, so in this parametrization $P \equiv 0$ is a lost solution and must be stated separately. The gap belongs to the parametrization, not to the equation. Writing the family as $P = MAe^{kt}/(1 + Ae^{kt})$ recovers $P \equiv 0$ at $A = 0$ and loses $P \equiv M$. Parametrizing by the initial value, $P(t) = \dfrac{M P_0 e^{kt}}{M - P_0 + P_0 e^{kt}}$, covers both: $P_0 = 0$ and $P_0 = M$ give the two equilibria (on any interval where the denominator is nonzero).

The shape follows from the formula. For $0 < P_0 < M$ the curve is an S: increasing, with the steepest growth at $P = M/2$, where $P' = kM/4$, and tending to $M$. For $P_0 > M$ the solution decreases to $M$. For $P_0 < 0$ (not meaningful for a population) the denominator vanishes at a finite time and the solution blows up. Near $0$ the equilibrium repels and $M$ attracts every solution that starts at a positive value.

### Newton's law of cooling

Newton's law of cooling says an object's temperature $T$ changes at a rate proportional to the difference from the surroundings:

$$T' = -k\,(T - T_{\text{env}}), \qquad k > 0,$$

with $T_{\text{env}}$ constant. It is separable with the single equilibrium $T = T_{\text{env}}$. For $T \neq T_{\text{env}}$,

$$\ln\lvert T - T_{\text{env}}\rvert = -kt + c \quad\Longrightarrow\quad T(t) = T_{\text{env}} + (T_0 - T_{\text{env}})\,e^{-kt}.$$

Here the lost solution is recovered: $T_0 = T_{\text{env}}$ gives $T \equiv T_{\text{env}}$. The temperature approaches $T_{\text{env}}$ but, in this model, does not reach it in finite time.

The law is an empirical approximation. It describes cooling reasonably when heat loss is mostly by convection and the temperature gap is modest. Radiation grows faster than linearly with temperature, and evaporation from a hot drink adds its own loss, so real data drift away from a single exponential. The constant $k$ depends on the object and its surroundings and is found from a measurement.

## Worked Examples

### Example 1: a lost solution that the constant recovers

Solve $y' = 2ty$, $y(0) = 3$. Here $g(t) = 2t$ and $h(y) = y$, with equilibrium $y \equiv 0$. For $y \neq 0$:

$$\frac{y'}{y} = 2t \quad\Longrightarrow\quad \ln\lvert y\rvert = t^2 + c \quad\Longrightarrow\quad y = Ae^{t^2}, \quad A = \pm e^{c}.$$

Then $y(0) = A = 3$, so $y = 3e^{t^2}$. Substitution: $y' = 6te^{t^2} = 2t\cdot 3e^{t^2} = 2ty$, and $y(0) = 3$. It is valid for all real $t$. The lost solution $y \equiv 0$ is the $A = 0$ member of the family, and the initial condition selects $A = 3$ anyway. A numerical integration gives $y(1) = 8.1548$, matching $3e = 8.1548$.

### Example 2: an implicit solution and a restricted interval

Solve $y' = -t/y$, $y(0) = 2$. Here $h(y) = 1/y$ is undefined at $y = 0$, so $y = 0$ is not an equilibrium but a point the solution must avoid. Separating, $y\,y' = -t$, so

$$\frac{y^2}{2} = -\frac{t^2}{2} + c \quad\Longrightarrow\quad t^2 + y^2 = C.$$

The initial condition gives $C = 4$. This relation is a circle, but a solution is a function, so the condition $y(0) = 2 > 0$ selects the upper half: $y = \sqrt{4 - t^2}$. Substitution: $y' = -t/\sqrt{4 - t^2} = -t/y$ and $y(0) = 2$. The formula is valid on $(-2, 2)$: at $t = \pm 2$ we have $y = 0$, where the equation is undefined and the slope of the semicircle is infinite. For $y(0) = -2$ the solution is the lower half, $-\sqrt{4 - t^2}$. A numerical integration to $t = 1.9$ gives $0.6245$, matching $\sqrt{4 - 1.9^2}$.

### Example 3: the logistic equation with numbers

Let $k = 0.4$, $M = 100$, $P(0) = 10$. Then $C = (100 - 10)/10 = 9$ and

$$P(t) = \frac{100}{1 + 9e^{-0.4t}}.$$

Substitution: with $E = e^{-0.4t}$, $P' = \dfrac{100\cdot 9\cdot 0.4\,E}{(1 + 9E)^2}$, and $0.4\,P\,(1 - P/100) = 0.4\cdot\dfrac{100}{1 + 9E}\cdot\dfrac{9E}{1 + 9E}$, which is the same; also $P(0) = 100/10 = 10$. Values, compared with a numerical integration of the ODE:

```text
t      P(t)       numerical
0      10.0000    10.0000
5      45.0853    45.0853
10     85.8486    85.8486
15     97.8178    97.8178
20     99.6990    99.6990
30     99.9945    99.9945
```

The population reaches $M/2 = 50$ when $9e^{-0.4t} = 1$, at $t = \ln 9/0.4 \approx 5.49$, where the growth rate is the maximum $kM/4 = 10$. Starting above the capacity, with $P(0) = 150$, gives $C = -1/3$ and $P = 100/(1 - e^{-0.4t}/3)$, which falls toward $100$ (it is $100.011$ at $t = 20$). This formula is valid for $t > -\ln 3/0.4 \approx -2.75$, so it covers every $t \ge 0$. The lost solution $P \equiv 0$ is the case $P(0) = 0$: the formula breaks there because $C = (M - P_0)/P_0$ is undefined.

### Example 4: cooling coffee

A cup of coffee at $90\,^\circ\text{C}$ sits in a $20\,^\circ\text{C}$ room and reads $70\,^\circ\text{C}$ after $5$ minutes. Then $T = 20 + 70e^{-kt}$ and $70 = 20 + 70e^{-5k}$, so $e^{-5k} = 5/7$ and $k = \ln(7/5)/5 \approx 0.0673\ \text{min}^{-1}$. After $10$ minutes $T = 20 + 70\cdot(5/7)^2 \approx 55.71$. To reach $40\,^\circ\text{C}$: $70e^{-kt} = 20$, so $t = \ln 3.5/k \approx 18.62$ minutes. Substitution: $T' = -70ke^{-kt} = -k(T - 20)$ and $T(0) = 90$.

### Example 5: the sigmoid is a logistic solution

The sigmoid $\sigma(t) = 1/(1 + e^{-t})$ satisfies $\sigma' = \sigma(1 - \sigma)$, the logistic equation with $k = M = 1$. With $\sigma(0) = 1/2$ the constant is $C = (1 - 1/2)/(1/2) = 1$, which gives the sigmoid. Check: $\sigma' = e^{-t}/(1 + e^{-t})^2$ and $\sigma(1 - \sigma) = \frac{1}{1 + e^{-t}}\cdot\frac{e^{-t}}{1 + e^{-t}}$, equal. At $t = 3$ the formula and a numerical integration both give $0.9526$. By the uniqueness theorem this IVP has no other solution. This is why gradient code for a sigmoid activation can compute the derivative from the output alone.

## Common Misconceptions & Pitfalls

- **"Divide freely and the formula is the whole answer."** Division by $h(y)$ drops the roots of $h$. For the logistic equation the answer is the formula plus $P \equiv 0$.
- **"$dy/dx$ is a fraction, so anything goes."** The rewriting is justified by the chain rule and a substitution. It stops being valid at any $t$ where $h(y(t)) = 0$.
- **Dropping the absolute value in $\ln\lvert y\rvert$.** Writing $\ln y$ silently restricts to positive $y$. Keep $\lvert\cdot\rvert$, then absorb $\pm e^{c}$ into one constant.
- **Putting a constant on each side.** One constant is enough; two are redundant.
- **Taking the wrong sign of the square root.** In Example 2, $t^2 + y^2 = 4$ is not a function. The initial condition chooses the branch.
- **"The solution lives on the whole real line."** Example 2 lives on $(-2, 2)$ and the logistic solutions with $P_0 < 0$ blow up in finite time. State the interval.
- **"Every first-order equation is separable."** $y' = t + y$ is not: the ratio of its slopes at two heights depends on $t$, which a product $g(t)h(y)$ cannot produce.

## Summary

A separable equation $y' = g(t)h(y)$ is solved by finding the roots of $h$, dividing where $h \neq 0$, and integrating, with the chain rule justifying the notation and the zero-derivative-on-an-interval fact giving the single constant. The division discards the equilibria, so every solution must be checked against them: $y' = 2ty$ recovers $y \equiv 0$ through the constant, while the logistic equation $P' = kP(1 - P/M)$ has the formula $P = M/(1 + Ce^{-kt})$ that contains $P \equiv M$ and misses $P \equiv 0$. Newton's law of cooling gives $T = T_{\text{env}} + (T_0 - T_{\text{env}})e^{-kt}$, an approximation with its constant fitted from a measurement. Every answer is verified by substituting it into the equation and the initial condition, and is stated together with its interval of validity.

## Documentation Links

- [OpenStax Calculus Volume 2, 4.3 Separable Equations](https://openstax.org/books/calculus-volume-2/pages/4-3-separable-equations): separation of variables and applications including Newton's law of cooling.
- [OpenStax Calculus Volume 2, 4.4 The Logistic Equation](https://openstax.org/books/calculus-volume-2/pages/4-4-the-logistic-equation): carrying capacity, direction fields, equilibria, and the solution of the logistic equation.
- [MIT OpenCourseWare 18.01SC, Part C: Mean Value Theorem, Antiderivatives and Differential Equations](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-c-mean-value-theorem-antiderivatives-and-differential-equations/): lecture notes, videos, and problems, including the session "Separation of Variables".
