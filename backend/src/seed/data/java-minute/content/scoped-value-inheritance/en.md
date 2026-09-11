---
version: 1.0
updatedAt: 2026-09-11
---
## Question

# How does scoped value inheritance work?

## Short Answer

There isn't a short answer to this one.

## Less Short Answer

The term "inheritance" comes from thread-local variables, but scoped values work in a different way. First you bind a scoped value to a value, then you call a method that sees this binding. Now the question is: if this method creates new threads, can those threads see the scoped value binding you defined? The default answer is no.

## The Important Exception

There is one important exception: if this method creates a `StructuredTaskScope`, then the bindings are seen by the subtasks created by that scope. The reason is that none of these subtasks can escape the scope of the original method call, so the bindings cannot escape it either.

## One Last Word

Scoped values are a great replacement for thread-local variables, and you should start using them now. They do not work in the same way, and because you control their life cycle when you bind them, they are much safer for your application.

## References

- [Java Coding Tip #393: How Does Scoped Value Inheritance Work?](https://www.youtube.com/watch?v=FMZfhjprSE8) — video
- [ScopedValue — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html) — doc
- [StructuredTaskScope — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html) — doc
