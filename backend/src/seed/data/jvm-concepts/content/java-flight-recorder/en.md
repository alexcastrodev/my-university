---
version: 1.0
updatedAt: 2026-08-13
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

## Trade-offs

- **Under-1% overhead is a default, not a guarantee** — it holds for the default event set and thresholds; enabling more event types (especially allocation profiling at a low threshold) trades overhead back for detail, so treat "how much am I enabling" as a real dial, not something to max out by default.
- **A continuous recording's circular buffer only holds the *recent* past** — sized by `maxage`/`maxsize`, so it's excellent for "something just went wrong, dump the last few minutes" but useless for an incident that happened hours before anyone thought to look, unless the buffer was sized generously enough to cover that window.
- **Book vs today**: in JDK 8, JFR required both `-XX:+UnlockCommercialFeatures` and `-XX:+FlightRecorder` because it was an Oracle-only licensed feature — **none of that applies anymore**. JFR has been fully open source and available in every mainstream JDK build since JDK 11, and on current JDKs `jcmd <pid> JFR.start` works with no unlock flags at all. Also not emphasized by the book's GUI-centric framing: the bundled **`jfr` CLI tool** (`jfr print`, `jfr summary`) lets you inspect a `.jfr` file's contents directly from a terminal — no Java Mission Control GUI required — which matters more today than it did in 2020, since headless containers and CI pipelines are a far more common place to be debugging a JVM than a desktop with a GUI available.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 3 "A Java Performance Toolbox", "Java Flight Recorder", pp. 74-88 — book
- [JDK Flight Recorder documentation — Java SE 25](https://docs.oracle.com/en/java/javase/25/jfapi/index.html) — doc
- [jcmd — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) — doc
- [jfr — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jfr.html) — doc
