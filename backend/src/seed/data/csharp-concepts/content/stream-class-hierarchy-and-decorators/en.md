---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

`System.IO.Stream` is the one abstraction behind files, memory buffers, network
sockets, pipes, and compression. Code written against `Stream` works with all of
them, and wrappers (decorators) add behavior by holding another stream: a
`GZipStream` compresses whatever it wraps, a `BufferedStream` batches small
reads and writes. The model is small, but it hides four traps that cause real
bugs: a `Read` that returns fewer bytes than you asked for, a decorator that
closes the stream you still needed, a wrapper that was never flushed, and an
async call on a file that was opened for synchronous access. This concept covers
the hierarchy, the decorator chain, and how ownership and disposal work through
it.

## Use Cases

- Reading a fixed-size header from a file or a socket and being sure you got all
  of it.
- Compressing a payload into memory with `GZipStream` and then reading the bytes
  back.
- Writing text to a stream you do not own (an HTTP response body, a network
  stream) without closing it when you finish.
- Reading a large file asynchronously without blocking a thread-pool thread on
  every call.
- Deciding whether a stream can be rewound (`Seek`) or can only be consumed once.

## Deep Dive

### The hierarchy and the decorator chain

`Stream` is abstract. Some subclasses are sources or sinks of bytes
(`FileStream`, `MemoryStream`, `NetworkStream`), and others are decorators that
take another `Stream` in their constructor and transform what passes through
(`BufferedStream`, `GZipStream`, `CryptoStream`). You build a pipeline by
nesting them, with the real source or sink in the middle:

```csharp
// Write: your bytes -> gzip -> buffer -> file
await using var file = new FileStream("log.gz", FileMode.Create, FileAccess.Write);
await using var buffered = new BufferedStream(file, 64 * 1024);
await using var gzip = new GZipStream(buffered, CompressionLevel.Optimal);

await gzip.WriteAsync(payload);
```

`FileStream` already buffers internally (its default buffer is 4 KB), so wrapping
it in a `BufferedStream` only helps when you want a different size. The decorator
is worth it on streams that do not buffer, such as `NetworkStream`, where many
tiny writes would each become a system call.

### Read can return fewer bytes than you asked for

`Read` returns how many bytes it actually put in the buffer, and `0` only at the
end of the stream. On a file this is usually the full amount, but on a network
stream or a compressed stream a single call can return just what has arrived.
Code that assumes it got everything works in tests and fails in production:

```csharp
// Wrong: ignores the return value.
var header = new byte[16];
stream.Read(header, 0, header.Length);

// Right: loop until you have it all.
int read = 0;
while (read < header.Length)
{
    int n = stream.Read(header, read, header.Length - read);
    if (n == 0) throw new EndOfStreamException();
    read += n;
}

// Same thing, since .NET 7:
stream.ReadExactly(header);                 // throws EndOfStreamException if the stream ends early
await stream.ReadExactlyAsync(header, ct);
```

Use `ReadAtLeast` when a minimum is enough but you want to fill a larger buffer.

### Ownership: who disposes the inner stream

Disposing a decorator disposes the stream it wraps, by default. That is what you
want when you built the whole chain, and a bug when the inner stream belongs to
someone else. Most wrappers take a `leaveOpen` argument for this:

```csharp
// Writes text into a stream the caller owns, and leaves it open.
using var writer = new StreamWriter(responseBody, Encoding.UTF8, bufferSize: 1024, leaveOpen: true);
await writer.WriteAsync(text);
await writer.FlushAsync(); // flush explicitly: leaveOpen skips the close that would have flushed
```

A related trap: a compression stream only writes its final block on dispose.
Read the compressed bytes before disposing the `GZipStream` and you get a
truncated archive.

```csharp
var ms = new MemoryStream();
using (var gzip = new GZipStream(ms, CompressionLevel.Optimal, leaveOpen: true))
    gzip.Write(payload);                 // the gzip stream is disposed (and finished) here
byte[] compressed = ms.ToArray();        // safe now, and ms is still open
```

### Seek, CanSeek, and one-way streams

`FileStream` and `MemoryStream` can seek, but `NetworkStream`, `GZipStream`, and
pipes cannot, and `Length` and `Position` throw `NotSupportedException` on them.
Check `CanSeek` before rewinding, and rewind a `MemoryStream` after writing and
before reading:

```csharp
var ms = new MemoryStream();
ms.Write(data);
ms.Position = 0;          // without this, reading starts at the end and returns 0 bytes
var copy = new byte[data.Length];
ms.ReadExactly(copy);
```

### Text on top of bytes

`StreamReader` and `StreamWriter` convert between bytes and text with an
encoding. Both default to UTF-8, and `StreamReader` also detects a byte order
mark. Pass the encoding explicitly when the data is not UTF-8, because
decoding with the wrong one produces garbage rather than an error:

```csharp
using var reader = new StreamReader(stream, Encoding.Latin1, detectEncodingFromByteOrderMarks: false);
string line = await reader.ReadLineAsync(ct) ?? "";
```

### Async file access

A `FileStream` opened without the async flag still has `ReadAsync`, but it runs
the synchronous call on a thread-pool thread. Open it for asynchronous I/O to
use the operating system's async support:

```csharp
await using var fs = new FileStream("big.bin", new FileStreamOptions
{
    Mode = FileMode.Open,
    Access = FileAccess.Read,
    Options = FileOptions.Asynchronous | FileOptions.SequentialScan,
    BufferSize = 4096,
});
await fs.CopyToAsync(destination, ct);
```

`using` and `await using` both work on streams. Prefer `await using` in async
code, because `DisposeAsync` can flush buffered data without blocking.

## Trade-offs

- **Forgetting that a decorator closes the inner stream.** The default is to
  dispose both, which breaks code that keeps using the stream afterwards.
  ```csharp
  using (var reader = new StreamReader(stream)) { /* ... */ }
  stream.ReadByte(); // ObjectDisposedException: the reader closed it
  ```
- **`leaveOpen: true` moves the cleanup to you.** The wrapper no longer flushes
  its buffer when the caller disposes the inner stream later, so a `StreamWriter`
  that was not flushed loses its last block of data.
- **A buffer on top of a buffer wastes memory.** `BufferedStream` around a
  `FileStream` adds a second copy and no speed. Add one only for streams that do
  not already buffer.
- **`MemoryStream` hides large allocations.** It grows by doubling, and a
  100 MB payload held in one makes a 100 MB array plus intermediate copies. For
  large or unbounded data, copy straight from the source to the destination.
- **Async on a synchronous `FileStream` is not really async.** It keeps a
  thread-pool thread busy for each call, so on a busy server the benefit is
  smaller than it looks. The cost of the async flag is slightly more overhead for
  tiny reads, so use it for large or slow files.

## Documentation Links

- [Stream class, System.IO, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.stream) (doc)
- [Stream.ReadExactly method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.stream.readexactly) (doc)
- [FileStream class, System.IO, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream) (doc)
- [BufferedStream class, System.IO, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.bufferedstream) (doc)
- [GZipStream class, System.IO.Compression, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.gzipstream) (doc)
- [StreamReader class, System.IO, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.streamreader) (doc)
