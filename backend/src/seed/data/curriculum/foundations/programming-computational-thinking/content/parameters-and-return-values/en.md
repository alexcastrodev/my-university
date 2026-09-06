---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Parameters are the names a function declares to receive values from its caller, and a return value is the result a function hands back with a `return` statement. Together they define a function's contract: what it needs to do its job, and what the caller gets in exchange. A function that has no `return` statement — or reaches the end of its body without hitting one — implicitly returns `None`, Python's value for "nothing here," which is a common source of confusion when a caller expects a real result.

## Use Cases

- Writing a function that behaves differently depending on the arguments it's called with, instead of hardcoding a single case.
- Giving a parameter a default value so most callers can omit it, while still allowing it to be overridden when needed.
- Returning a computed value so the caller can use it in further computation, rather than just printing it.
- Recognizing when a function was written to `print()` a result instead of `return` it, which silently breaks any code that tries to use its "return value."

## Deep Dive

### Binding arguments to parameters

```python
def greet(name, greeting="Hello"):
    return f"{greeting}, {name}!"

greet("Ada")                    # "Hello, Ada!"        — greeting uses its default
greet("Ada", "Hi")               # "Hi, Ada!"           — positional argument
greet(name="Ada", greeting="Hi") # "Hi, Ada!"           — keyword arguments, any order
```

`name` has no default, so it's required — calling `greet()` with no arguments raises `TypeError: greet() missing 1 required positional argument: 'name'`. `greeting="Hello"` gives that parameter a default, making it optional. Arguments can be passed positionally (matched by order) or by keyword (matched by name), and the two styles can be mixed as long as every positional argument comes before any keyword argument.

### What a function returns when it doesn't say

```python
def print_square(x):
    print(x * x)   # prints the result — doesn't return it

result = print_square(5)   # prints 25
print(result)               # None — print_square never used "return"
```

`print_square` *looks* like it produces 25, because it prints it — but nothing after `return` tells Python what value to hand back to the caller, so the function implicitly returns `None`. `result` ends up holding `None`, not `25`, and any code that tries to do `result + 1` will raise a `TypeError` involving `NoneType`. This is one of the most common early bugs: confusing a function that *displays* a value with one that *returns* it.

## Trade-offs

- **A missing `return` doesn't raise an error — it silently returns `None`**, which means the bug only surfaces later, when the caller tries to use that `None` as if it were a real value:

  ```python
  def add(a, b):
      total = a + b   # forgot "return total"

  x = add(2, 3)
  print(x + 1)   # TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'
  ```
- **Mutable default arguments are evaluated once, at definition time, not on every call** — a default value like `[]` is shared across every call that doesn't override it, which is rarely the intended behavior and is a well-known Python pitfall.
- **Giving every parameter a default makes a function easy to call but can hide a required piece of information the caller forgot to supply** — whether a parameter should be required or optional is a design decision about the function's contract, not just a convenience for the caller.

## Documentation Links

- [Python Tutorial — More Control Flow Tools](https://docs.python.org/3/tutorial/controlflow.html) — doc
- [Python Built-in Functions](https://docs.python.org/3/library/functions.html) — doc
