---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

`java.nio.channels` and `java.nio.ByteBuffer` are the layer beneath both the high-level `Path`/`Files` API (`nio2-path-and-files-api`) and the classic blocking sockets covered in `sockets-and-raw-http-anatomy`. Where a classic `InputStream`/`OutputStream` is one-directional and moves data one byte (or byte array) at a time, a `Channel` is bidirectional and always moves data into or out of a `ByteBuffer` — a fixed-size block of memory with its own read/write cursor. That's the real shift: I/O stops being "pull the next byte" and becomes "fill this buffer, then drain it," which is what makes non-blocking reads, zero-copy transfers, and memory-mapped files possible.

## Use Cases

- Copying or forwarding large files (log shipping, upload proxies) where `FileChannel.transferTo` avoids copying bytes through user-space entirely.
- Parsing or indexing a large file without loading it fully into a `byte[]`, via a memory-mapped `MappedByteBuffer` that lets the OS page it in on demand.
- Writing a low-level, high-throughput TCP server or client that can't afford one blocked OS thread per connection — the entry point non-blocking channels exist for, before a `Selector` is layered on top (see `jvm-concepts` → `nio-servers-and-async` for the full event-loop treatment).
- Reading a binary protocol whose header and payload are separate buffers, using scatter/gather `read`/`write` instead of concatenating byte arrays by hand.
- Choosing between heap and direct buffers when profiling shows GC pressure or copy overhead in a hot I/O path.

## Deep Dive

### Channel vs. Stream: a different mental model, not just a new class name

An `InputStream`/`OutputStream` pair is one-directional: one object reads, a different object writes, and both move raw bytes on demand. A `Channel` is a single object that can be read from *and* written to, and it never hands you a byte directly — it always fills or drains a `ByteBuffer` you provide:

```java
// classic stream: pull one array's worth of bytes at a time
try (InputStream in = new FileInputStream("data.bin")) {
    byte[] arr = new byte[1024];
    int n = in.read(arr);
}

// channel: the channel writes into a buffer you own and control
try (FileChannel channel = FileChannel.open(Path.of("data.bin"), StandardOpenOption.READ)) {
    ByteBuffer buf = ByteBuffer.allocate(1024);
    int n = channel.read(buf); // fills buf, returns bytes read or -1 at EOF
}
```

The buffer, not the channel, tracks where you are in the data — which is why understanding `ByteBuffer`'s internal state is the real prerequisite for using channels correctly.

### ByteBuffer's four markers: capacity, position, limit, mark

Every `Buffer` (not just `ByteBuffer`) tracks four indices into its backing storage:

- `capacity` — the buffer's fixed size, set at creation, never changes.
- `position` — where the next read or write happens; advances after each operation.
- `limit` — the first index that must not be read or written; for a freshly allocated buffer this equals `capacity`.
- `mark` — a saved position you can `reset()` back to; unset until you call `mark()`.

```java
ByteBuffer buf = ByteBuffer.allocate(10);
System.out.println(buf.capacity()); // 10
System.out.println(buf.position()); // 0
System.out.println(buf.limit());    // 10

buf.put((byte) 1).put((byte) 2).put((byte) 3);
System.out.println(buf.position()); // 3 — advanced by each put()
System.out.println(buf.limit());    // 10 — unchanged, still write-mode
```

### The flip/clear/compact cycle — and the classic bug of forgetting flip()

A buffer is always in one of two implicit modes: **write mode** (fill it up to `limit`) or **read mode** (drain it up to `limit`). `flip()` switches from write to read by setting `limit = position` and `position = 0` — this is the step that's easy to forget:

```java
// the bug: writing, then trying to read without flipping first
ByteBuffer buf = ByteBuffer.allocate(10);
buf.put((byte) 65).put((byte) 66).put((byte) 67); // position=3, limit=10

byte[] out = new byte[3];
buf.get(out); // reads from position 3 onward — past what was written!
// no exception here necessarily, but the bytes read are garbage (zeros),
// not the 65/66/67 just written
```

```java
// fixed: flip() before reading
ByteBuffer buf = ByteBuffer.allocate(10);
buf.put((byte) 65).put((byte) 66).put((byte) 67);
buf.flip();                    // limit=3 (old position), position=0
byte[] out = new byte[3];
buf.get(out);                  // reads exactly the 3 bytes written: 65, 66, 67
```

`clear()` resets the buffer to full write mode (`position = 0`, `limit = capacity`) *without* preserving unread data — anything not yet consumed is simply overwritten by the next writes. `compact()` is the safer alternative when a read was partial: it shifts the unread bytes (from `position` to `limit`) down to index 0, sets `position` to the number of bytes moved, and sets `limit = capacity`, ready for more writes without losing what wasn't consumed yet:

```java
buf.flip();          // read mode
buf.get();           // consume 1 byte, 2 remain unread
buf.compact();        // the 2 unread bytes move to index 0; position=2, limit=capacity
// buf is back in write mode, with the leftover bytes preserved at the front
```

### Heap buffers vs. direct buffers

`ByteBuffer.allocate(n)` creates a **heap buffer**, backed by a JVM byte array; `ByteBuffer.allocateDirect(n)` creates a **direct buffer**, backed by memory allocated outside the JVM heap:

```java
ByteBuffer heap   = ByteBuffer.allocate(4096);        // fast to allocate, lives on the Java heap
ByteBuffer direct = ByteBuffer.allocateDirect(4096);   // slower to allocate, lives in native memory
```

The OS can hand native I/O operations a direct buffer's address and read/write straight into it; a heap buffer, since it can be moved by the garbage collector, has to be copied into a temporary native buffer by the JVM before a system call can use it, and copied back for reads. Direct buffer allocation is comparatively expensive (it isn't reclaimed the same way ordinary objects are — often only released when a full GC runs, though `isDirect()` doesn't tell you anything about *when*) and their memory isn't pooled by default, so they're worth using for buffers that are large, reused repeatedly (a `FileChannel` copy loop), or held for a long time — not for small, short-lived buffers where the allocation overhead outweighs the copy it avoids.

```java
System.out.println(ByteBuffer.allocate(10).isDirect());       // false
System.out.println(ByteBuffer.allocateDirect(10).isDirect()); // true
```

### FileChannel: reading, writing, and zero-copy transfer

`FileChannel` opens a file for channel-based I/O and, unlike a stream, supports random access via `position(long)`:

```java
try (FileChannel channel = FileChannel.open(Path.of("data.bin"),
        StandardOpenOption.READ, StandardOpenOption.WRITE)) {
    ByteBuffer buf = ByteBuffer.allocate(256);
    int read = channel.read(buf);   // reads at the current file position
    channel.position(0);            // seek back to the start
}
```

`transferTo`/`transferFrom` move bytes directly between two channels — typically file-to-socket or file-to-file — without ever copying the data through a Java-visible buffer at all, which is why this is called zero-copy:

```java
try (FileChannel source = FileChannel.open(Path.of("large-upload.bin"), StandardOpenOption.READ);
     SocketChannel destination = SocketChannel.open(new InetSocketAddress("host", 8080))) {
    long size = source.size();
    long transferred = 0;
    while (transferred < size) {
        transferred += source.transferTo(transferred, size - transferred, destination);
    }
}
```

The JVM delegates this, where the OS supports it, to a kernel-level operation (e.g. `sendfile` on Linux) — the data never crosses into user-space Java memory, which is what makes it faster than a manual read-into-buffer/write-from-buffer loop for large files.

### Memory-mapped files: treating a file as an array of bytes

`FileChannel.map()` asks the OS to map a region of a file directly into the process's address space, returned as a `MappedByteBuffer`; reading or writing that buffer reads or writes the file, with the OS paging data in on demand instead of the program issuing explicit `read`/`write` calls:

```java
try (FileChannel channel = FileChannel.open(Path.of("big-index.dat"),
        StandardOpenOption.READ, StandardOpenOption.WRITE)) {
    MappedByteBuffer mapped = channel.map(FileChannel.MapMode.READ_WRITE, 0, channel.size());
    byte firstByte = mapped.get(0);      // a memory read, not an explicit syscall per access
    mapped.put(0, (byte) 42);            // written back to the file by the OS, on its own schedule
}
```

This pays off for large files accessed randomly or repeatedly (a database's index file, a large binary blob scanned many times) because the OS's page cache does the work of deciding what stays resident, avoiding both a full in-memory copy and a chatty sequence of small `read` calls. It's a poor fit for a file read once from start to finish — a plain buffered stream read is simpler and just as fast for that case — and unmapping is not fully deterministic in older JDKs (`MappedByteBuffer` has no explicit `close()`/`unmap()`; the mapping is released when the buffer is garbage collected, though newer `java.lang.foreign` APIs offer more deterministic control outside `java.nio` itself).

### SocketChannel / ServerSocketChannel: non-blocking mode

`SocketChannel` and `ServerSocketChannel` are the channel-based counterparts to `Socket`/`ServerSocket` (`sockets-and-raw-http-anatomy`), and the reason they exist at all is `configureBlocking(false)`: a socket that can be told not to wait when there's nothing to do yet.

```java
ServerSocketChannel server = ServerSocketChannel.open();
server.bind(new InetSocketAddress(8350));
server.configureBlocking(false);

SocketChannel client = server.accept(); // returns immediately: a SocketChannel, or null if none waiting
```

```java
SocketChannel channel = SocketChannel.open();
channel.configureBlocking(false);
channel.connect(new InetSocketAddress("localhost", 8350)); // returns immediately, connection in progress

ByteBuffer buf = ByteBuffer.allocate(256);
int n = channel.read(buf); // returns immediately: 0 if no data is available yet, not a block
```

That last line is the key behavioral difference from a blocking socket: `read()` on a non-blocking channel with nothing to read returns `0` right away instead of parking the thread, and `accept()` on a non-blocking server channel returns `null` instead of waiting for a connection. Polling every channel in a loop to see which one has data works but wastes CPU, which is exactly why non-blocking channels are almost always paired with a `Selector` — a single thread that blocks efficiently on *many* channels at once and wakes only when one of them is actually ready. That mechanism (registering channels, selection keys, the event loop) is covered in depth in the `jvm-concepts` module's `nio-servers-and-async` concept; this concept stops at the channel/buffer layer the selector sits on top of.

### Scatter/gather I/O: one call, many buffers

`read`/`write` overloads that take a `ByteBuffer[]` let a channel fill (scatter) or drain (gather) a whole array of buffers in a single call, in order:

```java
ByteBuffer header  = ByteBuffer.allocate(16);  // fixed-size header
ByteBuffer payload = ByteBuffer.allocate(1024); // variable-size payload
ByteBuffer[] buffers = { header, payload };

channel.read(buffers); // fills header completely before spilling into payload

// later, to send both back out in one call:
header.flip();
payload.flip();
channel.write(buffers); // drains header, then payload, in order
```

This avoids manually slicing one big buffer into a header region and a payload region — each part of the message gets its own buffer, and the channel handles filling/draining them in sequence.

## Trade-offs

- **Buffers are stateful and mutable, which makes forgetting `flip()`/`clear()` a real class of bug** — the same buffer object silently behaves differently depending on its position/limit, unlike an immutable stream read.
```java
buf.put((byte) 1);
buf.get(); // returns 0, not 1 — read happens from position 1 onward, past what was written
```
- **Direct buffers trade allocation cost for I/O speed** — worth it for buffers that are large or reused across many I/O calls, a net loss for small, short-lived, or rarely-reused buffers where the allocation overhead dominates.
- **`transferTo`/`transferFrom` zero-copy only kicks in when the OS and channel types support it** — it degrades gracefully to a regular copy loop otherwise, so it's a performance opportunity, not a guaranteed behavior to depend on for correctness.
- **Memory-mapped files give up deterministic cleanup** — there is no direct `unmap()` in `java.nio`; the mapping is released on garbage collection of the `MappedByteBuffer`, which can leave a file's mapping (and, on some platforms, a delete-pending state) alive longer than the code that used it expects.
- **Non-blocking mode alone doesn't solve concurrency — it just avoids blocking** — reading in a tight loop without a `Selector` burns CPU polling channels that have nothing ready; the payoff of non-blocking channels only shows up once a selector (or an equivalent reactor) is driving them.
- **Scatter/gather helps message framing but doesn't validate it** — passing buffers in the wrong order or with the wrong sizes reads/writes silently misaligned data; the API guarantees fill/drain order, not that the boundaries match the actual protocol.

## Documentation Links

- [ByteBuffer — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html) — doc
- [FileChannel — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.html) — doc
- [SocketChannel — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/SocketChannel.html) — doc
- [ServerSocketChannel — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/ServerSocketChannel.html) — doc
- [MappedByteBuffer — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/MappedByteBuffer.html) — doc
