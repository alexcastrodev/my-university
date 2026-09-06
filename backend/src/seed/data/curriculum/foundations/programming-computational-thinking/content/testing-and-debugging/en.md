---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Testing is the practice of writing down, in advance, what a function should return for specific inputs — including tricky edge cases — and checking that it actually does, rather than trusting that it works because it compiled and ran once. Debugging is what happens when a test fails: a systematic process of narrowing down *where* a program's behavior diverges from what's expected, rather than guessing at causes or scattering `print()` statements at random. ACM/IEEE CS2013's Software Development Fundamentals area treats both as core skills, not an afterthought bolted onto "real" programming.

## Use Cases

- Writing a handful of test cases for a function before trusting it, including boundary cases (empty input, zero, the smallest and largest values expected).
- Isolating which of several functions is responsible for a wrong result, when only the overall program's output is known to be wrong.
- Forming a hypothesis about a bug's cause and designing a small check that would confirm or rule it out, instead of changing code at random.
- Re-running a fixed set of test cases after any change, to catch a fix that broke something that used to work.

## Deep Dive

### Writing test cases before trusting a function

```python
def average(numbers):
    return sum(numbers) / len(numbers)

# test cases, written down before relying on the function elsewhere
assert average([2, 4, 6]) == 4
assert average([5]) == 5
assert average([-2, 2]) == 0
```

Each `assert` is a test case: a known input paired with the expected output. Choosing good test cases means including boundary conditions on purpose — here, a single-element list and a list that averages to zero — not just one "obviously fine" example. Running this file immediately reveals a bug this function doesn't handle: `average([])` raises `ZeroDivisionError`, an edge case worth deciding on deliberately (raise an error? return `0`? return `None`?) rather than leaving as an accident of the formula.

### A systematic process for isolating a bug

Suppose a larger program produces a wrong final result, and it's not obvious which of several functions is at fault. Rather than guessing, narrow it down by checking intermediate values at a specific point, then move that check earlier or later depending on what's found:

```python
def process(data):
    cleaned = clean(data)
    print("DEBUG cleaned:", cleaned)     # check: is cleaned already wrong?
    result = summarize(cleaned)
    print("DEBUG result:", result)        # check: did summarize introduce the bug?
    return result
```

If `cleaned` already looks wrong, the bug is in `clean` (or in `data` itself) — no need to look at `summarize` at all. If `cleaned` looks right but `result` doesn't, the bug is isolated to `summarize`. This binary narrowing — check the midpoint, then recurse into whichever half is wrong — is the same idea bisection search applies to numeric guesses, applied here to *where in a program* a bug lives.

## Trade-offs

- **Writing test cases takes time up front that feels like it's not "real progress" on the feature** — but a bug caught by a test case written five minutes ago is far cheaper to fix than the same bug found by a user, or by a much larger program built on top of the broken function.
- **`print()`-based debugging is easy to reach for but doesn't scale to a program with many functions or a bug that only appears after many iterations** — a systematic narrowing process (or a real debugger) finds the same information with far fewer, more targeted checks.
- **A test suite that passes doesn't prove a function is correct for every possible input** — it only proves it's correct for the specific cases tested; choosing which cases to test (especially boundary cases) is a skill in itself, not a mechanical checklist.

## Documentation Links

- [ACM/IEEE CS2013 — Software Development Fundamentals KA](https://csed.acm.org/wp-content/uploads/2023/09/SDF-Version-Gamma.pdf) — doc
- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
