---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

Modern CPUs can apply one arithmetic instruction to several numbers at once —
SIMD, *Single Instruction Multiple Data*, exposed as SSE/AVX on x86-64 and
Neon/SVE on AArch64. HotSpot's C2 compiler already auto-vectorises some loops,
but unpredictably: a small refactor can silently turn a vectorised loop back
into a scalar one. The Vector API (`jdk.incubator.vector`) makes the
vectorisation *explicit* — you write the loop in terms of fixed-width vectors
and the runtime maps each operation onto the best instruction the current CPU
has, falling back to a software implementation where it has none. It is still
an incubator module — shipped as `jdk.incubator.vector` since JDK 16, on its
eleventh round in JDK 26 and a twelfth targeted at JDK 27 — so it needs
`--add-modules` to compile and run, and its API can still change between
releases.

## Use Cases

- Numeric kernels over large `float`/`double`/`int` arrays: dot products,
  matrix multiplication, FIR filters, distance computations in vector search.
- Image and signal processing — per-pixel or per-sample arithmetic that is
  identical for every element.
- Machine-learning inference and similarity scoring in pure Java, where a
  4x–8x throughput win on the hot loop is the whole point (Lucene's vector
  search uses this API for exactly that).
- Bulk data transforms: character encoding/decoding, checksums, parsing, and
  compression inner loops that scan byte arrays.
- Cases where auto-vectorisation is measurably not kicking in and you need a
  guarantee rather than a hope.

## Deep Dive

### Enabling the incubator module

The package is not in `java.base` and incubator modules are not resolved by
default, so the module has to be added at *both* compile and run time.
Without the flag it isn't even a missing-class error — the package is
invisible:

```
$ java Kernel.java
Kernel.java:1: error: package jdk.incubator.vector is not visible
import jdk.incubator.vector.*;
                    ^
  (package jdk.incubator.vector is declared in module jdk.incubator.vector,
   which is not in the module graph)
```

```
$ java --add-modules jdk.incubator.vector Kernel.java
WARNING: Using incubator modules: jdk.incubator.vector
```

Per JEP 11 (Incubator Modules), incubator modules are deliberately excluded
from the default root set for code on the class path, and a warning is issued
whenever one is resolved — at compile, link, and run time. The compile-time
warning can be suppressed; the run-time one cannot. An application that is
itself a named module can declare `requires jdk.incubator.vector;` in its
`module-info.java` and skip the flag entirely; class-path applications have no
such option.

### Species: element type plus shape

A **lane** is one element position inside a vector. A `VectorShape` is the
total bit width (`S_128_BIT`, `S_256_BIT`, `S_512_BIT`, `S_Max_BIT`), and the
pair (element type, shape) is a **species**, represented by
`VectorSpecies<E>`. There is one concrete vector class per numeric primitive
except `char`: `ByteVector`, `ShortVector`, `IntVector`, `LongVector`,
`FloatVector`, `DoubleVector`.

Always hold the species in a `static final` field — the JIT constant-folds the
lane count out of the loop only if it is a compile-time constant:

```java
import jdk.incubator.vector.*;

static final VectorSpecies<Double> SPECIES = DoubleVector.SPECIES_PREFERRED;

System.out.println(SPECIES);                 // Species[double, 2, S_128_BIT]
System.out.println(SPECIES.length());        // 2
System.out.println(SPECIES.vectorShape());   // S_128_BIT
```

`SPECIES_PREFERRED` asks the runtime for the widest shape that is actually
fast on this machine. The output above is from an AArch64 machine with 128-bit
Neon registers — two `double` lanes. The identical source on an AVX2 x86-64
machine prints `Species[double, 4, S_256_BIT]`, and on AVX-512 hardware, eight
lanes. **The lane count is a property of the host, not of your code.**

### The canonical loop: `loopBound` plus a scalar tail

Compute `a[i] * x^2 + 2 * b[i]` over two arrays. The scalar version:

```java
static void scalar(double[] a, double x, double[] b, double[] out) {
    for (int i = 0; i < a.length; i++) {
        out[i] = a[i] * x * x + b[i] * 2;
    }
}
```

The vector version processes `SPECIES.length()` elements per iteration.
`SPECIES.loopBound(n)` returns the largest multiple of the lane count that is
`<= n`, and whatever is left over is finished by an ordinary scalar loop:

```java
static void vector(double[] a, double x, double[] b, double[] out) {
    int i = 0;
    int upperBound = SPECIES.loopBound(a.length);
    for (; i < upperBound; i += SPECIES.length()) {
        DoubleVector va = DoubleVector.fromArray(SPECIES, a, i);
        DoubleVector vb = DoubleVector.fromArray(SPECIES, b, i);
        va.mul(x * x)                 // scalar broadcast into every lane
          .add(vb.mul(2))
          .intoArray(out, i);
    }
    for (; i < a.length; i++) {       // tail: a.length % lanes elements
        out[i] = a[i] * x * x + b[i] * 2;
    }
}
```

`fromArray` loads lanes from an array at an offset, `intoArray` stores them
back. Every arithmetic method returns a *new* vector — `Vector` is immutable,
so `va.mul(...)` never modifies `va`.

The tail loop is not optional. Dropping it leaves `a.length % SPECIES.length()`
elements untouched, and because the lane count varies per machine, that bug
can be invisible on your laptop and wrong in production.

### Masks: one loop instead of two

A `VectorMask<E>` is a per-lane boolean. `SPECIES.indexInRange(offset, limit)`
builds the mask that is true exactly for the lanes still inside the array, and
the masked `fromArray`/`intoArray` overloads skip the rest — so the tail
disappears:

```java
static void masked(double[] a, double x, double[] b, double[] out) {
    for (int i = 0; i < a.length; i += SPECIES.length()) {
        VectorMask<Double> m = SPECIES.indexInRange(i, a.length);
        DoubleVector va = DoubleVector.fromArray(SPECIES, a, i, m);
        DoubleVector vb = DoubleVector.fromArray(SPECIES, b, i, m);
        va.mul(x * x).add(vb.mul(2)).intoArray(out, i, m);
    }
}
```

With 10 elements and 2 lanes each mask prints `Mask[TT]`; with 4 lanes the
last one is `Mask[TT..]`. Masking costs a little on hardware without native
predication, which is why the explicit tail loop is still the common shape in
performance-critical code.

Masks are also how conditionals are expressed — there is no `if` inside a
lane. Comparisons produce masks, and `blend` selects per lane:

```java
VectorMask<Double> smaller = vb.lt(va);          // lane-wise vb < va
DoubleVector mins = va.blend(vb, smaller);       // take vb where mask is true
```

`add`, `sub`, `mul`, `div`, `neg`, `abs`, `min`, `max`, `eq`, and `lt` exist as
named methods. There is deliberately no `gt()` — the general form covers it:

```java
VectorMask<Double> bigger = vb.compare(VectorOperators.GT, va);
DoubleVector fused = va.lanewise(VectorOperators.FMA, vb, vb); // va*vb + vb
```

`lanewise(op, ...)` with a `VectorOperators` constant is the escape hatch for
every operation without a dedicated method — `SQRT`, `POW`, `BIT_COUNT`,
`AND`, `LSHL`, and dozens more.

### Reductions: many lanes to one value

`reduceLanes` collapses a vector into a single scalar. Summing an array means
accumulating into a vector and reducing once at the end, not once per
iteration:

```java
static final VectorSpecies<Float> S = FloatVector.SPECIES_PREFERRED;

static float sum(float[] xs) {
    FloatVector acc = FloatVector.zero(S);
    int i = 0;
    for (; i < S.loopBound(xs.length); i += S.length()) {
        acc = acc.add(FloatVector.fromArray(S, xs, i));
    }
    float total = acc.reduceLanes(VectorOperators.ADD);
    for (; i < xs.length; i++) total += xs[i];
    return total;
}
```

`reduceLanes` also takes `MUL`, `MIN`, `MAX`, `AND`, `OR`, `XOR`, and a masked
overload. `Vector` further offers `slice`, `rearrange`, `shuffle`,
`reinterpretShape`, and `convert` for reshaping data between species — the
`Vector` Javadoc is the practical reference.

## Trade-offs

- **Incubator status is a real dependency risk** — the module has been
  incubating since JDK 16 (JEP 338), with a twelfth round targeted at JDK 27
  (JEP 537), waiting on Project Valhalla value types before it can be promoted
  to preview. Method signatures have changed between rounds, and the run-time
  warning cannot be suppressed. Because standard modules are forbidden from
  declaring `requires transitive` on an incubator module, a library that
  exposes vector types in its public API pushes the dependency — and, for
  class-path consumers, the `--add-modules` flag — onto every one of its users.
- **Results are numerically equivalent but not bit-identical to the scalar
  loop** — floating-point addition isn't associative, so summing in lanes and
  reducing gives a different answer than summing left to right. Reproducible
  and unavoidable:
  ```java
  float[] x = new float[1 << 16];
  for (int i = 0; i < x.length; i++) x[i] = 1.0f / (i + 1);
  // scalar left-to-right sum: 11.667428
  // vector accumulate + reduceLanes(ADD): 11.667574
  ```
  Never assert bit equality against a scalar reference; compare within an
  epsilon.
- **The lane count is a property of the machine, not the program** — the same
  bytecode runs 2, 4, 8, or 16 lanes wide, so any logic that assumes a lane
  count, and any tail handling you skip, breaks on different hardware.
  ```java
  // AArch64/Neon: Species[double, 2, S_128_BIT]
  // x86-64/AVX2:  Species[double, 4, S_256_BIT]
  DoubleVector.SPECIES_PREFERRED.length();  // 2 or 4 or 8
  ```
- **The performance win depends entirely on the JIT** — vector objects are
  only free if C2 intrinsifies the operations and scalarises the object away.
  In the interpreter, under `-Xint`, before the loop is hot, or when the
  species is not a `static final` constant, the same code can be *slower* than
  scalar. It pays off in long-running hot loops over large arrays and nowhere
  else.
- **Small datasets lose** — setup, mask construction, and the tail loop are
  fixed overhead. Below roughly a few hundred elements, or for a loop executed
  a handful of times, the scalar version usually wins and is certainly simpler.
- **Verbosity against uncertainty** — the scalar loop is one line; the vector
  version is a dozen, plus a species field. The trade is explicit,
  predictable vectorisation versus terse code that *might* be
  auto-vectorised — which means the only honest way to choose is to benchmark
  both (JMH) rather than reason about it.
- **Everything is a method call, and mixed species don't type-check** —
  `a * b + c` becomes `a.mul(b).add(c)`, which reads poorly for a long
  formula, and operations require both operands to share a species, so
  combining a 256-bit `FloatVector` with a 128-bit one needs an explicit
  reshape rather than an implicit conversion.

## Documentation Links

- [jdk.incubator.vector package summary — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.incubator.vector/jdk/incubator/vector/package-summary.html) — doc
- [Vector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.incubator.vector/jdk/incubator/vector/Vector.html) — doc
- [VectorSpecies — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.incubator.vector/jdk/incubator/vector/VectorSpecies.html) — doc
- [VectorOperators — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.incubator.vector/jdk/incubator/vector/VectorOperators.html) — doc
- [JEP 537: Vector API (Twelfth Incubator)](https://openjdk.org/jeps/537) — doc
- [JEP 338: Vector API (Incubator)](https://openjdk.org/jeps/338) — doc
