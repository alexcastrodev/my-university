---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

[The Garbage Collector: Generations and the LOH](/csharp-concepts/garbage-collector-generations-and-the-loh)
explains what the collector does. This concept is about the knobs: Workstation
or Server, concurrent or not, `GCSettings.LatencyMode`, `GC.TryStartNoGCRegion`,
the heap limits that decide what happens inside a container, `GCConserveMemory`,
`GCHeapCount` and DATAS. A stress program (8 threads, 100 MB of live data, about
12 GB of garbage per second) ran under each setting and reported throughput,
pauses and peak memory. The summary: the defaults are good, a setting that
sounds like a free win (`LowLatency`) made the program 7 times slower, and one
documented default (DATAS) does nothing on the macOS machine used here. Every
number belongs to this hardware (Apple M4 Max, 14 cores, 36 GB, macOS) or to a
Docker Desktop Linux VM (14 CPUs, 8 GB), and none of it generalizes to yours.

Versions: .NET SDK 10.0.100, TFM `net10.0`, no NuGet packages (shared framework
only). Host runtime Microsoft.NETCore.App 10.0.0 (macOS arm64); container runs
used `mcr.microsoft.com/dotnet/sdk:10.0` with runtime 10.0.14 (Linux arm64).

## Use Cases

- Choosing Workstation, Workstation non-concurrent or Server GC for a worker, an
  API and a sidecar with a measurement instead of a rule of thumb.
- Reading a pause budget and checking what the runtime really read from
  `runtimeconfig.json` and the environment.
- Sizing a container: what heap limit .NET derives from `--memory`, and what
  happens at it.
- Reviewing code that sets `GCLatencyMode.LowLatency` or calls
  `GC.TryStartNoGCRegion` in a service.

## Deep Dive

### Where settings live, and which one wins

A setting can come from `runtimeconfig.json` (`System.GC.Server`), an MSBuild
property (`ServerGarbageCollection`) or the environment (`DOTNET_gcServer`).
The environment wins: with `"System.GC.Server": true` in the file,
`DOTNET_gcServer=0` ran Workstation, and `DOTNET_GCConserveMemory=2` beat
`ConserveMemory: 5` in the file. Numbers in environment variables are
hexadecimal (`DOTNET_GCHeapCount=0x4`), in JSON they are decimal.

`AppContext` is a reader here, not a setter. `AppContext.SetData("System.GC.Server",
true)` at startup left `GCSettings.IsServerGC` at `False`: the GC reads its
configuration once, before `Main`. To see what the runtime uses, ask it:

```csharp
foreach (var kv in GC.GetConfigurationVariables().OrderBy(k => k.Key))
    Console.WriteLine($"{kv.Key} = {kv.Value}");   // ServerGC, ConcurrentGC, HeapCount, GCDynamicAdaptationMode, ...
```

### Measure pauses before changing anything

`GC.CollectionCount(gen)` counts collections, `GC.GetTotalPauseDuration()` is the
total time managed threads were suspended since start (sample it before and
after a phase), and `GC.GetGCMemoryInfo(kind)` describes the last GC of one kind
(`Ephemeral`, `FullBlocking`, `Background`), so it is one GC, not an average
(a background gen2 sweeps, a blocking one compacts):

```text
collections gen0=7 gen1=6 gen2=6
total pause=0.60 ms, allocated=190 MB
Ephemeral    index=6 gen=0 compacted=False concurrent=False pause=0.03 ms pause%=2.5 heap=101 MB fragmented=27 MB committed=101 MB
FullBlocking index=7 gen=2 compacted=True concurrent=False pause=0.19 ms pause%=3.6 heap=61 MB fragmented=13 MB committed=62 MB
Background   index=5 gen=2 compacted=False concurrent=True pause=0.04 ms pause%=2.4 heap=101 MB fragmented=52 MB committed=101 MB
```

### The stress program

Each of 8 threads runs 2 million "requests" against a shared live set of 100,000
arrays of 1 KB (100 MB). A request builds 30 strings and 20 small arrays,
replaces one live array in four, and allocates a 200,000-byte array (large
object heap) one time in 256. Each request's latency is recorded, so a GC pause
shows up as the worst request. The load is extreme on purpose (Workstation was
paused 45 to 70 percent of the run).

### Workstation, Server, concurrent: measured on macOS

Median of 3 runs each, 16 million requests per run:

| Mode | Requests/s | gen0 / gen1 / gen2 | Total pause | Worst request | Peak RSS |
|---|---|---|---|---|---|
| Workstation, non-concurrent | 2.40 M | 624 / 233 / 154 | 4.6 s | 31 ms | 313 MB |
| Workstation, concurrent (default) | 2.05 M | 8,356 / 2,199 / 151 | 3.4 s | 18 ms | 223 MB |
| Workstation, concurrent, `GCConserveMemory=7` | 1.58 M | 8,625 / 2,453 / 427 | 3.7 s | 15 ms | 237 MB |
| Server (DATAS default) | 4.81 M | 60 / 41 / 36 | 1.1 s | 89 ms | 3,477 MB |
| Server, DATAS off | 4.93 M | 56 / 40 / 32 | 1.0 s | 83 ms | 3,455 MB |
| Server, `GCConserveMemory=7` | 4.40 M | 85 / 76 / 76 | 1.4 s | 66 ms | 2,576 MB |

- **Concurrent against not.** The concurrent default had shorter worst pauses
  (99.99th percentile of request latency 2 ms against 11 ms; worst 18 against 31
  ms) at 15 percent lower throughput, and ran 13 times more gen0 collections
  (I measured that, and Linux showed a similar ratio; the documentation I read
  does not explain it). Background GC only shortens gen2 pauses, so the
  throughput price came from the extra gen0 collections.
- **Server against Workstation.** About twice the throughput and a third of the
  total pause, but the worst request was 5 times longer (fewer, bigger
  collections) and peak memory 15 times larger: Server GC treats the process as
  the dominant one on the machine.
- **`GCConserveMemory=7`.** On Server it cut peak memory 26 percent for 9
  percent less throughput and double the gen2 count; on Workstation it cost 23
  percent of throughput and nearly tripled gen2 for no RSS gain. The docs
  suggest trying 5 to 7: measure, it is not free.

### DATAS: the default only where regions exist

DATAS (dynamic adaptation to application sizes) is on by default for Server GC
since .NET 9: `GCDynamicAdaptationMode` read `1` without my setting it. On the
Linux VM (same program, 2 runs each):

| Linux, Server | Requests/s | gen0 / gen1 / gen2 | Total pause | Peak RSS |
|---|---|---|---|---|
| DATAS default | 2.78 M | 438 / 155 / 82 | 2.9 s | 712 MB |
| DATAS off | 4.11 M | 100 / 67 / 60 | 1.2 s | 2,002 MB |

That is the documented trade: a heap proportional to live data, at a throughput
cost (the docs report 2 to 3 percent on their benchmark; 32 percent here, on a
hostile load). On macOS the same two rows were identical (4.81 M against 4.93 M
requests/s, 3.5 GB both). `GetConfigurationVariables` shows why:
`GCRegionRange = 0` on macOS and `16637952000` on Linux. Regions (4 MB for small
objects, 32 MB for the large and pinned heaps) replaced segments in .NET 7 on
64-bit Windows and Linux only. My inference is that DATAS needs regions (the
docs do not say so; the measurement does), so on macOS treat DATAS as absent and
test it on the OS you deploy.

On Linux, setting `GCHeapCount` made the runtime report
`GCDynamicAdaptationMode = 0` and the count was honored: 2 heaps gave 2.27 M
requests/s at 823 MB, 4 heaps 3.15 M at 1,299 MB, 14 heaps 4.11 M at 2,002 MB.
`GCHeapAffinitizeMask=0xF` left the result unchanged (docs only).

### `GCSettings.LatencyMode`: what each value really does

Defaults read back: Workstation concurrent `Interactive`, Workstation
non-concurrent `Batch`, Server `Interactive`. Setting every value in turn on
Workstation concurrent accepted all four; Workstation non-concurrent ignored
`SustainedLowLatency` (the value stayed `LowLatency`) and Server ignored
`LowLatency` (stayed `Interactive`). Both match the docs: `LowLatency` is
Workstation only and `SustainedLowLatency` needs background GC. Under the stress
program (Workstation concurrent, 2 runs each, mode set at startup):

| Mode | Requests/s | gen0 / gen2 | Total pause | Peak RSS | Peak committed |
|---|---|---|---|---|---|
| `Interactive` | 2.2 M | 8,356 / 151 | 3.3 s | 225 MB | 244 MB |
| `Batch` | 1.9 to 2.3 M | 8,265 / 149 | 4.2 to 4.6 s | 209 MB | 231 MB |
| `SustainedLowLatency` | 2.2 to 2.3 M | 8,355 / 150 | 3.3 to 3.4 s | 224 MB | 245 MB |
| `LowLatency` | 0.3 M | 295,086 / 0 | 36 to 37 s | 1.8 to 2.4 GB | 16.1 GB |

`Batch` removed background gen2 (longer pauses, worst request 27 to 39 ms
against 15 to 17 ms). `SustainedLowLatency` changed nothing because the default
already collects gen2 in the background. `LowLatency` did what the docs
describe, no gen2 at all, and the heap never got cleaned: 295 thousand gen0 and
gen1 collections, 16 GB committed on a 36 GB machine, 53 seconds instead of 7.
It is for a short, allocation-light window in a UI or acquisition loop, never a
setting for a service.

### `GC.TryStartNoGCRegion`: a budget, not a switch

```csharp
if (GC.TryStartNoGCRegion(200L << 20))     // commit up front, no GC until 200 MB is allocated
{
    try { /* critical section */ }
    finally { if (GCSettings.LatencyMode == GCLatencyMode.NoGCRegion) GC.EndNoGCRegion(); }
}
```

- The call runs a blocking full GC to make room (each generation counter moved
  by one; 6.6 to 7.1 ms with 97 MB live).
- Inside a 64 MB region, 40 MB of 1 MB arrays caused 0 collections and the mode
  stayed `NoGCRegion`. At 80 MB the GC ran (1 collection on macOS, 6 on Linux),
  the mode silently went back to `Interactive`, and `EndNoGCRegion` threw
  `InvalidOperationException: NoGCRegion mode must be set.`, hence the mode
  check in the `finally`.
- A nested `TryStartNoGCRegion` throws `InvalidOperationException` and also ended
  the outer region (the later `EndNoGCRegion` threw). Ending twice throws.
- Size limits depend on the platform. macOS Workstation accepted up to 243 MB and
  threw `ArgumentOutOfRangeException` from 244 MB; macOS Server accepted up to
  13,653 MB. On the Linux VM 4,096 MB was accepted and 16 GB returned `false`
  with no exception. Under `--memory=1g` 100 MB was accepted and 500 MB returned
  `false`: the region commits memory up front, so a container limit shrinks it.
  `TryStartNoGCRegion(total, lohSize)` splits the budget (1 GB with 900 MB for
  the large object heap returned `true`).

Then the counterintuitive part. Allocating 100 MB of 1 KB arrays with 97 MB live
took 2.4 to 2.5 ms normally (13 collections, 0.4 ms of pause) and 6.2 to 6.5 ms
inside a no-GC region (0 collections), after a 6.6 ms entry. The collections cost
0.4 ms in total, and never reusing memory meant touching fresh pages. Use a
region only when even a short pause inside a bounded section is unacceptable,
you know its allocation volume, and you can pay the entry cost.

### Containers: the heap limit is derived from the cgroup

[The Garbage Collector concept](/csharp-concepts/garbage-collector-generations-and-the-loh)
states the 75 percent default; here it is measured with `docker run --memory`,
allocating 64 KB arrays until failure:

| Container | `TotalAvailableMemoryBytes` | Result |
|---|---|---|
| `--memory=256m` | 192 MB | `OutOfMemoryException` at 186 MB held, RSS 219 MB |
| plus `GCHeapHardLimitPercent=50` | 128 MB | at 123 MB, RSS 155 MB |
| plus `GCHeapHardLimit=64 MB` | 64 MB | at 60 MB, RSS 91 MB |
| `--memory=512m` | 384 MB | high memory threshold 460 MB |

The runtime throws a catchable `OutOfMemoryException` at its own limit instead of
the kernel `OOMKill`ing the process, which is the point of the default. The limit
covers the managed heap only: threads, JIT code and native libraries come out of
the remaining 25 percent. The Kubernetes side is in
[Managed Runtime Memory in Containers](/kubernetes-concepts/managed-runtime-memory-in-containers),
which listed the .NET default as "documented" and is now measured. `--cpus=2`
made `Environment.ProcessorCount` 2 and Server GC created 2 heaps (asking for
`GCHeapCount=4` still gave 2). The stress program under `--memory=512m`:
Workstation 1.85 M requests/s, gen2 133, peak RSS 332 MB; Server 2.14 M, gen2
242, peak 364 MB (DATAS on or off gave the same, 2.06 M and 341 MB off).
Server shrank from 3.5 GB unlimited to 364 MB and DATAS stopped mattering,
because the hard limit already bounds the heap; its advantage fell from 2 times
to 16 percent. With `--cpus=2`, Server did 1.15 M with 6.2 s of pause against
Workstation's 0.97 M with 9.1 s.

### Book vs today

- Older articles recommend `GC.Collect()` to "free memory before a big job" and
  `GCLatencyMode.LowLatency` for responsiveness. `LowLatency` above turned a 7 s
  run into 53 s with a 16 GB commit, and the previous concept shows why a manual
  `GC.Collect()` promotes live data. Neither belongs in a service today.
- .NET Framework advice (`gcServer` and `gcConcurrent` in `app.config`, "Server
  GC for any web server") predates containers. Today the flags live in
  `runtimeconfig.json`, the Web SDK defaults to Server GC, and in a small
  container Workstation (or Server with DATAS, on Linux) is the usual start. The
  docs suggest Workstation without concurrent GC for hundreds of instances.
- Still valid: measure first, change one setting at a time, allocate less before
  tuning the collector.

## Trade-offs

- **Workstation versus Server.** Server won on throughput (about 2 times) and paid
  15 times the memory and 5 times the worst pause. For one small container start
  with Workstation; on a dedicated many-core host measure Server.
- **Concurrent versus non-concurrent.** Concurrent shortened the worst request
  (18 against 31 ms) for 15 percent less throughput. Disable it for batch work or
  very many small instances.
- **DATAS.** A small heap on Linux (712 against 2,002 MB), 32 percent less
  throughput on a hostile load, no effect on macOS. If a latency-critical service
  regresses, set `DOTNET_GCDynamicAdaptationMode=0`.
- **No-GC region.** No pause inside a bounded section, paid by an entry GC (about
  7 ms here) and slower allocation on fresh memory; an overrun ends it silently.
- **`GCConserveMemory`.** A smaller heap (Server, DATAS on Linux: 526 MB against
  712) for more collections and less throughput. Try 5 to 7 and measure.

## Documentation Links

- [Workstation and server garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/workstation-server-gc) (doc)
- [Background garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/background-gc) (doc)
- [Latency modes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/latency) (doc)
- [Dynamic adaptation to application sizes (DATAS), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/datas) (doc)
- [Garbage collector config settings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector) (doc)
- [GC.TryStartNoGCRegion, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.gc.trystartnogcregion) (doc)
- [GCLatencyMode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.gclatencymode) (doc)
- [GC.GetGCMemoryInfo, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.gc.getgcmemoryinfo) (doc)
- [GC.GetTotalPauseDuration, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.gc.gettotalpauseduration) (doc)
