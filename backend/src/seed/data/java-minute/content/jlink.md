---
version: 1.0
updatedAt: 2026-08-05
---
## Question

# What is JLink?

## Short Answer

`jlink` is a standard JDK tool that builds a custom runtime image containing only the modules your application needs.

## What It Is

The JDK gives you two tools that work together for packaging and distribution:

- `jlink` creates a trimmed runtime image.
- `jpackage` wraps that image into an installer or native package.

`jlink` works with modular applications. It starts from your application module, resolves its required modules, and then assembles a runtime image that includes only that module graph. That means you get the JDK modules you actually use, instead of shipping the whole JDK.

In practice, that image already contains a runnable `java` launcher and the platform modules your app depends on, so the target machine does not need a separate full JDK install.

One important detail: modules are included at the module level, not class-by-class. So if you depend on a large module just to use one class, you may still pull in more than you expected. `jlink` is great at trimming the JDK, but it cannot trim inside a module.

If your application is not modular, `jlink` is not the right tool. It needs named modules so it can resolve the dependency graph before building the image.

## Practical Example

```bash
jlink \
  --module-path $JAVA_HOME/jmods:mods \
  --add-modules com.myapp \
  --output myapp-runtime
```

This command tells `jlink` where to find the platform modules (`$JAVA_HOME/jmods`) and your application modules (`mods`), which root module to include, and where to write the custom runtime image.

From there, `jlink` walks the module graph:

- it starts at `com.myapp`;
- adds every transitive `requires` dependency;
- keeps only the JDK modules that are actually needed;
- writes the finished image to `myapp-runtime`.

If you add `jpackage` afterward, you can turn that image into a platform-specific installer instead of shipping a raw directory.

## Solution and Conclusion

Use `jlink` when you want to distribute a modular application with a smaller, self-contained runtime. Then use `jpackage` if you want to turn that runtime into an installer for Windows, macOS, or Linux.

Think of the pipeline like this:

1. compile your module;
2. package it as a modular JAR;
3. link a custom runtime with `jlink`;
4. optionally wrap that runtime with `jpackage`.

So the short version is: `jlink` trims the runtime, `jpackage` ships it.

## References

- [Java Coding Tip #383: JLink](https://youtube.com/shorts/bJ3GDdTmRJc?is=FoMccFwLU_1L-t8D) — video
- [jlink — Java SE 25 Tool Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html) — doc
- [jpackage — Java SE 25 Tool Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jpackage.html) — doc
