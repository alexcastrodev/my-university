---
version: 1.0
updatedAt: 2026-11-13
---
## Objective

From Go 1.5 through 1.24, `GOMAXPROCS` defaulted to the machine's core count, so a
pod limited to 2 CPUs on a 64-core node ran 64 Ps. Go 1.25 made the default
container-aware on Linux and added periodic updates on every OS. This lesson separates
what was measured from what comes from the documentation. Measured with Go 1.27.0
(`GOTOOLCHAIN=go1.27.0`) on an Apple M4 Max (14 cores, arm64), macOS 27.0.1, 3 runs per
program: the default and its overrides, `runtime.SetDefaultGOMAXPROCS`, the runtime
goroutine that applies updates, how the `go` line in `go.mod` switches all of it off,
and an open-loop CPU-bound load at `GOMAXPROCS` 1 to 56. Not measured, because macOS
has no cgroups and Docker was not available: reading `cpu.max`, request versus limit in
Kubernetes, rounding and throttling. Those come from the Go 1.25 notes, the Go blog,
the `runtime` docs and the 1.27 source, and are attributed in the text.

## Use Cases

- Removing `go.uber.org/automaxprocs` or a hand-set `GOMAXPROCS` env after moving to Go 1.25+.
- Pods with a CPU request and no limit: knowing why `GOMAXPROCS` still equals the node's cores.
- In-place pod resize or a VPA changing the CPU limit while the process runs.
- Explaining throttling-driven p99 spikes on pods whose limit is far below the node size.
- A new toolchain with `go 1.24` still in `go.mod`: why nothing changed.

## Deep Dive

### The rule, as documented

The `runtime.GOMAXPROCS` doc in 1.27: if the `GOMAXPROCS` environment variable is a
positive number, it wins. Otherwise the default is the minimum of the logical CPU count,
the CPU affinity mask and, on Linux, the cgroup "average CPU throughput limit"
(quota/period), "never ... less than 2 unless the logical CPU count or CPU affinity
mask count are below 2", and a fractional limit "rounds up to the next whole number".
The source (`runtime/cgroup_linux.go`, 1.27) is short:

```go
func adjustCgroupGOMAXPROCS(procs int32, cpu cgroup.CPU) int32 {
	limit, ok, err := cgroup.ReadCPULimit(cpu)
	if err == nil && ok {
		limit = ceil(limit)
		limit = max(limit, 2)
		if int32(limit) < procs {
			procs = int32(limit)
		}
	}
	return procs
}
```

Applying that rule by hand (arithmetic, not a measurement): limit `2500m` on a 64-core
node gives 3; limit `500m` gives 2; limit `4` gives 4; a request of `2` with no limit
gives 64. The Go 1.25 notes: "The Go runtime does not consider the 'CPU requests' option."

### What the runtime reads

From the 1.27 source and docs (not measured here):

- cgroup v2: `cpu.max`, format `$MAX $PERIOD` in microseconds, where `max` means no limit
  (kernel docs; the default is "max 100000"). cgroup v1: `cpu.cfs_quota_us` (`-1` means no
  limit) and `cpu.cfs_period_us`.
- At startup the runtime reads `/proc/self/cgroup` and `/proc/self/mountinfo`, opens the
  limit files and keeps them open "for the entire process lifetime", rereading with `pread`
  from offset 0. The Go 1.25 notes mention the cached descriptors.
- Two documented gaps in the source comment: only the leaf cgroup is read, so a tighter
  parent limit is missed ("container runtimes tend to hide parent cgroups ... anyway"),
  and a process migrated to another cgroup "will not notice".
- In Kubernetes, the limit "defines a hard ceiling on how much CPU time the container can
  use" per scheduling interval, while "the CPU request typically defines a weighting"
  (Kubernetes docs). Only the ceiling becomes `cpu.max`, which is why Go follows the limit.

### Periodic updates: sysmon and the updater goroutine

In 1.27 `sysmon` calls `sysmonUpdateGOMAXPROCS` "at most once per second", recomputing
the default (on macOS just the CPU count, from `cgroup_stubs.go`). If the value changed
it wakes a runtime goroutine that stops the world and applies it. That goroutine shows
up in `GODEBUG=schedtrace=10,scheddetail=1`:

```text
  G17: status=4(GOMAXPROCS updater (idle)) m=nil lockedm=nil
```

It was there in 3 of 3 runs, including with `GOMAXPROCS=4` in the environment (it stays
idle: the source skips updates when `sched.customGOMAXPROCS` is set). With
`GODEBUG=updatemaxprocs=0` it was absent in 3 of 3 runs, each with 3 snapshots. The
update itself was not observed: this Mac offers no way to change the CPU count or a CPU
limit under a running process.

### Measured: defaults, overrides, SetDefaultGOMAXPROCS

```go
show("start")
stw := read("/sched/pauses/total/other:seconds")
runtime.GOMAXPROCS(4)
show("after runtime.GOMAXPROCS(4)")
runtime.GOMAXPROCS(4) // same value: no stop-the-world
runtime.SetDefaultGOMAXPROCS()
show("after SetDefaultGOMAXPROCS()")
fmt.Println("non-GC stop-the-world pauses:", read("/sched/pauses/total/other:seconds")-stw)
```

```text
$ ./defaults
start                              NumCPU=14 GOMAXPROCS=14 metric=14
after runtime.GOMAXPROCS(4)        NumCPU=14 GOMAXPROCS=4 metric=4
after SetDefaultGOMAXPROCS()       NumCPU=14 GOMAXPROCS=14 metric=14
non-GC stop-the-world pauses: 2
$ GOMAXPROCS=6 ./defaults
start                              NumCPU=14 GOMAXPROCS=6 metric=6
after runtime.GOMAXPROCS(4)        NumCPU=14 GOMAXPROCS=4 metric=4
after SetDefaultGOMAXPROCS()       NumCPU=14 GOMAXPROCS=14 metric=14
non-GC stop-the-world pauses: 2
```

Identical in 3 runs each. `metric` is `/sched/gomaxprocs:threads`. Every change is a
stop-the-world (two pauses for two changes; the repeated `GOMAXPROCS(4)` returned early,
as the source does when `n == ret`). `SetDefaultGOMAXPROCS` ignored `GOMAXPROCS=6`: the
doc says it restores the default "ignoring the GOMAXPROCS environment variable", and
re-enables automatic updates.

### The go line in go.mod decides

Both behaviors are GODEBUG settings, and GODEBUG defaults follow the `go` line of the
main module. The same program built by 1.27.0 with `go 1.24`:

```text
$ go version -m bin/legacy124 | grep DefaultGODEBUG
	build	DefaultGODEBUG=containermaxprocs=0,cryptocustomrand=1,decoratemappings=0,tlssecpmlkem=0,tlssha1=1,tracebacklabels=0,updatemaxprocs=0,urlstrictcolons=0,x509sha256skid=0,x509sslcertoverrideplatform=0
```

No updater goroutine in 3 of 3 runs. Adding a `godebug` block (Go 1.23+, per the
GODEBUG doc) brought both back while keeping `go 1.24`:

```text
godebug (
	containermaxprocs=1
	updatemaxprocs=1
)
```

`DefaultGODEBUG` then read `containermaxprocs=1` and `updatemaxprocs=1`, and the updater
was back in 3 of 3 runs. One gap for fleet audits: the source says that with
`updatemaxprocs=0` it increments `/godebug/non-default-behavior/updatemaxprocs:events`
"unconditionally", but the counter read 0 in 9 of 9 runs, also with `net/http` linked
(which links `internal/godebug`). Reading the source, the increment runs in
`runtime.main` before `internal/godebug` registers its hook, so it is dropped.

### Parallelism limit versus throughput limit

The blog's model: `GOMAXPROCS` limits parallelism; a CPU limit limits CPU time per period
(default 100 ms). "So an '8 CPU limit' is actually a limit of 800ms of CPU time every
100ms of wall time." Exceeding it makes the kernel throttle the whole cgroup "for the
remainder of the throttling period", which hurts tail latency far more than a lower
`GOMAXPROCS`, and GC bursts can trigger it even in a mostly idle service.

What this Mac can show is the other side: a load that needs more CPU than `GOMAXPROCS`
allows. An open-loop generator offers 4000 requests per second for 3 s; each is a
goroutine doing about 0.7 ms of SHA-256, so the load needs about 2.8 cores. Latency is
measured from the intended arrival time:

```go
for i := range n {
	due := start.Add(time.Duration(i) * interval)
	if w := time.Until(due); w > 0 {
		time.Sleep(w)
	}
	wg.Go(func() {
		work()
		lat[i] = time.Since(due)
	})
}
```

```text
GOMAXPROCS=1    1485 req/s  CPU  1.0 cores  p50=3.5708s  p99=5.1431s  max=5.1769s  sched p99<=5.36870912s
GOMAXPROCS=2    2853 req/s  CPU  2.0 cores  p50=501.9ms  p99=1.4052s  max=1.4194s  sched p99<=1.610612736s
GOMAXPROCS=3    3999 req/s  CPU  2.8 cores  p50=700µs    p99=2.5ms    max=9ms      sched p99<=768ns
GOMAXPROCS=4    3999 req/s  CPU  2.9 cores  p50=800µs    p99=800µs    max=900µs    sched p99<=2.56µs
GOMAXPROCS=14   3999 req/s  CPU  2.9 cores  p50=800µs    p99=800µs    max=2.2ms    sched p99<=3.584µs
GOMAXPROCS=56   3999 req/s  CPU  2.9 cores  p50=800µs    p99=800µs    max=1.1ms    sched p99<=3.072µs
```

Repeated in 3 runs: with 1 and 2 Ps throughput stopped at 1.3k to 1.5k and about 2.85k
req/s, and the queue grew for the whole run (p50 from 0.5 to 3.6 s, `sched p99` is the
`/sched/latencies` bucket bound). From 3 Ps up the load fit and p50 stayed at 0.7 to
0.8 ms; 14 and 56 Ps showed no repeatable difference. Tails were noisy: this host ran
other jobs (load average 8 to 13), and one run of 4 Ps fell to 3781 req/s with p50 108
ms. An oversubscribed `GOMAXPROCS` costs nothing measurable when CPU is free; its cost
in a container is throttling, which needs a real cgroup to measure.

## Trade-offs

- **Limit versus request only**: with a limit, `GOMAXPROCS` follows it and latency is
  predictable, but the pod cannot use idle node CPU. With only a request it can, and
  `GOMAXPROCS` stays at the node's cores; the blog names "a small container receiving 2
  CPUs running on a 128 core machine" as the case to fix with a limit or an explicit value.
- **Rounding up and the floor of 2**: by the doc's rule a `500m` limit gets 2 Ps. By
  arithmetic, two busy threads spend 50 ms of quota in 25 ms of wall time and the
  cgroup is throttled for the remaining 75 ms of the period. Small limits and Go
  services do not mix well; `2500m` gets 3 Ps, which can also exceed 2.5.
- **Explicit settings freeze the value**: the env var or a `runtime.GOMAXPROCS(n)` call
  with `n > 0` (which is what `automaxprocs` does) disables automatic updates, so a resized pod
  keeps the old value. `SetDefaultGOMAXPROCS` hands control back (measured above).
- **Each change stops the world**: measured as one non-GC pause per effective change.
  The runtime checks at most once per second, so updates are rare and cheap, but not free.
- **The go line is the switch**: upgrading the toolchain alone keeps the old defaults
  (measured with `go 1.24`); raise the `go` line or use a `godebug` block.

## Documentation Links

- [Container-aware GOMAXPROCS, The Go Blog (Michael Pratt and Carlos Amedee, 2025)](https://go.dev/blog/container-aware-gomaxprocs): doc
- [Go 1.25 Release Notes: container-aware GOMAXPROCS, SetDefaultGOMAXPROCS, go.dev](https://go.dev/doc/go1.25): doc
- [runtime.GOMAXPROCS and SetDefaultGOMAXPROCS, pkg.go.dev](https://pkg.go.dev/runtime#GOMAXPROCS): doc
- [Go, Debug and GODEBUG: containermaxprocs, updatemaxprocs and godebug blocks, go.dev](https://go.dev/doc/godebug): doc
- [runtime/cgroup_linux.go at go1.27.0, go.googlesource.com](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/runtime/cgroup_linux.go): doc
- [Go issue 73193: runtime: CPU limit-aware GOMAXPROCS default (proposal discussion)](https://go.dev/issue/73193): doc
- [Kubernetes: Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/): doc
- [Linux kernel docs: Control Group v2 (cpu.max)](https://docs.kernel.org/admin-guide/cgroup-v2.html): doc
