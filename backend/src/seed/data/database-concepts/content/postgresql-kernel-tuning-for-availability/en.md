---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`postgresql.conf` only controls what happens inside the PostgreSQL process. A
server can have a perfectly tuned `shared_buffers` and `checkpoint_completion_target`
and still stall for tens of seconds because of decisions the Linux kernel makes
underneath it — how aggressively it defers writing dirty memory to disk, how
willing it is to swap out an idle backend, how it schedules PostgreSQL's worker
processes against everything else on the box, and whether it silently reshapes
memory into huge pages behind PostgreSQL's back. These are `sysctl` and `/sys`
settings, configured once at the OS level, and they are the difference between a
server that degrades gracefully under load and one that goes unresponsive for
seconds at a time with nothing showing up as a slow query.

## Use Cases

- Provisioning a large-RAM server (many tens or hundreds of GB) and wanting to
  avoid a single enormous "emergency" dirty-page flush that can saturate the
  disk subsystem and block all writes until it finishes.
- Diagnosing a production PostgreSQL server that intermittently freezes for
  several seconds to tens of seconds under memory pressure, with no
  corresponding entry in `pg_stat_activity` or the slow query log — a classic
  symptom of Transparent Huge Page (THP) defragmentation, not a database
  problem at all.
- Hardening a dedicated PostgreSQL host against memory pressure without fully
  disabling swap outright (`swappiness=0` can itself introduce OOM-killer risk
  on some kernels) — keeping a thin safety margin instead of an all-or-nothing
  switch.
- Tuning CPU scheduler behavior on a server handling hundreds of concurrent
  client connections, where default process-migration and autogrouping
  settings (tuned for desktop responsiveness, not daemon throughput) add
  measurable scheduling overhead.

## Deep Dive

### Where these settings live

Kernel parameters are set with `sysctl`. On systems with an `/etc/sysctl.d`
directory, a dedicated file survives package updates better than editing
`/etc/sysctl.conf` directly:

```bash
# /etc/sysctl.d/30-postgresql.conf
kernel.sched_migration_cost_ns = 5000000
kernel.sched_autogroup_enabled = 0
vm.dirty_background_bytes = 67108864
vm.dirty_bytes = 1073741824
vm.zone_reclaim_mode = 0
vm.swappiness = 1
```

```bash
# activate immediately, no reboot required
sudo sysctl --system
# or, without a sysctl.d directory, after editing /etc/sysctl.conf directly:
sudo sysctl -p
```

### CPU scheduler: `sched_migration_cost_ns` and `sched_autogroup_enabled`

- `kernel.sched_migration_cost_ns` (default 0.5 ms) is how long the scheduler
  treats a migrated process's cache as still "hot," making it less eligible for
  another migration. As the number of PostgreSQL backend processes grows, the
  scheduler's per-decision overhead can consume a large share of total CPU
  just assigning processors to tasks. Raising it to 5 ms gives each backend
  enough time to finish a query before it's considered for migration again.
- `kernel.sched_autogroup_enabled` groups tasks by their originating terminal
  session to improve *interactive* responsiveness — useful on a desktop,
  actively harmful on a server where PostgreSQL and everything else launched
  from the same init session get lumped into one scheduling group and
  effectively rate-limited against each other. Setting it to `0` removes that
  grouping.

### `vm.zone_reclaim_mode`

On NUMA (multi-socket) hosts, a nonzero `zone_reclaim_mode` makes the kernel
prefer reclaiming memory from the *local* NUMA node over using memory from a
remote node — including memory being used to cache PostgreSQL's data files.
That aggressive local reclaim reduces the effective size of the OS page cache.
Setting it to `0` lets the kernel use all available RAM for caching regardless
of which socket it's attached to.

### `vm.dirty_background_bytes` and `vm.dirty_bytes`

```bash
vm.dirty_background_bytes = 67108864     # 64 MB — background flush starts here
vm.dirty_bytes = 1073741824              # 1 GB — hard write-blocking threshold
```

`dirty_background_bytes` is how much modified (dirty) memory can accumulate
before the kernel starts writing it to disk *in the background*, without
blocking anything. `dirty_bytes` is the much larger threshold at which the
kernel stops trusting the background writer and blocks **all** write activity
until the entire dirty set is flushed — an event that, from PostgreSQL's
point of view, looks identical to the disk subsystem simply vanishing for as
long as the flush takes.

A low `dirty_background_bytes` trades a small amount of steady-state write
overhead (constant small flushes instead of large batched ones) for making
that emergency-flush threshold far less likely to ever be reached.

### `vm.swappiness`

```bash
vm.swappiness = 1
```

`swappiness` controls how eagerly the kernel moves idle process memory to swap
under memory pressure. PostgreSQL backends holding query state don't benefit
from being swapped out, and paying the cost to page them back in when a query
resumes is exactly the kind of stall a highly available server can't afford.
`1` all but disables swapping while leaving a last-resort valve — `0` is
avoided because some kernel versions respond to it by invoking the OOM killer
sooner rather than swapping at all, which is a worse outcome than swapping
occasionally.

### Disabling Transparent Huge Pages

```bash
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag
echo no    > /sys/kernel/mm/transparent_hugepage/khugepaged/defrag
# if the khugepaged line above errors, use the numeric form instead:
echo 0     > /sys/kernel/mm/transparent_hugepage/khugepaged/defrag
```

Transparent Huge Pages let the kernel silently back a process's memory with
large (typically 2 MB) pages instead of the standard 4 KB pages, without the
application asking for it — unlike PostgreSQL's own explicit `huge_pages`
setting in `postgresql.conf`, which requests huge pages deliberately and
predictably. THP's problem is *khugepaged*, the background kernel thread that
periodically scans memory and defragments it into huge-page-sized contiguous
blocks. On a busy server with `shared_buffers` occupying a large, actively
used memory region, that defragmentation pass can stall the processes
touching that memory for tens of seconds — indistinguishable, from the
outside, from PostgreSQL simply hanging.

### Persisting the THP setting across reboots

THP is a `/sys` runtime setting, not a `sysctl` value, so it resets on every
reboot unless it's re-applied at boot time. The mechanism is distribution- and
bootloader-specific:

```bash
# RHEL / CentOS and derivatives — bakes the kernel command-line argument
# into every installed kernel entry
sudo grubby --update-kernel=ALL --args='transparent_hugepage=never'
```

```bash
# Debian / Ubuntu — edit /etc/default/grub
GRUB_CMDLINE_LINUX="transparent_hugepage=never"
```
```bash
sudo update-grub
```

A distribution-agnostic alternative that avoids touching the bootloader at
all is a small `systemd` oneshot unit that runs early in boot and writes
directly to the three `/sys` paths above (or, on RHEL-family systems,
`tuned-adm profile` combined with a custom `tuned` profile that sets
`transparent_hugepage=never`) — worth preferring in containerized or
image-based deployments where editing GRUB config isn't practical.

## Trade-offs

- **A low `dirty_background_bytes` slightly reduces steady-state write
  throughput in exchange for avoiding a multi-second write-blocking stall.**
  Frequent small background flushes cost more total I/O overhead than fewer,
  larger batched ones — a deliberate trade of average performance for a
  bounded worst case.
  ```bash
  # inspect current dirty memory accounting live
  grep -E '^Dirty|^Writeback' /proc/meminfo
  ```
- **`swappiness=1` instead of `0` accepts a small amount of swap risk to avoid
  a worse one.** Some kernels respond to `0` by preferring the OOM killer over
  swapping under pressure — killing a backend outright is a worse failure mode
  than the brief latency of paging it back in.
  ```bash
  sysctl vm.swappiness
  ```
- **Disabling THP system-wide gives up a memory-management optimization for
  every other process on the host, not just PostgreSQL**, in exchange for
  removing PostgreSQL's exposure to `khugepaged` stalls — a reasonable trade
  on a dedicated database host, less obviously so on a host PostgreSQL shares
  with other large-memory workloads that might actually benefit from THP.
  ```bash
  cat /sys/kernel/mm/transparent_hugepage/enabled
  # [never] madvise always   <- bracketed value is the active mode
  ```
- **`kernel.sched_autogroup_enabled=0` trades desktop-style interactive
  fairness for daemon throughput** — the setting exists specifically to make
  foreground/interactive tasks feel snappier by isolating them from
  background load, a goal that's actively counterproductive on a server
  where PostgreSQL *is* the workload, not a background task competing with
  something more important.
- **`vm.zone_reclaim_mode=0` is a no-op on single-node hardware.** It only
  matters on multi-socket NUMA hosts; setting it has no effect, positive or
  negative, on a single-NUMA-node server, so it's worth confirming NUMA
  topology before assuming the setting is doing anything.
  ```bash
  numactl --hardware | head -1
  # e.g. "available: 2 nodes (0-1)" confirms this setting is actually relevant
  ```

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 3, "Minimizing Downtime", recipe "Applying bonus kernel tweaks", p. 132-136 — doc
- [PostgreSQL Documentation — Resource Consumption (huge_pages parameter, THP discouraged)](https://www.postgresql.org/docs/current/runtime-config-resource.html) — doc
- [PostgreSQL Documentation — Managing Kernel Resources](https://www.postgresql.org/docs/current/kernel-resources.html) — doc
- [Linux Kernel Documentation — Transparent Hugepage Support](https://www.kernel.org/doc/html/latest/admin-guide/mm/transhuge.html) — doc
- [Red Hat Enterprise Linux 9 Documentation — Configuring Transparent Huge Pages](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/configuring-huge-pages_monitoring-and-managing-system-status-and-performance) — doc
