---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

JShell is the command-line REPL (Read-Evaluate-Print Loop) that ships with the JDK since JDK 9 (JEP 222): it lets you type an expression, a statement, a method, or even a class directly at a prompt and see it evaluated immediately, without writing a class with a `main` method, saving a `.java` file, or compiling anything first.

## Use Cases

- Trying out an unfamiliar API method (does `String.repeat()` trim whitespace? what does `List.of()` do with a `null`?) in seconds, without creating a project.
- Testing a regular expression or a stream pipeline against sample data before pasting it into real code.
- Prototyping a small algorithm or a new class/interface interactively, keeping state across snippets while it takes shape.
- Teaching or learning a language feature: showing exactly what an expression evaluates to, one line at a time.
- Quickly checking the behavior of a checked exception, a numeric conversion, or an edge case without the ceremony of `try`/`catch` and a `main` method.

## Deep Dive

### Starting a session and evaluating a bare statement

JShell is a command-line tool: run `jshell` and it drops into an interactive prompt.

```
$ jshell
|  Welcome to JShell -- Version 25
|  For an introduction type: /help intro

jshell> System.out.println("This is a simple Java program.");
This is a simple Java program.
```

No `class`, no `public static void main(String[] args)` — JShell wraps every snippet in a synthetic class and method behind the scenes, so the same code that runs in JShell is still valid Java, just missing the framework `javac` would otherwise require.

### Variables and state across snippets

Declaring a variable at the prompt adds it as a `static` field of that synthetic class, and its value persists across snippets:

```
jshell> int count;
count ==> 0

jshell> count = 10;
count ==> 10

jshell> System.out.println("Reciprocal: " + 1.0 / count);
Reciprocal: 0.1
```

JShell also accepts multiline constructs, prompting with `...>` until the snippet is syntactically complete:

```
jshell> for (count = 0; count < 3; count++)
   ...> System.out.println(count);
0
1
2
```

### Evaluating a bare expression: the `$1`, `$2` ... variables

An expression doesn't need a surrounding statement at all — JShell evaluates it and stores the result in an implicit numbered variable:

```
jshell> 3.0 / 16.0
$1 ==> 0.1875

jshell> $1 * 2
$2 ==> 0.375
```

`$1`, `$2`, ... behave like any other variable: they can be reassigned, printed, or used inside a later expression, which makes chaining quick calculations without naming everything painless.

### Methods, classes, and interfaces without the boilerplate

A stand-alone method becomes a `static` method of the synthetic class, callable with no receiver:

```
jshell> double reciprocal(double d) { return 1 / d; }
|  created method reciprocal(double)

jshell> reciprocal(4.0)
$3 ==> 0.25
```

Classes and interfaces work the same way — declare one, then instantiate and use it immediately in the same session:

```
jshell> class MyClass {
   ...>     double val;
   ...>     MyClass(double v) { val = v; }
   ...>     double reciprocal() { return 1 / val; }
   ...> }
|  created class MyClass

jshell> new MyClass(10.0).reciprocal()
$4 ==> 0.1
```

JShell even supports forward references: a method can call another method that hasn't been defined yet, as long as it exists by the time the first one is actually invoked.

### Auto-imported packages

JShell starts with a default set of common packages already imported, so code that would need an explicit `import` in a regular source file just works:

```
jshell> FileInputStream fin = new FileInputStream("myfile.txt");
```

`FileInputStream` resolves without `import java.io.*;` because the default startup script pre-imports `java.io`, `java.math`, `java.net`, `java.nio.file`, `java.util`, `java.util.concurrent`, `java.util.function`, `java.util.prefs`, `java.util.regex`, and `java.util.stream`. Anything outside that list still needs an explicit `import`, and `/imports` lists whatever is currently active.

### The `/` commands

Everything that isn't Java code and starts with `/` is a JShell command, used to inspect or manage the session rather than the code itself:

```
jshell> int start = 0;
start ==> 0

jshell> int end = 10;
end ==> 10

jshell> /vars
|    int start = 0
|    int end = 10

jshell> /methods
|    double reciprocal(double)

jshell> /list
   1 : int start = 0;
   2 : int end = 10;
   3 : double reciprocal(double d) { return 1 / d; }
```

`/edit` opens an editor window for a snippet (`/edit`, `/edit 3`, or `/edit start` to edit by number or name); `/save file` and `/open file` persist a session to a file and reload it later; `/exit` ends the session. `/help` (or `/?`) lists every available command.

## Trade-offs

- **Fast feedback vs. no persistence by default** — nothing survives past `/exit` unless it's explicitly saved with `/save`, so JShell is best for throwaway exploration, not for building anything meant to last beyond the session.
- **Convenience hides the framework** — the synthetic class and method that make bare statements work are invisible, which is great for speed but can obscure *why* a top-level `return` or a stand-alone method is legal here but wouldn't compile as-is in a real `.java` file.
- **Auto-import and automatic exception handling lower friction, but also lower fidelity** — JShell silently handles checked exceptions in snippets and pre-imports several packages, so code that "just works" interactively may need explicit `try`/`catch` and `import` statements once copied into a real source file:

```
jshell> FileInputStream fin = new FileInputStream("myfile.txt"); // no try/catch, no import needed here
```

## Documentation Links

- [Introduction to JShell — Java SE 25](https://docs.oracle.com/en/java/javase/25/jshell/introduction-jshell.html) — doc
- [The jshell Command — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jshell.html) — doc
