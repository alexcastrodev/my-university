---
version: 1.0
updatedAt: 2026-09-12
---
## Learning Objectives

- Implement a simple on-disk layout, a superblock, an inode table, and a data-block region, backed by a single ordinary host file standing in for a raw disk.
- Implement create, write, read, and delete operations that correctly update the free-block bitmap and the affected inode's own block pointers.
- Reuse Lab 8's free-space-management discipline at the block level, tracking free versus allocated data blocks with a bitmap rather than reimplementing that idea from nothing.
- Inject a deliberate crash mid-write and confirm, empirically, that this lab's intentionally non-journaled design does not survive it correctly, the specific, concrete case journaling exists to fix.

## Context & Motivation

**File System Implementation and Journaling** and **Files, Directories, and Inodes** already cover, theoretically, how a file system organizes a disk into a superblock, an inode table, and data blocks, and why an unprotected multi-step update (allocating a block, then writing data, then updating an inode's pointer) is vulnerable to leaving the disk in an inconsistent state if a crash happens partway through. This lab builds a real, working file system implementing that layout, matching the spirit of the official OSTEP-projects file-system-checker assignment, over a single ordinary file on the host machine standing in for a raw disk.

## Core Theory

Nothing about *why* a file system needs an inode table separate from directory entries, or *why* journaling exists, is re-derived here; both arguments already exist in `files-directories-and-inodes` and `file-system-implementation-and-journaling`. This lab implements the non-journaled version of that design deliberately, specifically so its real, concrete failure mode under a crash can be observed directly, rather than only described.

## Worked Examples

### The on-disk layout, as a byte offset map

```text
Block 0:              Superblock (total blocks, inode count, free-list
                       start offset — read once, on mount)
Blocks 1..N:           Inode table (fixed-size inode structs, one per
                       possible file: size, block pointers, type)
Block N+1:              Free-block bitmap (one bit per data block below)
Blocks N+2..end:        Data blocks (raw file content, one block per
                       inode block-pointer entry)
```

### Step 1 — mounting: a virtual disk is just an ordinary host file

```c
typedef struct {
    FILE *disk_file;      // an ordinary host file standing in for a raw disk
    superblock_t sb;
    uint8_t *free_bitmap;  // loaded into memory from Block N+1 on mount
} filesystem_t;

filesystem_t *mount(const char *disk_path) {
    filesystem_t *fs = malloc(sizeof(filesystem_t));
    fs->disk_file = fopen(disk_path, "r+b");
    fseek(fs->disk_file, 0, SEEK_SET);
    fread(&fs->sb, sizeof(superblock_t), 1, fs->disk_file);
    fs->free_bitmap = load_bitmap(fs->disk_file, &fs->sb);
    return fs;
}
```

### Step 2 — creating a file: allocate an inode, initialize it, write it back

```c
int fs_create(filesystem_t *fs, const char *name) {
    int inum = find_free_inode(fs);  // scan the in-memory inode bitmap
    if (inum < 0) return -1;         // no free inode slots left

    inode_t inode = { .size = 0, .type = FILE_TYPE, .block_count = 0 };
    write_inode(fs, inum, &inode);   // one disk write: Block (1 + inum/inodes_per_block)
    add_directory_entry(fs, name, inum);  // a second disk write: the directory's own data block
    return inum;
}
```

### Step 3 — writing data: allocate a block (reusing Lab 8's bitmap discipline), write it, THEN update the inode

```c
int fs_write(filesystem_t *fs, int inum, const void *data, size_t size) {
    int block_num = find_free_block(fs);  // scans fs->free_bitmap — the SAME
                                             // bitmap-based free-space idea
                                             // Lab 8's malloc allocator used
                                             // at the byte level, reused here
                                             // at the block level
    if (block_num < 0) return -1;

    mark_block_allocated(fs, block_num);         // step A: update the bitmap
    write_data_block(fs, block_num, data, size); // step B: write the actual data
    inode_t inode = read_inode(fs, inum);
    inode.blocks[inode.block_count++] = block_num;
    inode.size += size;
    write_inode(fs, inum, &inode);               // step C: point the inode at it
    return 0;
}
```

Three separate disk writes, the bitmap update, the data block, and the inode's own pointer, none of them atomic with respect to each other, is exactly the vulnerability `file-system-implementation-and-journaling` describes theoretically; Step 4 makes it real.

### Step 4 — injecting a crash mid-write, and observing real, on-disk corruption

```c
int fs_write_with_injected_crash(filesystem_t *fs, int inum, const void *data, size_t size) {
    int block_num = find_free_block(fs);
    mark_block_allocated(fs, block_num);
    write_data_block(fs, block_num, data, size);
    fflush(fs->disk_file);
    exit(1);  // simulated crash: the inode update below NEVER happens
    // inode_t inode = read_inode(fs, inum);
    // ... (unreached)
}
```

```text
$ ./fs_test --inject-crash-after-block-write
$ ./fsck my_virtual_disk.img

CORRUPTION DETECTED: block 42 is marked ALLOCATED in the bitmap, but
no inode references it (a "leaked" block: space that can never be
reclaimed by this simple design, since nothing points back to it to
confirm it is actually in use by a real file).
```

A small file-system checker (`fsck`), matching the spirit of the official OSTEP-projects file-system-checker assignment, scans the bitmap against every inode's actual block pointers and reports exactly this mismatch, the concrete, observable, on-disk consequence of the three-step, non-atomic write this lab deliberately did not protect with a journal.

## Common Misconceptions & Pitfalls

- **"A crash between these three writes is a rare, unlikely edge case not worth building a real test for."** Step 4's deliberately injected crash is the whole point of building this lab's simpler, non-journaled version first: making the failure reproducible and observable on demand is what turns "journaling matters" from an assertion into something this lab's own `fsck` can detect and report concretely.
- **"Free-block tracking for a file system is a completely different problem from free-space tracking in a memory allocator."** Step 3 deliberately reuses the same bitmap-based idea Lab 8's own free list served at the byte level, now applied at the block level; the underlying problem, tracking which fixed-size units of storage are currently in use, is the same shape at both a memory allocator's and a file system's layer.
- **"Detecting the corruption after the fact means the crash's damage is already fixed."** The `fsck` output in Step 4 detects the inconsistency but does not repair it automatically in this lab's intentionally simple design; the leaked block remains permanently unusable unless a separate repair step reclaims it, which is precisely why `file-system-implementation-and-journaling` argues journaling, preventing the inconsistency from occurring at all, is the stronger real-world design.

## Summary

This lab builds a real, working file system, a superblock, inode table, and data-block region, over a single ordinary host file standing in for a raw disk, with create, write, and delete operations reusing Lab 8's own bitmap-based free-space discipline at the block level. Deliberately building the intentionally simpler, non-journaled version first, and then injecting a real crash between a data write and its corresponding inode update, is what turns `file-system-implementation-and-journaling`'s theoretical claim about multi-step-update vulnerability into an observable, `fsck`-detectable corruption on an actual virtual disk, exactly the concrete failure journaling exists to prevent.

## Documentation Links

- [OSTEP Projects — File System Checker](https://github.com/remzi-arpacidusseau/ostep-projects): the real, official assignment this lab's crash-detection and `fsck`-style checking is modeled in spirit on.
- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "File System Implementation"](https://pages.cs.wisc.edu/~remzi/OSTEP/file-implementation.pdf): the source for the superblock/inode-table/data-block layout this lab implements.
