---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Most Ruby debugging starts and ends with `puts`, and that is fine more often
than purists admit — but `puts`, `p`, and `pp` are three different tools with
three different output rules, and knowing which one to reach for saves a
surprising amount of confusion. Beyond print debugging, Ruby ships an official
debugger (the `debug` gem, driven by `binding.break` and the `rdbg` command)
that can pause a running process, step through it, and even attach to a program
running inside Docker. Pry is the third-party alternative: not primarily a
step-debugger, but a full REPL dropped into your program's scope, where you can
navigate objects like directories and print the source of any method you can
reach.

## Use Cases

- Choosing the right inspection call in a hurry: `p` when you need to see
  whether something is `nil`, the string `"nil"`, or `:nil`; `pp` when the
  object is a deeply nested hash that `p` would print as one unreadable line.
- Pausing a request mid-flight in a Rails controller or a background job to
  inspect real local variables, instead of guessing from log output.
- Attaching a debugger to a process you did not start in a terminal — a server
  in a Docker container, a Sidekiq worker — via `rdbg --open` and `rdbg --attach`.
- Answering "what is this method actually doing?" for a gem you did not write,
  by opening a Pry session and running `show-source`.
- Finding out who called the current method without stopping the program, using
  `Kernel#caller`.
- Sanity-checking that an optimization is actually faster with `Benchmark`
  before committing to it.

## Deep Dive

### `puts` vs. `p` vs. `pp` (and `jj`, and `y`)

```ruby
value = nil

puts value       # prints an empty line   (to_s)
p value          # prints: nil            (inspect)

s = "nil"
puts s           # prints: nil
p s              # prints: "nil"
```

`puts` calls `to_s` — the human-readable form, meant for program output. `p`
calls `inspect` — the debug form, which keeps quotes on strings, shows `nil`
as `nil`, and renders symbols with their colon. `p` also *returns* its argument,
so you can wrap an expression in it without changing the code's behavior:

```ruby
total = p(subtotal * rate) + shipping
```

`pp` ("pretty print") uses `inspect` too, but breaks large nested structures
across lines instead of emitting one long one:

```ruby
order = { id: 42, customer: { name: "Ada", address: { city: "London", zip: "E1" } },
          items: [{ sku: "A1", qty: 2 }, { sku: "B7", qty: 1 }] }

p order   # one very long line
pp order  # indented, one nesting level per indent step
```

Two more that are worth remembering for complex hashes and arrays:

```ruby
require "json"
jj order   # formatted JSON

require "yaml"
y order    # YAML
```

`jj` and `y` are useful when the structure is data rather than Ruby objects —
JSON and YAML are often easier to scan than `inspect` output, and easy to paste
into a ticket.

> ⚠️ **New in Ruby 4.0: `instance_variables_to_inspect`.** Every `p`/`pp` call
> on an object goes through the default `inspect`, which dumps every instance
> variable — including the ones you never wanted in a log line, like a raw
> `@password` or an API `@token`. Overriding `#inspect` entirely to fix that
> means reimplementing its whole formatting logic. `instance_variables_to_inspect`
> is the narrower fix: define it to return just the symbols you want shown,
> and the default renderer does the rest.
> ```ruby
> class User
>   def initialize(name, password)
>     @full_name = name
>     @first, @last = name.split(" ")
>     @password = password
>   end
>
>   def instance_variables_to_inspect = [:@first, :@last]
> end
>
> p User.new("Jane Smith", "hunter2")
> # => #<User:0x00007f... @first="Jane", @last="Smith">   — @password never appears
> ```
> Returning `nil` means "use the default, show everything"; unrecognized or
> non-Symbol entries are just ignored rather than raising. Rails itself adopted
> this in its own model inspection to replace several hand-rolled `#inspect`
> overrides — a sign it is meant as the normal way to do this now, not an edge
> case.

### `Kernel#caller`: the stack without a debugger

`caller` returns the current call stack as an array of strings. Dropping it into
a method tells you who invoked it, which is often the entire question:

```ruby
class Account
  def balance
    puts caller.first(3)   # who is calling this, and from where?
    @balance
  end
end
```

Each entry looks like `"app/models/report.rb:18:in 'Report#totals'"`. Since it
is a plain array, you can filter it — `caller.grep(/app\//)` cuts out the
framework frames and leaves only your own code.

> ⚠️ **New in Ruby 4.0: clearer `ArgumentError` backtraces.** A "wrong number
> of arguments" backtrace line used to name only the method, leaving you to
> guess which class it belonged to when the same method name existed on
> several classes:
> ```
> # Ruby 3.4
> test.rb:1:in 'foo': wrong number of arguments (given 1, expected 2) (ArgumentError)
>
> # Ruby 4.0
> test.rb:1:in 'Object#foo': wrong number of arguments (given 1, expected 2) (ArgumentError)
> ```
> The receiver's class or module is now part of every such line (`Object#foo`,
> not just `foo`), and internal `<internal:...>` frames are filtered out of the
> backtrace by default so the first line you see is your own code, not a stdlib
> implementation detail. Neither change requires touching your code — you get
> a shorter path from stack trace to root cause for free on upgrade.

### The `debug` gem: Ruby's official debugger

Ruby ships the `debug` gem as a default gem. It replaced the old third-party
`debugger` gem, which has been discontinued since 2015 — if a blog post tells
you to `gem install debugger`, it is out of date.

```ruby
require "debug"

def checkout(cart)
  total = cart.sum(&:price)
  binding.break          # execution stops here, with a prompt on the terminal
  apply_discount(total)
end
```

`binding.break` pauses execution at that line and hands you a debugger prompt
with the full local scope available. You can also start a script under the
debugger without editing it:

```sh
rdbg checkout.rb
```

For a process you cannot attach a terminal to directly — inside Docker, or a
background worker — run it with a debug server open and connect from a second
terminal:

```sh
# terminal 1 (the process being debugged)
rdbg --open checkout.rb

# terminal 2
rdbg --attach
```

### The commands that matter

The single most important distinction is `step` vs. `next`:

- `step` / `s` — steps *into* method calls on the current line.
- `next` / `n` — executes the whole current line, including any methods it
  calls, and stops on the next line of the *current* frame.

Reach for `next` while you are scanning down a method, and `step` only at the
call you actually suspect. The rest of the working set:

```
continue / c            run until the next breakpoint (or the end)
break 42                break at line 42 of the current file
break Cart#total        break whenever Cart#total is called
break Cart#total if qty > 10    conditional breakpoint
watch @balance          stop when the instance variable changes
catch ArgumentError     stop wherever that error is raised
eval user.reload.name   evaluate an arbitrary expression in this scope
bt / backtrace          print the call stack
trace call              log every method call from here on
trace exception         log every exception raised
trace line              log every executed line
```

`catch` is the one that saves the most time on a mystery exception: instead of
reading a backtrace after the fact, you stop at the exact moment of the `raise`
with all the locals still alive.

> ⚠️ `watch @ivar` is powerful and expensive. The official documentation
> describes this feature as very slow — it has to check the variable
> continuously. Use it to find *where* a value changes, then remove it; don't
> leave one armed while you step through a long run.

### Pry: a REPL where your program is

Pry is a third-party gem and a different tool from `debug`. Instead of a
step-debugger with an evaluation escape hatch, it is a full REPL that happens
to open inside your program:

```ruby
require "pry"

class Cart
  def total
    binding.pry   # a Pry REPL opens here, with self == this Cart
    @items.sum(&:price)
  end
end
```

Its distinguishing feature is Unix-shell-style navigation through objects:

```
pry> cd @items.first     # self is now that item
pry> ls                  # variables and methods available here
pry> cd ..                # back up one level
pry> cd /                 # back to the top-level binding
pry> cd -                 # back to where you were before the last cd
```

`cd` genuinely changes `self`, so after `cd @items.first` you can call that
object's methods bare, without a receiver. `ls` lists what is in scope — local
variables, instance variables, and the methods the current object responds to,
grouped by where they are defined.

The command most people install Pry for is `show-source`:

```
pry> show-source Cart#total       # the actual Ruby source of the method
pry> show-source ActiveRecord::Base#save
pry> show-doc Array#sum           # its documentation
```

Being able to read a gem's real implementation from inside a live session,
without hunting through the bundle path, is the thing Pry does that nothing
else does as smoothly. Anything prefixed with `.` is handed to the OS shell, so
`.git status` or `.ls -la` work without leaving the session.

Pry does not step-debug on its own. The companion gem `pry-byebug` adds
`step`, `next`, `continue`, and `finish` to a Pry session, giving you both the
REPL and the stepping in one place.

### `Benchmark`: measuring instead of guessing

```ruby
require "benchmark"

words = File.readlines("/usr/share/dict/words", chomp: true)

Benchmark.bmbm(20) do |x|
  x.report("select + size") { words.select { |w| w.length > 10 }.size }
  x.report("count")         { words.count  { |w| w.length > 10 } }
end
```

`Benchmark.bm(width)` prints user CPU time, system CPU time, their total, and
the real (wall-clock) elapsed time for each `report` block; `width` is just the
label column width. `bmbm` runs the whole set **twice** — a rehearsal pass, then
the measured pass — so that memory allocated by the first block is not still
being garbage-collected while the second block is being timed. The official
documentation is explicit that this reduces the distortion rather than
eliminating it, so treat a small difference between two reports as noise, not
as a result.

## Trade-offs

- **Print debugging is not a lesser technique, but it does not scale to state
  you did not predict** — `p` and `pp` require you to already know which value
  is interesting. A breakpoint gives you the whole scope at once, including
  the variable you would not have thought to print. The cost is that you must
  be able to reach a terminal attached to the process, which is exactly why
  `rdbg --open` / `--attach` exists.
- **`debug` and Pry solve overlapping but different problems** — `debug` is the
  official, dependency-free stepping debugger and the right default for
  "walk me through this execution." Pry is a superior REPL and code browser
  (`ls`, `cd`, `show-source`) and the right choice for "explain this object /
  this gem to me." Adding `pry-byebug` gets you both, at the cost of two more
  gems in the `:development` group.
- **A forgotten `binding.break` or `binding.pry` will hang production** — the
  process stops and silently waits for input that never comes. Keep both gems
  out of the production group, and let a linter (RuboCop's
  `Lint/Debugger` cop) fail the build on a committed breakpoint.
- **`watch` and `trace` buy visibility with a large slowdown** — `watch @ivar`
  is documented as very slow, and `trace line` logs every executed line. Both
  are excellent for narrowing down a specific mystery and terrible as a
  standing configuration.
- **Benchmark numbers are noisy by construction** — GC, the OS scheduler, and
  JIT warm-up all land inside your measurement. `bmbm` mitigates the GC part
  and nothing mitigates the rest, so prefer large differences and repeated runs
  over a single close call.

## Documentation Links

- [Programming Ruby 3.3 (Pickaxe) — Debugging Ruby](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
- [ruby/debug — the official Ruby debugger](https://github.com/ruby/debug) — doc
- [pry/pry — an IRB alternative and runtime developer console](https://github.com/pry/pry) — doc
- [deivid-rodriguez/pry-byebug — step debugging for Pry](https://github.com/deivid-rodriguez/pry-byebug) — doc
- [Kernel — Ruby Core docs (p, pp, caller)](https://docs.ruby-lang.org/en/3.3/Kernel.html) — doc
- [Benchmark — Ruby Standard Library docs](https://docs.ruby-lang.org/en/3.3/Benchmark.html) — doc
- [Ruby 4.0.0 Released — ruby-lang.org](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) — doc
