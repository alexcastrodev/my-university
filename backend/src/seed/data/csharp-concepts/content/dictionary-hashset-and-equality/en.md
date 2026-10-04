---
version: 1.0
updatedAt: 2026-10-04
---
## Objective

`Dictionary<TKey, TValue>` and `HashSet<T>` give near constant-time lookup, but
only if the key type honors a contract that the compiler does not check:
objects that are equal must return the same hash code, and a key's hash must not
change while it sits in the collection. Break either rule and the collection
does not throw, it just stops finding items it clearly contains. This concept
covers how both collections store items, what `Equals` and `GetHashCode` must
guarantee, how comparers change the rules for strings and custom types, how
records behave as keys, and the allocation-free lookup APIs added in recent
versions.

## Use Cases

- A cache keyed by a composite value such as tenant id plus product id.
- A case-insensitive lookup table for header names or user-entered codes.
- A set of ids already processed, where only "have I seen this?" matters.
- Counting occurrences with a single hash lookup per item instead of two.

## Deep Dive

### How the collections store items

A `Dictionary` has two arrays. `entries` holds the items (hash code, key, value,
and an index of the next entry in the same bucket). `buckets` maps a bucket
number, computed from the hash code, to the first entry of that bucket. A lookup
computes the hash, picks the bucket, then walks the short chain comparing hash
codes and calling `Equals`. When the entries array is full, the collection
allocates larger arrays (an implementation detail: today the size is a prime
number, roughly double) and re-inserts everything, which is why adding many items to a dictionary also
benefits from a capacity hint:

```csharp
var map = new Dictionary<string, int>(capacity: 10_000);
map.EnsureCapacity(50_000);   // grows once if the capacity is lower

var seen = new HashSet<int>(1_000);
bool added = seen.Add(42);    // false if 42 was already there
```

`HashSet<T>` uses the same structure without values. Use it when only presence
matters: `Contains` is O(1) on average, while `List<T>.Contains` scans the list
in O(n).

### The Equals and GetHashCode contract

The rules, in order of how often they are broken:

- If `a.Equals(b)` is true, `a.GetHashCode()` must equal `b.GetHashCode()`.
  The reverse is not required: different objects may collide.
- The hash code of an object must not change while it is a key. The collection
  computed the bucket once, when you added it.
- `Equals` must be reflexive, symmetric, and transitive, and `x.Equals(null)`
  must return false.
- A hash code is only valid inside one running process. It may differ between
  runs (string hashes are randomized), so never store it in a file or database.

Overriding `Equals` without `GetHashCode` makes the compiler warn, and it is a
real bug: the dictionary compares hash codes first, so two "equal" objects land
in different buckets and are never compared.

```csharp
public sealed class Sku : IEquatable<Sku>
{
    public string Code { get; }
    public Sku(string code) => Code = code;

    public bool Equals(Sku? other) =>
        other is not null && string.Equals(Code, other.Code, StringComparison.OrdinalIgnoreCase);

    public override bool Equals(object? obj) => Equals(obj as Sku);

    public override int GetHashCode() =>
        string.GetHashCode(Code, StringComparison.OrdinalIgnoreCase); // must match the Equals above
}
```

Implement `IEquatable<T>` on types that are used as keys, because the generic
dictionary then calls the typed `Equals` instead of the `object` one, which
avoids boxing for structs.

### The mutable key bug

If a property that takes part in `GetHashCode` changes after the object was
added, the entry stays in the bucket of the old hash and lookups look in the new
one:

```csharp
// Point is a class with settable X and Y whose Equals and GetHashCode use both.
var key = new Point { X = 1, Y = 2 };
var map = new Dictionary<Point, string> { [key] = "a" };

key.X = 10;
Console.WriteLine(map.ContainsKey(key));          // False
Console.WriteLine(map.Count);                     // 1, the entry is still there
Console.WriteLine(map.ContainsKey(new Point { X = 1, Y = 2 })); // False too: Equals fails
```

The entry is now unreachable: no key hashes to its bucket and also equals it.
Use immutable types for keys (records with `init` properties, `readonly record
struct`, strings, ids).

### Comparers

Every constructor accepts an `IEqualityComparer<TKey>`. For strings, the default
comparison is ordinal (exact characters), which is fast and culture independent.
Pick a comparer on purpose instead of lowercasing keys by hand:

```csharp
var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
headers["Content-Type"] = "application/json";
Console.WriteLine(headers["content-type"]);   // found

var names = new HashSet<string>(StringComparer.CurrentCultureIgnoreCase); // culture rules: avoid for identifiers
```

Use `Ordinal` or `OrdinalIgnoreCase` for identifiers, file names, and protocol
tokens. Culture-sensitive comparers depend on the machine's locale (the Turkish
dotted and dotless I is the classic surprise), so a lookup can succeed on one
server and fail on another.

### Records as keys

A record generates `Equals` and `GetHashCode` from all its fields, so two
records with the same values are the same key:

```csharp
public readonly record struct TenantProduct(Guid TenantId, int ProductId);

var prices = new Dictionary<TenantProduct, decimal>();
prices[new TenantProduct(tenant, 7)] = 9.90m;
Console.WriteLine(prices[new TenantProduct(tenant, 7)]);   // 9.90

// For a class (records already generate this), combine the fields by hand:
public override int GetHashCode() => HashCode.Combine(TenantId, ProductId);
```

Records compare each field with its own equality, so a record that contains a
`List<T>` or an array compares them by reference, and two records with equal
lists are not equal. A record with settable properties has the mutable key
problem above, so make key records immutable.

### Lookup APIs that avoid double hashing

The classic "check then add" does two lookups:

```csharp
if (!map.ContainsKey(key)) map[key] = 1;       // two hashes
map.TryAdd(key, 1);                            // one

var value = map.GetValueOrDefault(key, 0);     // one lookup, with a default

// Count occurrences with one lookup and an in-place update:
ref int count = ref CollectionsMarshal.GetValueRefOrAddDefault(map, key, out _);
count++;
```

`GetValueRefOrAddDefault` returns a reference to the value stored inside the
dictionary, so the update needs no second lookup. The reference is only valid
until the dictionary is next modified.

## Trade-offs

- **A bad `GetHashCode` degrades the dictionary to a linked list.** Returning a
  constant is legal and turns every lookup into a scan of one giant bucket.
  ```csharp
  public override int GetHashCode() => 1;  // correct, and O(n) per lookup
  ```
- **`GetHashCode` is not unique and not stable.** Two different values may
  share a hash, and the value changes between runs, so use it only for in-memory
  tables.
- **Ordinal is fast and exact, culture-aware is correct for people and slow.**
  Sorting or matching text a user reads may need culture rules, while keys the
  program creates should be ordinal.
- **A `ref` into a dictionary dies on the next change.** Adding an item can
  resize the entries array, after which the old `ref int` points to stale memory
  that the dictionary no longer uses.
  ```csharp
  ref int c = ref CollectionsMarshal.GetValueRefOrAddDefault(map, "a", out _);
  map["b"] = 1;   // may resize
  c++;            // updates the old array, not the dictionary
  ```
- **`Dictionary<T, bool>` as a set wastes memory and obscures intent.** Use
  `HashSet<T>`, which also gives set operations (`UnionWith`, `IntersectWith`,
  `ExceptWith`).
- **Enumeration order is an implementation detail.** A dictionary often returns
  items in insertion order until something is removed, and then new items reuse
  the freed slots, so do not depend on it. Use `SortedDictionary` or sort the
  keys when order matters.

## Documentation Links

- [Dictionary<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.dictionary-2) (doc)
- [Object.GetHashCode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.object.gethashcode) (doc)
- [How to define value equality for a class or struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/statements-expressions-operators/how-to-define-value-equality-for-a-type) (doc)
- [Best practices for comparing strings in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings) (doc)
- [Records, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [CollectionsMarshal.GetValueRefOrAddDefault, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.collectionsmarshal.getvaluereforadddefault) (doc)
