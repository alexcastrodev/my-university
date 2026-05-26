# Creating and Running a Modular Program

> **OCP Exam Topic** — Create and compile a single-module Java program using `module-info.java`, `javac --module-source-path`, and `java --module-path -m`. Covered in Chapter 12 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Directory Structure

A modular project uses a conventional layout. Each module lives in its own directory, and the `module-info.java` file sits at the **root of the module's source tree** — not inside a package directory.

```
project/
├── src/
│   └── com.example.greeting/          <- module directory (name matches module)
│       ├── module-info.java
│       └── com/
│           └── example/
│               └── greeting/
│                   └── Greeter.java
└── out/                               <- compiled output
```

The outer directory name conventionally matches the module name, but the compiler does not require it. What the compiler does require is that `module-info.java` be at the top of the source root for that module.

---

## Writing module-info.java

The module declaration file uses a new file-level construct. It is **not** inside any package.

```java
// src/com.example.greeting/module-info.java
module com.example.greeting {
    // no requires needed — java.base is implicit
}
```

And the single class in the module:

```java
// src/com.example.greeting/com/example/greeting/Greeter.java
package com.example.greeting;

public class Greeter {
    public String greet(String name) {
        return "Hello, " + name + "!";
    }
}
```

---

## Compiling a Single Module

Use `javac` with the `--module-source-path` flag to compile a single module or a whole project tree at once.

```bash
# Create the output directory first
mkdir -p out

# Compile the module
javac --module-source-path src \
      -d out \
      src/com.example.greeting/module-info.java \
      src/com.example.greeting/com/example/greeting/Greeter.java
```

After compilation the output mirrors the module structure:

```
out/
└── com.example.greeting/
    ├── module-info.class
    └── com/
        └── example/
            └── greeting/
                └── Greeter.class
```

### Key javac Flags for Modules

| Flag | Meaning |
|---|---|
| `--module-source-path <path>` | Root of the source tree containing module directories |
| `-d <dir>` | Output directory for compiled modules |
| `--module-path <path>` or `-p <path>` | Where to find compiled modules the current module depends on |
| `--module <name>` or `-m <name>` | Compile only the named module |

---

## Running a Modular Program

The `java` command gains two new flags for modules:

```bash
java --module-path out \
     --module com.example.greeting/com.example.greeting.Greeter
```

The value after `--module` (or `-m`) takes the form:

```
<module-name>/<fully.qualified.MainClass>
```

### Shortened form using -p and -m

```bash
java -p out -m com.example.greeting/com.example.greeting.Greeter
```

`-p` is the short form of `--module-path` and `-m` is the short form of `--module`.

---

## A Complete Single-Module Example

Below is a self-contained example you can reproduce.

**Source files:**

```java
// src/com.example.app/module-info.java
module com.example.app { }
```

```java
// src/com.example.app/com/example/app/Main.java
package com.example.app;

public class Main {
    public static void main(String[] args) {
        System.out.println("Modular Hello World");
    }
}
```

**Compile:**

```bash
javac --module-source-path src -d out \
      $(find src -name "*.java")
```

**Run:**

```bash
java -p out -m com.example.app/com.example.app.Main
```

**Output:**

```
Modular Hello World
```

---

## Packaging as a Modular JAR

Once compiled you can package the module into a JAR file. A modular JAR contains `module-info.class` at its root.

```bash
jar --create \
    --file mods/com.example.app.jar \
    --main-class com.example.app.Main \
    -C out/com.example.app .
```

Running from a JAR:

```bash
java -p mods -m com.example.app
```

Because `--main-class` was set in the manifest, you can omit the class name after `-m`.

---

## Key Points to Remember

- `module-info.java` lives at the root of the module source directory, not inside any package.
- `javac --module-source-path` compiles one or more modules in a single invocation.
- `java -p <path> -m <module>/<MainClass>` runs a modular program.
- `-p` is short for `--module-path`; `-m` is short for `--module`.
- The compiled output preserves the module directory structure under the output root.
- A modular JAR includes `module-info.class`; if a main class is set you can run it with just `-m <module>`.
