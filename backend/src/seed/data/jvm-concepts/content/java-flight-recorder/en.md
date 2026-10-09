---
version: 1.1
updatedAt: 2026-10-09
---
## Objective

Understand Java Flight Recorder (JFR): a JVM-built-in, event-based profiler designed to run in production continuously at under 1% overhead, so you have real data from the incident instead of trying to reproduce it later.

## Use Cases

- Diagnosing an intermittent production slowdown without attaching a heavyweight sampling profiler that itself perturbs the measurement.
- Automatically dumping a recording when something goes wrong (a request that takes more than 5 minutes, an unexpected exception spike) instead of hoping to catch it live.
- Reading a recording's contents from a headless container or CI environment where no GUI tool is available.

## Deep Dive

### Event-based profiling, not sampling-only

JFR works by recording *events* — a thread blocked waiting for a lock, a GC pause, an object allocation crossing a size threshold, a method sampled as currently executing — into a stream, either held in a circular in-memory buffer or written to a file. Because it's built into the JVM itself rather than attached externally, it can capture things an external profiler can't see cheaply, like exact GC pause boundaries and JIT compilation events, at a cost designed to stay under 1% of application throughput by default.

### Continuous vs. fixed-duration recording

```
Fixed-duration  — start recording, run a load test or reproduce a scenario, stop.
                  Best for *proactive* analysis: you know when the interesting work happens.

Continuous      — always running, circular buffer keeps only the most recent events within a
                  size/time budget. Best for *reactive* analysis: dump the buffer's contents the
                  moment something goes wrong, and you already have data from right before it
                  happened — no need to reproduce the problem on demand.
```

### Starting a recording with jcmd

The most portable way to control JFR — works identically whether you're on a workstation or SSH'd into a container — is `jcmd` against a running JVM's process id:

```
% jcmd <pid> JFR.start name=diag duration=60s filename=recording.jfr
% jcmd <pid> JFR.check                     # list active recordings
% jcmd <pid> JFR.dump name=diag filename=snapshot.jfr   # dump a continuous recording on demand
% jcmd <pid> JFR.stop name=diag
```

`-XX:StartFlightRecording=<options>` starts a recording from the moment the JVM boots, which is what you want when the interesting behavior might be startup itself, not just steady state.

### Reading a recording without a GUI: `jfr view`

`jfr view` aggregates events into ready-made tables, so a first look at a `.jfr` file is one command in a terminal. `jfr summary` shows which event types exist, `jfr view all-views` lists the views of your JDK, and a view name can be replaced by any event type name:

```
$ jfr summary recording.jfr              # event types and counts
$ jfr view all-views recording.jfr       # every view this JDK knows
$ jfr view hot-methods recording.jfr     # where the sampled time went
$ jfr view gc-pauses recording.jfr
$ jfr view allocation-by-site recording.jfr
$ jfr view contention-by-site recording.jfr
```

Because the output is plain text (and `jfr print --json` gives structured data), a recording can also be handed to a script, or to an AI agent, for analysis with no Mission Control session.

### Your own events: application telemetry through the same mechanism

An application can emit events that land in the same recording, with the same timestamps and thread information as the JVM's own events. Subclass `jdk.jfr.Event`, mark the fields, and wrap the work with `begin()` and `commit()`:

```java
import jdk.jfr.*;

@Name("shop.OrderPlaced")
@Label("Order Placed")
@Category("Shop")
@StackTrace(false)
class OrderPlaced extends Event {
    @Label("Order Id") long orderId;
    @Label("Items") int items;
}

static void place(long id, int items) throws InterruptedException {
    OrderPlaced e = new OrderPlaced();
    e.begin();
    Thread.sleep(items * 5L);        // the real work
    e.orderId = id;
    e.items = items;
    e.commit();                      // duration = commit time minus begin time
}
```

```
$ java -XX:StartFlightRecording=filename=orders.jfr Orders.java
$ jfr view shop.OrderPlaced orders.jfr

Start Time Duration Event Thread Stack Trace Order Id Items
---------- -------- ------------ ----------- -------- -----
15:48:46    11.3 ms main         N/A                1     2
15:48:46    18.8 ms main         N/A                2     3
15:48:46    25.1 ms main         N/A                3     4
```

### Where the time and the CPU went: JDK 25 additions

Three JDK 25 JEPs improve how much a recording can tell you about code:

- **Cooperative sampling (JEP 518)** changes how the sampler captures stacks: it records only the program counter and stack pointer, and the target thread builds its own stack trace at its next safepoint. This replaces the stack-walking heuristics the sampler thread used to rely on.
- **CPU-time profiling (JEP 509, experimental, Linux only)** samples each thread that runs Java code at fixed intervals of *CPU* time, using the kernel's CPU timer, and attributes time spent in native code to the calling Java method. The event is off by default:

```
$ java -XX:StartFlightRecording=jdk.CPUTimeSample#enabled=true,filename=profile.jfr -jar app.jar
$ jfr view cpu-time-hot-methods profile.jfr
```

- **Method timing and tracing (JEP 520)** instruments the methods you name and reports exact invocation counts and min, average and max time (`jdk.MethodTiming`), or one event with stack trace per call (`jdk.MethodTrace`). Targets are `class`, `class::method`, `::method`, or `@annotation`, separated by semicolons:

```
$ java -XX:StartFlightRecording=filename=orders.jfr,method-timing=Orders::place Orders.java
$ jfr view method-timing orders.jfr

Timed Method            Invocations Minimum Time Average Time Maximum Time
----------------------- ----------- ------------ ------------ ------------
Orders.place(long, int)          40  6.270000 ms 23.100000 ms 40.500000 ms

$ jcmd <pid> JFR.start method-timing=@jakarta.ws.rs.GET    # on a running JVM
```

## Trade-offs

- **Under-1% overhead is a default, not a guarantee** — it holds for the default event set and thresholds; enabling more event types (especially allocation profiling at a low threshold) trades overhead back for detail, so treat "how much am I enabling" as a real dial, not something to max out by default.
- **Custom events are cheap to disable and not free to enable**: an event type that is off is designed to cost very little, but when it is on, every `commit()` writes a record. Call `end()` and guard expensive field computation with `shouldCommit()`, which is false when the event is disabled or its duration is below the configured threshold:

```java
OrderPlaced e = new OrderPlaced();
e.begin();
// ... work ...
e.end();
if (e.shouldCommit()) {          // false when disabled or below the duration threshold
    e.orderId = id;              // only now pay for filling the fields
    e.commit();
}
```

- **CPU-time sampling is experimental and Linux-only; method timing instruments bytecode**: `jdk.CPUTimeSample` is only available on Linux, and a broad method-timing filter (a whole package, or a common annotation) instruments many methods at once, so it spends overhead like any other detail you enable. Name the few methods you suspect.

- **A continuous recording's circular buffer only holds the *recent* past** — sized by `maxage`/`maxsize`, so it's excellent for "something just went wrong, dump the last few minutes" but useless for an incident that happened hours before anyone thought to look, unless the buffer was sized generously enough to cover that window.
- **Book vs today**: in JDK 8, JFR required both `-XX:+UnlockCommercialFeatures` and `-XX:+FlightRecorder` because it was an Oracle-only licensed feature — **none of that applies anymore**. JFR has been fully open source and available in every mainstream JDK build since JDK 11, and on current JDKs `jcmd <pid> JFR.start` works with no unlock flags at all. Also not emphasized by the book's GUI-centric framing: the bundled **`jfr` CLI tool** (`jfr print`, `jfr summary`) lets you inspect a `.jfr` file's contents directly from a terminal — no Java Mission Control GUI required — which matters more today than it did in 2020, since headless containers and CI pipelines are a far more common place to be debugging a JVM than a desktop with a GUI available.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 3 "A Java Performance Toolbox", "Java Flight Recorder", pp. 74-88 — book
- [JDK Flight Recorder documentation — Java SE 25](https://docs.oracle.com/en/java/javase/25/jfapi/index.html) — doc
- [jcmd — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) — doc
- [jfr — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jfr.html) — doc
- [JEP 509: JFR CPU-Time Profiling (Experimental)](https://openjdk.org/jeps/509) - doc
- [JEP 518: JFR Cooperative Sampling](https://openjdk.org/jeps/518) - doc
- [JEP 520: JFR Method Timing & Tracing](https://openjdk.org/jeps/520) - doc
