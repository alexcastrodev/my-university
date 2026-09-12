---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement `malloc`, `free`, and `realloc` in C, managing a heap region obtained in large chunks from the operating system rather than one allocation at a time.
- Implement a free list threaded through the unused blocks themselves, and boundary tags enabling constant-time coalescing of adjacent free blocks.
- Explain the concrete throughput-versus-utilization tradeoff every allocator design decision in this lab actually faces.
- Measure the finished allocator against a real, provided trace-driven test harness, matching CMU's own Malloc Lab grading methodology.

## Context & Motivation

**The Heap and Dynamic Allocation** already explains why `malloc` and `free` need to track free versus allocated space themselves: the operating system hands out memory in coarse-grained pages, not the small, precisely-sized chunks application code actually requests, and someone has to bridge that gap. This lab is where that explanation becomes a real, working allocator, matching CMU's own Malloc Lab, an exercise CS:APP's own labs page treats as one of its more demanding assignments specifically because a naive, seemingly-correct implementation runs into real, measurable performance problems long before it runs into outright bugs.

## Core Theory

Nothing about *why* an allocator needs its own free-space bookkeeping is re-derived here; that argument belongs to `the-heap-and-dynamic-allocation`. This lab implements a specific, standard design for that bookkeeping: boundary tags, a header (and matching footer) on every block, free or allocated, recording that block's size and allocation status, which is what makes coalescing two adjacent free blocks into one larger block an O(1) operation rather than a scan over the whole heap.

## Worked Examples

### API specification

```text
void *mm_malloc(size_t size);   // returns a pointer to a usable block
                                  // of at least `size` bytes, or NULL
void mm_free(void *ptr);        // returns the block at ptr to the free list
void *mm_realloc(void *ptr, size_t size);  // resizes, preserving contents
```

### Step 1 — a block's header, carrying size and allocation status together

```c
// Size and allocation bit packed into one word: the low bit stores
// allocated (1) vs. free (0), since a real block size is always a
// multiple of 8 and its own low 3 bits are otherwise unused.
#define PACK(size, alloc)  ((size) | (alloc))
#define GET_SIZE(header)   (*(header) & ~0x7)
#define GET_ALLOC(header)  (*(header) & 0x1)

typedef struct {
    size_t header;
    // ... payload bytes follow ...
    // size_t footer;   (a matching copy of `header`, at the block's end)
} block_t;
```

### Step 2 — coalescing, made O(1) by the footer of the block BEFORE this one

```c
void *coalesce(void *bp) {
    size_t prev_alloc = get_alloc(footer_of(prev_block(bp)));  // O(1): reads
    size_t next_alloc = get_alloc(header_of(next_block(bp)));   // a fixed offset,
    size_t size = get_size(header_of(bp));                       // no scanning

    if (prev_alloc && next_alloc) {
        return bp;  // no adjacent free blocks; nothing to merge
    } else if (prev_alloc && !next_alloc) {
        size += get_size(header_of(next_block(bp)));
        set_header_footer(bp, size, FREE);
    } else if (!prev_alloc && next_alloc) {
        size += get_size(footer_of(prev_block(bp)));
        bp = prev_block(bp);
        set_header_footer(bp, size, FREE);
    } else {
        size += get_size(footer_of(prev_block(bp))) + get_size(header_of(next_block(bp)));
        bp = prev_block(bp);
        set_header_footer(bp, size, FREE);
    }
    return bp;
}
```

The footer's whole purpose is this Step: without it, checking whether the block immediately *before* `bp` is free would require scanning backward from the very start of the heap, since blocks have variable size and there is otherwise no way to know where the previous block begins; the footer, read at a fixed, constant offset immediately before `bp`, makes that check O(1) instead.

### Step 3 — the free list, threaded through the free blocks' own payload space

```c
// A free block reuses its OWN unused payload bytes to store next/prev
// pointers — no separate memory is allocated for free-list bookkeeping,
// since a free block, by definition, has no payload data to preserve.
typedef struct free_block {
    size_t header;
    struct free_block *next;
    struct free_block *prev;
} free_block_t;

void *find_fit(size_t asize) {
    for (free_block_t *bp = free_list_head; bp != NULL; bp = bp->next) {
        if (get_size(header_of(bp)) >= asize) {
            return bp;  // first-fit: the first free block large enough
        }
    }
    return NULL;  // no fit found; the caller must extend the heap
}
```

### Step 4 — the real tradeoff this lab's design decisions actually face

```text
First-fit (Step 3):         fast to find A fit, but can leave many small,
                              unusable fragments scattered early in the heap

Best-fit:                    scans the WHOLE free list for the smallest
                              adequate block, reducing fragmentation but
                              costing real throughput on every allocation

Segregated free lists
(size-class buckets):        a real, standard middle ground — near-O(1)
                              lookup within a size class, while still
                              keeping fragmentation lower than plain
                              first-fit across one single list
```

CMU's own Malloc Lab grades submissions on exactly this tradeoff, a combined score weighing measured throughput (operations per second on a real trace of malloc/free/realloc calls) against measured utilization (peak memory actually used versus peak memory requested), not on passing a single correctness check alone.

### Step 5 — verifying against a real, trace-driven test harness

```text
$ ./mdriver -f traces/binary-bal.rep

Results for mm malloc:
trace  valid  util     ops      secs   Kops
 0       yes  99%     5694  0.000267   21318
 ...
Perf index = 45 (util) + 40 (thru) = 85/100
```

CMU's provided driver replays a real, recorded trace of allocation requests, exactly the kind of realistic workload `the-heap-and-dynamic-allocation`'s own theoretical treatment argues an allocator has to perform well under, not a synthetic, uniform benchmark an implementation could be narrowly tuned to pass without actually being a good general-purpose allocator.

## Common Misconceptions & Pitfalls

- **"An allocator just needs to be correct; performance is a secondary concern."** CMU's own grading methodology weighs utilization and throughput as heavily as correctness, because a correct-but-slow or correct-but-wasteful allocator is a real, practical failure for anything that actually calls `malloc` frequently, which is the entire point of building a trace-driven test rather than a purely correctness-based one.
- **"Coalescing requires scanning the heap to find adjacent free blocks."** Step 2's whole design point is that it does not: a footer on the block immediately before `bp`, read at a fixed offset, makes checking that block's allocation status an O(1) operation, which is exactly what keeps `free` itself fast regardless of heap size.
- **"A free list needs its own separately allocated memory for its next/prev pointers."** Step 3's design reuses a free block's own unused payload space for exactly this bookkeeping, since a block that is free, by definition, has no payload data that needs preserving; allocating separate memory for free-list metadata would waste exactly the space this design reclaims for free.

## Summary

This lab implements `malloc`, `free`, and `realloc` for real, matching CMU's own Malloc Lab: boundary tags (a header and footer on every block) enabling O(1) coalescing of adjacent free blocks, a free list threaded through free blocks' own unused payload space rather than separately allocated, and a fit-finding strategy, first-fit here, chosen from a real, concrete space of throughput-versus-utilization tradeoffs the lab's own trace-driven grading methodology measures directly. Verifying against a real, recorded trace of allocation requests, rather than a synthetic benchmark, is what actually tests whether the allocator performs well under the realistic, uneven workload `the-heap-and-dynamic-allocation`'s own theoretical treatment argues a real allocator has to handle.

## Documentation Links

- [CS:APP — Lab Assignments (Malloc Lab)](https://csapp.cs.cmu.edu/3e/labs.html): CMU's own, official Malloc Lab this exercise matches exactly, including its trace-driven grading methodology.
- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Free-Space Management"](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-freespace.pdf): the source for the free-list and boundary-tag design this lab's allocator implements.
