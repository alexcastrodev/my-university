---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Connect a real process's lifecycle, spawned, scheduled, faulting, writing to disk, to the specific components this discipline's Arc 3 and Arc 4 labs built separately.
- Produce a single, continuous, timestamped trace spanning a scheduling decision (Lab 9), a page-table miss (Lab 10), and a file-system write (Lab 11), from one connected scenario rather than three isolated tests.
- Compare this traced, connected narrative directly against `operating-systems-i`'s own closing capstone concept, confirming the same story holds when the underlying components are real, working code instead of prose.
- Identify, from the trace, which specific component was responsible for each observable event, and explain why that attribution is only possible because all three components were built and instrumented consistently in this discipline.

## Context & Motivation

`operating-systems-i`'s own closing concept, **Capstone: Tracing a Process From fork() to Page Fault to Disk**, tells one connected story: a process is created, the scheduler eventually gives it CPU time, it touches a memory address that is not yet mapped and faults, the kernel resolves that fault by fetching or allocating a page, and, at some point, the process writes data that ultimately lands on disk through the file system. This discipline's capstone is where that story is run for real, against the actual lottery scheduler (Lab 9), the actual page-table-and-TLB simulator (Lab 10), and the actual file system (Lab 11) this discipline built separately, connecting them into the one integrated system `operating-systems-i` only had room to describe in prose.

## Core Theory

Nothing about *why* each individual event, a scheduling decision, a page fault, a disk write, happens is re-derived here; each already has its own theoretical treatment in `operating-systems-i` and its own working implementation in this discipline's earlier labs. This capstone's real content is integration: making the three separately built components observable through one shared, consistent trace format, and running one connected scenario that exercises all three in the order the theoretical capstone describes.

## Worked Examples

### The connected scenario

```text
1. A simulated process is created and given 3 tickets (Lab 9's lottery
   scheduler); two other processes with 1 ticket each are already running.
2. The process is eventually drawn by the scheduler's lottery.
3. Once running, it accesses a virtual address whose page is not yet
   resident (Lab 10's page-table simulator reports a page fault).
4. The fault handler allocates a physical frame (evicting an existing
   page under Lab 10's LRU policy, since physical frames are scarce
   in this scenario) and maps the new page in.
5. The process writes data, which Lab 11's file system persists: a
   free block is allocated, the data is written, and the process's
   file's inode is updated to point at it.
```

### Step 1 — a shared, timestamped trace format across all three components

```python
class Trace:
    def __init__(self):
        self.events = []

    def log(self, component: str, event: str, detail: dict):
        self.events.append({
            "t": simulated_clock(),
            "component": component,  # "scheduler" | "vm" | "fs"
            "event": event,
            "detail": detail,
        })
```

Each earlier lab's own code gets exactly one additional call inserted, `trace.log(...)`, at the specific point where it produces an event worth recording; no other logic in Labs 9, 10, or 11 changes at all, which is deliberate, this capstone is about observing the existing, already-correct components together, not modifying what they do.

### Step 2 — instrumenting each component at its one meaningful event

```python
# In Lab 9's scheduler, at the moment a process wins the lottery draw:
trace.log("scheduler", "process_scheduled", {"pid": winner.pid, "tickets": winner.tickets})

# In Lab 10's page table simulator, inside _handle_page_fault:
trace.log("vm", "page_fault", {"vpn": vpn, "evicted_vpn": victim_vpn if victim_vpn else None})

# In Lab 11's file system, inside fs_write, right after the inode update:
trace.log("fs", "block_written", {"inode": inum, "block": block_num, "bytes": len(data)})
```

### Step 3 — running the connected scenario and producing one trace

```python
def test_capstone_connected_trace():
    trace = Trace()
    scheduler = LotteryScheduler(trace=trace)
    vm = PageTableSimulator(frames=4, policy="LRU", trace=trace)
    fs = FileSystem(disk_path="capstone_disk.img", trace=trace)

    proc = scheduler.create_process(tickets=3)
    scheduler.run_until(proc, "scheduled")

    vm.translate(proc.some_unmapped_address)   # forces the page fault
    fs.fs_write(proc.inode, data=b"hello, capstone")

    assert [e["event"] for e in trace.events] == \
        ["process_scheduled", "page_fault", "block_written"], \
        "the trace should show all three components' events, in the order they occurred"
```

### Step 4 — reading the finished trace as one connected story

```text
t=0.012s  [scheduler]  process_scheduled   {pid: 7, tickets: 3}
t=0.014s  [vm]         page_fault          {vpn: 1024, evicted_vpn: 512}
t=0.019s  [fs]         block_written        {inode: 3, block: 88, bytes: 15}
```

This is `operating-systems-i`'s own closing narrative, told here not as prose but as three timestamped, attributable events, each traceable back to the exact component and exact line of exact-lab code, Lab 9's scheduler, Lab 10's fault handler, Lab 11's write path, that produced it, which is only possible because all three were built to a consistent enough interface, in this same discipline, to be wired into one shared trace.

## Common Misconceptions & Pitfalls

- **"Running Labs 9, 10, and 11's own individual test suites already demonstrates the full system works."** Each earlier lab's own tests verify that component in isolation; nothing in those tests confirms the three actually compose correctly into one connected scenario, which is exactly what this capstone's shared-trace test checks and what `operating-systems-i`'s own capstone concept describes as one continuous story, not three separate ones.
- **"Adding tracing calls to already-correct code risks introducing new bugs."** Step 2's instrumentation is deliberately minimal, one `trace.log()` call inserted at an already-existing, already-correct point in each component's logic, with no change to that logic's actual behavior; this is precisely why it is safe to add after each component has already been independently verified in its own lab.
- **"The order events appear in the trace doesn't matter much, as long as all three happen eventually."** Step 3's assertion checks the exact order specifically because `operating-systems-i`'s own capstone narrative is a causal sequence, scheduling before the fault (the process has to be running to touch memory), the fault before the write (the page needs to be mapped before data can be written through it); a trace showing events out of this order would reveal a real bug in how the components are actually sequenced, not a cosmetic issue.

## Summary

This capstone connects the three separately built components of Arc 3 and Arc 4, Lab 9's lottery scheduler, Lab 10's page-table-and-TLB simulator, and Lab 11's file system, into one running scenario and one shared, timestamped trace, turning `operating-systems-i`'s own closing capstone narrative, a process scheduled, faulting, and eventually writing to disk, from prose into an observed, attributable sequence of real events. Each traced event is directly traceable back to the exact component, and the exact lab, that produced it, which is only possible because those components were built, and are now instrumented, consistently enough to compose into one connected system, the concrete, practical proof this whole discipline's separately built labs actually add up to the integrated machine `operating-systems-i` described.

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces](https://pages.cs.wisc.edu/~remzi/OSTEP/): the source for the scheduling, virtual-memory, and file-system material this discipline's separately built labs, and this capstone's connected scenario, are grounded in throughout.
- [OSTEP Projects — xv6 Kernel Projects](https://github.com/remzi-arpacidusseau/ostep-projects): the real, official project set whose scheduling and virtual-memory assignments this discipline's Labs 9 and 10 are modeled on, now run together in this capstone's connected scenario.
