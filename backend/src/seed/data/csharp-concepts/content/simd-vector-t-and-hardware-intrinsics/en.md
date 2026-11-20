---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

SIMD (single instruction, multiple data) lets one CPU instruction work on 4, 8,
16 or more elements at once. .NET exposes it in layers: `Vector<T>` (width
chosen by the hardware), `Vector128<T>`, `Vector256<T>` and `Vector512<T>`
(fixed width, portable), platform intrinsics such as `AdvSimd` (Arm) and `Avx2`
(x86), and `TensorPrimitives` (ready-made loops). It shows that the JIT does
not vectorize a plain loop, how to write sum, count and search kernels with the
remainder handled, and, with numbers, when it pays off and when the framework
already did it (`Sum`, `Count`, `IndexOf`). Everything ran on one Apple M4 Max,
so the x64 paths (AVX2, AVX-512) and the .NET 11 APIs are marked "docs only".

Versions: .NET SDK 10.0.100, runtime 10.0.0, TFM `net10.0`, BenchmarkDotNet
0.15.8, System.Numerics.Tensors 10.0.14, macOS arm64 (Apple M4 Max, 128-bit
NEON). .NET 11 is not installed here.

## Use Cases

- Summing, scaling or comparing large numeric arrays (signals, pixels,
  embeddings) where the loop is the hot path.
- Counting or finding bytes in a buffer, which `IndexOf` and `Count` already do.
- Replacing a branch per element with a mask and `ConditionalSelect`.

## Deep Dive

### What the JIT does not do

A NEON register is 128 bits: 16 bytes, or 4 ints or floats. One
`add v16.4s, v16.4s, v17.4s` adds four ints. The JIT does not turn a scalar
loop into that. `DOTNET_JitDisasm` on a plain int sum shows one element per
iteration, no vector register:

```text
ldr     w4, [x0, x3]      ; load one int
add     w2, w4, w2        ; add it
add     x3, x3, #4        ; next element
sub     w1, w1, #1
cbnz    w1, <loop>
```

The `Vector<int>` version compiles to `ldr q17, [x4]`, a vector `add`, then
`addv s16, v16.4s` to fold the lanes (`DOTNET_TieredCompilation=0
DOTNET_JitDisasm`, .NET 10.0.0). RyuJIT does not auto-vectorize your loops:
vectorized code is code you, or the BCL, wrote with these types.

### What this machine reports

`Vector.IsHardwareAccelerated` and `Vector128.IsHardwareAccelerated` are
`True`; `Vector256` and `Vector512` are `False`. `Vector<int>.Count` is 4 here
(8 on AVX2, 16 on 512-bit, docs only). `AdvSimd.Arm64.IsSupported` is `True`;
`Sse2`, `Avx2` and `Avx512F` are `False`. `Vector256<int>.IsSupported` is `True` although the
width is not accelerated: it runs a slow software fallback
(`Vector512.Create(1)` worked), so choose a path with `IsHardwareAccelerated`,
not `IsSupported`. Calling another architecture's
intrinsic throws: `Avx2.Add` gave `PlatformNotSupportedException`. With
`DOTNET_EnableHWIntrinsic=0` (a test knob) all of them turned `False`, which
tests the scalar fallback.

### `Vector<T>`: sum with a scalar remainder

```csharp
static int SumInt(ReadOnlySpan<int> x)
{
    var acc = Vector<int>.Zero;
    int i = 0, last = x.Length - Vector<int>.Count;
    for (; i <= last; i += Vector<int>.Count) acc += new Vector<int>(x.Slice(i));
    int sum = Vector.Sum(acc);                 // fold the lanes
    for (; i < x.Length; i++) sum += x[i];     // remainder: 1003 % 4 = 3 elements
    return sum;
}
```

For `1..1003` the scalar sum and `SumInt` both gave `503506`. `Vector.Dot` gave
`60` for `{1,2,3,4}` against `{8,7,6,5}`. A comparison returns a mask (all bits
set in the lanes where it is true) and `ConditionalSelect` picks per lane with
no branch: for `v = <-4 -1 2 5>` the mask `GreaterThan(v, 0)` was `<0 0 -1 -1>`
and `ConditionalSelect(mask, v, 0)` gave `<0 0 2 5>`. `EqualsAll` and
`GreaterThanAny` reduce a mask to a `bool`. Element types are the primitive
numbers, not `char` or `bool`.

### `Vector128<T>`: fixed width and a mask you can read

`Vector128<byte>` always holds 16 bytes. `Equals` gives `255` in matching
lanes and `ExtractMostSignificantBits` packs the top bit of each lane into an
integer you can count or scan. For the bytes `0,1,2,3,2,5,2,7,8,9,2,11,12,13,14,2`
against `2` the mask had `255` at lanes 2, 4, 6, 10 and 15, the bits were
`1000010001010100`, popcount 5, first match at lane 2.

`PopCount(bits)` is the count, `TrailingZeroCount(bits)` the first index; .NET
10 also has `Vector128.Count(v, x)` and `IndexOf` (`5` and `2` above).
`Vector128.Create(span)` on a span shorter than the vector throws
`ArgumentOutOfRangeException` (measured); `LoadUnsafe` does not check.

### The dispatch pattern

```csharp
static int CountEqual(ReadOnlySpan<byte> data, byte value)
{
    int count = 0, i = 0;
    if (Vector128.IsHardwareAccelerated && data.Length >= Vector128<byte>.Count)
    {
        var target = Vector128.Create(value);
        for (int last = data.Length - 16; i <= last; i += 16)
            count += (int)uint.PopCount(Vector128.Equals(
                Vector128.Create(data.Slice(i)), target).ExtractMostSignificantBits());
    }
    for (; i < data.Length; i++) if (data[i] == value) count++;   // remainder or all
    return count;
}
```

`IsHardwareAccelerated` is a JIT-time constant, so the untaken branch is
removed. On 1000 random bytes it printed `path Vector128: CountEqual = 3` and,
with `DOTNET_EnableHWIntrinsic=0`, `path scalar: CountEqual = 3`. A `Vector256`
path goes in front with the same guard (false here, so docs only).

### Measured: sum, count, find

Release, BenchmarkDotNet 0.15.8, Apple M4 Max; 1,000,000 ints (0 to 99),
1,000,000 floats and 1 MiB of random bytes. Mean per call.

| Task | Variant | Time |
|---|---|---|
| Sum `int[]` | scalar loop | 256 us |
| | LINQ `Sum()` | 128 us |
| | `Vector<int>` (`Slice`, `LoadUnsafe`) | 129, 125 us |
| | `Vector<int>`, 4 accumulators | 38 us |
| | `TensorPrimitives.Sum` | 123 us |
| Sum `float[]` | scalar loop | 560 us |
| | LINQ `Sum()` | 573 us |
| | `Vector<float>` | 146 us |
| | `TensorPrimitives.Sum` | 128 us |
| Count bytes `== 7` | scalar loop (LINQ `Count`: 296) | 281 us |
| | `Vector128` + `ExtractMostSignificantBits` | 54.6 us |
| | `span.Count(7)` | 54.5 us |
| | `Vector128`, per-lane byte counters | 24.8 us |
| First byte (match at the end) | scalar loop | 268 us |
| | `Vector128` loop | 37.4 us |
| | `span.IndexOf` | 16.7 us |

LINQ `Sum` on `int[]` is already vectorized (level with `Vector<int>`); on
`float[]` it is not. One accumulator is latency-bound, since each add waits for
the last: four independent accumulators were 3.3 times faster than one, 6.7
times faster than the scalar loop, and beat `TensorPrimitives.Sum<int>` here.
`Slice` costs a bounds check per iteration (visible in the disassembly).
`span.Count` matched my `ExtractMostSignificantBits` kernel within noise; a
kernel adding the `0xFF` masks into per-lane byte counters (flushed at most
every 255 vectors) was 2.2 times faster than both on arm64. `span.IndexOf`
beat my loop 2.2 times: for searching, call it.

### Branches and small inputs

Summing only the positive values of 1,000,000 ints in -100..99:

| Variant | Time |
|---|---|
| `if (x > 0) s += x`, random order | 2,382 us |
| same loop, data sorted (predictable branch) | 254 us |
| `Vector<int>` mask + `ConditionalSelect` + widen, random | 125 us |

The branchy loop is 9.4 times slower on random data than on the same values
sorted: the branch predictor failing, not the arithmetic. The masked version
has no data-dependent branch and is 19 times faster. For small `int[]` inputs
(ns per call; below 1 ns is the harness resolution) scalar, `Vector<int>` and
`TensorPrimitives.Sum` took 0.46, 0.49 and 0.78 at N=3 (no vector fits, so all
run scalar code), 4.6, 1.5 and 1.4 at N=16, 16.7, 4.9 and 2.6 at N=64, and 266,
110 and 76 at N=1024.

### Hardware intrinsics: AdvSimd here, Avx2 as a bridge

Intrinsics map one method to one instruction. On Arm64:

```csharp
if (AdvSimd.Arm64.IsSupported)
{
    var total = AdvSimd.Arm64.AddAcross(bytes);     // adds all 16 byte lanes: 93
}
```

That ran here (`93`; `AdvSimd.CompareEqual` gave the same mask as `Vector128.Equals`). `Sse2`, `Avx2`
(256-bit) and `Avx512F` compile on arm64 but `IsSupported` is `False`, so their
bodies are docs only. The SVE class is marked for evaluation: on .NET 10.0.100
using it is compile error `SYSLIB5003`. The doc's advice: the portable
`(vector & mask) == Vector128<byte>.Zero` already becomes `ptest` on x86, so a
hand-written `Sse41.TestZ` is not needed.

### Pitfalls

- **Reading past the end.** The bound `i <= length - Count` plus a scalar
  remainder is the defense. `LoadUnsafe` and pointer loads do not check;
  the doc warns of "non-deterministic results" or `AccessViolationException`.
  The offset is `nuint`: check `Length >= Count` before `Length - Count`.
  Not provoked here (docs only). `LoadAligned` needs aligned memory; the doc
  steers you to `Create(span)` and `LoadUnsafe` (alignment not measured).
- **Float results change.** Vector sums add in another order and float addition
  is not associative. 1003 random floats: scalar `494980.84`, `Vector<float>`
  `494980.53`, `double` accumulator `494980.6481`. For 1,000,000 times `0.1f`
  the scalar loop gave `100958.34` and the vector sum `99759.85` (mathematically
  `100000`). Tests need a tolerance.
- **Branching per element** defeats the lanes; **short inputs** can lose to a
  plain loop. Use masks and measure your sizes.
- **Test every path**: scalar fallback and each width, with lengths around
  multiples of `Count` (I compared 11 lengths from 0 to 100003 with the scalar
  result).

### New in .NET 11: lane construction and composition (docs only)

The .NET 11 runtime page (GA, updated 2026-11-10) lists new methods on
`Vector64/128/256/512<T>` and `Vector<T>`: `CreateGeometricSequence`,
`CreateAlternatingSequence`, `CreateHarmonicSequence`; `Zip`, `ZipLower`,
`ZipUpper`, `Unzip`, `UnzipEven`, `UnzipOdd`; `Concat*` and `Reverse`. Its
examples: `Vector128.CreateGeometricSequence(1, 2)` (lanes 1, 2, 4, 8) and
`Vector128.Zip(a, b)`, which returns the interleaved halves as a tuple. They were approved in dotnet/runtime#122557, merged in
#127690, reverted in #129610 and reapplied in #129627, all on 2026-06-19. None
of this ran here (no .NET 11 SDK). The same page says Arm64 `Count`, `IndexOf`
and `LastIndexOf` no longer go through `ExtractMostSignificantBits` (5 to 50%
faster), consistent with the gap measured above (not re-measured).

### Book vs today

The 2015 `System.Numerics.Vectors` era told you to use `Vector<T>` for
portability and to hand-write SSE/AVX intrinsics with a fallback for speed.
Today the doc calls the fixed-width `Vector128<T>` family "the recommended
starting point for new vectorized algorithms". For sums, counts and searches
you should write none of it: LINQ `Sum` on `int`, `span.Count`, `span.IndexOf`,
`SearchValues<T>` and `TensorPrimitives` already do, and `IndexOf` beat my hand
loop 2.2 times. Hand-write a kernel when a profile points at a loop none of
them covers (a custom predicate, a fused multiply-add, a masked reduction) and
keep the scalar version as the test oracle. "Uses SIMD" is not a speed: 3.3
times separated one accumulator from four.

## Trade-offs

- **Speed versus maintenance.** Each width and instruction set is another path
  to write and test; per-platform intrinsics multiply it.
- **`Vector<T>` versus `Vector128<T>`.** `Vector<T>` adapts its width but the
  algorithm cannot rely on it; `Vector128<T>` is fixed and simpler, but 256-bit
  hardware stays idle without a `Vector256` path.
- **Hand-written versus the BCL.** `span.IndexOf` was 2.2 times faster than my
  loop. Prefer the library until a profile shows a gap; keep a scalar fast path
  for small inputs.
- **Docs-only coverage.** AVX2, AVX-512 and the .NET 11 lane methods were read,
  not run; Apple Silicon numbers do not transfer to x64 servers.

## Documentation Links

- [Use SIMD and hardware intrinsics in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/simd) (doc)
- [Vector<T> struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.vector-1) (doc)
- [Vector128 class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.intrinsics.vector128) (doc)
- [AdvSimd class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.intrinsics.arm.advsimd) (doc)
- [TensorPrimitives class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.tensors.tensorprimitives) (doc)
- [What's new in .NET 11 runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime) (doc)
- [API proposal: more Vector<T> sequence and lane APIs, dotnet/runtime#122557](https://github.com/dotnet/runtime/issues/122557) (doc)
- [Reapply "Add lane construction and composition APIs", dotnet/runtime#129627](https://github.com/dotnet/runtime/pull/129627) (doc)
