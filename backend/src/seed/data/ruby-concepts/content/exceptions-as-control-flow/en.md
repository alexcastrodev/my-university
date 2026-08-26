---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Exceptions in Ruby are expensive — measurably, not just stylistically. Using
`begin/rescue` for normal, expected control flow (rather than genuine
error handling) has a real performance cost, and Ruby offers a cheaper
mechanism, `catch`/`throw`, for the specific case of "jump out of nested
code" that doesn't need a stack trace. Knowing the actual hierarchy,
knowing when `ensure` and `retry` apply, and knowing which idiom to reach
for is the difference between exceptions used correctly and exceptions used
as a control-flow crutch.

## Use Cases

- Choosing `find_by`/`where` over `find` (which raises) in code paths where
  "not found" is an expected, common outcome rather than an error.
- Writing a custom exception hierarchy that lets callers `rescue` broadly
  (a library's base error class) or narrowly (a specific failure) as
  needed.
- Using `catch`/`throw` to break out of deeply nested loops or recursive
  search without paying the cost — or the semantic mismatch — of raising
  an exception for a non-error "found it" event.
- Writing a `retry` loop for a flaky network call, with a bounded attempt
  count and a real backoff so it can't spin forever.

## Deep Dive

### The exception hierarchy, and why `rescue` is safe by default

```ruby
begin
  1 / 0
rescue => e        # implicitly rescues StandardError, NOT Exception
  puts e.class      # ZeroDivisionError
end
```

`Exception` is the true root, but `rescue` with no explicit class only
catches `StandardError` and its descendants — genuinely fatal conditions
like `NoMemoryError` or `SystemExit` live outside `StandardError`
specifically so a broad `rescue` clause never accidentally swallows them.
Custom application errors should subclass `StandardError`, by convention
named ending in `Error`.

### `ensure`, `else`, and `retry`

```ruby
attempts = 0
begin
  attempts += 1
  risky_network_call
rescue Net::TimeoutError
  raise if attempts >= 3
  sleep(2 ** attempts)
  retry
ensure
  connection.close
end
```

`ensure` always runs — exception or not, even if the exception isn't
rescued — making it the right place for guaranteed cleanup. `retry`
re-runs the entire `begin` block from the top; without a bounded attempt
counter like `attempts` above, it's a real infinite-loop risk. `else` (not
shown) runs only when nothing was raised at all — used rarely, but exists
for symmetry with `ensure`.

### `catch`/`throw`: jumping out without an exception

```ruby
result = catch(:found) do
  matrix.each do |row|
    row.each do |cell|
      throw(:found, cell) if cell == target
    end
  end
  nil
end
```

`catch`/`throw` is a distinct mechanism from exceptions, meant for normal
control flow that needs to jump out of nested structures — not error
handling. `throw` doesn't need to be lexically inside the `catch` block,
only somewhere in the call stack beneath it at runtime. It's measurably
cheaper than raising an exception for the same "stop searching, I found
it" event, precisely because it doesn't build a backtrace.

### Custom exceptions that carry data

```ruby
class PaymentDeclinedError < StandardError
  attr_reader :retryable

  def initialize(message, retryable: false)
    super(message)
    @retryable = retryable
  end
end

begin
  charge_card
rescue PaymentDeclinedError => e
  retry_charge if e.retryable
end
```

A custom exception is a normal class — it can carry structured data (like
`retryable` here) that the `rescue` site uses to decide what to do next,
which is more useful than parsing information back out of a message
string.

## Trade-offs

- **`begin/rescue` used for expected, common outcomes is measurably
  slower than an equivalent `if`/`else` check** — the exact multiplier
  varies by Ruby implementation and version, but the direction is
  consistent enough that "does this path represent an actual error, or an
  expected outcome?" should decide whether to reach for an exception at
  all. `find_by` (returns `nil`) over `find` (raises) in a normal lookup
  path is the standard example.
- **Third-party libraries that raise for ordinary conditions (an HTTP
  client raising on a 404, say) impose that cost on your code even though
  you didn't choose it** — worth checking whether a library exposes a
  non-raising alternative before working around it.
- **`retry` without a bounded counter is a genuine infinite-loop risk**,
  not just a style nit — a rescue clause that unconditionally calls
  `retry` on a persistently-failing condition (bad credentials, a
  permanently-down dependency) never terminates.

## Documentation Links

- [Exception handling — Ruby Core syntax docs](https://docs.ruby-lang.org/en/3.3/syntax/exceptions_rdoc.html) — doc
- [Kernel#catch, #throw — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Kernel.html#method-i-catch) — doc
- [The Complete Guide to Rails Performance — Exceptions as Flow Control](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
