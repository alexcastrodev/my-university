---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

`Task<List<T>>` makes the caller wait for every item before it sees the first
one, and holds all of them in memory at once. `IAsyncEnumerable<T>` produces
items one at a time, asynchronously, and lets the consumer process each as it
arrives. It is the right shape for results that are large, slow to produce, or
open-ended: rows read from a database, lines read from a network stream, pages
fetched from a remote API, or a JSON array sent to a client. This concept covers
how to write and consume one, how cancellation and `ConfigureAwait` work with
`await foreach`, how ASP.NET Core and EF Core use it, and what happens when the
stream fails halfway.

## Use Cases

- Exporting a million rows as JSON without loading them all into memory.
- Reading a paged remote API and handing each item to the caller as soon as its
  page arrives.
- A progress feed or log tail that never ends and must stop when the client
  disconnects.
- Processing a file line by line while doing asynchronous work per line.

## Deep Dive

### Producing and consuming

An async iterator is a method that is `async`, returns `IAsyncEnumerable<T>`,
and uses `yield return`. The consumer uses `await foreach`:

```csharp
public static async IAsyncEnumerable<string> ReadLinesAsync(
    string path,
    [EnumeratorCancellation] CancellationToken ct = default)
{
    using var reader = new StreamReader(path);
    while (await reader.ReadLineAsync(ct) is { } line)
        yield return line;
}

await foreach (var line in ReadLinesAsync("big.log", ct))
    Console.WriteLine(line);
```

Like a synchronous iterator, the compiler turns the method into a state machine.
Nothing runs until the first `MoveNextAsync`, and the body resumes after each
`yield return` only when the consumer asks for the next item. That pull model is
what gives you backpressure: a slow consumer slows the producer.

### Cancellation with `[EnumeratorCancellation]`

The caller does not pass the token to the iterator method in every case, for
example when the stream arrives through an interface. `WithCancellation` hands a
token to the enumerator instead, and `[EnumeratorCancellation]` tells the
compiler to wire the parameter to it:

```csharp
IAsyncEnumerable<string> lines = ReadLinesAsync("big.log");

await foreach (var line in lines.WithCancellation(ct))
    Process(line);
```

Without the attribute, the token passed to `WithCancellation` is silently
ignored, and the compiler only warns about it. If the caller already passes a
token to the method and also uses `WithCancellation`, the two are combined.

### `ConfigureAwait` and disposal

`await foreach` awaits on every `MoveNextAsync` and once more on `DisposeAsync`.
Library code that should not resume on the captured context configures the
whole loop:

```csharp
await foreach (var item in source.ConfigureAwait(false))
    Handle(item);
```

Leaving the loop in any way (`break`, `return`, an exception) calls
`DisposeAsync`, which runs the iterator's `finally` blocks and `await using`
cleanup. That is how a database reader or file handle inside the iterator is
released early, so always consume the stream with `await foreach` rather than
calling `GetAsyncEnumerator` by hand and forgetting to dispose it.

### Streaming JSON from an endpoint

A minimal API endpoint can return `IAsyncEnumerable<T>`. `System.Text.Json`
writes the array incrementally, so the client starts receiving items while the
server is still producing the rest, and the server never holds the whole result:

```csharp
app.MapGet("/orders/export", (OrdersDbContext db) =>
    db.Orders
        .AsNoTracking()
        .OrderBy(o => o.Id)
        .Select(o => new OrderRow(o.Id, o.Total))
        .AsAsyncEnumerable());
```

`AsAsyncEnumerable()` is the EF Core method that turns a query into a stream. It
reads rows as the consumer asks for them, so the database connection stays open
for the whole enumeration. The reverse direction also streams:
`JsonSerializer.DeserializeAsyncEnumerable<T>(stream)` yields the elements of a
large JSON array one at a time.

### LINQ over async streams

The synchronous LINQ operators do not work on `IAsyncEnumerable<T>`. Until
recently that meant the `System.Linq.Async` NuGet package. From memory, .NET 10
ships the same async operators in the base library as
`System.Linq.AsyncEnumerable`, so `Where`, `Select`, `ToListAsync` and friends
work without the extra package. Check the version your project targets before
relying on it.

```csharp
var big = await ReadOrdersAsync(ct)
    .Where(o => o.Total > 1_000)
    .Select(o => o.Id)
    .ToListAsync(ct);
```

## Trade-offs

- **A stream hides the cost of each step.** Each `MoveNextAsync` can be a
  network round trip, so a consumer that does slow work per item holds the
  producer's resources (a connection, a cursor) open for the whole time.
  ```csharp
  await foreach (var row in db.Orders.AsAsyncEnumerable())
      await SendEmailAsync(row); // the database connection stays open during every email
  ```
  If the per-item work is slow, read a page into memory first, then process it.
- **Errors arrive in the middle.** An exception from `MoveNextAsync` can happen
  after the consumer has already handled many items, and, for an HTTP response,
  after the status code and part of the body have been sent. The client sees a
  truncated body, not a 500.
  ```csharp
  // Items 1..999 were already sent as 200 OK. Item 1000 throws: the response is cut off.
  ```
  Validate what you can before returning the stream, and make clients treat an
  incomplete JSON array as a failure.
- **`await foreach` is not parallel.** Items are pulled one at a time, so a slow
  async step per item multiplies by the item count. To overlap work, hand items
  to a `Channel<T>` or use `Parallel.ForEachAsync` over the stream.
- **Streaming loses a single, consistent total.** A `Task<List<T>>` can be
  counted, sorted, and returned with a `Content-Length`. A stream has no length
  up front, and anything that needs the whole set (sorting by a computed value,
  a count in a header) must buffer it anyway, which removes the benefit.
- **The token attribute is easy to forget.** A missing
  `[EnumeratorCancellation]` compiles and runs, and then ignores
  `WithCancellation`, so a cancelled request keeps producing items nobody reads.

## Documentation Links

- [Asynchronous streams (IAsyncEnumerable), C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/generate-consume-asynchronous-stream) (doc)
- [await foreach statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements#the-await-foreach-statement) (doc)
- [EnumeratorCancellationAttribute, .NET API, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.enumeratorcancellationattribute) (doc)
- [How to serialize and deserialize JSON, streaming with IAsyncEnumerable, System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/deserialization#deserialize-to-iasyncenumerable) (doc)
- [Minimal APIs, responses, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) (doc)
- [What is new in .NET 10 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
