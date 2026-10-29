---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

C# can drop below the managed world: pointers, pinning, native memory and
function pointers compiled to a bare `calli`, with no bounds checks, type checks
or GC help. Since `Span<T>`, `MemoryMarshal` and the vectorized helpers
arrived, most code that once needed this no longer does. This concept covers
enabling `unsafe` on .NET 10 / C# 14, the pointer operators, `fixed` and
fixed-size buffers next to `[InlineArray]`, `Unsafe` and `NativeMemory`, what
an overrun and a stale pointer really do, function pointers with measured call
costs, and the C# 15 safety model.

## Use Cases

- Interop: native buffers, `qsort`-style callbacks, native function tables.
- Hot parsing or hashing loops where a profiler proved bounds checks matter.
- Reading code built on `Unsafe.As`, `Unsafe.Add` or `MemoryMarshal`.
- Reviewing a pull request that turns on `AllowUnsafeBlocks`.

## Deep Dive

### Turning it on

Without the switch, any `unsafe` block fails with `error CS0227: Unsafe code may
only appear if compiling with /unsafe`. The project opts in with
`<AllowUnsafeBlocks>true</AllowUnsafeBlocks>`; the keyword then marks a block, a
method or a type. A pointer outside that context is CS0214, `sizeof` of a user
struct CS0233 (`sizeof(int)` is a constant, legal anywhere). The switch alone
marks the module `UnverifiableCodeAttribute`, even with no unsafe code in it.

### Pointer operators and scaled arithmetic

`&` takes an address, `*` dereferences, `->` reaches a member, `p[i]` is
`*(p + i)`, and arithmetic moves by `sizeof(T)`:

```csharp
int n = 0x11223344;
int* pi = &n;
byte* pb = (byte*)pi;
Console.WriteLine($"{*pi:X} {pb[0]:X} {pb[3]:X}");   // 11223344 44 11 (little-endian)
long* pl = (long*)pi;
Console.WriteLine($"{(nint)(pi + 1) - (nint)pi} {(nint)(pl + 1) - (nint)pl}");  // 4 8
int* stack = stackalloc int[4] { 10, 20, 30, 40 }; int* end = stack + 4;
Console.WriteLine($"{end - stack} {stack[2]} {*(stack + 3)}");   // 4 30 40
Point* pp = &pt;  pp->Y = 5;                                      // pt.Y is 5
```

`&n` works because a local is a *fixed variable* in the docs' terms. An array
element or a class field can move, so `&arr[0]` is CS0212 ("You can only take
the address of an unfixed expression inside of a fixed statement initializer").
Managed types are softer on C# 14: `string* ps = &s;` only warns with CS8500
("This takes the address of, gets the size of, or declares a pointer to a
managed type ('string')") and points at the local slot holding the reference,
not at the characters. `stackalloc string[2]` is still the error CS0208.

### `fixed`, fixed-size buffers and `[InlineArray]`

`fixed` pins an object for the block so the GC cannot move it: arrays,
strings, spans (via `GetPinnableReference`) and fixed-size buffers:

```csharp
fixed (int* pa = arr) { pa[1] = 20; }                       // arr is 1,20,3,4
fixed (char* pc = "héllo") Console.WriteLine($"{pc[1]} {(int)pc[5]}");  // é 0
fixed (byte* ph = heap.AsSpan()) { ph[0] = 9; }             // heap[0] is 9
fixed (int* pe = Array.Empty<int>()) Console.WriteLine(pe == null);   // True
```

A pinned string exposes its terminating `'\0'`; an empty array pins to `null`.
A fixed-size buffer embeds elements in a struct, as C layouts need, and
`[InlineArray]` (C# 12) gives the same layout in safe code:

```csharp
unsafe struct Header { public fixed byte Magic[16]; public int Version; }
[InlineArray(16)] struct Bytes16 { private byte _e0; }

var h = new Header { Version = 0x42 }; int i = 16;
Console.WriteLine($"{sizeof(Header)} {h.Magic[i]:X}");   // 20 42: index 16 read Version
var ia = new Bytes16(); Span<byte> view = ia;            // 16 elements, no unsafe
ia[i] = 1;                                                // IndexOutOfRangeException
```

Fixed-buffer access is pointer access, so index 16 silently returned the next
field; inside a class, using the buffer unpinned is CS1666. `stackalloc` has
the same split: into a `Span<int>` it is safe and `buf[3]` threw
`IndexOutOfRangeException`; into an `int*` it needs `unsafe`, and the docs note
that pointer element access "doesn't check for out-of-bounds errors".

### `Unsafe`, `MemoryMarshal` and `NativeMemory`

`Unsafe` works on managed references (`ref T`), so most of it compiles without
the `unsafe` keyword (`Unsafe.SizeOf<Header>()` is 20). Its docs warn that most
APIs "do not perform any argument checking or validation":

```csharp
Unsafe.As<float, int>(ref f);                     // 3F800000 for 1.0f
ref int r0 = ref MemoryMarshal.GetArrayDataReference(nums);   // nums = 5,6,7,8
Unsafe.Add(ref r0, 2);                            // 7, no bounds check
MemoryMarshal.GetReference(nums.AsSpan(1));       // 6
Unsafe.ReadUnaligned<int>(ref raw[1]);            // 1 for bytes FF 01 00 00 00
string s = Unsafe.As<string>(new object());       // no cast check: s.GetType() is Object
```

`NativeMemory` wraps the C allocator (the docs name `malloc`, `calloc`,
`aligned_alloc` and `free`). The GC never sees that memory, so each block needs
its `Free`, and `AlignedAlloc(1024, 64)` (which returned an address with
`% 64 == 0`) needs `AlignedFree`. Wrapping the pointer at once in
`new Span<byte>(p, 16)` brings the checks back: `span[16]` threw
`IndexOutOfRangeException`.

### What goes wrong: overruns and stale pointers

Reading 11 ints through a pointer to a pinned 4-int array raised nothing and
walked into the next array: its header (`0`), its type handle (matching
`typeof(int[]).TypeHandle.Value`), its length `2`, padding and its first
element `111`. The array indexer refuses:

```text
p4[0..10]: 1 2 3 4 0 0 159007776 1 2 0 111
four[4]:   IndexOutOfRangeException: Index was outside the bounds of the array.
```

A pointer taken without pinning goes stale when the GC compacts. With 1,000
dead arrays allocated before `data = { 11, 22, 33, 44 }`, the address came from
`Unsafe.AsPointer(ref data[0])` and then
`GC.Collect(2, GCCollectionMode.Forced, blocking: true, compacting: true)` ran:

```text
before: 11C6355C0 gen 0 read 11,22
after:  11C633588 gen 1 moved True
old pointer reads 0,0; array holds 11,22
pinned: moved False, gen 0, reads 11
```

All six runs (Release and Debug) moved the array; inside `fixed` the address
held. Only reads were made: a write through the old pointer would hit memory
the GC can reuse. The docs' rule: pin "for as long as the pointer is used".

### Function pointers and what a call costs

`delegate*<int, int, int>` holds the address of a static method and is called
with `calli`, with no delegate object. `managed` is the default convention
(`add == same` is `True`); `unmanaged[...]` targets native code:

```csharp
delegate*<int, int, int> add = &Ops.Add;                         // add(2, 3) is 5
delegate* managed<int, int, int> same = &Ops.Add;
nint libc = NativeLibrary.Load("/usr/lib/libSystem.B.dylib");
var abs = (delegate* unmanaged[Cdecl]<int, int>)NativeLibrary.GetExport(libc, "abs");   // abs(-42) is 42
var qsort = (delegate* unmanaged[Cdecl]<void*, nuint, nuint, delegate* unmanaged[Cdecl]<void*, void*, int>, void>)
    NativeLibrary.GetExport(libc, "qsort");
int[] values = { 42, 7, 19, 3, 25 };
fixed (int* pv = values) qsort(pv, (nuint)values.Length, sizeof(int), &Ops.Compare);
// values: 3,7,19,25,42

static unsafe class Ops
{
    public static int Add(int a, int b) => a + b;
    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    public static int Compare(void* a, void* b) => (*(int*)a).CompareTo(*(int*)b);
}
```

Native `qsort` called back into C# through `[UnmanagedCallersOnly]`. Taking
`&obj.Method` is CS8759, calling `Compare` directly CS8901, converting it to a
`Func` CS8902, storing it in a managed `delegate*` CS8786. Measured with
BenchmarkDotNet 0.15.8, .NET 10.0.0, Apple M4 Max (arm64), 1,000 dependent
calls per operation, targets `NoInlining` unless stated:

| Call | Per call |
|---|---|
| direct: inlined / not inlined | about 0.23 / 1.16 ns |
| function pointer / delegate | about 1.19 / 1.26 ns |
| interface (sealed class) | about 1.07 ns |
| function pointer / delegate to an inlinable method | about 1.12 / 1.18 ns |
| native `abs`: `unmanaged[Cdecl]` / plus `SuppressGCTransition` | about 1.00 / 0.76 ns |

The docs call `calli` "more efficient" than a delegate's `Invoke`; it was, by
about 5%, and the interface call beat both. The real gap is inlining: even
aimed at an inlinable method, function pointers and delegates cost five times
an inlined call. `SuppressGCTransition` saved about a quarter on a trivial
native call; its docs allow it only for code that runs under a microsecond and
never blocks, throws or calls back, and list "GC starvation" and "Data
corruption" among the consequences of misuse.

### Verifiability and the safe replacements

The docs call `unsafe` code unverifiable, "code whose safety can't be verified
by .NET tools". In .NET Framework, security-transparent code could not
"contain unsafe or unverifiable code"; the porting docs say code access
security and security transparency are not supported as a boundary on .NET 6+.
Nothing on .NET 10 refused to load the code above: the gate is the compiler
switch.

Most former reasons for pointers have a safe API now: spans and `stackalloc`
into a span, `Buffer`, `MemoryMarshal`, `BinaryPrimitives`, `SearchValues<T>`
and `Vector<T>`, often faster because they are vectorized. Counting `'\n'` in
1 MiB of random bytes with the same benchmark setup:

```csharp
fixed (byte* p = data)                                    // before: about 294 us
    for (byte* cur = p, end = p + data.Length; cur < end; cur++)
        if (*cur == (byte)'\n') count++;

int count = data.AsSpan().Count((byte)'\n');              // after: about 53 us
```

### Where the language is going: C# 15 and .NET 11

The unsafe-code page now describes two models. The *original* one (the default,
and the only one SDK 10.0.100 has) makes pointer features unsafe and puts no
duty on callers of an `unsafe` member. The *updated memory safety model*, which
the docs say "is in preview in C# 15 and .NET 11", makes declaring pointers,
`&`, `fixed`, `stackalloc` to a pointer and `sizeof` legal in safe code, while
`*p`, `->`, `p[i]`, function pointer calls and fixed-buffer indexing still need
`unsafe`. An `unsafe` member becomes *requires-unsafe*: callers need an
`unsafe` context, so the audit duty propagates until a method validates its
inputs behind a safe signature. It is enabled with the .NET 11 SDK and
`LangVersion` `preview`; none of it was compiled here.

## Trade-offs

- **Speed versus guarantees.** Pointers drop bounds checks, type checks and GC
  tracking at once. Measure first: the safe `Count` was about 5.5 times faster.
- **Fixed buffers versus inline arrays.** Fixed buffers match C layouts but are
  unchecked. Prefer `[InlineArray]` unless a native signature needs one.
- **Function pointers versus delegates.** No allocation and a slightly cheaper
  call, but static targets only, no closures and no inlining. They pay off for
  native callbacks and dispatch tables more than for speed.

## Documentation Links

- [Unsafe code, pointer types, and function pointers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/unsafe-code) (doc)
- [Pointer related operators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/pointer-related-operators) (doc)
- [fixed statement, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/fixed) (doc)
- [Function pointers, C# 9.0 feature proposal, dotnet/csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-9.0/function-pointers.md) (doc)
- [Unsafe class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.unsafe) (doc)
- [NativeMemory class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.nativememory) (doc)
