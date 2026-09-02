---
version: 1.0
updatedAt: 2026-09-02
---
## Question

# What is a ReadWriteLock?

## Short Answer

A lock that enables parallel reads and blocks on writes.

## Less Short Answer

Locks are used to prevent race conditions. A race condition occurs when two threads are writing and reading the same field: will thread B see the value written by thread A? Synchronization achieves that by blocking everything.

## Two Locks in One

`ReadWriteLock` works with two locks: one for the read operations, and another one for the write operations. The write lock is exclusive — no other lock can be taken when it is active. The read lock, on the other hand, is not: you can have any number of active read locks.

## One Last Word

Of course, this is an optimization only if your number of write operations is much smaller than the number of read operations.

## References

- [Java Coding Tip #162: What Is a ReadWriteLock?](https://www.youtube.com/shorts/ubmAvn-8QTM) — video
- [ReadWriteLock — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReadWriteLock.html) — doc
- [ReentrantReadWriteLock — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html) — doc
