# OCP Java SE 25 Developer Professional — Exam Outline (1Z0-831)

## Source
- Book: *OCP Oracle Certified Professional Java SE 21 Developer Study Guide* (Selikoff & Boyarsky)
- PDF extracted to `tmp/study-guide.txt` (56 365 lines)
- Assessment test: `tmp/assessment-test.txt` (3 772 lines)
- Per-chapter questions: `tmp/rq-XX-<name>.txt`

## Exam Format
- ~50 questions, 90 minutes
- Mix of **single-choice** and **multi-select** ("Choose all that apply")
- No partial credit; multi-select requires ALL correct answers selected

## Topics & Chapter Mapping

| # | Exam Topic | Study Guide Chapter | RQ File |
|---|-----------|---------------------|---------|
| 1 | Handling Date, Time, Text, Numeric and Boolean Values | Ch 2 (Operators) + Ch 4 (Core APIs) | rq-02, rq-04 |
| 2 | Implementing Program Flow Control | Ch 3 (Making Decisions) | rq-03 |
| 3 | Applying Object-Oriented Principles | Ch 6 (Class Design) + Ch 7 (Beyond Classes) | rq-06, rq-07 |
| 4 | Implementing Exception Handling | Ch 11 (Exceptions & Localization) | rq-11 |
| 5 | Using Arrays and Collections | Ch 9 (Collections & Generics) | rq-09 |
| 6 | Processing Data with Streams and Lambdas | Ch 8 (Lambdas) + Ch 10 (Streams) | rq-08, rq-10 |
| 7 | Packaging and Deploying Java Code | Ch 12 (Modules) | rq-12 |
| 8 | Implementing Multithreading | Ch 13 (Concurrency) | rq-13 |
| 9 | Performing I/O Operations | Ch 14 (I/O) | rq-14 |
| 10 | Developing Applications with Localization | Ch 11 (Exceptions & Localization) | rq-11 |

## Assessment Test
25 questions covering all topics — in `tmp/assessment-test.txt`.  
Answers start around line 1 200 of that file.

## Question Types Found in Book
- Code snippet → predict output / compile error
- "Which of the following…? (Choose all that apply.)"
- Fill-in-the-blank (what line does not compile)
- API knowledge (method signatures, return types)

## Key OCP 1Z0-831 Sub-Topics (from JAVA-25.md)

### Values & Types
- Primitives + wrapper autoboxing, `Math` API, operator precedence, casting
- `String`, `StringBuilder`, text blocks
- `LocalDate`, `LocalTime`, `LocalDateTime`, `Duration`, `Period`, `Instant`, time zones, DST

### Flow Control
- `if/else`, `switch` statements and expressions (pattern matching, guarded patterns)
- `for`, `while`, `do-while`, enhanced `for`
- `break`, `continue`, labeled statements

### OOP
- Object lifecycle, GC eligibility
- Classes, records, fields, methods, constructors (flexible constructor bodies), initializers
- Overloaded methods, varargs
- Scopes, encapsulation, immutability, `var`, unnamed variables
- Inheritance, abstract classes, sealed types
- Interfaces (default, static, private methods), functional interfaces
- Polymorphism, reference vs object type
- `enum` with fields, methods, constructors

### Exceptions
- `try/catch/finally`, `try-with-resources`, multi-catch
- Checked vs unchecked, custom exceptions

### Collections
- Arrays (1D/2D), `Arrays` API
- `List`, `Set`, `Map`, `Deque`, sequenced collections
- `Comparable`, `Comparator`, sorting

### Streams & Lambdas
- Lambda expressions, method references
- Functional interfaces: `Function`, `Predicate`, `Consumer`, `Supplier`, `UnaryOperator`, `BiFunction`
- `Stream`, `IntStream`, `LongStream`, `DoubleStream`
- Intermediate: `filter`, `map`, `flatMap`, `sorted`, `distinct`, `limit`, `peek`
- Terminal: `collect`, `reduce`, `count`, `findFirst`, `anyMatch`, `forEach`
- `Collectors`: `toList`, `groupingBy`, `partitioningBy`, `joining`
- Parallel streams, `forEachOrdered`

### Modules
- `module-info.java`: `requires`, `exports`, `opens`, `uses`, `provides`
- Unnamed / automatic modules, migration
- `javac`, `java`, `jar`, `jlink` tools

### Concurrency
- Platform threads vs virtual threads (`Thread.ofVirtual()`)
- `Runnable`, `Callable`, `ExecutorService`, `ScheduledExecutorService`
- `Future`, `CompletableFuture`
- Scoped values
- `synchronized`, `Lock`, `ReentrantLock`
- `ConcurrentHashMap`, `CopyOnWriteArrayList`, atomic classes
- Thread lifecycle, deadlock, livelock, starvation

### I/O
- `InputStream`/`OutputStream`, `Reader`/`Writer`
- `FileInputStream`, `BufferedReader`, `PrintWriter`
- Serialization / `Serializable`, `transient`
- `Path`, `Files`, `Paths` (NIO.2)
- File attributes, directory walking (`Files.walk`, `Files.find`)

### Localization
- `Locale`, `ResourceBundle`, property files, hierarchy
- `NumberFormat`, `DateTimeFormatter`, `MessageFormat`
- Currency, percentage formatting
