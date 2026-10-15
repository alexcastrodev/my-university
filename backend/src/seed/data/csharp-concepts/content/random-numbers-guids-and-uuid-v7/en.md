---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

"Give me a random number" and "give me a unique id" sound like one problem and are
at least three. A game wants fast, repeatable pseudo-randomness. A password reset
token wants unpredictability an attacker cannot model. A database key wants
uniqueness, and, if it is a clustered key, an order that does not scatter inserts
across the index. .NET has a tool for each: `Random` (including the thread-safe
`Random.Shared`), `RandomNumberGenerator` for security, and `Guid`, which since
.NET 9 can create version 7 (time-ordered) values. This concept shows what each
one guarantees, the newer helpers (`Shuffle`, `GetItems`), and where version 7
GUIDs help and where their ordering is weaker than people assume.

## Use Cases

- Simulations, games, sampling and tests that need many cheap random values, often
  repeatable from a seed.
- Generating tokens, password-reset codes, API keys and salts that must not be
  guessable.
- Shuffling a deck or picking random items from a list without writing
  Fisher-Yates by hand.
- Choosing a primary-key type: `int` identity, random GUID, or time-ordered GUID.

## Deep Dive

### Random: fast, seedable, not secret

`Random` is a pseudo-random generator. The same seed gives the same sequence,
which the docs call out as useful for test suites and replaying games, and which
is exactly why it is useless for secrets. The docs also warn that the sequence
for a given seed may differ between .NET versions, so do not persist seeds as
a contract:

```csharp
var a = new Random(42);
var b = new Random(42);
Console.WriteLine($"{a.Next()} {b.Next()}");      // 1434747710 1434747710
Console.WriteLine(a.Next(1, 7));                    // 1..6: upper bound is exclusive
Console.WriteLine(a.NextInt64(10_000_000_000));     // a long below the bound
```

An instance is not thread safe per the docs, so sharing one `new Random()`
across threads is a bug. Since .NET 6, `Random.Shared` is a ready-made thread-safe
instance. We called it from `Parallel.For` 1000 times without trouble:

```csharp
var set = new ConcurrentBag<int>();
Parallel.For(0, 1000, _ => set.Add(Random.Shared.Next(100)));
Console.WriteLine(set.Count);    // 1000, no exceptions
```

You cannot seed `Random.Shared`. When you need reproducibility (a test, a
replay), create your own `new Random(seed)` and keep it on one thread.

### Shuffle, GetItems and the .NET 10 string helpers

.NET 8 added two helpers that replace common hand-written loops. `Shuffle` mixes
an array or span in place. `GetItems` picks values with replacement from a set of
choices, so the same choice can come out twice:

```csharp
int[] arr = [1, 2, 3, 4, 5, 6, 7, 8];
new Random(1).Shuffle(arr);
Console.WriteLine(string.Join(",", arr));                       // 2,1,5,7,4,3,6,8

string[] colors = ["red", "green", "blue"];
Console.WriteLine(string.Join(",", new Random(1).GetItems(colors, 5)));
// red,red,green,blue,green  (five picks from three choices: repeats are expected)
```

The outputs above are for seed 1 on this SDK, and per the docs may differ in
another version. `GetItems` has overloads that take a destination span. Per the API
docs, .NET 10 adds `Random.GetString(choices, length)` and `Random.GetHexString(length)`:

```csharp
Console.WriteLine(new Random(1).GetString("abc", 8));   // aabcbbbc
Console.WriteLine(new Random(1).GetHexString(8));        // 317CA65F
```

They are convenient for test data. Remember that they inherit `Random`'s
predictability.

### RandomNumberGenerator for anything an attacker would guess

The docs' guidance is direct: for "a cryptographically secure random number, such
as one that's suitable for creating a random password", use the static methods of
`RandomNumberGenerator`. Since .NET 8 it mirrors the helpers above:

```csharp
byte[] token = RandomNumberGenerator.GetBytes(16);                 // 16 random bytes
int die = RandomNumberGenerator.GetInt32(1, 7);                     // 1..6, upper bound exclusive
string code = RandomNumberGenerator.GetHexString(8);                // 8 hex chars
string pin = RandomNumberGenerator.GetString("0123456789", 6);      // 6 digits
RandomNumberGenerator.Shuffle<int>(numbers);                        // secure shuffle in place
```

Prefer `GetInt32` over reducing random bytes with `% n` yourself. Secure
generation costs more than `Random`, which rarely matters for tokens. For URL-safe output, pair
the bytes with `Base64Url` from the encodings concept. This section stays at the
level of "which API"; designing a token scheme (expiry, storage, comparison) is a
security topic of its own.

### Guid: v4 and v7

`Guid.NewGuid()` makes a version 4 value: random bits plus the version and variant
markers. In .NET 9, `Guid.CreateVersion7()` makes a version 7 value following
RFC 9562, which puts a Unix-millisecond timestamp in the first 48 bits and fills
the rest with random data. The docs state that the method uses `UtcNow` as the
timestamp and "seeds the rand_a and rand_b sub-fields with random data". There is
also an overload that takes a `DateTimeOffset` (it throws
`ArgumentOutOfRangeException` before the Unix epoch), and `Guid.Version` and
`Guid.Variant` properties to inspect a value (also .NET 9):

```csharp
var g4 = Guid.NewGuid();
Console.WriteLine($"{g4.Version} {g4.Variant}");        // 4 9
var t = DateTimeOffset.UtcNow;
var g7 = Guid.CreateVersion7(t);
Console.WriteLine(g7);                                  // 01a140fe-3a48-7c7e-98b3-8f9b5668440e
Console.WriteLine(g7.ToString("N")[..12] == t.ToUnixTimeMilliseconds().ToString("x12"));  // True
```

The first 12 hex digits are the millisecond timestamp, and the `7` after the second
dash is the version.

### What "sortable" really means

The timestamp prefix is the point: values created later sort later, so inserts
land near the end of an index instead of at random places, which is the usual
argument for fewer page splits and better cache behavior on a clustered key (the
benefit depends on your database engine, so measure it there). But the guarantee is only at
millisecond granularity, because the remaining bits are random. We measured it:

```csharp
var spaced = new List<Guid>();
for (int i = 0; i < 5; i++) { spaced.Add(Guid.CreateVersion7()); Thread.Sleep(3); }
Console.WriteLine(spaced.SequenceEqual(spaced.OrderBy(x => x)));       // True: 3 ms apart

var burst = Enumerable.Range(0, 10000).Select(_ => Guid.CreateVersion7()).ToList();
Console.WriteLine(burst.SequenceEqual(burst.OrderBy(x => x)));         // False: tight loop
int inversions = 0;
for (int i = 1; i < burst.Count; i++)
    if (string.CompareOrdinal(burst[i - 1].ToString(), burst[i].ToString()) > 0) inversions++;
Console.WriteLine(inversions);   // 4966 of 9999 adjacent pairs out of order on this machine
```

So two ids generated in the same millisecond have no defined relative order. If
you need a strict order (an event log, say), add a sequence column or use a
generator with a counter. Do not rely on creation order inside a burst.

Ordering also depends on the database. SQL Server's docs say ordering of
`uniqueidentifier` "is not implemented by comparing the bit patterns", so do not
assume that the byte or string order you see in .NET matches the order the
database uses for a GUID column. For SQL Server keys, EF Core's docs say the provider already
generates sequential GUIDs client-side when a GUID is a primary key, so you
normally leave that to the framework rather than call `CreateVersion7` yourself.
Check your provider's documentation before choosing.

Finally, a v7 GUID leaks its creation time to anyone who reads the first 12 hex
digits. Do not use it where a public id should not reveal when a row was created.

## Trade-offs

- **`Random` is cheap and reproducible, and predictable.** Fine for games and
  tests, unacceptable for tokens. If the value gates access to anything, use
  `RandomNumberGenerator`, even if the code looks identical.
- **`Random.Shared` trades control for convenience.** It is thread safe and needs
  no setup, but you cannot seed it, so tests that need repeatability should inject a
  seeded `Random` instead.
- **Version 7 GUIDs improve insert locality, not strict ordering.** The win is
  real for clustered indexes, and it is limited to millisecond resolution. Within a
  millisecond they are random, and across databases the sort order differs.
- **v7 reveals time, v4 does not.** A random v4 GUID is the safer public
  identifier. Use v7 for internal keys, and consider a separate public id.
- **GUIDs are bigger than ints.** 16 bytes in every index and foreign key, and
  unreadable in logs. Time ordering fixes fragmentation, not size.

## Documentation Links

- [Random class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.random) (doc)
- [RandomNumberGenerator class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.randomnumbergenerator) (doc)
- [Guid.CreateVersion7 method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.guid.createversion7) (doc)
- [uniqueidentifier (Transact-SQL), Microsoft Learn](https://learn.microsoft.com/en-us/sql/t-sql/data-types/uniqueidentifier-transact-sql) (doc)
- [Generated values, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/generated-properties) (doc)
