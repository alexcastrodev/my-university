---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a two-level page table simulator translating a simulated virtual address into a physical address, matching the multi-level walk theory already covers.
- Implement a small, fixed-size TLB cache in front of the page table walk, and measure the actual hit-rate difference it makes on a real access pattern.
- Implement FIFO and LRU page replacement policies, and measure their differing behavior once the simulated working set exceeds available physical frames.
- Reproduce, with real measured numbers, the thrashing behavior `demand-paging-and-thrashing` describes theoretically.

## Context & Motivation

**Paging and Page Tables**, **The Translation Lookaside Buffer**, and **Page Replacement Policies** already cover, theoretically, how a multi-level page table translates virtual addresses, why a TLB cache exists to avoid walking that table on every single memory access, and what happens once physical memory runs out and pages must be evicted to make room for others. This lab builds a userspace simulator implementing all three, matching the OSTEP-projects xv6 virtual-memory assignment's own spirit, and its whole value is turning "a TLB should reduce average access time" and "thrashing happens once the working set exceeds physical memory" from claims into measured numbers from a real simulated run.

## Core Theory

Nothing about *why* a multi-level page table trades lookup speed for space efficiency, or *why* a TLB exploits temporal locality in real access patterns, is re-derived here; both arguments already exist in `paging-and-page-tables` and `the-translation-lookaside-buffer`. This lab implements those designs directly, over a simulated (not real, kernel-level) address space, specifically so the cost of every translation step can be counted precisely.

## Worked Examples

### API specification

```text
class PageTableSimulator(levels: int, entries_per_level: int, frames: int, policy: str)
    def translate(self, virtual_address: int) -> int
        # returns the physical address; internally counts whether this
        # was a TLB hit, a page-table hit, or a page fault requiring
        # eviction under the configured replacement policy
    def stats(self) -> dict  # {"tlb_hits": ..., "page_faults": ..., "evictions": ...}
```

### Step 1 — the multi-level page table walk, counted step by step

```python
class PageTableSimulator:
    def __init__(self, levels, entries_per_level, frames, policy):
        self.levels = levels
        self.page_table = {}          # simulated multi-level table, as a dict
        self.physical_frames = {}     # frame_number -> virtual_page currently there
        self.free_frames = list(range(frames))
        self.policy = FIFOPolicy() if policy == "FIFO" else LRUPolicy()
        self.tlb = TLB(size=16)
        self.stats = {"tlb_hits": 0, "page_faults": 0, "evictions": 0}

    def _walk_page_table(self, vpn: int) -> int:
        # Each level of the walk is counted as its own real memory
        # access — exactly what real hardware does, and exactly why a
        # TLB miss is expensive relative to a hit: an N-level table
        # costs N extra accesses BEFORE the actual data access happens.
        for level in range(self.levels):
            self.stats.setdefault("page_table_accesses", 0)
            self.stats["page_table_accesses"] += 1
        if vpn not in self.page_table:
            self._handle_page_fault(vpn)
        return self.page_table[vpn]
```

### Step 2 — the TLB, checked FIRST, before any page-table walk happens at all

```python
class TLB:
    def __init__(self, size: int):
        self.size = size
        self.entries = {}  # vpn -> frame, a small, fixed-size cache

    def lookup(self, vpn: int):
        return self.entries.get(vpn)  # None on a TLB miss

    def insert(self, vpn: int, frame: int):
        if len(self.entries) >= self.size:
            self.entries.pop(next(iter(self.entries)))  # evict oldest, simplistically
        self.entries[vpn] = frame

def translate(self, virtual_address: int) -> int:
    vpn, offset = split_address(virtual_address)
    frame = self.tlb.lookup(vpn)
    if frame is not None:
        self.stats["tlb_hits"] += 1
        return combine(frame, offset)  # TLB hit: skips the ENTIRE page-table
                                          # walk from Step 1 — this is the
                                          # whole point of a TLB
    frame = self._walk_page_table(vpn)  # TLB miss: pay the full walk cost
    self.tlb.insert(vpn, frame)
    return combine(frame, offset)
```

### Step 3 — FIFO versus LRU page replacement, on real access sequences

```python
class FIFOPolicy:
    def __init__(self):
        self.order = []  # insertion order; evict the OLDEST regardless
                            # of how recently it was actually accessed
    def choose_victim(self):
        return self.order.pop(0)

class LRUPolicy:
    def __init__(self):
        self.access_order = []  # re-ordered on EVERY access, not just insertion
    def record_access(self, vpn):
        if vpn in self.access_order:
            self.access_order.remove(vpn)
        self.access_order.append(vpn)  # most-recently-used goes to the end
    def choose_victim(self):
        return self.access_order.pop(0)  # evict the LEAST-recently-used
```

### Step 4 — reproducing thrashing, with real measured numbers

```python
def test_thrashing_when_working_set_exceeds_frames():
    sim = PageTableSimulator(levels=2, entries_per_level=64, frames=4, policy="LRU")
    working_set = list(range(4))     # fits exactly within 4 frames: no thrashing
    for _ in range(1000):
        for vpn in working_set:
            sim.translate_vpn(vpn)
    fault_rate_fits = sim.stats["page_faults"] / 1000

    sim2 = PageTableSimulator(levels=2, entries_per_level=64, frames=4, policy="LRU")
    working_set2 = list(range(8))    # DOUBLE the available frames
    for _ in range(1000):
        for vpn in working_set2:
            sim2.translate_vpn(vpn)
    fault_rate_thrashing = sim2.stats["page_faults"] / 1000

    assert fault_rate_thrashing > fault_rate_fits * 5, \
        "a working set exceeding physical frames should show dramatically more faults"
```

Running both configurations and comparing their measured fault rates directly is what turns `demand-paging-and-thrashing`'s theoretical claim, that thrashing sets in once a process's working set no longer fits in physical memory, into a concrete, observed number difference rather than a diagram.

## Common Misconceptions & Pitfalls

- **"A TLB hit and a TLB miss cost roughly the same, since both eventually return a physical address."** Step 1's per-level access counting is specifically built to make this false in the measured output: a miss pays for the full multi-level walk before it can even attempt the actual data access, while a hit skips that walk entirely, which is the real, measurable reason TLBs matter for performance, not just a theoretical convenience.
- **"FIFO and LRU should perform about the same in practice, since they're both just eviction policies."** Step 3's two policies track genuinely different information, insertion order alone for FIFO versus a continuously updated recency order for LRU, and Step 4's kind of measured comparison, run under a real access pattern with actual locality, routinely shows LRU faulting less often precisely because it tracks what FIFO deliberately ignores: which pages were used most recently, not merely which arrived first.
- **"Thrashing is a vague, informal term rather than something with a precise, measurable signature."** Step 4's test gives it a precise, checkable signature: fault rate rising sharply and disproportionately once the working set crosses the available-frames boundary, exactly the pattern `demand-paging-and-thrashing` predicts and this lab's own comparison confirms with real numbers.

## Summary

This lab builds a userspace simulator implementing `paging-and-page-tables`'s multi-level walk, `the-translation-lookaside-buffer`'s caching layer checked before that walk, and `page-replacement-policies`'s FIFO and LRU eviction strategies, counting real simulated memory accesses at every step rather than only describing the mechanisms. Comparing measured fault rates between a working set that fits in available physical frames and one that does not is what turns `demand-paging-and-thrashing`'s theoretical prediction into a concrete, observed number difference, and comparing FIFO against LRU under the same real access pattern is what makes the practical difference between "insertion order" and "recency order" visible as measured data rather than an assumption.

## Documentation Links

- [OSTEP Projects — xv6 Kernel Projects (Virtual Memory)](https://github.com/remzi-arpacidusseau/ostep-projects): the real, official xv6 virtual-memory assignments this lab's simulator design is modeled in spirit on.
- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Paging: Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-paging.pdf): the source for the multi-level page-table walk and TLB design this lab implements and measures directly.
