---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Input and output are how a program talks to the outside world: `input()` pauses execution to read a line of text typed by the user, and `print()` writes a value out to the screen. Together they form the smallest possible feedback loop a program can have — write something, read a response, show a result — which is why nearly every introductory course, including CS50, starts here before covering any control flow at all.

## Use Cases

- Prompting a user for a value the program needs (a name, a number, a choice) and reading it back.
- Displaying a computed result so the person running the program can see the outcome.
- Printing intermediate values while writing or debugging a program, to see what a variable actually holds at a given point.
- Building the simplest possible "does this program run at all" check before adding any real logic.

## Deep Dive

### Reading input and printing output

```python
name = input("What's your name? ")   # pauses, shows the prompt, waits for Enter
print("Hello,", name)                 # writes "Hello, <name>" to the screen
```

`input()` always returns a `str`, no matter what the user typed — even if they type `"42"`, the value stored in `name` is the three-character string `"42"`, not the number 42. This is a common source of early bugs: reading a number requires an explicit conversion.

```python
age_text = input("Age? ")     # e.g. user types "16" — age_text is the str "16"
age = int(age_text)            # explicit conversion: age is now the int 16
print("Next year you'll be", age + 1)
```

Without that conversion, `age_text + 1` would raise a `TypeError`, because Python won't silently combine a `str` and an `int`.

`print()` accepts multiple arguments separated by commas and joins them with a single space by default; it also accepts a `sep` and `end` keyword argument to change that behavior:

```python
print("a", "b", "c")                    # a b c
print("a", "b", "c", sep="-")           # a-b-c
print("no newline", end="")             # doesn't add a trailing newline
```

## Trade-offs

- **`input()` always returns a string, so forgetting to convert it is a very common bug** — the mistake often doesn't surface as a crash, but as a silently wrong result:

  ```python
  x = input("Enter a number: ")   # user types "5"
  print(x * 2)                     # prints "55", not 10 — string repetition, not multiplication
  ```
- **Prompting inside `input()` mixes output and input in one call**, which is convenient but can make a long chain of prompts harder to read than writing an explicit `print()` before each `input()` with no argument — a style choice, not a correctness issue.
- **Heavy reliance on `print()` for debugging works but doesn't scale** — it's the right first tool, but as programs grow, a systematic debugging process (covered later, in testing-and-debugging) replaces scattered print statements with a repeatable method.

## Documentation Links

- [Python Built-in Functions](https://docs.python.org/3/library/functions.html) — doc
- [CS50x 2025 — Weeks](https://cs50.harvard.edu/x/2025/weeks/) — doc
