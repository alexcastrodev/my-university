---
version: 1.0
updatedAt: 2026-08-07
---
## Question

# How can you use preview features?

## Short Answer

There are two options for that: one for the compiler and one for the JVM.

## What It Is

You need to activate preview features at two levels.

**Compiler level.** Add `--enable-preview`, and then specify one of:

- `--source`, followed by the version of the source you're using — any version between 8 and the version of the JDK you're using; or
- `--target`, followed by the version of the bytecode you want to generate — again, between 8 and the version of the JDK you're using.

**Runtime level.** Add the same `--enable-preview` option to the `java` command, so the JVM knows you want to run code that uses preview features.

So you cannot use preview features by accident. You need to tell the compiler you want to activate them, and at runtime you need to tell the JVM you want to run them.

## Practical Example

```bash
javac --enable-preview --source 25 Main.java
java --enable-preview Main
```

## Solution and Conclusion

This preview feature mechanism is useful because you can activate preview features on demand, without downloading a separate build of the JDK. That makes it easy to try them out and give feedback on the OpenJDK mailing lists if you feel something is missing or wrong — which is something you should definitely do.

## References

- [Java Coding Tip #384: Using Preview Features](https://www.youtube.com/watch?v=2gmWx0-zqkk) — video
- [javac — Java SE 25 Tool Reference (--enable-preview)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html) — doc
- [java — Java SE 25 Tool Reference (--enable-preview)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) — doc
