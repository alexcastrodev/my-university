---
version: 1.0
updatedAt: 2026-07-18
---
## Question

# How can you add a snippet of code in your Javadoc?

## Short Answer

Use the `{@snippet}` tag, introduced by JEP 413. It renders code inline in your Javadoc with proper formatting and, unlike the old `<pre>{@code ...}</pre>` trick, doesn't require you to manually escape HTML characters like `<`, `>`, and `&`.

## What It Is

Before JEP 413, embedding a code example in Javadoc meant wrapping it in `<pre>{@code ... }</pre>` and hand-escaping any HTML-sensitive characters in the snippet. It worked, but it was fragile and easy to get wrong for anything beyond a trivial one-liner.

`{@snippet}` replaces that pattern with a dedicated tag that handles escaping for you and supports both inline snippets and external snippet files.

## Inline Snippets

The simplest form embeds the code directly in the Javadoc comment:

```java
/**
 * {@snippet :
 * List<String> names = List.of("Ana", "Bruno");
 * names.forEach(System.out::println);
 * }
 */
void printNames(List<String> names) { ... }
```

No escaping needed — `<`, `>`, and `&` are written as normal Java syntax.

## External Snippet Files

For longer or reusable examples, you can pull the snippet from an external file using `snippet-files`, a directory of source files kept alongside your Javadoc sources. Reference a file by name, or a specific region within it using markup comments (`@start region=...` / `@end`):

```java
/**
 * {@snippet file="Example.java" region="main"}
 */
```

Tell the `javadoc` tool where to find these files with the `--snippet-path` option.

## Why It Matters

Keeping examples as separate, real source files means they can actually be compiled and tested, so they don't silently rot out of sync with the API they're documenting — a common problem with code embedded as plain text inside comments.

## Solution and Conclusion

Prefer `{@snippet}` over the old `<pre>{@code}</pre>` pattern for any new Javadoc: it's cleaner for inline examples and, via `snippet-files` and `--snippet-path`, lets you keep longer examples as verifiable external source files.

## References

- [Java Coding Tip #374: Javadoc Code Snippets](https://www.youtube.com/shorts/ZNe_-Z1qxp8) — video
- [JEP 413: Code Snippets in Java API Documentation](https://openjdk.org/jeps/413) — doc
- [javadoc — Java SE 25 Tool Reference (--snippet-path option)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javadoc.html) — doc
