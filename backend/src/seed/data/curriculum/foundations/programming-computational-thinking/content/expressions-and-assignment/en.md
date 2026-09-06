---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

An expression is anything that evaluates to a value: a literal, a variable, or a combination of both joined by operators (`+`, `-`, `*`, `/`, `==`, `and`, ...). Assignment (`=`) takes the value an expression evaluates to and stores it under a name — it is not the same symbol as mathematical equality, even though it looks like it. In math, `x = x + 1` is a false statement for any `x`; in Python, it is a perfectly ordinary instruction meaning "compute the current value of `x`, add one, and store the result back under the name `x`." Keeping those two meanings separate is one of the first mental adjustments every new programmer has to make.

## Use Cases

- Computing a derived value (a total, an average, a boolean flag) from other variables in one line.
- Updating a running value across a loop (a counter, an accumulator) using its own current value.
- Reading a condition (`age >= 18`) as an expression that produces a `bool`, to be used immediately or stored for later.
- Chaining several assignments to unpack a computation into named, readable intermediate steps.

## Deep Dive

### Expressions evaluate; assignment stores

```python
3 + 4          # an expression: evaluates to 7, but nothing is stored
total = 3 + 4  # an assignment: evaluates 3 + 4, then stores 7 under the name "total"
```

The right-hand side of `=` is always evaluated completely *first*; only then is the resulting value bound to the name on the left. This is what makes self-referential assignment work at all:

```python
count = 5
count = count + 1   # right side evaluates using the OLD count (5), giving 6
                     # only then does "count" start meaning 6
```

Python also supports compound assignment operators as shorthand for this exact pattern:

```python
count += 1   # equivalent to: count = count + 1
total *= 2   # equivalent to: total = total * 2
```

### Equality is a different operator entirely

Mathematical equality — "is this the same value as that?" — is spelled `==` in Python, deliberately different from the single `=` used for assignment:

```python
x = 5        # assignment: x now refers to 5
x == 5       # equality check: evaluates to True, doesn't change x
```

`==` produces a `bool` and changes nothing; `=` changes what a name refers to and produces nothing usable. Confusing the two is a classic beginner error, and Python's grammar forbids `=` from appearing inside most expressions specifically to catch it — writing `if x = 5:` is a `SyntaxError`, not a silently wrong program.

## Trade-offs

- **`x = x + 1` looks like a false mathematical statement but is a correct, common instruction** — the mental model has to shift from "state a fact" to "issue a command," and that shift is exactly what trips up learners coming from algebra.
- **Compound operators (`+=`) are easy to misread as introducing a new operator rather than reusing the current value** — `total += total` doubles `total`, which is often exactly what's intended, but is easy to write by accident when the intent was to add some other value.
- **Confusing `=` and `==` is a common source of bugs, though Python's grammar prevents the most dangerous form of it**: unlike some other languages, `if x = 5:` is a syntax error in Python, not a silent assignment inside a condition, so this particular mistake is caught immediately rather than at run time.

  ```python
  if x = 5:   # SyntaxError: invalid syntax
      pass
  ```

## Documentation Links

- [Python Tutorial — An Informal Introduction to Python](https://docs.python.org/3/tutorial/introduction.html) — doc
- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
