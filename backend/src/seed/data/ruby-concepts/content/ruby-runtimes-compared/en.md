---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

"Ruby" in everyday conversation means CRuby/MRI running the YARV virtual machine —
but that is one implementation of a language that has several. YJIT (a JIT
compiler shipped inside CRuby itself) can speed up the runtime you already have
with a flag. TruffleRuby and JRuby are separate runtimes that trade CRuby
compatibility for peak performance or JVM interoperability. mRuby is a
deliberately incomplete subset for embedding. Choosing between them is almost
never a pure performance decision — it is a decision about which gems, which C
extensions, and which language features you are willing to give up.

## Use Cases

- Turning on YJIT for a long-running Rails or Sidekiq process, where the JIT has
  time to warm up and the compiled code gets reused across thousands of requests.
- Deliberately *not* turning on YJIT for a short-lived CLI script or a Lambda-style
  function that exits before compilation pays for itself.
- Reaching for JRuby when the real requirement is "call this Java library" or
  "run CPU-bound Ruby in parallel threads inside one process."
- Evaluating TruffleRuby for a compute-heavy, gem-light workload where raw
  throughput matters more than ecosystem breadth.
- Embedding mRuby as a scripting layer inside a C program or on constrained
  hardware, where full CRuby would not fit.
- Reading a benchmark blog post and knowing which runtime it is actually measuring
  before drawing a conclusion about "Ruby being slow."

## Deep Dive

### YARV: the baseline you are already running

Since Ruby 1.9, the standard interpreter has been YARV ("Yet Another Ruby VM").
The names CRuby, MRI (Matz's Ruby Interpreter), and YARV get used
interchangeably in practice — CRuby/MRI names the C implementation, YARV names
the bytecode VM inside it.

YARV compiles your source to an internal bytecode before interpreting it. Unlike
the JVM, that bytecode is not an external artifact you ship — there is no `.rbc`
file to deploy, and the compile step happens on every boot. You can still look at
it:

```ruby
puts RubyVM::InstructionSequence.compile("a = 1 + 2").disasm
```

That is a debugging and teaching tool, not a build step. It also explains a
practical fact: Ruby boot time includes parsing and compiling every file you
`require`, which is why large Rails apps pay a visible startup cost.

### YJIT: the one that matters in practice

CRuby has shipped more than one JIT over the years. Ruby 3.3 through 3.4 also
carried **RJIT**, a pure-Ruby successor to the older MJIT — an elegant idea (the
JIT is hackable by Ruby programmers) that was always labeled experimental and
never recommended for production. Ruby 4.0 **removed RJIT entirely**; the flag
is gone.

**YJIT** is the one that matters in practice. It is written in Rust, shipped
experimentally in Ruby 3.1, and has been considered production-ready since Ruby
3.2, with substantial gains in 3.3 and later. Its core technique is **lazy basic
block versioning (LBBV)**: instead of compiling a whole method up front, it
compiles individual basic blocks *as they are first executed*, and it creates a
separate compiled version of a block per set of observed runtime types.

That matters because Ruby is dynamically typed and almost every operation is a
method call. In `a + b`, the interpreter must check what `a` is before it can
know which `+` to run. If YJIT has already observed that a given block always
sees `Integer` receivers, it compiles a version specialized to `Integer` with the
type check reduced to a cheap guard, and jumps straight to integer addition. The
"lazy" part means it never spends time compiling code paths your program does not
actually take — a big deal in a framework like Rails where most loaded code never
runs on the hot path.

Enabling it is a flag or an environment variable:

```bash
ruby --yjit app.rb
RUBY_YJIT_ENABLE=true bundle exec puma
```

```ruby
# Check at runtime whether YJIT is actually on
RubyVM::YJIT.enabled?    # => true / false
RubyVM::YJIT.runtime_stats  # requires a stats-enabled build
```

The catch is warm-up. YJIT only compiles a method after it has been called some
number of times (the default call threshold is 30, and CRuby raises it
automatically for very large applications so that boot-heavy Rails code does not
flood the code cache). Compiled code also costs memory. So YJIT is a clear win
for a Puma worker serving traffic for hours, and close to pure overhead for
`ruby one_off_script.rb`.

> ⚠️ **Book vs. today:** *Programming Ruby 3.3* was written before any of this —
> at the time, RJIT was CRuby's second JIT track. Ruby 4.0 removed it and
> replaced it with ZJIT (below). Check the release notes for the exact Ruby
> version you are running before assuming which JITs it ships.

### ZJIT: the next experimental direction, not a YJIT replacement

Ruby 4.0 introduced **ZJIT**, built by the same team behind YJIT but on a
deliberately different architecture: a **method-based** JIT using an SSA
(static single assignment) intermediate representation, closer to how a
"textbook" optimizing compiler is built. Where YJIT lazily compiles and
specializes individual basic blocks as they run, ZJIT compiles at the method
level — a strategy the team expects to have a **higher long-term performance
ceiling**, at the cost of the engineering being newer and less battle-tested.

ZJIT ships in the Ruby 4.0 release but is **not built or enabled by default** —
it requires Rust 1.85+ to build and is opted into explicitly:

```bash
ruby --zjit app.rb
```

Two things matter for how you should treat it today:

- **YJIT remains the production recommendation.** ZJIT is explicitly framed as
  the foundation for future compiler work, not a drop-in upgrade — there is no
  migration to make yet.
- **The two are not mutually exclusive on the roadmap.** ZJIT's stated design
  goal is a more approachable, contributor-friendly compiler architecture (a
  traditional method-JIT is easier to reason about and extend than lazy basic
  block versioning), which matters for the language's long-term velocity even
  before it matters for your app's latency.

Treat ZJIT the way you would treat any experimental interpreter flag: worth
trying against a representative benchmark in a lower environment, not worth
reaching for in production while YJIT is available and proven.

### TruffleRuby: peak performance, partial compatibility

TruffleRuby is a third-party implementation running on **GraalVM**, built with the
Truffle language framework and Graal's aggressive optimizing compiler. Its
headline claim is real: on some CPU-bound benchmarks it is several times faster
than CRuby, because Graal can inline and specialize across Ruby method boundaries
in ways an interpreter cannot.

An unusual design choice makes that possible: TruffleRuby **reimplements much of
the core library in pure Ruby** rather than in C. Methods that are C functions in
CRuby are ordinary Ruby methods in TruffleRuby, which means the JIT can see
through them and optimize them together with your code instead of treating them
as opaque native calls.

The costs are compatibility and warm-up:

- It passes roughly 97% of ruby-spec — high, but "roughly 97%" in a language this
  reflective means real programs still hit gaps.
- The gem ecosystem is narrower. Gems with **native C extensions** are the main
  problem; TruffleRuby can run some of them through its LLVM-bitcode layer, but
  slowly and not universally.
- Peak speed requires warm-up. Running on the JVM gives the highest ceiling but
  the slowest start; the Native Image build starts fast but does not reach the
  same peak. Neither profile suits a short-lived process.

### JRuby: Ruby on the JVM

JRuby runs Ruby on the Java Virtual Machine. Its distinguishing feature is
two-way interoperability with Java libraries:

```ruby
require "java"

list = java.util.ArrayList.new
list.add("one")
list.add("two")
list.size         # => 2, calling Java's size()

# Ruby-style names map onto Java's camelCase automatically
map = java.util.HashMap.new
map.put("k", "v")
map.key_set.to_a  # keySet() reachable as key_set
```

JRuby also inherits the JVM's threading model, its mature GC options, and its
profiling and monitoring tooling.

The limitations are specific and worth memorizing:

- **Ractors are not supported**, and CRuby's thread scheduler / Fiber scheduler
  semantics do not carry over — JRuby uses real JVM threads instead.
- **Native C-extension gems are not supported** in the CRuby sense. Gems either
  need a pure-Ruby mode or a JRuby-specific replacement (the common pattern being
  a JDBC-backed adapter in place of a native database driver).
- JVM startup cost is real and is felt hardest by short-lived commands.

> ⚠️ **Book vs. today:** the book's complaint that JRuby lags CRuby by years —
> JRuby 9.4 (November 2022) only reaching Ruby 3.1 parity — was fair at the time
> but is much less true now. JRuby 10, released in 2025, targets Ruby 3.4
> compatibility and requires a modern JDK baseline (Java 21+). Treat "JRuby is
> stuck several versions behind" as a claim to re-check against the current
> release rather than a standing fact.

### mRuby: not a drop-in replacement

mRuby is a minimalist Ruby designed by Matz for **embedding**: a small
interpreter you link into a C program or run on memory-constrained hardware. It
implements a subset of the language and a much smaller standard library,
assembled from opt-in `mrbgems` at build time.

The important framing is that mRuby is not "Ruby, but smaller for your web app."
It is a scripting layer for C hosts and devices. Your Rails app will not run on
it, and it is not trying to.

### The long tail

Several other implementations exist but see little or no activity, and are worth
recognizing by name rather than evaluating:

- **Artichoke Ruby** — written in Rust, pre-production.
- **Opal** — compiles Ruby to JavaScript for the browser.
- **MagLev** — built on the Smalltalk/GemStone VM.
- **Rubinius** — a Ruby-in-Ruby implementation.
- **IronRuby** — targeted the .NET CLR.

If a runtime is not CRuby, TruffleRuby, JRuby, or mRuby, assume you are on your
own for support.

## Trade-offs

- **YJIT is nearly free to enable, but only for long-running processes** — the
  default call threshold of 30 calls means a script that exits in a second pays
  compilation cost without collecting the benefit. Enable it on web and worker
  processes; leave it off for CLI tools, and verify with `RubyVM::YJIT.enabled?`
  rather than assuming the flag reached the process.
- **YJIT trades memory for speed** — compiled code lives in a bounded code cache
  (`--yjit-exec-mem-size`). On a memory-tight box running many forked workers,
  that is a real budget line, not a rounding error.
- **TruffleRuby buys throughput with ecosystem risk** — the ~97% ruby-spec pass
  rate and limited native-extension support mean the deciding question is never
  "is it faster?" but "does my entire `Gemfile.lock` work?" Audit the gems before
  benchmarking.
- **JRuby buys Java interop and true thread parallelism, and gives up CRuby
  fidelity** — no Ractors, no native C extensions, and JVM startup cost. It is the
  right answer when you are already inside a JVM shop or need a specific Java
  library, and an expensive detour when you just want "Ruby, but faster."
- **A runtime switch is an operational commitment, not an experiment** — different
  GC behavior, different memory profile, different profiling tooling, and a
  smaller pool of people who have debugged your stack in production. The cheapest
  performance win available to most Ruby applications is still CRuby with YJIT on.
- **"Ruby is slow" is not a statement about a language** — always ask which
  runtime, which version, and whether the JIT was warm before accepting a
  benchmark.

## Documentation Links

- [YJIT — Ruby's JIT compiler (ruby/ruby docs)](https://github.com/ruby/ruby/blob/master/doc/yjit/yjit.md) — doc
- [YJIT Numbers in 2023 — Rails at Scale](https://railsatscale.com/2023-11-08-yjit-numbers-in-2023/) — doc
- [Everything you need to know about Ruby 4.0 — Honeybadger](https://www.honeybadger.io/blog/ruby-4/) — doc
- [TruffleRuby — GraalVM](https://www.graalvm.org/ruby/) — doc
- [JRuby — Ruby on the JVM](https://www.jruby.org/) — doc
- [mruby — the lightweight embeddable Ruby](https://mruby.org/) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby Runtimes](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
