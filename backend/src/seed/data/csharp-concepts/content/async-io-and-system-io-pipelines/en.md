---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

Reading and writing data without blocking a thread is the baseline for any
server in .NET. The `Stream` async methods cover most cases, but they leave you
to manage buffers, partial reads, and memory pressure yourself. `ArrayPool<byte>`
removes the allocation cost of temporary buffers, and `System.IO.Pipelines`
goes further: it owns the buffering, lets a parser look at data without
copying it, and slows a fast producer down when the consumer falls behind. This
concept shows when each level is enough and what each one costs you.

## Use Cases

- Copying an uploaded file to disk or blob storage without loading it all in
  memory.
- A hot code path that needs a temporary buffer per request and must not feed
  the garbage collector.
- Parsing a framed network protocol (length-prefixed or line-based) where a
  message can arrive split across several reads.
- A producer that reads from a socket faster than the consumer can process, and
  must not grow memory without limit.

## Deep Dive

### Async reads and writes with Memory

The `Memory<byte>` overloads of `ReadAsync` and `WriteAsync` return
`ValueTask`, so a call that completes synchronously allocates nothing. A read
may return fewer bytes than the buffer holds, and zero means end of stream, so
a read always sits in a loop:

```csharp
static async Task<int> CountBytesAsync(Stream input, CancellationToken ct)
{
    var buffer = new byte[16 * 1024];
    var total = 0;
    int read;
    while ((read = await input.ReadAsync(buffer.AsMemory(), ct)) > 0)
        total += read; // only buffer[..read] is valid data
    return total;
}
```

When you only move bytes from one stream to another, do not write that loop:
`CopyToAsync` does it, with a default buffer of 81920 bytes you can change with
an overload:

```csharp
await using var file = File.Create(path);
await request.Body.CopyToAsync(file, bufferSize: 64 * 1024, ct);
```

### Renting buffers with ArrayPool

Allocating a new array for every request makes the garbage collector work for
nothing. `ArrayPool<byte>.Shared` lends arrays and takes them back:

```csharp
var buffer = ArrayPool<byte>.Shared.Rent(minimumLength: 4096);
try
{
    var read = await stream.ReadAsync(buffer.AsMemory(0, 4096), ct);
    Process(buffer.AsSpan(0, read));
}
finally
{
    ArrayPool<byte>.Shared.Return(buffer, clearArray: true); // clear if it held secrets
}
```

Two rules prevent most bugs. `Rent` may return an array larger than requested,
so always track the length you actually use and never rely on `buffer.Length`.
And after `Return`, the array belongs to the pool again: keeping a reference,
or returning it twice, corrupts another caller's data.

### Pipelines: the pool, the buffering, and the parser in one

`System.IO.Pipelines` splits the work in two ends joined by a `Pipe`. The writer
asks for memory, fills it, and flushes. The reader gets a `ReadOnlySequence<byte>`
(possibly several segments) and tells the pipe how much it used:

```csharp
static async Task ReadLinesAsync(PipeReader reader, CancellationToken ct)
{
    while (true)
    {
        ReadResult result = await reader.ReadAsync(ct);
        ReadOnlySequence<byte> buffer = result.Buffer;

        while (TryReadLine(ref buffer, out ReadOnlySequence<byte> line))
            Handle(line);

        // consumed: parsed and gone. examined: seen, so do not wake me until more arrives.
        reader.AdvanceTo(buffer.Start, buffer.End);

        if (result.IsCompleted) break;
    }
    await reader.CompleteAsync();
}

static bool TryReadLine(ref ReadOnlySequence<byte> buffer, out ReadOnlySequence<byte> line)
{
    var position = buffer.PositionOf((byte)'\n');
    if (position is null) { line = default; return false; }
    line = buffer.Slice(0, position.Value);
    buffer = buffer.Slice(buffer.GetPosition(1, position.Value));
    return true;
}
```

The key is `AdvanceTo(consumed, examined)`. Data before `consumed` is released.
Data between `consumed` and `examined` stays in the pipe but the next
`ReadAsync` waits for new bytes instead of returning the same incomplete
message in a busy loop.

You can wrap an existing stream without writing the producer yourself:
`PipeReader.Create(stream)` and `PipeWriter.Create(stream)`.

### Backpressure

A `Pipe` has two thresholds in `PipeOptions`. When the unread data passes
`pauseWriterThreshold`, `FlushAsync` on the writer does not complete until the
reader consumes enough to drop under `resumeWriterThreshold`:

```csharp
var pipe = new Pipe(new PipeOptions(
    pauseWriterThreshold: 64 * 1024,   // writer waits above this
    resumeWriterThreshold: 32 * 1024)); // and resumes below this

PipeWriter writer = pipe.Writer;
Memory<byte> memory = writer.GetMemory(sizeHint: 4096);
int bytesRead = await socket.ReceiveAsync(memory, SocketFlags.None, ct);
writer.Advance(bytesRead);
FlushResult flush = await writer.FlushAsync(ct); // waits here when the reader is behind
```

This is the whole point against a hand-rolled `MemoryStream` plus a loop: a slow
consumer slows the producer down instead of filling memory.

### When it is worth it

ASP.NET Core's Kestrel server is built on Pipelines for exactly these reasons.
For your own code, `Stream` with `ArrayPool` is enough when you copy, hash, or
transform data in fixed chunks. Reach for Pipelines when you parse a protocol
whose messages cross read boundaries, when you must cap memory under a fast
producer, or when copying bytes between buffers shows up in a profile.

## Trade-offs

- **`ArrayPool` shifts ownership onto you.** A buffer you forget to return only
  costs a fresh allocation later, but one you keep after returning is a data
  race with whoever rents it next.
  ```csharp
  ArrayPool<byte>.Shared.Return(buffer);
  buffer[0] = 1; // another caller may now own this array
  ```
- **The returned array can be longer than requested.** Code that hashes or
  sends `buffer` instead of `buffer.AsMemory(0, read)` sends stale bytes from
  an earlier user of the same array.
- **Pipelines have a steeper API.** `ReadOnlySequence<byte>` can be multi-segment,
  so a parser needs `SequenceReader<byte>` or careful slicing, and a wrong
  `AdvanceTo` either loses data or spins at 100 percent CPU.
  ```csharp
  reader.AdvanceTo(buffer.Start);               // nothing consumed or examined: ReadAsync returns again at once
  reader.AdvanceTo(buffer.Start, buffer.End);   // examined everything: wait for more data
  ```
- **Backpressure moves the problem, it does not remove it.** A paused writer
  means a socket that is not being read, so the remote side eventually stalls
  too. That is the intended effect, but it needs timeouts so one slow client
  cannot hold a connection forever.
- **Not every workload needs it.** For a handler that copies a body to a file,
  `CopyToAsync` is shorter, easier to read, and fast enough.

## Documentation Links

- [Stream.ReadAsync and the Memory overloads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.stream.readasync) (doc)
- [Stream.CopyToAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.stream.copytoasync) (doc)
- [ArrayPool<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1) (doc)
- [System.IO.Pipelines in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/io/pipelines) (doc)
- [PipeOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipelines.pipeoptions) (doc)
