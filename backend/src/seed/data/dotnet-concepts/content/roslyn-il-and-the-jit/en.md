---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

C# never runs as C#. Roslyn compiles it to IL (intermediate language) plus
metadata inside an assembly, and at run time the JIT turns each method into
machine code the first time it is called, and often again later. Knowing the
two steps explains things that otherwise look like magic: why a benchmark is
slow in its first second, why a lambda or a top-level program becomes a
compiler-generated method, what ReadyToRun and Native AOT trade away, and how
to look at what the compiler and the JIT actually produced instead of guessing.

## Use Cases

- Reading the IL of a method to see what the compiler generated for a feature
  (top-level statements, `foreach`, closures, `async`).
- Understanding why the first requests after a deploy are slower than the rest,
  and what warm-up actually warms.
- Deciding whether `PublishReadyToRun` is worth the bigger files for a service
  with slow startup.
- Diagnosing a microbenchmark that measured Tier0 code instead of optimized
  code.
- Explaining to a Java developer how the CLR pipeline maps to `javac`,
  bytecode and HotSpot.

## Deep Dive

### Step one: Roslyn emits IL and metadata

`dotnet build` runs Roslyn, the C# compiler, which writes an assembly (`.dll`).
The assembly holds two things. **Metadata** describes every type, method,
field and the assemblies referenced. **IL** is the body of each method, written
for a stack machine that does not depend on the CPU. Metadata is what makes
reflection, the debugger and decompilers possible.

Take this program:

```csharp
long total = 0;
for (int round = 0; round < 20; round++)
{
    for (int i = 0; i < 1_000; i++)
        total += Calc.Add(i, 1);
    Thread.Sleep(20);
}
Console.WriteLine(total);                     // 10010000
Console.WriteLine(Calc.LongLoop(100_000_000)); // 299999995

static class Calc
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int Add(int a, int b) => a + b;

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static long LongLoop(int n)
    {
        long sum = 0;
        for (int i = 0; i < n; i++)
            sum += i % 7;
        return sum;
    }
}
```

To read the IL without installing anything globally, install the ILSpy command
line tool into a local folder:

```bash
dotnet tool install ilspycmd --tool-path ./tools
./tools/ilspycmd -il bin/Release/net10.0/IlJit.dll
```

The relevant part of the output, abridged:

```text
.method public hidebysig static int32 Add (int32 a, int32 b) cil managed noinlining
{
    // Code size: 4 (0x4)
    .maxstack 8
    IL_0000: ldarg.0
    IL_0001: ldarg.1
    IL_0002: add
    IL_0003: ret
}

.class private auto ansi beforefieldinit Program
    .method private hidebysig static void '<Main>$' (string[] args) cil managed
        .entrypoint
        ...
        IL_000a: call int32 Calc::Add(int32, int32)
        ...
        IL_0029: call void [System.Console]System.Console::WriteLine(int64)
```

Three things show up. IL pushes arguments on an evaluation stack, operates on
them and returns, with no registers. The top-level statements became a
compiler-generated class `Program` with an entry point named `<Main>$`. And
calls into the framework name the assembly that defines the type
(`[System.Console]`), which is how the runtime knows what to load.

### Step two: the JIT compiles methods on first call

The runtime does not compile the assembly when it loads. Each method starts
pointing to a stub, and the first call triggers the JIT for that method only.
Since .NET Core 3.0 this is **tiered**: a method is first compiled quickly with
few optimizations (Tier0), and if it turns out to be hot it is compiled again,
fully optimized, in the background (Tier1). Calls switch to the new code once it
is ready.

The shipping runtime can print what the JIT did. `DOTNET_JitDisasmSummary=1`
lists every method it compiled, with the tier. On .NET 10.0.0, macOS arm64, the
program above produced:

```text
JIT compiled Program:<Main>$(System.String[]) [Instrumented Tier0, IL size=72, code size=368]
JIT compiled Calc:Add(int,int) [Tier0, IL size=4, code size=36]
JIT compiled Calc:Add(int,int) [Instrumented Tier0, IL size=4, code size=36]
JIT compiled Calc:Add(int,int) [Tier1, IL size=4, code size=20]
JIT compiled Program:<Main>$(System.String[]) [Tier1-OSR @0x1a with Synthesized PGO, IL size=72, code size=204]
JIT compiled Calc:LongLoop(int) [Instrumented Tier0, IL size=24, code size=192]
JIT compiled Calc:LongLoop(int) [Tier1-OSR @0x12 with Synthesized PGO, IL size=24, code size=100]
```

`Add` was compiled three times. `DOTNET_JitDisasm=Add` shows why it was worth
it: the Tier0 version copies both arguments to the stack frame and loads them
back, while the Tier1 version is a single instruction around the frame setup.

```text
; Tier0 code                         ; Tier1 code
str  w0, [fp, #0x1C]                 add  w0, w0, w1
str  w1, [fp, #0x18]
ldr  w0, [fp, #0x1C]
ldr  w1, [fp, #0x18]
add  w0, w0, w1
; Total bytes of code 36             ; Total bytes of code 20
```

### Dynamic PGO and on-stack replacement

The `Instrumented Tier0` line is **dynamic PGO** (profile-guided optimization):
the intermediate version records which branches and types are actually used,
and Tier1 uses that profile. Dynamic PGO is enabled by default since .NET 8;
Microsoft reports an average gain of about 15% on its benchmark suite.

`LongLoop` is called only once, so call counting can never promote it. That is
what **OSR** (on-stack replacement, added in .NET 7) solves: the loop has a
patchpoint, and after enough iterations the runtime compiles an optimized
version and jumps into it in the middle of the running method. `Tier1-OSR
@0x12` means the switch happened at IL offset `0x12`, which is the loop header
in the IL listing.

Turning the knobs off makes each mechanism visible:

| Setting | What the summary showed |
|---|---|
| default | `Add`: Tier0, Instrumented Tier0, Tier1. Loops: Tier0 then Tier1-OSR |
| `DOTNET_TieredPGO=0` | Same tiers, without the `Instrumented` step |
| `DOTNET_TieredCompilation=0` | Every method compiled once as `FullOpts` |

### ReadyToRun: compiled before the app starts

The program above caused only 9 JIT compilations in total, although it used
`Console`, threads and string formatting. The framework assemblies ship as
**ReadyToRun** (R2R): they contain native code next to the IL, so the runtime
uses that code instead of calling the JIT. With `DOTNET_ReadyToRun=0` the same
run caused 663 JIT compilations.

You can do the same for your own code with `PublishReadyToRun`, which requires a
runtime identifier:

```bash
dotnet publish -c Release -r osx-arm64 --self-contained false -p:PublishReadyToRun=true -o r2r
```

The published `IlJit.dll` grew from 5,120 to 6,144 bytes and the summary
changed to:

```text
JIT compiled Calc:Add(int,int) [Instrumented Tier1, IL size=4, code size=20]
JIT compiled Calc:Add(int,int) [Tier1, IL size=4, code size=20]
```

`<Main>$` and `LongLoop` were never JIT compiled; their precompiled code ran.
`Add`, being hot, was still recompiled by tiering, because R2R code is
optimized less aggressively than Tier1 code. R2R is startup insurance, not a
replacement for the JIT. Native AOT goes further and removes IL and the JIT
completely, which is the subject of its own concept.

### The Java parallel

The pipeline mirrors the JVM: Roslyn plays `javac`, IL plays bytecode, the
assembly plays the `.class`/`.jar`, and tiered JIT with PGO plays HotSpot's C1
and C2 tiers. Two differences matter. HotSpot starts by interpreting bytecode,
while the CLR's first tier is already machine code (the Tier0 listing above).
And the shipped framework is precompiled (R2R), which the JVM only approaches
with CDS and the AOT cache of Project Leyden.

## Trade-offs

- **Tiered compilation favors startup over the first seconds of throughput.**
  Code runs unoptimized until it gets hot, so short benchmarks measure Tier0.
  Use BenchmarkDotNet, which warms up, instead of a `Stopwatch` around one call.
- **Disabling tiering gives steady code immediately and slower startup.**
  `TieredCompilation=false` makes every method `FullOpts` from the start, and
  also loses dynamic PGO, which can only learn from instrumented tiers.
- **Dynamic PGO makes performance depend on the workload seen so far.** A
  service warmed with unrepresentative traffic can optimize for the wrong
  branches.
- **ReadyToRun trades size for startup.** Microsoft documents assemblies two to
  three times larger; for a small app the gain is small because the framework is
  already precompiled.
- **IL is easy to read back, for anyone.** A decompiler restores readable C#
  from your assemblies, including logic you consider private. Obfuscation slows
  that down but does not prevent it; secrets never belong in the binary.
  ```bash
  ./tools/ilspycmd bin/Release/net10.0/IlJit.dll   # prints C# rebuilt from IL
  ```
  Even the names survive, except local variable names, because they live in the `.pdb`, not in
  the assembly: `long sum` came back as `long num`.

## Documentation Links

- [Managed execution process, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/managed-execution-process) (doc)
- [Compilation config settings (tiered compilation, quick JIT, ReadyToRun, PGO), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/compilation) (doc)
- [What's new in .NET 8 runtime (dynamic PGO on by default), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-8/runtime) (doc)
- [What's new in .NET 7 (on-stack replacement), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-7) (doc)
- [ReadyToRun deployment overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) (doc)
- [Viewing JIT dumps (JitDisasm, JitDisasmSummary), dotnet/runtime](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/jit/viewing-jit-dumps.md) (doc)
