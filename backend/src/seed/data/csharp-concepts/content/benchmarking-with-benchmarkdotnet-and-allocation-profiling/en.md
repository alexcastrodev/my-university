---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

"This version is faster" and "this version allocates less" are claims about
numbers, and a number taken with a stopwatch around one call is rarely the
number you think it is. BenchmarkDotNet is the standard tool for measuring .NET
code: it handles warm-up, JIT tiers, process isolation and statistics, and with
`[MemoryDiagnoser]` it reports allocations per operation, which is the number
that usually explains a slow service. This concept shows why a stopwatch
misleads, how to write a benchmark with a baseline and parameters, how to read
the report, which traps make a benchmark measure nothing, how pooling looks in
the numbers, and how to watch allocation in a running process. Every number
below was measured on one machine (an Apple M4 Max, macOS, arm64, 14 cores,
BenchmarkDotNet 0.15.8). Treat them as an illustration of the method, not as
data about your hardware.

## Use Cases

- Proving, before a pull request, that a rewrite allocates less and is not
  slower.
- Choosing between two implementations (`+=` versus `StringBuilder`, `new`
  versus `ArrayPool`) with evidence instead of folklore.
- Reading `Gen0` and `Allocated` to find out why a hot path triggers many
  collections.
- Checking that a runtime upgrade did not regress a critical method.
- Watching the allocation rate of a running service without attaching a
  debugger.

## Deep Dive

### Why a stopwatch misleads

A loop of `Stopwatch.StartNew()` around a call looks fine until you call it
more than once. Building a semicolon-separated string from 100 integers with
`+=`, timed on five consecutive calls in a Release build:

```csharp
for (int i = 0; i < 5; i++)
{
    long before = GC.GetAllocatedBytesForCurrentThread();
    var sw = Stopwatch.StartNew();
    var s = Csv.Plus(values);
    sw.Stop();
    Console.WriteLine($"{sw.Elapsed.TotalMicroseconds:F1} us, {GC.GetAllocatedBytesForCurrentThread() - before} B");
}
```

| Call | Time (two runs) | Allocated |
|---|---|---|
| 0 | 149 us, 283 us | 41,640 B, 39,736 B |
| 1 | 11 us, 9 us | 30,944 B |
| 2 to 4 | about 4 to 6 us | 30,944 B |

The first call was 25 to 60 times slower than the steady state, because it includes JIT
compilation and first-use costs. The steady state needs several calls to
appear, tiered compilation can still change the code afterwards, and a single
number has no spread. BenchmarkDotNet exists to remove exactly these problems:
it runs the method in a separate process, calibrates how many operations to run
per measurement, discards warm-up, repeats, and reports the mean with an error
interval. Note that `GC.GetAllocatedBytesForCurrentThread` already gave the
stable number here (30,944 bytes) after the first call. Bytes are far more
repeatable than time, which is why the lab for this concept asserts on them.

### A first benchmark

```csharp
[MemoryDiagnoser]
public class ConcatBench
{
    [Params(10, 1000)] public int N;
    private int[] _values = [];

    [GlobalSetup] public void Setup() => _values = Enumerable.Range(0, N).ToArray();

    [Benchmark(Baseline = true)] public string Plus() => Csv.Plus(_values);
    [Benchmark] public string Builder() => Csv.Builder(_values);
}
```

Run it from a console project that references the `BenchmarkDotNet` package,
in Release, outside the debugger:

```csharp
BenchmarkSwitcher.FromAssembly(typeof(Program).Assembly).Run(args);
```

```bash
dotnet run -c Release -- --filter "*ConcatBench*" --job short
```

`--job short` runs fewer iterations (three here), which is why the error
column below is wide. Use the default job for a conclusion you will defend.

| Method | N | Mean | Ratio | Gen0 | Allocated | Alloc Ratio |
|---|---|---|---|---|---|---|
| Plus | 10 | 72.9 ns | 1.00 | 0.0573 | 480 B | 1.00 |
| Builder | 10 | 49.1 ns | 0.67 | 0.0325 | 272 B | 0.57 |
| Plus | 1000 | 145,528 ns | 1.00 | 459.2 | 3,844,104 B | 1.000 |
| Builder | 1000 | 3,005 ns | 0.02 | 1.99 | 16,680 B | 0.004 |

### Reading the report

- **Baseline and Ratio.** `[Benchmark(Baseline = true)]` marks the reference
  method; `Ratio` is each method's mean divided by the baseline's mean (the
  report legend says "[Current]/[Baseline]"), so 0.02 means about fifty times faster.
  A ratio is only meaningful within one report.
- **`[Params]`** runs every benchmark once per value and prints one block per
  value, separated by an empty row. The table above shows why: at N = 10 the
  builder is 33 percent faster, at N = 1000 it is almost fifty times faster and
  allocates 230 times fewer bytes, because `+=` copies the whole string at each
  step and the cost grows with the square of the input. One input size would
  have hidden the story.
- **`Gen0`, `Gen1`, `Gen2`** are collections per 1000 operations: 459 gen0
  collections per 1000 calls of `Plus(1000)`. This is the cost the mean does not
  show, because it falls on the whole process.
- **`Allocated`** is managed memory per operation, inclusive of what the
  method calls; native memory is not counted.
- **`Error` and `StdDev`** tell you how much to trust `Mean`. If the error is a
  large fraction of the mean (the N = 10 row above, from a short run), do not
  conclude anything from that row.

### Traps that make a benchmark measure nothing

Four methods that look like benchmarks, in one class with `[MemoryDiagnoser]`:

```csharp
[Benchmark] public void Dead()     { var a = new byte[1000]; }
[Benchmark] public int  Kept()     { var a = new byte[1000]; return a.Length + _x; }
[Benchmark] public byte[] Returned() { var a = new byte[1000]; return a; }
[Benchmark] public double Constant() => Math.Sqrt(2.0);
```

| Method | Mean | Allocated |
|---|---|---|
| Dead | 0.04 ns | none |
| Kept | 0.04 ns | none |
| Returned | 28.5 ns | 1,024 B |
| Constant | about 0 ns | none |

BenchmarkDotNet printed a `ZeroMeasurement` warning for the first, second and
fourth: "the method duration is indistinguishable from the empty method
duration". The JIT removed the array that nothing used, even in `Kept`, where
only its length was read (the escape analysis described in Value Types,
Reference Types and Boxing), and folded `Math.Sqrt(2.0)` into a constant. Only
the version that returns the array measured an allocation. The rules that
follow:

- **Return the result** (or hand it to a `Consumer`/`Blackhole`) so the work
  cannot be removed. This is dead code elimination.
- **Read inputs from fields** set in `[GlobalSetup]`, never constants, so the
  JIT cannot fold the computation.
- **Keep setup out of the method.** Building the input inside the benchmark
  measures the setup too; `[GlobalSetup]` runs once and `[IterationSetup]` is a
  last resort, because it distorts short benchmarks.
- **Release only.** Running the same project in Debug, BenchmarkDotNet stops
  before measuring: "Assembly Demo which defines benchmarks is non-optimized".
  Also run outside the debugger and, ideally, with other heavy programs closed.
- **Watch for tiering and warm-up.** The default job runs warm-up iterations
  until the method is stable; if you lower it, check that `Mean` is not still
  falling.

### Comparing .NET 10 and .NET 11

BenchmarkDotNet can run the same benchmark on several runtimes through a job
per runtime. On 0.15.8, the stable version when this was written, that
is a problem for .NET 11: its `CoreRuntime` has `Core10_0` and no `Core11_0`,
the command line `--runtimes net11.0` is rejected ("The provided runtime
"net11.0" is invalid", the list ends at `net10_0`), and a project built for
`net11.0` fails with `NotImplementedException: GetRuntimeVersion not
implemented for NotRecognized` in the default toolchain. What worked here was
building the project for both target frameworks and running each build in the
process with `--inProcess`, which measures on the host runtime without the SDK
check:

```bash
dotnet run -c Release -f net10.0 -- --filter "*VersionBench*" --inProcess
dotnet run -c Release -f net11.0 -- --filter "*VersionBench*" --inProcess
```

| Method | .NET 10.0.0 | .NET 11.0.0 | Allocated (both) |
|---|---|---|---|
| `LinqSum` over 1000 ints | 1.234 us | 1.218 us | 104 B |
| `StringBuilder` loop, 1000 ints | 2.883 us | 2.770 us | 16,680 B |

Differences of 1 to 4 percent with errors up to 2 percent: no conclusion
beyond "no regression here". `--inProcess` gives up the process isolation that
protects a benchmark from the host's own state, so it is a workaround, not a
default; check the release notes of BenchmarkDotNet for first-class .NET 11
support before relying on this.

### Pooling as a measured fix

`ArrayPool<T>.Shared` and `ObjectPool<T>` (package
`Microsoft.Extensions.ObjectPool`) replace allocation with reuse. Whether they
pay off is a question for the report:

| Method (ShortRun) | Mean | Ratio | Gen0/Gen1/Gen2 | Allocated |
|---|---|---|---|---|
| `new byte[100_000]` | 3,401 ns | 1.000 | 31 / 31 / 31 | 100,045 B |
| `ArrayPool<byte>.Shared.Rent` / `Return` | 3.96 ns | 0.001 | none | none |
| `new StringBuilder()` plus `ToString()` | 13.2 ns | 0.004 | 0.017 gen0 | 144 B |
| `StringBuilder` pool `Get` / `Return` | 10.2 ns | 0.003 | 0.005 gen0 | 40 B |

The array above 85,000 bytes lives on the large object heap, so every call
feeds gen2 collections (the 31 in the `Gen2` column); the pool removes the
allocation altogether. The small builder case is a modest gain, and the
pooled version still allocates 40 bytes for the result string. Pooling has a
configuration cost you can measure as well. The default policy of the
`StringBuilder` pool discards builders that grew past 4,096 characters, so
with a result of 3,890 characters it pays for the pool plus a new builder
every call:

| Bytes per call (1000 calls, one thread) | 100 values | 1000 values |
|---|---|---|
| pooled `StringBuilder` | 609 B | 21,176 B |
| new `StringBuilder()` | 2,064 B | 16,680 B |
| new `StringBuilder(capacity)` | 1,880 B | 19,880 B |

At 100 values the pool allocates only the result (602 B for a 290 character
string). At 1000 values the pooled version allocated more than a plain builder,
because the builder never survived the pool's size limit (the policy's `InitialCapacity` is 100 and `MaximumRetainedCapacity` is 4,096, read from `StringBuilderPooledObjectPolicy`). A pool is a
trade, not a free win: measure with your real sizes. The same holds for
`ArrayPool` (clear sensitive data on `Return` with `clearArray: true`, and never
touch a buffer after returning it).

### Allocation in a running process

When you cannot attach a benchmark, `dotnet-counters` reads the runtime's
counters through EventPipe. Installed with `dotnet tool install dotnet-counters
--tool-path <dir>` (version 10.0.750501 here) and pointed at a process that
called the `+=` method in a loop for 25 seconds:

```bash
dotnet-counters collect -p <pid> --counters System.Runtime \
    --format csv -o counters --refresh-interval 1 --duration 00:00:08
```

The CSV had one row per counter per second, using the OpenTelemetry style
names of recent runtimes. The ones that answer an allocation question:

| Counter | Value over 8 seconds |
|---|---|
| `dotnet.gc.collections` for gen0 | 2,459 to 3,053 per second |
| `dotnet.gc.collections` for gen1 / gen2 | 0 to 2 per second / 0 |
| `dotnet.gc.heap.total_allocated` | 20.6 to 25.5 GB per second |
| `dotnet.gc.last_collection.heap.size` for the LOH | 24 B |

That is a gen0-only storm: everything dies young, nothing reaches the LOH, and
the process spends its time allocating and collecting. It is the shape of the
`+=` loop with 1000 values from the benchmark above. Counters tell you that a
process allocates too much and in which generation; to find which methods and
types are responsible, use an allocation profile or a dump with the tools in
Diagnosing Production with dotnet-trace, dump and gcdump, then confirm the fix
with a benchmark.

## Trade-offs

- **Stopwatch versus BenchmarkDotNet.** A stopwatch is enough to see an order
  of magnitude (a 50x difference is not noise); BenchmarkDotNet is for
  decisions, at the price of minutes per run and a separate project.
- **Short job versus default job.** `--job short` makes a fast feedback loop but
  produces wide error bars, as the N = 10 row shows; use the default job for
  numbers that go into a pull request.
- **Time versus allocations.** Bytes per operation are stable across machines
  and runs, time is not. For regression tests, assert on allocation in ranges
  (as the lab does with `GC.GetAllocatedBytesForCurrentThread`) and keep time in
  benchmarks you read.
  ```csharp
  var before = GC.GetAllocatedBytesForCurrentThread();
  Work();
  Assert.InRange(GC.GetAllocatedBytesForCurrentThread() - before, 0, 1_000);
  ```
- **Microbenchmark versus production.** A benchmark on one machine, one input
  size and a warm cache says little about contention, a loaded GC heap or a
  different CPU. Use it to compare two versions, then confirm in production
  with counters.
- **Pooling versus plain allocation.** A pool removes GC pressure for big
  or hot buffers, and adds lifetime rules (return it, do not touch it after) and
  size policies. For small short-lived objects, the generational GC is often
  cheaper than the discipline.

## Lab

In this lab you build an allocation meter, fix methods that allocate too much, and write a BenchmarkDotNet benchmark. The tests never look at time: they read `GC.GetAllocatedBytesForCurrentThread` and assert on ranges, and they read the attributes of your benchmark class by reflection.

**The scenario**

A small reporting library that renders integer lists and checksums network frames.

- `Measure.cs`: `BytesPerCall` and `AllocRatio`, to be written.
- `ReportRenderer.cs`: `RenderSlow` (provided, uses `+=`), `RenderFast` and `RenderPooled`.
- `Frames.cs`: `ChecksumCopy` (provided, copies the frame) and `ChecksumPooled`.
- `RenderBenchmarks.cs`: the benchmark class, with no attributes yet.
- `BenchLab.Runner`: a console project that runs the benchmarks for real, in Release.

**What you will do, step by step**

1. **Measure allocation (TODO-00).** `BytesPerCall` calls the work once as warm-up, then runs it `iterations` times between two reads of `GC.GetAllocatedBytesForCurrentThread()` and returns the average. Keep every result in `Sink` so the work is not dead code, and throw `ArgumentOutOfRangeException` for zero or negative iterations.
2. **Compare (TODO-01).** `AllocRatio` returns the candidate's bytes divided by the baseline's, like the `Alloc Ratio` column, and refuses a baseline that allocates nothing.
3. **Fix the `+=` loop (TODO-02).** `RenderFast` returns the same text as `RenderSlow` using one `StringBuilder`. The test allows a few times the result size and requires the slow version to allocate more than fifty times the result.
4. **Stop copying frames (TODO-03).** `ChecksumPooled` rents a buffer from `ArrayPool<byte>.Shared`, sums only the first `frame.Length` bytes (the rented buffer may be longer and dirty) and returns it in a `finally`. The test uses a 100,000 byte frame, above the LOH threshold, and requires less than 1,000 bytes per call.
5. **Write the benchmark (TODO-04).** Add `[MemoryDiagnoser]`, a `[Params]` field with at least two sizes, a `[GlobalSetup]` method, and two `[Benchmark]` methods that return their results, one of them `Baseline = true`. Then run it with the runner and read `Ratio` and `Alloc Ratio`.

**How you know you are done**

`dotnet test` (and then `dotnet test -c Release`) is all green, and the runner prints a table where the fast version has an `Alloc Ratio` well below 1 for 1000 values. You should be able to explain why the result of `Dead` in the traps table is not a measurement.

**Optional challenge**

- **TODO-05:** `RenderPooled` takes a builder from an `ObjectPool<StringBuilder>` and allocates only the result string. Try it with 1000 values and explain why it stops helping.

**Prerequisites:** allocations and `ArrayPool<T>`, basic reflection, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`, and then `dotnet test -c Release`. The methods throw `NotImplementedException` and each `TODO-NN` is a comment with the hint, so the red tests are your checklist.

## Documentation Links

- [BenchmarkDotNet overview](https://benchmarkdotnet.org/articles/overview.html) (doc)
- [BenchmarkDotNet good practices](https://benchmarkdotnet.org/articles/guides/good-practices.html) (doc)
- [BenchmarkDotNet baselines](https://benchmarkdotnet.org/articles/features/baselines.html) (doc)
- [BenchmarkDotNet diagnosers, including the MemoryDiagnoser](https://benchmarkdotnet.org/articles/configs/diagnosers.html) (doc)
- [GC.GetAllocatedBytesForCurrentThread, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.gc.getallocatedbytesforcurrentthread) (doc)
- [ArrayPool<T>, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1) (doc)
- [Object reuse with ObjectPool in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/objectpool) (doc)
- [dotnet-counters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) (doc)
