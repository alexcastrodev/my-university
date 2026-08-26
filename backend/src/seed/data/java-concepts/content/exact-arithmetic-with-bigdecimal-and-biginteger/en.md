---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

`double` and `long` are fast because they are fixed-width binary types — and
that is exactly why they are the wrong tool for money, tax, or cryptographic
keys. A `double` cannot represent `0.1` at all, and a `long` stops at
9,223,372,036,854,775,807. `java.math.BigDecimal` and `java.math.BigInteger`
trade speed for two guarantees the primitives can't give: arbitrary precision
(the number grows as large as memory allows) and *exact* decimal arithmetic
under a rounding policy you choose explicitly rather than one the hardware
picks for you. Both are immutable value-like classes, so every operation
returns a new object.

## Use Cases

- Monetary arithmetic — prices, invoice totals, tax, interest — where a
  fraction of a cent lost to binary rounding is a reconciliation bug or an
  audit finding.
- Anything with a legally mandated rounding rule (banker's rounding, VAT
  rounding, currency-specific scales) that has to be stated in code rather
  than inherited from IEEE 754.
- Cryptography and number theory: RSA-sized integers, modular exponentiation,
  probable-prime generation — all far beyond `long`.
- Parsing and re-emitting decimal data (JSON, CSV, database `NUMERIC`
  columns) without changing the value or its number of decimal places.
- Combinatorics and exact big-integer results — factorials, `2^4096`, large
  Fibonacci numbers — where overflow would silently wrap a `long`.

## Deep Dive

### Why `double` loses decimal values

A `double` stores a binary fraction. `0.1` is a repeating fraction in base 2,
so it is stored as the nearest representable value, and the error is visible
as soon as you add:

```java
System.out.println(0.1 + 0.2);        // 0.30000000000000004
System.out.println(0.1 + 0.2 == 0.3); // false

double sum = 0;
for (int i = 0; i < 10; i++) sum += 0.1;
System.out.println(sum);              // 0.9999999999999999
```

`BigDecimal` stores the digits you actually wrote, in base 10, so the same
computation is exact:

```java
BigDecimal sum = BigDecimal.ZERO;
for (int i = 0; i < 10; i++) sum = sum.add(new BigDecimal("0.1"));
System.out.println(sum);              // 1.0
```

Note `sum = sum.add(...)`. `BigDecimal` is immutable; a bare
`sum.add(x);` computes a value and throws it away:

```java
BigDecimal balance = new BigDecimal("10.00");
balance.add(new BigDecimal("5"));     // return value discarded
System.out.println(balance);          // 10.00
```

### The `BigDecimal` model: unscaled value and scale

A `BigDecimal` is exactly two things: an arbitrary-precision integer
(`unscaledValue()`, a `BigInteger`) and a 32-bit `scale()`. The value is
`unscaledValue × 10^-scale`:

```java
BigDecimal d = new BigDecimal("12.3400");
System.out.println(d.unscaledValue()); // 123400
System.out.println(d.scale());         // 4
System.out.println(d.precision());     // 6  (total significant digits)
```

Scale is part of the object's identity, which is why `equals()` distinguishes
`2.0` from `2.00` while `compareTo()` does not:

```java
BigDecimal a = new BigDecimal("2.0");
BigDecimal b = new BigDecimal("2.00");
System.out.println(a.equals(b));       // false — different scales
System.out.println(a.compareTo(b));    // 0     — same numeric value
```

For money this is a feature: `2.00` carries "two decimal places" as data, and
`setScale()` is how you normalise it.

```java
BigDecimal price = new BigDecimal("2.345");
System.out.println(price.setScale(2, RoundingMode.HALF_UP));   // 2.35
System.out.println(price.setScale(2, RoundingMode.HALF_EVEN)); // 2.34
```

### Constructing one correctly

`new BigDecimal(double)` is exact — and that is the problem. It faithfully
records the binary approximation the `double` already holds, all 55 digits of
it:

```java
System.out.println(new BigDecimal(0.1));
// 0.1000000000000000055511151231257827021181583404541015625

System.out.println(BigDecimal.valueOf(0.1));   // 0.1
System.out.println(new BigDecimal("0.1"));     // 0.1
```

`BigDecimal.valueOf(double)` routes through `Double.toString()`, so it gives
the short decimal a human would have typed. The `String` constructor never
involves a `double` at all — prefer it whenever the value originates as text
(a request body, a CSV cell, a config file). `BigInteger` has the same split:
`BigInteger.valueOf(long)` for values that fit, the `String` constructor for
anything bigger.

```java
BigInteger big = new BigInteger("3419229223372036854775807");
System.out.println(Long.MAX_VALUE);   // 9223372036854775807
System.out.println(big);              // 3419229223372036854775807
```

### Division forces you to name a rounding policy

`add`, `subtract`, and `multiply` always have an exact decimal answer, so the
one-argument forms are safe. Division often doesn't, and the one-argument
`divide()` refuses to guess:

```java
BigDecimal.ONE.divide(new BigDecimal("3"));
// ArithmeticException: Non-terminating decimal expansion;
// no exact representable decimal result.
```

Supply a target scale plus a `RoundingMode`, or a `MathContext` that fixes
the number of significant digits:

```java
BigDecimal.ONE.divide(new BigDecimal("3"), 5, RoundingMode.HALF_UP);
// 0.33333

BigDecimal.ONE.divide(new BigDecimal("3"), MathContext.DECIMAL64);
// 0.3333333333333333
```

`RoundingMode` (in `java.math`, shared with `setScale`) has eight constants:
`UP`, `DOWN`, `CEILING`, `FLOOR`, `HALF_UP`, `HALF_DOWN`, `HALF_EVEN`, and
`UNNECESSARY`. `HALF_EVEN` is banker's rounding — it rounds ties toward the
even neighbour so that a long run of roundings doesn't drift upward, which is
why it is the default in every `MathContext` preset except `UNLIMITED`.
`UNNECESSARY` asserts that no rounding should be needed and throws if it is:

```java
new BigDecimal("2.5").setScale(0);   // ArithmeticException: Rounding necessary
```

`MathContext` bundles a precision (significant digits) with a
`RoundingMode`, and every arithmetic method has an overload taking one:
`DECIMAL32`, `DECIMAL64`, `DECIMAL128` mirror the IEEE 754 decimal formats
(7, 16, and 34 digits, all `HALF_EVEN`), and `MathContext.UNLIMITED` means
"exact, or throw".

### `BigInteger`: unbounded integers, modular and prime arithmetic

`BigInteger` covers the integer operators plus the number theory that
public-key cryptography needs:

```java
BigInteger.valueOf(2).pow(4096).bitLength();          // 4097
BigInteger.valueOf(48).gcd(BigInteger.valueOf(18));   // 6
BigInteger.valueOf(1000).sqrt();                      // 31 (floor)
BigInteger.valueOf(4).modPow(BigInteger.valueOf(13),
                             BigInteger.valueOf(497)); // 445
```

`modPow` is the operation behind RSA, and it is not the same as
`pow().mod()` — it never materialises the astronomically large intermediate.
Primality is probabilistic: `isProbablePrime(certainty)` and
`nextProbablePrime()` may report a composite as prime with probability less
than `1 - 1/2^certainty`, while `probablePrime(bitLength, random)` generates a
fresh candidate of a given size:

```java
BigInteger p = BigInteger.probablePrime(2048, new SecureRandom());
System.out.println(p.isProbablePrime(100));   // true
```

Constants `ZERO`, `ONE`, `TWO`, and `TEN` exist on both classes
(`BigInteger.TWO` since Java 9, `BigDecimal.TWO` since Java 19), and both
implement `Comparable`, so they sort and work in a `TreeMap` without a
comparator.

### Coming back down without losing data silently

The `xxxValue()` methods are narrowing conversions and they are quiet about
it. A `BigInteger` past `Double.MAX_VALUE` becomes `Infinity`; a
`BigDecimal` with a fraction is truncated:

```java
System.out.println(BigInteger.TEN.pow(400).doubleValue()); // Infinity
System.out.println(new BigDecimal("2.99").intValue());     // 2
```

The `...Exact` variants — `intValueExact()`, `longValueExact()`,
`toBigIntegerExact()` — fail loudly instead:

```java
new BigDecimal("2.50").intValueExact();
// ArithmeticException: Rounding necessary
```

Printing has a matching trap: `toString()` may switch to scientific notation,
`toPlainString()` never does.

```java
BigDecimal x = new BigDecimal("600.0").stripTrailingZeros();
System.out.println(x);                  // 6E+2
System.out.println(x.toPlainString());  // 600
```

### Where `java.math` stops: no complex, no rational type

`java.math` is only two numeric classes. There is no built-in complex,
rational, matrix, or unsigned type — for those you either write a small value
class or take a library dependency (Apache Commons Math's `Complex`,
`BigFraction`). Since Java 16, a `record` makes the hand-rolled version
nearly free, and immutability comes for free with it:

```java
public record Complex(double re, double im) {
    public Complex plus(Complex o)  { return new Complex(re + o.re, im + o.im); }
    public Complex times(Complex o) {
        return new Complex(re * o.re - im * o.im, re * o.im + im * o.re);
    }
    public double magnitude() { return Math.hypot(re, im); }
}

var c = new Complex(3, 5).times(new Complex(2, -2));
System.out.println(c);            // Complex[re=16.0, im=4.0]
```

Note the `plus`/`times` naming: Java has no operator overloading, so every
one of these types — including `BigDecimal` — is used through method calls,
and `a.add(b).multiply(c)` is as good as the syntax gets.

## Trade-offs

- **Correctness costs speed and allocation** — every operation allocates a
  new object and runs in software instead of one CPU instruction, so
  `BigDecimal` is orders of magnitude slower than `long` or `double`. High-volume
  money code often stores integer minor units (cents) in a `long` and reaches
  for `BigDecimal` only at the boundaries where scaling and rounding happen.
- **`equals()` and `compareTo()` disagree, so hash-based and sorted
  collections disagree too** — `BigDecimal` deliberately breaks the usual
  "consistent with equals" expectation, and `2.0` versus `2.00` is a silent
  duplicate key in a `HashMap`.
  ```java
  var values = List.of(new BigDecimal("2.0"), new BigDecimal("2.00"));
  new HashSet<>(values).size();   // 2  — equals() sees two values
  new TreeSet<>(values).size();   // 1  — compareTo() sees one
  ```
- **`new BigDecimal(double)` imports the very error you switched away from**
  — the constructor is exact about a value that was already wrong, so a
  `double` anywhere upstream of the conversion has already lost the precision.
  ```java
  new BigDecimal(1.1).multiply(new BigDecimal("3"));
  // 3.300000000000000266453525910037569701671600341796875
  new BigDecimal("1.1").multiply(new BigDecimal("3"));  // 3.3
  ```
- **Unrounded division throws instead of approximating** — safer than a wrong
  answer, but it means every `divide()` in the codebase has to make a policy
  decision, and a missing overload is a production `ArithmeticException`
  rather than a compile error.
  ```java
  new BigDecimal("10").divide(new BigDecimal("3")); // ArithmeticException
  ```
- **Immutability makes discarded results invisible** — nothing warns when a
  return value is dropped, unlike the compile error you would get from
  misusing an assignment operator.
  ```java
  BigDecimal total = new BigDecimal("0.00");
  total.add(new BigDecimal("9.99"));   // silently does nothing
  ```
- **Scale is unbounded, and so is cost** — `BigInteger` grows with the value
  and `BigDecimal`'s precision grows with every `multiply`, so chained exact
  arithmetic on user-supplied input can consume surprising amounts of memory
  and CPU. `MathContext` on each operation, or a periodic `setScale()`, caps it.
- **Readability suffers** — a formula written in `BigDecimal` method calls is
  materially harder to read and review than the same formula in operators,
  which is a real argument for keeping the exact-arithmetic layer thin and
  well-tested rather than spreading it through the domain model.

## Documentation Links

- [BigDecimal — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html) — doc
- [BigInteger — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigInteger.html) — doc
- [MathContext — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/MathContext.html) — doc
- [RoundingMode — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/RoundingMode.html) — doc
- [Double — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Double.html) — doc
