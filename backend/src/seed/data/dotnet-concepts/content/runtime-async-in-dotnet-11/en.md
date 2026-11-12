---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Since C# 5 an `async` method has been rewritten by the compiler into a state machine: fields for the
locals, a `MoveNext` method, a builder that owns the returned `Task`. The runtime sees an ordinary
class with an ordinary method and knows nothing about "suspension". .NET 11 adds a second way: with
runtime async the compiler marks the method as async and the runtime itself captures and resumes the
frames. The lesson on `Task` and `async`/`await` internals already has a short section on this. This
one goes deeper: what exactly switches on, what you gain and what you do not, and what to check before
you turn it on in your own project.

The honest framing comes first. Runtime async is **enabled in the runtime libraries but still
documented as a preview feature for your own code**. Everything here was run on SDK 11.0.100 and
runtime 11.0.0 (macOS arm64, Release builds unless said otherwise). Where I only have the documentation,
I say so.

## Use Cases

- Deciding whether to turn the flag on in an application that is already moving to `net11.0`.
- Reading a profiler, a debugger call stack or a log of `new StackTrace()` and wondering where the
  `MoveNext` and `AsyncMethodBuilderCore` frames went.
- Explaining why a service that only changed its target framework now allocates less on suspending
  calls without a code change.
- Reviewing a claim such as "runtime async makes async 10 times faster" against what you can measure.

## Deep Dive

### What already comes on, and what you opt into

There are two separate things. First, the .NET 11 runtime libraries are compiled with the feature, so
the async methods in the base class library no longer have compiler state machines. I counted methods
carrying `[AsyncStateMachine]` in the shipped assemblies: 3 in `System.Private.CoreLib`, 2 in
`System.Net.Http` and 0 in `System.IO.Compression`, against 69, 119 and 51 on .NET 10. You get that
without doing anything, as soon as the app runs on the 11 runtime.

Second, your own code opts in with one property, and on `net11.0` you do not need
`EnablePreviewFeatures`:

```xml
<PropertyGroup>
  <Features>runtime-async=on</Features>
</PropertyGroup>
```

The [.NET 11 runtime notes](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime)
say "Runtime Async is a preview feature", so read the opt-in as a decision about risk, not as a
switch Microsoft has declared production-ready. According to the same page the old
`DOTNET_RuntimeAsync` and `UNSUPPORTED_RuntimeAsync` environment variables were removed, and the way to
opt out per project is `<UseRuntimeAsync>false</UseRuntimeAsync>`. I did not test that opt-out; it is
from the documentation. I did test that with the flag on the method no longer has
`AsyncStateMachineAttribute`, which is an easy check that the compiler really took the other path.

### The live stack gets shorter

I wrote a recursive async method that awaits `Task.CompletedTask` and then calls itself, and at the
bottom returns `new StackTrace().FrameCount`. Frames at recursion depth 0, 3 and 10:

```text
                 depth 0   depth 3   depth 10   per level
classic            9         21        49          4
runtime async      3          6        13          1
```

The classic build adds four frames per level, the method plus the state-machine and builder
infrastructure around it. With runtime async each call is one frame, the real call chain. The documentation example shows the same effect: 13 frames became 5. This is the
"live" stack, what a profiler or a debugger sees while the code runs, or what a log line with
`new StackTrace()` prints.

An exception's `StackTrace` did not change. For a method that yields and then throws three levels deep,
both builds printed the same five lines (four calls of the method plus `Main`). The documentation
explains why: the existing cleanup of exception stack traces in compiler-generated code already hid the
state-machine frames. So the exception text your logs and Sentry captured before does not get shorter
by turning the flag on.

### Allocation and time, measured and not guessed

The marketing version says "lower overhead". I measured two shapes of call, both in Release. The first
awaits a method that always suspends once (`await Task.Yield()`), 200,000 times in a loop, and divides
`GC.GetTotalAllocatedBytes` by the call count:

```text
                          classic      runtime async
returns Task<int>          96 B/call     56 B/call
returns ValueTask<int>    104 B/call     56 B/call
time, 200k Task calls    148-178 ms     59-63 ms
```

Suspending costs less memory in both shapes, and the `Task` version took about 2.5 times less time over
several runs. The `ValueTask` time was too noisy to claim anything (58 to 106 ms against 76 to 102 ms),
and 56 bytes is still an allocation: runtime async does not make suspension free.

The second shape is the one people use to sell `ValueTask`: 2 million awaits of a method whose result is
already available (`await Task.CompletedTask` inside). Both builds allocated nothing. After warm-up the
classic build ran it in about 8 ms and runtime async in about 12 ms (the first classic runs took 75 ms
before tiered compilation optimized them). So on the synchronous fast path I measured no gain and a
small loss. An earlier run of mine on a release candidate, in a Debug build, had shown 94 MB against
215 KB for this loop. That does not describe Release, where the classic fast path allocated nothing, and that is the reason this lesson uses Release numbers only. These are micro measurements on
one machine: they show the direction, not what your service will gain. The documentation lists the
mechanisms behind the improvement (cached continuations, tiered async compilation, JIT folding of
`Task.CompletedTask`), and says that continuations that have nothing to restore skip the
`ExecutionContext` capture, which I did not measure.

### What does not change for the code you write

The contract is the same, and the lab checks the pieces:

- **Results and ordering.** Both builds returned the same sums, and `await` still resumes after the awaited
  work completes.
- **`ConfigureAwait`.** With a counting `SynchronizationContext` installed, an `await Task.Delay(5)` posted
  one continuation to it and `ConfigureAwait(false)` posted zero, in both modes. The rules for libraries
  and for application code are unchanged.
- **`AsyncLocal<T>`.** A value set inside an async method was visible after an `await` in that method and
  did not leak to the caller, in both modes.
- **`ValueTask`.** The usage rules (await once, do not use it concurrently) are part of the type, not of the
  implementation. Runtime async does not make a double await legal.
- **The type you return.** The method still returns `Task<T>`; I printed `GetType()` of the returned task in
  both modes and got `Task<int>`, so nothing in your signatures changes.

### Debugger and diagnostics

This part is from the documentation, not from a debugger session. It says breakpoints bind inside
runtime-async methods and that stepping crosses `await` without entering generated infrastructure, and
that the async profiler now reports events for both runtime-async methods and compiler state-machine
methods, so tools see one consistent model. It also says Native AOT and ReadyToRun are supported.

What I would check before enabling it in a real project is anything that reads the state machine: a tool
or an in-house script that walks `MoveNext` frames or state-machine fields in a dump, or a test that
looks for `AsyncStateMachineAttribute` by reflection. With the flag on the attribute is gone, as the lab
shows. I did not test `dotnet-dump` or the async stack commands against a dump of a runtime-async
process, so treat that as an open item for your own tooling.

### The lab

The lab compiles one `Workload.cs` into two projects that differ in a single line, and the tests load
both through extern aliases. They assert properties with margins: classic adds at least twice as many
frames per level as runtime async, runtime async adds about one, the allocation per suspending call is
between 1 and 1,024 bytes in both and lower with runtime async, `ConfigureAwait` posts 1 or 0
continuations, and the exception traces have the same number of lines. No test asserts an exact byte
count or a time, because both change with the machine and the build configuration.

## Trade-offs

- **Preview for your own code.** The libraries use it; your opt-in is the documented preview. Turn it on in a
  service with good tests and a way back, not in a library you ship to others.
- **Live stacks and exception stacks differ.** Profilers and debuggers get shorter stacks, but exception
  traces did not change, so do not promise shorter error logs.
- **Gains depend on the shape of the call.** Suspending calls allocated about 40 to 50 percent less here.
  The synchronous fast path had no allocation to remove and was slightly slower in my loop.
- **Tooling that reads state machines can break.** Anything that depends on `MoveNext`, builders or
  `AsyncStateMachineAttribute` needs to be checked with the flag on.
- **Not a reason to change code.** Do not replace `Task` with `ValueTask` or remove `ConfigureAwait` because
  of this feature; the rules from the internals lesson still decide those.

## Documentation Links

- [What's new in the .NET 11 runtime, Runtime Async, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime) (doc)
- [Runtime-native async, dotnet/runtime issue 109632](https://github.com/dotnet/runtime/issues/109632) (doc)
- [Asynchronous programming with async and await, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/) (doc)
- [ConfigureAwait FAQ, .NET Blog](https://devblogs.microsoft.com/dotnet/configureawait-faq/) (doc)
- [ValueTask<TResult> struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.valuetask-1) (doc)
