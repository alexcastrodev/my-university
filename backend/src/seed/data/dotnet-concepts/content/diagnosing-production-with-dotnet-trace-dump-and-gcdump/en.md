---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

When a .NET process in production is slow, eats memory or stops answering, you usually cannot attach Visual Studio, redeploy with extra logging or reproduce the problem on your laptop. The .NET diagnostic CLI tools work on the live process as it is, with no code change and no restart: `dotnet-counters` shows runtime metrics, `dotnet-trace` samples stacks and records runtime events, `dotnet-gcdump` takes a snapshot of the managed heap, `dotnet-dump` writes a full process dump that you analyze with SOS commands, and `dotnet-stack` prints the managed stack of every thread. This concept writes one deliberately broken ASP.NET Core app (a CPU-heavy endpoint, an event-handler leak, sync-over-async blocking and a lock-order deadlock), diagnoses each symptom with the right tool on macOS, shows the real output, and says exactly what worked here, what needed a workaround and what only Linux offers. Versions used: SDK 10.0.100 (runtime 10.0.0), `dotnet-counters`, `dotnet-trace`, `dotnet-dump`, `dotnet-gcdump` and `dotnet-stack` 10.0.750501.

## Use Cases

- Finding the method that burns CPU behind a slow endpoint, from a few seconds of trace of the live process.
- Proving that memory grows because objects stay rooted (and by what), not because the GC is lazy.
- Explaining why requests queue up while CPU is idle: threads blocked on `.Result` or on a lock.
- Watching GC, thread pool and CPU metrics of a container during an incident without touching its code.

## Deep Dive

### Installing the tools and finding the process

I installed the five tools into a folder instead of globally (`dotnet tool install --tool-path ./tools dotnet-counters`, and so on); all came out as version `10.0.750501`. Each tool has a `ps` command. With the sample app running:

```text
$ dotnet-trace ps
  2166  BrokenShop    .../BrokenShop/bin/Release/net10.0/BrokenShop
$ ls $TMPDIR | grep dotnet-diagnostic
dotnet-diagnostic-2166-1793201850-socket
```

That Unix domain socket is the diagnostic port. The docs explain that every .NET process opens one by default (a named pipe on Windows) and the tools connect to it by pid. It is created with `srw-------` permissions, which is why the tool must run as the same user as the app (or as root). The docs warn that it exposes everything in memory, secrets included. I started the same app with `DOTNET_EnableDiagnostics=0`: no socket appeared, `dotnet-trace ps` no longer listed it, and `dotnet-stack report -p <pid>` failed with:

```text
[ERROR] Microsoft.Diagnostics.NETCore.Client.ServerNotAvailableException: Unable to connect to Process 89451. Please verify that /var/folders/.../T/ is writable by the current user. If the target process has environment variable TMPDIR set, please set TMPDIR to the same directory.
```

The message hints at a common trap: tool and app must see the same `TMPDIR`. `DOTNET_DiagnosticPorts` does the reverse: the runtime connects to a socket that a tool listens on. The docs say this lets a monitoring tool wait for apps instead of polling for them, and the counters docs use it to watch an app from startup.

### EventPipe: what most of these tools ride on

The docs describe EventPipe as a runtime component that collects events from the runtime (GC, JIT, thread pool, a stack sampler) and from any `EventSource`, serializes them in the `.nettrace` format and streams them over the diagnostic port. `dotnet-counters`, `dotnet-trace`, `dotnet-gcdump` and `dotnet-stack` are EventPipe clients, which is why they need no admin rights and work the same on Windows, Linux and macOS. The price, per the same page: stacks contain managed frames only, and no kernel or native events. `dotnet-dump` is different: it asks the runtime to launch `createdump`, which reads the process memory.

### Symptom 1: a slow endpoint (dotnet-trace)

The bug: `GET /report` counts primes with trial division that never stops at the square root.

```csharp
[MethodImpl(MethodImplOptions.NoInlining)]
static bool IsPrime(int n)
{
    for (int d = 2; d < n; d++) if (n % d == 0) return false; // no sqrt bound: the bug
    return true;
}
```

One request took `6.6 s`. While requests were running I collected 8 seconds with the two profiles that `dotnet-trace list-profiles` offers for this (`collect-linux` adds kernel CPU sampling, Linux only):

```bash
dotnet-trace collect -p 2166 --profile dotnet-common,dotnet-sampled-thread-time --duration 00:00:00:08 -o report.nettrace
```

```text
Provider Name                           Keywords            Level               Enabled By
Microsoft-Windows-DotNETRuntime         0x000000100003801D  Informational(4)    --profile
Microsoft-DotNETCore-SampleProfiler     0x0000F00000000000  Informational(4)    --profile
```

The result was a 3.2 MB `.nettrace` file. `dotnet-trace report <file> topN` reads it in the terminal:

```text
Top 10 Functions (Exclusive)                              Inclusive    Exclusive
1.  Monitor.Wait(class System.Object,int32)               25.81%       25.81%
2.  LowLevelLifoSemaphore.WaitNative(...)                 22.58%       22.58%
3.  Missing Symbol                                        17.21%       17.21%
4.  ... three more wait frames at 8.6% each ...
7.  BrokenShop!ReportBuilder.IsPrime(int32)               8.58%        8.58%
```

The culprit was only seventh. The sampler takes about 100 stacks per second of every managed thread, running or not, so this is wall-clock time and idle threads that wait dominate. Each line at about 8.6% is roughly one thread for the whole window. Read past the `Wait` frames: `IsPrime` is the only application frame. `dotnet-trace convert report.nettrace --format speedscope` produced `report.speedscope.json` (open it at speedscope.app). A short Python script that walks its open/close events and sums the time per leaf stack (last three frames, in ms) printed:

```text
total sampled thread time: 85094 ms (12 threads)
21026 System.Threading.LowLevelLifoSemaphore.WaitForSignal > System.Threading.LowLevelLifoSemaphore.WaitNative > UNMANAGED_CODE_TIME
16020 System.Threading.ManualResetEventSlim.Wait > System.Threading.Monitor.Wait > UNMANAGED_CODE_TIME
16020 System.Net.Sockets.SocketAsyncEngine.EventLoop > ? > UNMANAGED_CODE_TIME
 7986 dynamicClass.lambda_method1 > ReportBuilder.IsPrime > UNMANAGED_CODE_TIME
```

`IsPrime` was on a stack for 7986 ms of the 8000 ms window, under the endpoint delegate. On macOS, every stack ended in `UNMANAGED_CODE_TIME`, even the pure managed loop, so here the converter could not separate running from blocked time. The docs point to a kernel-aware profiler for real CPU stacks: `dotnet-trace collect-linux` (.NET 10, root, kernel 6.4+) or `perf` on Linux, ETW on Windows.

### Live metrics with dotnet-counters

`dotnet-counters monitor -p <pid>` redraws a table in place with ANSI escape codes, fine for a human but not capturable. `collect` writes CSV or JSON. I ran `dotnet-counters collect -p 2166 --counters System.Runtime --format json -o c1.json --duration 00:00:00:05` with two `/report` requests running:

```text
dotnet.process.cpu.time (s / 1 sec)        cpu.mode=user   2.0097
dotnet.process.cpu.time (s / 1 sec)        cpu.mode=system 0.0039
dotnet.thread_pool.work_item.count ({work_item} / 1 sec)    28
dotnet.gc.last_collection.heap.size (By)   gc.heap.generation=gen0  0
```

Two seconds of CPU per second means two cores busy. The heap size is 0 because it describes the last collection and none had run yet. `dotnet-counters list` no longer lists names on this version; it prints a link to the built-in metrics page. Mixing the `System.Runtime` meter and the old `EventCounters\System.Runtime` in one `--counters` list is refused ("Using the same provider name with and without the EventCounters\ prefix in the counter list is not supported").

### Symptom 2: memory that only grows (dotnet-gcdump)

The bug is a classic: a short-lived object subscribes to a static event and never unsubscribes, so the event keeps it alive forever:

```csharp
class OrderSession
{
    readonly byte[] _lines = new byte[10_000];
    public OrderSession(int id) => PriceFeed.PriceChanged += OnPriceChanged;   // never -=
    void OnPriceChanged(object? s, EventArgs e) => _lines[0]++;
}
```

I ran `dotnet-gcdump collect -p 8218 -o snap1.gcdump` after 2001 requests, again after 5002, and `dotnet-gcdump report` on each file:

```text
Warning: the target runtime does not support non-lossy (Block) buffering, which requires .NET 11+. Falling back to the default lossy buffering; the gcdump may be incomplete on large heaps.
	Finished writing 760370 bytes.

snap1:  21,437,578  GC Heap bytes      19,720  GC Heap objects
snap2:  52,068,624  GC Heap bytes      31,659  GC Heap objects

   Object Bytes     Count  Type                                      (snap1 -> snap2 count)
         10,024     2,001  System.Byte[] (Bytes > 10K)               -> 5,002
             64     2,002  System.EventHandler                       -> 5,003
             32     2,001  OrderSession  [BrokenShop.dll]            -> 5,002
```

Read the columns carefully: "Object Bytes" is the size of one instance, not the total, so the 2,001 arrays of 10,024 bytes are 20 MB. A type whose count tracks the request count between two snapshots is the leak. The docs say a gcdump is built from the events of an induced gen 2 collection, so what it shows survived a full GC (it is rooted). The files are small (under 1 MB) because they hold the object graph, not the memory. What a gcdump cannot tell you is the root path in text: its report has only the heapstat view. For that you need a dump.

### Symptom 2 again: dotnet-dump and SOS

My first `dotnet-dump collect` on macOS failed immediately:

```text
Problem launching createdump (may not have execute permissions): execve(/usr/local/share/dotnet/shared/Microsoft.NETCore.App/10.0.0/createdump) FAILED Permission denied (13)
```

On this machine the `createdump` of the 10.0.0 runtime had no execute bit (`-rw-r--r--`), while those of 8.0.22 and 9.0.11 did. I did not change the system install: I copied the runtime to a private folder, ran `chmod +x` on that copy and started the app with `DOTNET_ROOT` pointing there. The next attempt failed once after 20 s with "This failure may be because createdump or the application is not properly signed and entitled"; the three attempts after it worked. Sizes: a default Full dump was 7,621,153,320 bytes (7.6 GB, it includes every mapped page), `--type Heap` was 702 MB. Analysis of a macOS dump on macOS worked:

```bash
dotnet-dump analyze leak.dmp -c "dumpheap -stat" -c "dumpheap -stat -live" -c "eeheap -gc" -c exit
```

```text
dumpheap -stat (tail):
00010b69c400  6,291 30,427,784 System.Byte[]
00010e5e4880  3,001 36,108,032 System.Delegate[]
Total 488,036 objects, 108,234,738 bytes

dumpheap -stat -live (tail):
00010e410108 3,001     96,032 OrderSession
00010e5e33d0 3,002    192,128 System.EventHandler
00010b69c400 3,134 30,090,718 System.Byte[]
Total 19,987 objects, 31,409,510 bytes
eeheap -gc:  Number of GC Heaps: 14 ... GC Allocated Heap Size: Size: 0x6781870 (108533872) bytes.
```

Plain `dumpheap -stat` counts garbage that is not collected yet: the 36 MB of `Delegate[]` came from `GetInvocationList()` in my own counter property and were all dead. With `-live` only reachable objects remain, and the leak stands out. `eeheap -gc` showed 14 heaps because ASP.NET Core uses Server GC (one heap per core). Then the question a gcdump cannot answer, who holds an `OrderSession`:

```text
> gcroot 7b1c0796e0
HandleTable:
    0000000106bf15e8 (strong handle)
          -> 007f7c007028     System.Object[]
          -> 007c5c837508     System.EventHandler
          -> 007e5c58b0d0     System.Object[]
          -> 007bdc006788     System.EventHandler
          -> 007b1c0796e0     OrderSession
Found 1 unique roots.
```

A strong handle to the array of static fields, the multicast `EventHandler` stored in `PriceChanged`, its invocation list, one delegate, and its target. The fix is the `-=` (or a weak event). A dump holds every secret in memory, so treat it like a database backup.

### Symptom 3: thread pool starvation (dotnet-stack and counters)

The bug: an endpoint blocks on async work.

```csharp
app.MapGet("/quote", () => QuoteService.GetQuoteAsync().Result);   // GetQuoteAsync awaits Task.Delay(100)
```

Alone, a request took `0.16 s`. With 300 concurrent requests the thread pool coped (max 0.86 s), so I sent 6000 with 500 in flight. Latency: p50 `2.5 s`, p99 `6.8 s`, max `8.6 s`, for 100 ms of work. `dotnet-stack report -p <pid>` 10 seconds in printed 135 threads, and 125 of them looked like this:

```text
Thread (0x6C32E):
  [Native Frames]
  System.Private.CoreLib!System.Threading.Tasks.Task.InternalWaitCore(int32,value class System.Threading.CancellationToken)
  Anonymously Hosted DynamicMethods Assembly!dynamicClass.lambda_method3(...)
  Microsoft.AspNetCore.Routing!Microsoft.AspNetCore.Routing.EndpointMiddleware.Invoke(class Microsoft.AspNetCore.Http.HttpContext)
  ...
  System.Private.CoreLib!System.Threading.PortableThreadPool+WorkerThread.WorkerThreadStart()
```

Pool threads waiting on a `Task` inside an endpoint is the signature of sync-over-async. Note the handler name is gone: the lambda was inlined into the generated delegate, which is one more reason to put handlers in named methods. During the same run I collected `dotnet.thread_pool.thread.count` and `dotnet.thread_pool.queue.length`, and found a trap: `collect` labels both `(... / 1 sec)` and prints the change per interval, with negative values, not the level. The first sample is the starting level, so I summed them:

```text
time      thread.count  queue.length    level: threads / queued items
15:56:19  11            0               11 / 0
15:56:20  39            209             50 / 209
15:56:21  14            171             64 / 380
15:56:24  8             578             91 / 793
...
15:56:41  4             202             173 / 468
```

Threads grew from 11 to 173 in about 22 seconds, a handful per second after the first burst, while hundreds of work items waited in the queue. That slow, steady injection is the pool trying to rescue a starvation it cannot fix: every new thread is blocked again by the next request.

### Symptom 3b: a lock-order deadlock (dotnet-stack, then syncblk)

`GET /transfer` starts two tasks: one does `lock (AccountA) { Thread.Sleep(100); lock (AccountB) { } }`, the other takes the same locks in the opposite order, and the endpoint waits on both with `Task.WaitAll`. `curl -m 3` gave up after 3 s. `dotnet-stack report` showed the request thread in `Task.WaitAll` under `BrokenShop!Bank.Transfer()` and two threads stuck in `Monitor.Enter_Slowpath` under `Bank+<>c.<Transfer>b__2_0()` and `b__2_1()`. The stacks show who waits, not who owns. SOS `syncblk` on a Heap dump answered that:

```text
Index         SyncBlock MonitorHeld Recursion Owning Thread Info          SyncBlock Owner
    7 0000007C18C79218            3         1 0000007C19351F80 8ea0a  33   00000072bc874638 System.Object
    8 0000007C18C79270            3         1 0000007C19352300 8ea0b  34   00000072bc874650 System.Object
```

Two locks, each owned by one thread (`MonitorHeld 3` is one owner plus one waiter). A deadlocked process also ignored `kill` (SIGTERM): it stopped listening but stayed alive until `kill -9`.

### Containers, permissions and Linux

I could not run Docker here, so this is from the docs. Tools can run in the same container, on the host or in a sidecar. A sidecar needs a shared process namespace and the target's `/tmp` mounted, because the socket lives there; otherwise it reports the process is "not running compatible .NET runtime". `--diagnostic-port <path>` points a tool at a mapped socket path instead. `dotnet-dump` needs ptrace (`--cap-add=SYS_PTRACE`), and the dump path is resolved in the target's file system. `dotnet-monitor` is the alternative built for this: the docs describe it as a tool to collect dumps, traces, logs and metrics in production, on demand or by rules, through an HTTP API (default `https://localhost:52323`). Tight memory limits matter: the docs note that collecting a dump can make the target page in a lot of memory.

### Which tool for which symptom

| Symptom | First tool | Then |
|---|---|---|
| High CPU, slow endpoint | `dotnet-counters` (cpu.time) | `dotnet-trace collect`, then `report topN` or speedscope |
| Memory keeps growing | `dotnet-counters` (gc heap size) | two `dotnet-gcdump`, then `dotnet-dump` + `gcroot` |
| Requests queue, CPU idle | `dotnet-counters` (thread_pool) | `dotnet-stack report` |
| Hang or deadlock | `dotnet-stack report` | `dotnet-dump` + `syncblk` |
| Crash | `DOTNET_DbgEnableMiniDump=1` (docs: dump on crash) | `dotnet-dump analyze` |

## Trade-offs

- **The tools work on any process, so anyone with the same user can read it.** The diagnostic port and dumps expose memory, including secrets. Disable with `DOTNET_EnableDiagnostics=0` where that matters, and handle dumps like production data.
- **Thread-time sampling is wall clock, not CPU.** Idle waits fill the top of `topN`; skip `Wait` frames, and on Linux use `collect-linux` (root, kernel 6.4+) for real CPU stacks.
- **A gcdump is cheap but shallow.** Under 1 MB and no ptrace needed, but no root paths in text and lossy on runtimes before .NET 11. A dump answers everything and weighs hundreds of MB to GB.
- **Collection is not free.** A gcdump induces a gen 2 collection, a Full dump copied 7.6 GB here (about 24 s with `--diag`), and a trace allocates a buffer in the target (`--buffersize`, 256 MB by default).
- **Read counter units.** `/ 1 sec` on an up-down counter in `collect` output means a delta per interval, not the current value.
  ```text
  dotnet.thread_pool.queue.length ({work_item} / 1 sec)  -72
  ```
- **Your local platform is not production.** On macOS a broken `createdump` permission and an intermittent signing failure got in the way; reproduce your incident runbook on the OS you deploy.

## Documentation Links

- [dotnet-trace performance analysis utility, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-trace) (doc)
- [Investigate performance counters (dotnet-counters), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) (doc)
- [Dump collection and analysis utility (dotnet-dump), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-dump) (doc)
- [Heap analysis tool (dotnet-gcdump), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-gcdump) (doc)
- [Inspect managed stack traces (dotnet-stack), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-stack) (doc)
- [Collect diagnostics in Linux containers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/diagnostics-in-containers) (doc)
