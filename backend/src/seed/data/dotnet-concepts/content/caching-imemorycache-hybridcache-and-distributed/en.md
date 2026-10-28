---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

A cache trades freshness for speed, and the interesting part is everything that goes wrong around that trade: ten requests recomputing the same report at once, a cache that grows until the process is killed, an invalidation that reaches one server and not the other. .NET has three caching APIs and they solve different problems. `IMemoryCache` is a dictionary with expiration inside one process. `IDistributedCache` is a byte-array store shared between servers (Redis, SQL Server, Postgres). `HybridCache` puts both behind one call and adds the piece the other two lack: only one caller per key runs the expensive work. This concept runs all three and reports what really happened: how many times the factory ran, which entries were kept, which were silently dropped, and what a second server sees after the first one invalidates. Versions used: SDK 10.0.100, `Microsoft.Extensions.Caching.Memory` 10.0.14, `Microsoft.Extensions.Caching.Hybrid` 10.11.0.

## Use Cases

- Caching a database query or a call to another service that is expensive and changes rarely.
- Protecting a slow dependency from a burst of identical requests after a deploy or a cache expiry.
- Sharing cached data between several instances of an API behind a load balancer.
- Invalidating a group of related entries (everything about one customer) when the source changes.

## Deep Dive

### IMemoryCache: simple, local, and not atomic

`IMemoryCache` lives in the process of one server. Registration is `AddMemoryCache()` (many `Add*` calls such as `AddRazorPages` already do it) and the usual entry point is `GetOrCreateAsync`. The method looks atomic, and it is not. Ten concurrent callers on a cold key, with a factory that takes 200 ms:

```csharp
var tasks = Enumerable.Range(0, 10).Select(_ => mem.GetOrCreateAsync("report", async e =>
{
    Interlocked.Increment(ref factoryRuns);
    await Task.Delay(200);
    return "data";
}));
await Task.WhenAll(tasks);
```

```text
10 concurrent callers, factory runs: 10
```

All ten ran the factory. This is a cache stampede: right after an entry expires, every concurrent request misses together and hits the database together. The docs say the same about repopulating from a callback ("several threads repopulating the cached item"). `IMemoryCache` is thread-safe, but it does not coordinate the work that fills it.

### Expiration: sliding alone can live forever

Two time-based options exist: `SlidingExpiration` (renewed on each read) and `AbsoluteExpirationRelativeToNow` (a hard deadline). I touched two entries every 200 ms, both with a 300 ms sliding window, one of them also with an 800 ms absolute limit:

```text
t=600  ms: sliding-only=True, sliding+absolute(800)=True
t=800  ms: sliding-only=True, sliding+absolute(800)=False
t=1200 ms: sliding-only=True, sliding+absolute(800)=False
```

An entry with only a sliding window never expires while it keeps being read, so a hot key can serve stale data indefinitely. Always pair sliding with an absolute upper bound, or use absolute alone.

### Expiration is lazy

Nothing in `MemoryCache` runs on a timer. An expired entry is removed when you read that key, or when a periodic scan runs, and the scan is rate limited by `ExpirationScanFrequency`, which defaults to one minute (`00:01:00`):

```text
default scan, 500 ms after a 200 ms entry expired, nobody read it: count=1
reading the expired key itself: hit=False, count=0, callbacks=y:Expired
```

With `ExpirationScanFrequency = 100 ms`, touching any other key after the entry expired removed it and ran the eviction callback (`x:Expired`). With the default, an expired and unread entry still occupies memory and still counts in `Count` for up to a minute. Memory does not drop at the moment of expiry.

### Size limits: the cache does not watch your memory

The docs state that the runtime does not trim the cache under memory pressure. Without `SizeLimit` it grows without bound, and expiration alone does not cap a cache fed by many different keys. With a limit, every entry must declare a size, in whatever unit you choose (1 per entry makes the limit a count):

```csharp
using var mem = new MemoryCache(new MemoryCacheOptions { SizeLimit = 3 });
mem.Set("nosize", "x");   // throws
```

```text
InvalidOperationException: Cache entry must specify a value for Size when SizeLimit is set.
```

I then inserted four entries of size 1 into a cache with limit 3, and one of size 10:

```text
after 4 inserts of size 1, limit 3: count=3, a=True, d=False
after 300 ms: count=3, a=True, b=True, c=True, d=False
entry of size 10 (> limit 3): cached=False
no SizeLimit, Size=999 ignored: cached=True
```

The fourth entry was dropped without an exception: `Set` returned normally and `d` was simply not there, so a miss caused by the limit looks like any other miss. Two more facts: when no limit is set, `Size` is ignored, and `SizeLimit` on the shared cache from DI can break other libraries that insert entries without a size, so the docs recommend a dedicated cache instance for size-limited use.

### Keys: never raw user input

All three APIs treat the key as an opaque string. The docs warn against using raw input from the user in keys: a client can flood the cache with random keys (memory growth, denial of service) or reach entries it should not. Build keys from trusted identifiers and use a delimiter, because `$"order{customerId}{orderId}"` gives `order42123` for both customer 42 order 123 and customer 421 order 23. Prefer `$"order/{customerId}/{orderId}"`.

### IDistributedCache: bytes shared between servers

`IDistributedCache` stores `byte[]` and has no notion of objects, tags or stampede protection. Implementations come from packages (`Microsoft.Extensions.Caching.StackExchangeRedis`, `.SqlServer`, `.Postgres`). `AddDistributedMemoryCache()` registers an in-process implementation that the docs call useful for development, testing and a single production server: it is not distributed. Serialization is your job, which is the main reason people end up writing the same get, deserialize, miss, load, serialize, set code in every service.

### HybridCache: one call, two levels, one factory

`HybridCache` (package `Microsoft.Extensions.Caching.Hybrid`, registered with `AddHybridCache()`) is the abstraction to reach for in new code. The primary cache (L1) is `MemoryCache` in the process. If an `IDistributedCache` is registered, it becomes the secondary cache (L2) and serialization is added (`string` and `byte[]` natively, `System.Text.Json` for the rest).

```csharp
builder.Services.AddHybridCache();

app.MapGet("/orders/{id:int}", async (int id, HybridCache cache, OrderDb db, CancellationToken ct) =>
    await cache.GetOrCreateAsync($"order/{id}", async token => await db.LoadAsync(id, token), cancellationToken: ct));
```

The same stampede test as before, now through `HybridCache` (L1 only):

```text
10 concurrent callers, factory runs: 1
```

One caller ran the factory and the other nine waited for its result. The factory's `CancellationToken` is cancelled only when all waiting callers have cancelled. Defaults read back from `IOptions<HybridCacheOptions>`:

```text
MaximumPayloadBytes=1048576, MaximumKeyLength=1024, DefaultEntryOptions=null
```

Three behaviors worth knowing, all measured:

```text
factory throws twice: runs=2   (a failure is not cached)
expiration 300 ms: runs=2      (entry expired, factory ran again)
3 calls with a 1025-char key: factory runs=3, with a 1024-char key: runs=1
```

A key longer than `MaximumKeyLength` bypasses the cache and logs an error (`Cache key maximum length exceeded (maximum: 1024, actual: 1025)`), so every call pays the full price. Do not build keys from unbounded text.

### What the stampede protection does not cover

The coordination is per `HybridCache` instance. Three nodes, five concurrent callers each, a cold key, a shared L2:

```text
3 nodes x 5 concurrent callers, cold key: factory runs=3
```

One run per node, not one overall. The docs say so too: coordination does not extend to other instances, even when they share the same secondary cache. For a very expensive factory you still need a lock or a single-writer design outside the cache.

### Tags, and what invalidation really does

Entries can be grouped with tags and removed together with `RemoveByTagAsync`:

```csharp
var tags = new[] { "customer:42" };
await cache.GetOrCreateAsync("order:1", Load, tags: tags);
await cache.RemoveByTagAsync("customer:42");
```

```text
tags: v1, v1, after RemoveByTagAsync -> v2, factory runs=2
tag '*': ArgumentException: The tag '*' is reserved and cannot be used in this context.
tag '  ': ArgumentException: Tags cannot be empty.
```

The docs explain the mechanism: invalidation by tag is logical, not physical. `RemoveByTagAsync` records "ignore anything created before this point" for the tag, and old values stay in the stores until they expire. `RemoveByTagAsync("*")` invalidates everything, but there are no glob patterns.

### Other servers keep their L1

I simulated two servers with two service providers sharing one `IDistributedCache`, each with a 2 s `LocalCacheExpiration` and a 30 s `Expiration`:

```text
A computes -> A-v1; B reads -> A-v1; L2 entries=1; factory runs A=1 B=0
after A.RemoveByTagAsync: A -> A-v2; B (same moment) -> A-v1
after B's local expiration (2 s): B -> A-v2
RemoveAsync on A; B still serves: A-v3 (it was A-v3)
```

B never ran its factory: it filled itself from L2. After A invalidated, B kept serving the old value from its own L1 until `LocalCacheExpiration` passed. This matches the docs: key and tag invalidation reaches the current server and the out-of-process store, and the in-memory cache of other servers is not affected. In a multi-instance deployment, `LocalCacheExpiration` is the staleness budget, so keep it short for data that must converge fast.

### HybridCache without a real L2 is still useful

`AddDistributedMemoryCache()` is not used as L2. I registered it next to `AddHybridCache()` and asked the `IDistributedCache` for the key afterwards:

```text
IDistributedCache.Get("k") is null (HybridCache did not write to it)
```

That matches the docs: it would only duplicate L1 in the same process. You still get L1 and stampede protection, so migrating `IMemoryCache` code to `HybridCache` is useful even before Redis exists. Sharing between servers needs a real out-of-process implementation.

### Payload limit: what I observed

The docs say values over `MaximumPayloadBytes` (1 MB by default) are logged and not stored. I cached a 2 MB string and a 2 MB `byte[]` DTO three times each, with and without an L2:

```text
with L2: 2 MB string  -> factory runs=1, L2 entries=0
with L2: 2 MB DTO     -> factory runs=1, L2 entries=0
L1 only: 2 MB DTO     -> factory runs=1
```

With `Microsoft.Extensions.Caching.Hybrid` 10.11.0 the oversized value never reached L2 (and the log shows `Cache MaximumPayloadBytes (1048576) exceeded`), but the local copy still served the next calls. The practical rule holds either way: payloads above the limit do not cross servers, so large blobs belong in blob storage, not in the cache.

### Reusing instances

By default `HybridCache` hands each caller its own copy, to avoid shared mutable state. If the type is `sealed` and marked `[ImmutableObject(true)]`, it hands out the same instance:

```text
mutable class: same instance? False; sealed+[ImmutableObject]: same instance? True
```

That saves allocations and deserialization for large, frequently read objects, and is only safe when nobody mutates them.

## Trade-offs

- **IMemoryCache needs your discipline.** No stampede protection and no memory ceiling unless you add one.
  ```csharp
  new MemoryCacheOptions { SizeLimit = 1024 }   // and every entry sets Size
  ```
- **A size limit fails silently.** An entry that does not fit is not stored and no exception tells you, so watch the hit ratio.
  ```csharp
  mem.Set("big", "x", new MemoryCacheEntryOptions { Size = 10 });   // limit 3: cached=False
  ```
- **Sliding expiration alone can serve stale data forever.** Add an absolute bound.
  ```csharp
  new MemoryCacheEntryOptions { SlidingExpiration = TimeSpan.FromMinutes(5), AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1) }
  ```
- **A second level adds staleness you must size.** Other nodes only learn about an invalidation when their L1 expires, so `LocalCacheExpiration` is a consistency setting, not just a performance one.
  ```csharp
  new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10), LocalCacheExpiration = TimeSpan.FromSeconds(30) }
  ```
- **Tag invalidation is cheap but logical.** Old bytes stay in memory and in Redis until they expire, so it does not free space.
- **Serialization is a cost and a risk.** L2 means serializing, and a type that cannot round trip through `System.Text.Json` fails at runtime (with Native AOT you must supply a source-generated serializer).
- **A cache is not a source of truth.** The code must still work when the entry is missing, which is why the factory must be correct and safe to run more than once (one run per node, as measured).

## Documentation Links

- [HybridCache library in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid?view=aspnetcore-10.0) (doc)
- [Cache in-memory in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/memory?view=aspnetcore-10.0) (doc)
- [Distributed caching in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/distributed?view=aspnetcore-10.0) (doc)
- [Caching overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/overview?view=aspnetcore-10.0) (doc)
- [Caching in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/caching) (doc)
