---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

Understand how the JVM actually executes an expression like `a + b`: bytecode is a **stack machine** instruction set, not a register machine — every arithmetic, comparison, or conversion instruction pops its operands off the top of the `operand stack` and pushes the result back. Recognize what each instruction mnemonic operates on from its prefix letter (`i`, `l`, `f`, `d`, ...), and know where the JVM's arithmetic quietly diverges from what the Java source promised — silent truncation on narrowing conversions, and two different comparison opcodes needed just to handle `NaN` correctly.

## Use Cases

- Reading `javap -c` output line by line to see exactly which stack operations a line of Java source compiled to.
- Explaining why a narrowing cast like `(int) someHugeDouble` never throws, but silently returns a clamped or wrapped value.
- Understanding why the compiler emits `dcmpg` for one comparison operator and `dcmpl` for another on the exact same two `double`s — it's not arbitrary, it's how `NaN` is made to compare as "not greater" and "not less" simultaneously.
- Recognizing that `boolean` has no dedicated bytecode instructions at all — `&&`, `||`, and `Boolean` arithmetic compile down to plain `int` opcodes.

## Deep Dive

### The operand stack and the mnemonic naming convention

The JVM has no general-purpose registers for arithmetic. Every instruction that computes something pulls its inputs from the **operand stack** — a per-frame stack the `Code` attribute declares a maximum depth for (`stack=2` in the example below) — and pushes its result back onto it.

Bytecode mnemonics encode the type they operate on as a prefix letter:

| prefix | type | example |
|---|---|---|
| `i` | `int` (also `boolean`, `byte`, `short`, `char` at runtime) | `iadd`, `iload` |
| `l` | `long` | `ladd`, `lload` |
| `f` | `float` | `fadd`, `fload` |
| `d` | `double` | `dadd`, `dload` |
| `a` | object reference | `aload`, `areturn` |

Given:

```java
public class Arith {
    public static void main(String[] args) {
        int a = 5;
        int b = 7;
        int result = a + b;
        System.out.println("Result: " + result);
    }
}
```

`javap -c Arith.class` shows the addition as three stack operations, not one:

```
5: iload_1        // push local variable 'a' onto the stack
6: iload_2        // push local variable 'b' onto the stack
7: iadd            // pop both, push their sum
8: istore_3        // pop the sum, store it into local variable 'result'
```

`iadd` never sees `a` or `b` as named variables — it only ever sees "the top two values on the stack," which is exactly what makes the instruction set compact: one `iadd` opcode handles every possible pair of `int` inputs.

### Arithmetic instructions: add, sub, mul, div, rem, neg

Each arithmetic operation exists once per numeric type, following the same prefix convention — there's no single generic "add" instruction the JVM type-checks at runtime:

```
iadd / ladd / fadd / dadd    →  addition
isub / lsub / fsub / dsub    →  subtraction (second value subtracted from first)
imul / lmul / fmul / dmul    →  multiplication
idiv / ldiv / fdiv / ddiv    →  division (first divided by second)
irem / lrem / frem / drem    →  remainder of division
ineg / lneg / fneg / dneg    →  negation (sign flip)
```

`idiv` and `irem` are the only arithmetic instructions that can throw at runtime — dividing by zero with integer types raises `ArithmeticException`, while the same operation on `fdiv`/`ddiv` produces `Infinity` or `NaN` instead, per IEEE 754.

### Bitwise, shift, and boolean-as-int

Bitwise (`iand`, `ior`, `ixor` and their `l`-prefixed long counterparts) and shift instructions (`ishl`, `ishr`, `iushr`, `lshl`, `lshr`, `lushr`) only exist for integer types — there's no `fand` or `dshl`, since bitwise manipulation of floating-point bit patterns isn't a source-level operation.

`boolean` has **no dedicated bytecode instructions whatsoever**. The JVM represents `true`/`false` as `int` `1`/`0`, so Java's logical operators reuse the integer instruction set:

```java
boolean flag = x && y;   // compiles using iand-family logic, not a distinct "boolean and"
```

This is why decompiled or hand-written bytecode can't distinguish "an `int` holding `1`" from "a `boolean` holding `true`" — the distinction exists only in the constant pool's method/field descriptors (`Z` for `boolean` vs `I` for `int`), not in the arithmetic itself.

### Comparison instructions and NaN

`lcmp` (long), `fcmpg`/`fcmpl` (float), and `dcmpg`/`dcmpl` (double) all reduce a comparison to a single `int` on the stack: `1`, `0`, or `-1` for greater, equal, or less. `long` only needs one variant because integers have no `NaN`. Floating-point types need **two**, because `NaN` compares as neither greater than, less than, nor equal to anything — including itself — and the *g*/*l* suffix decides what a `NaN` operand evaluates to:

```java
public static boolean isGreater(double x, double y) { return x > y; }  // uses dcmpl
public static boolean isLess(double x, double y)    { return x < y; }  // uses dcmpg
```

```
public static boolean isGreater(double, double);
    dload_0
    dload_2
    dcmpl          // NaN → -1, so the following ifle branches to "false"
    ifle          10
    ...

public static boolean isLess(double, double);
    dload_0
    dload_2
    dcmpg          // NaN → 1, so the following ifge branches to "false"
    ifge          10
    ...
```

The compiler always pairs `>`/`>=` with `cmpl` and `<`/`<=` with `cmpg`, specifically so that any comparison involving `NaN` evaluates to `false`, matching IEEE 754 semantics rather than "greater or less by default."

### Value conversions and precision loss

Widening conversions (`i2l`, `i2f`, `i2d`, `l2f`, `l2d`, `f2d`) never lose information and never throw. Narrowing conversions (`l2i`, `f2i`, `f2l`, `d2i`, `d2l`, `d2f`, and the small-integer trio `i2b`, `i2s`, `i2c`) can lose information — and do so **silently**, with no exception:

```java
double big = 1e20;
int truncated = (int) big;        // d2i
byte narrowed = (byte) 200;       // i2b
```

```
ldc2_w   #7      // double 1.0E20d
dstore_1
dload_1
d2i               // out of int range → clamps to Integer.MAX_VALUE, not an exception
istore_3
...
sipush  200
istore  4
iload   4
i2b               // 200 doesn't fit in a signed byte → wraps to -56
istore  5
```

`truncated` prints `2147483647` (`d2i` on an out-of-range value clamps to the nearest representable `int`, per the JVM spec — it never wraps or throws), while `narrowed` prints `-56` (`i2b` truncates to the low 8 bits and reinterprets the sign bit, so `200` wraps around to a negative `byte`). Both are legal results of a legal cast — the type system permitted the narrowing, so nothing downstream is notified that data was lost.

## Trade-offs

- **Stack-based instructions vs. a register machine** — every operand has to be explicitly pushed before an operation and the result explicitly stored afterward (four instructions for one addition, as shown above), trading a larger instruction count for a smaller, simpler instruction set that's trivial to verify and doesn't need register-allocation info baked into the class file.
- **Narrowing conversions never throw** — `d2i`, `i2b`, and friends always produce *some* value rather than failing, which means a bad cast is a silent correctness bug instead of a stack trace pointing at the cast site.

```java
byte b = (byte) 200;   // -56, no exception — verify ranges before narrowing, don't rely on a cast to catch it
```

- **`NaN` correctness costs an extra opcode per comparison type** — `fcmpg`/`fcmpl` and `dcmpg`/`dcmpl` exist in pairs purely so the compiler can make every comparison operator behave correctly when an operand is `NaN`, at the cost of the compiler having to pick the right one for each operator rather than reusing a single `cmp` instruction.
- **`boolean` is `int` under the hood, with no runtime distinction** — this keeps the instruction set small (no separate boolean arithmetic family to specify and verify), but it also means the bytecode verifier's guarantees about `boolean` values rely entirely on descriptor-level type checking (the `Z` descriptor), not on any bytecode-level tag distinguishing it from `int`.

## Documentation Links

- [Chapter 6: The Java Virtual Machine Instruction Set — Java Virtual Machine Specification, SE 25](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-6.html) — doc
- [javap — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html) — doc
- [Mastering the Java Virtual Machine — Chapter 3 source code (Packt Publishing)](https://github.com/PacktPublishing/Mastering-the-Java-Virtual-Machine/tree/main/chapter-03) — doc
