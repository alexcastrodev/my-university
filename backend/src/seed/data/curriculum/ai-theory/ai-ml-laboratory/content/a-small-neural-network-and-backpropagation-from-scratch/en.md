---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement forward propagation through a small network with one hidden layer, extending Lab 2's logistic regression by exactly one layer.
- Implement backpropagation's chain-rule gradient computation by hand, layer by layer, for every weight in the network.
- Implement numerical gradient checking (finite-difference approximation) and use it to verify every hand-derived analytic gradient independently.
- Explain why gradient checking, not a decreasing loss curve, is the standard, real way a backpropagation implementation's correctness is actually confirmed.

## Context & Motivation

**Multilayer Networks as Composed Linear Transformations** already frames `logistic-regression-and-a-decision-boundary-from-scratch`'s own model precisely: a neural network with zero hidden layers. This lab adds one hidden layer and implements **Backpropagation: The Chain Rule Through a Computational Graph**'s own gradient computation by hand, then verifies it the way real deep learning frameworks' own test suites verify new layer implementations: numerically, not just by inspecting the derivation.

## Core Theory

Nothing about *why* the chain rule composes correctly through a computational graph, or *why* each layer's local gradient multiplies with the gradient flowing back from the layer after it, is re-derived here; both arguments already exist in `backpropagation-the-chain-rule-through-a-computational-graph`. This lab implements that computation directly, for a small, concrete two-layer network, and treats gradient checking as the real correctness test.

## Worked Examples

### API specification

```text
forward(X, W1, b1, W2, b2) -> (hidden, output)
backward(X, y, W1, b1, W2, b2, hidden, output) -> (dW1, db1, dW2, db2)
numerical_gradient(loss_fn, param, epsilon=1e-5) -> ndarray  # for checking ONLY
```

### Step 1 — forward propagation, one hidden layer

```python
def forward(X, W1, b1, W2, b2):
    z1 = X @ W1 + b1
    hidden = np.tanh(z1)                # hidden layer activation
    z2 = hidden @ W2 + b2
    output = sigmoid(z2)                # reusing Lab 2's own sigmoid
    return hidden, output
```

### Step 2 — backpropagation, the chain rule applied layer by layer

```python
def backward(X, y, W1, b1, W2, b2, hidden, output):
    n = X.shape[0]

    # Output layer: dL/d(z2) for cross-entropy + sigmoid simplifies to
    # (output - y), the SAME algebraic form Lab 2's gradient already used
    d_z2 = (output - y.reshape(-1, 1)) / n
    dW2 = hidden.T @ d_z2
    db2 = np.sum(d_z2, axis=0, keepdims=True)

    # Chain rule INTO the hidden layer: gradient flowing back through
    # W2, then through tanh's own local derivative (1 - tanh(z1)^2)
    d_hidden = d_z2 @ W2.T
    d_z1 = d_hidden * (1 - hidden ** 2)  # tanh'(z1) = 1 - tanh(z1)^2
    dW1 = X.T @ d_z1
    db1 = np.sum(d_z1, axis=0, keepdims=True)

    return dW1, db1, dW2, db2
```

### Step 3 — numerical gradient checking: the REAL correctness test

```python
def numerical_gradient(loss_fn, param, epsilon=1e-5):
    # For each entry in `param`, perturb it by +epsilon and -epsilon,
    # recompute the loss both times, and approximate the derivative as
    # the slope between the two — this uses ONLY the forward pass, never
    # the analytic backward() function being checked.
    grad = np.zeros_like(param)
    it = np.nditer(param, flags=['multi_index'])
    while not it.finished:
        idx = it.multi_index
        original = param[idx]
        param[idx] = original + epsilon
        loss_plus = loss_fn()
        param[idx] = original - epsilon
        loss_minus = loss_fn()
        param[idx] = original  # restore
        grad[idx] = (loss_plus - loss_minus) / (2 * epsilon)
        it.iternext()
    return grad

def test_backprop_matches_numerical_gradient():
    X, y = generate_small_dataset(n=20, seed=0)
    W1, b1, W2, b2 = init_small_network(n_features=X.shape[1], n_hidden=4)

    hidden, output = forward(X, W1, b1, W2, b2)
    dW1_analytic, db1_analytic, dW2_analytic, db2_analytic = backward(X, y, W1, b1, W2, b2, hidden, output)

    def loss_fn():
        h, o = forward(X, W1, b1, W2, b2)
        return cross_entropy_loss_from_output(o, y)

    dW1_numeric = numerical_gradient(loss_fn, W1)
    assert np.allclose(dW1_analytic, dW1_numeric, atol=1e-4), \
        "the hand-derived backprop gradient for W1 must match the independently computed numerical gradient"
```

This is the actual test that matters in this lab: `numerical_gradient` never calls `backward()` at all, it only ever calls `forward()` repeatedly with tiny perturbations, which is exactly what makes it an independent check on `backward()`'s own chain-rule derivation, the same technique real deep learning framework test suites use to verify new layer implementations before trusting them.

### Step 4 — a deliberately introduced bug, and gradient checking catching it

```python
def buggy_backward(X, y, W1, b1, W2, b2, hidden, output):
    dW1, db1, dW2, db2 = backward(X, y, W1, b1, W2, b2, hidden, output)
    dW1 = dW1 * 2  # a deliberate, subtle bug: an extra, incorrect factor of 2
    return dW1, db1, dW2, db2

def test_gradient_check_catches_the_bug():
    X, y = generate_small_dataset(n=20, seed=0)
    W1, b1, W2, b2 = init_small_network(n_features=X.shape[1], n_hidden=4)
    hidden, output = forward(X, W1, b1, W2, b2)
    dW1_buggy, *_ = buggy_backward(X, y, W1, b1, W2, b2, hidden, output)
    dW1_numeric = numerical_gradient(lambda: cross_entropy_loss_from_output(forward(X, W1, b1, W2, b2)[1], y), W1)
    assert not np.allclose(dW1_buggy, dW1_numeric, atol=1e-4), \
        "gradient checking should FLAG this deliberately introduced factor-of-2 bug"
```

## Common Misconceptions & Pitfalls

- **"If training loss decreases, the backpropagation implementation must be correct."** A subtly wrong gradient, off by a constant factor, missing a term, can still point in roughly the right direction often enough for loss to decrease overall, especially with a well-chosen learning rate compensating for the error; Step 4's deliberately introduced bug is specifically the kind of error a loss curve alone would very likely miss, while gradient checking catches it directly.
- **"Gradient checking and the analytic backward pass are really computing the same thing the same way, so comparing them is redundant."** They compute the gradient through genuinely independent methods, one via the chain rule applied algebraically, the other via direct numerical perturbation of the forward pass alone, which is exactly what makes their agreement (or disagreement) meaningful rather than circular.
- **"Gradient checking is precise enough to use as the actual training method, not just a correctness check."** It requires two forward passes per parameter being checked, which is computationally far too expensive for training a real network with many parameters; it is used specifically as a one-time (or occasional) correctness check on the much cheaper analytic gradient, not as a training-time replacement for it.

## Summary

This lab extends `logistic-regression-and-a-decision-boundary-from-scratch`'s zero-hidden-layer model by exactly one layer, implements `backpropagation-the-chain-rule-through-a-computational-graph`'s own chain-rule gradient computation by hand for every layer, and verifies every analytic gradient against an independently computed numerical gradient, the standard, real technique for confirming a backpropagation implementation is correct. Deliberately introducing a subtle bug, an extra factor of 2 in one gradient, and confirming gradient checking actually flags it demonstrates why this check matters: a decreasing loss curve alone would very plausibly have missed exactly this kind of error.

## Documentation Links

- [CS231n — Backpropagation, Intuitions](https://cs231n.github.io/optimization-2/): the direct source for the chain-rule backpropagation derivation this lab implements by hand.
- [Dive into Deep Learning — Forward Propagation, Backward Propagation, and Computational Graphs](https://d2l.ai/chapter_multilayer-perceptrons/backprop.html): a second, independent real source covering the same forward/backward computation and its verification.
