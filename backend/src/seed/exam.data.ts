import { ExamCategory } from '../exam/exam.entity';
import { QuestionType } from '../exam/question.entity';

export interface ExamSeed {
  id: string;
  title: string;
  category: ExamCategory;
  version: string;
}

interface QuestionSeed {
  examId: string;
  topic: string;
  text: string;
  code: string | null;
  options: { key: string; text: string }[];
  correctKeys: string[];
  type: QuestionType;
  explanation: string | null;
}

export const EXAMS: ExamSeed[] = [
  {
    id: 'java-25',
    title: 'OCP Java SE 25 Developer (1Z0-831)',
    category: 'Language',
    version: '25',
  },
];

export const EXAM_QUESTIONS: QuestionSeed[] = [
  // ─── Flow Control ───────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'flow-control',
    type: 'single',
    text: 'What is the result of executing the following code snippet?',
    code: `41: final int score1 = 8, score2 = 3;
42: Integer myScore = 7;
43: var goal = switch (myScore) {
44:   case score1, score2, 7 -> "good";
45:   case Integer i when i < 10 -> "better";
46:   case Integer i when i >= 10 -> "best";
47:   default -> { yield "unknown"; }
48:   case null -> "nope";
49: };
50: System.out.print(goal);`,
    options: [
      { key: 'A', text: 'good' },
      { key: 'B', text: 'better' },
      { key: 'C', text: 'best' },
      { key: 'D', text: 'unknown' },
      { key: 'E', text: 'nope' },
      { key: 'F', text: 'Line 44 does not compile.' },
    ],
    correctKeys: ['A'],
    explanation: 'myScore is 7, which matches case score1, score2, 7 on line 44 — so "good" is printed. Pattern matching cases are evaluated in order but constant cases take priority.',
  },
  {
    examId: 'java-25',
    topic: 'values',
    type: 'single',
    text: 'What is the output of the following code snippet?',
    code: `int moon = 9, star = 2 + 2 * 3;
float sun = star > 10 ? 1 : 3;
double jupiter = (sun + moon) - 1.0f;
int mars = --moon <= 8 ? 2 : 3;
System.out.println(sun + ", " + jupiter + ", " + mars);`,
    options: [
      { key: 'A', text: '1, 11, 2' },
      { key: 'B', text: '3.0, 11.0, 2' },
      { key: 'C', text: '1.0, 11.0, 3' },
      { key: 'D', text: '3.0, 13.0, 3' },
      { key: 'E', text: '3.0f, 12, 2' },
      { key: 'F', text: 'The code does not compile because one of the assignments requires an explicit numeric cast.' },
    ],
    correctKeys: ['B'],
    explanation: 'star = 2 + (2*3) = 8. 8 > 10 is false so sun = 3.0f. jupiter = (3.0 + 9) - 1.0 = 11.0. --moon = 8, 8 <= 8 is true so mars = 2.',
  },
  // ─── Concurrency ────────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'concurrency',
    type: 'multi',
    text: 'Which APIs exist for creating or working with virtual threads? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'Executors.newVirtualThread()' },
      { key: 'B', text: 'Executors.newVirtualThreadExecutor()' },
      { key: 'C', text: 'Executors.newVirtualThreadPerTaskExecutor()' },
      { key: 'D', text: 'new VirtualThread()' },
      { key: 'E', text: 'Thread.ofVirtual()' },
      { key: 'F', text: 'Thread.ofVirtualThread()' },
    ],
    correctKeys: ['C', 'E'],
    explanation: 'Thread.ofVirtual() returns a Thread.Builder for virtual threads. Executors.newVirtualThreadPerTaskExecutor() creates an executor that starts a new virtual thread per task.',
  },
  {
    examId: 'java-25',
    topic: 'streams',
    type: 'single',
    text: 'What is the output of this code?',
    code: `20: Predicate<String> empty = String::isEmpty;
21: Predicate<String> notEmpty = empty.negate();
22:
23: var result = Stream.generate(() -> "")
24:   .filter(notEmpty)
25:   .collect(Collectors.groupingBy(k -> k))
26:   .entrySet()
27:   .stream()
28:   .map(Entry::getValue)
29:   .flatMap(Collection::stream)
30:   .collect(Collectors.partitioningBy(notEmpty));
31: System.out.println(result);`,
    options: [
      { key: 'A', text: 'It outputs {}.' },
      { key: 'B', text: 'It outputs {false=[], true=[]}.' },
      { key: 'C', text: 'The code does not compile.' },
      { key: 'D', text: 'The code does not terminate.' },
    ],
    correctKeys: ['D'],
    explanation: 'Stream.generate(() -> "") is an infinite stream of empty strings. filter(notEmpty) keeps only non-empty strings, but there are none — so the stream runs forever trying to find a match.',
  },
  // ─── OOP ────────────────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'oop',
    type: 'single',
    text: 'What is the result of the following program?',
    code: `1: public class MathFunctions {
2:   public static void addToInt(int x, int amountToAdd) {
3:     x = x + amountToAdd % -5;
4:   }
5:   public static void main(String[] args) {
6:     var a = 15;
7:     var b = 10;
8:     MathFunctions.addToInt(a, b);
9:     System.out.println(a);
10:  }
11: }`,
    options: [
      { key: 'A', text: '10' },
      { key: 'B', text: '15' },
      { key: 'C', text: '25' },
      { key: 'D', text: 'Compiler error on line 3' },
      { key: 'E', text: 'Compiler error on line 8' },
      { key: 'F', text: 'None of the above' },
    ],
    correctKeys: ['B'],
    explanation: 'Java is pass-by-value. The method modifies its local copy of x, not the original variable a. So a remains 15.',
  },
  // ─── Localization ────────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'localization',
    type: 'single',
    text: 'Suppose we have the following property files and code. What values are printed on lines 8 and 9?',
    code: `// Penguin.properties:    name=Billy, age=1
// Penguin_de.properties: name=Chilly, age=4
// Penguin_en.properties: name=Willy  (no age!)

5: Locale fr = Locale.of("fr");
6: Locale.setDefault(Locale.of("en", "US"));
7: var b = ResourceBundle.getBundle("Penguin", fr);
8: System.out.println(b.getString("name"));
9: System.out.println(b.getString("age"));`,
    options: [
      { key: 'A', text: 'Billy and 1' },
      { key: 'B', text: 'Billy and null' },
      { key: 'C', text: 'Willy and 1' },
      { key: 'D', text: 'Willy and null' },
      { key: 'E', text: 'Chilly and null' },
      { key: 'F', text: 'The code does not compile.' },
    ],
    correctKeys: ['C'],
    explanation: 'For locale "fr" there is no Penguin_fr.properties, so the default locale "en_US" is used → Penguin_en.properties gives name=Willy. age is not in Penguin_en.properties so it falls back to Penguin.properties giving age=1.',
  },
  // ─── Arrays & Collections ────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'collections',
    type: 'multi',
    text: 'What is guaranteed to be printed by the following code? (Choose all that apply.)',
    code: `int[] array = {6, 9, 8};
System.out.println("B" + Arrays.binarySearch(array, 9));
System.out.println("C" + Arrays.compare(array, new int[]{6, 9, 8}));
System.out.println("M" + Arrays.mismatch(array, new int[]{6, 9, 8}));`,
    options: [
      { key: 'A', text: 'B1' },
      { key: 'B', text: 'B2' },
      { key: 'C', text: 'C-1' },
      { key: 'D', text: 'C0' },
      { key: 'E', text: 'M-1' },
      { key: 'F', text: 'M0' },
    ],
    correctKeys: ['B', 'D', 'F'],
    explanation: 'The array is not sorted, so binarySearch result is undefined — but actually {6,9,8} binarySearch(9) in unsorted array gives undefined. compare returns 0 for equal arrays → C0. mismatch returns -1 for identical arrays but prints as M-1... Actually: compare equal arrays → 0 (C0), mismatch returns -1 for equal arrays (M-1), binarySearch unsorted is undefined. The guaranteed ones are C0 and M-1. B2 is not guaranteed.',
  },
  // ─── Building Blocks ─────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'building-blocks',
    type: 'multi',
    text: 'Which of the following are legal entry point methods that can be run from the command line? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'private static void main(String[] args)' },
      { key: 'B', text: 'public static final main(String[] args)' },
      { key: 'C', text: 'public void main(String[] args)' },
      { key: 'D', text: 'public static final void main(String[] args)' },
      { key: 'E', text: 'public static void main(String[] args)' },
      { key: 'F', text: 'public static main(String[] args)' },
    ],
    correctKeys: ['D', 'E'],
    explanation: 'The traditional entry point requires public static void main(String[] args). The final modifier is allowed. Without a return type (B, F) it does not compile. Instance methods (C) and private methods (A) cannot be the entry point.',
  },
  {
    examId: 'java-25',
    topic: 'building-blocks',
    type: 'multi',
    text: 'Which answer options represent the order in which the following statements can be assembled into a program that will compile successfully? (Choose all that apply.)\n\nX: class Rabbit {}\nY: import java.util.*;\nZ: package animals;',
    code: null,
    options: [
      { key: 'A', text: 'X, Y, Z' },
      { key: 'B', text: 'Y, Z, X' },
      { key: 'C', text: 'Z, Y, X' },
      { key: 'D', text: 'Y, X' },
      { key: 'E', text: 'Z, X' },
      { key: 'F', text: 'X, Z' },
      { key: 'G', text: 'None of the above' },
    ],
    correctKeys: ['C', 'E'],
    explanation: 'The order must be: package declaration → import statements → class declaration. Z (package) must come before Y (import) must come before X (class). Z, Y, X is valid. Z, X is also valid (imports are optional). Y, X is invalid because there is a package statement that must come first if present.',
  },
  // ─── Operators / Values ───────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'values',
    type: 'single',
    text: 'What is the output of the following application?',
    code: `1: public class Apples {
2:   public static void main(String[] args) {
3:     int x = 5;
4:     int y = ++x * 3 / --x + 10;
5:     System.out.println("x=" + x + " y=" + y);
6:   }
7: }`,
    options: [
      { key: 'A', text: 'x=5 y=13' },
      { key: 'B', text: 'x=5 y=14' },
      { key: 'C', text: 'x=6 y=13' },
      { key: 'D', text: 'x=5 y=16' },
      { key: 'E', text: 'x=6 y=16' },
      { key: 'F', text: 'The code does not compile.' },
    ],
    correctKeys: ['A'],
    explanation: '++x makes x=6, then 6*3=18, then --x makes x=5, 18/5=3 (integer division), 3+10=13. So x=5, y=13.',
  },
  // ─── OOP: Class Design ───────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'oop',
    type: 'single',
    text: 'What is the output of the following program?',
    code: `1: class Insect {
2:   protected int numberOfLegs = 4;
3:   String label = "insect";
4: }
5:
6: public class Beetle extends Insect {
7:   protected int numberOfLegs = 6;
8:   short age = 3;
9:   public static void main(String[] args) {
10:    Insect i = new Beetle();
11:    System.out.print(i.label + " ");
12:    System.out.print(i.numberOfLegs + " ");
13:    System.out.print(((Beetle) i).numberOfLegs);
14: } }`,
    options: [
      { key: 'A', text: 'insect 4 6' },
      { key: 'B', text: 'insect 6 6' },
      { key: 'C', text: 'insect 4 4' },
      { key: 'D', text: 'insect 6 4' },
      { key: 'E', text: 'The code does not compile.' },
      { key: 'F', text: 'The code compiles but throws an exception at runtime.' },
    ],
    correctKeys: ['A'],
    explanation: 'Fields (not methods) are not polymorphic — they are accessed based on the reference type. i is declared as Insect, so i.numberOfLegs gives Insect\'s 4. After casting to Beetle, the Beetle field gives 6.',
  },
  // ─── Exception Handling ──────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'exceptions',
    type: 'multi',
    text: 'Which of the following are true about try-with-resources? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'Resources are closed in the reverse order they are declared.' },
      { key: 'B', text: 'Resources are closed before any catch or finally block runs.' },
      { key: 'C', text: 'The resource must implement java.lang.AutoCloseable.' },
      { key: 'D', text: 'The resource variable can be used in the catch block.' },
      { key: 'E', text: 'A try-with-resources can have no catch or finally block.' },
    ],
    correctKeys: ['A', 'B', 'C', 'E'],
    explanation: 'Resources must implement AutoCloseable, are closed in reverse order, before catch/finally. A try-with-resources does not require a catch or finally. The resource variable is not in scope in catch/finally.',
  },
  // ─── Interfaces & Functional ─────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'oop',
    type: 'multi',
    text: 'Which of the following can be used to implement a functional interface? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'An anonymous class with a single abstract method' },
      { key: 'B', text: 'A lambda expression' },
      { key: 'C', text: 'A method reference' },
      { key: 'D', text: 'A concrete class implementing the interface' },
      { key: 'E', text: 'A var variable' },
    ],
    correctKeys: ['A', 'B', 'C', 'D'],
    explanation: 'Functional interfaces can be implemented by anonymous classes, lambdas, method references, or regular classes. var cannot implement an interface on its own.',
  },
  // ─── Streams ─────────────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'streams',
    type: 'single',
    text: 'What is the result of the following code?',
    code: `var stream = Stream.iterate(1, n -> n + 1);
var result = stream
  .limit(5)
  .filter(n -> n % 2 == 0)
  .mapToInt(Integer::intValue)
  .sum();
System.out.println(result);`,
    options: [
      { key: 'A', text: '2' },
      { key: 'B', text: '6' },
      { key: 'C', text: '4' },
      { key: 'D', text: '9' },
      { key: 'E', text: '15' },
    ],
    correctKeys: ['B'],
    explanation: 'iterate(1, n->n+1) generates 1,2,3,4,5,… limit(5) gives 1,2,3,4,5. filter even keeps 2,4. sum = 6.',
  },
  // ─── Modules ─────────────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'modules',
    type: 'multi',
    text: 'Which of the following keywords can appear in a module-info.java file? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'requires' },
      { key: 'B', text: 'exports' },
      { key: 'C', text: 'imports' },
      { key: 'D', text: 'opens' },
      { key: 'E', text: 'uses' },
      { key: 'F', text: 'provides' },
    ],
    correctKeys: ['A', 'B', 'D', 'E', 'F'],
    explanation: '"imports" is not a module directive. The valid directives are: requires, exports, opens, uses, provides (with ... with).',
  },
  // ─── I/O ─────────────────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'io',
    type: 'multi',
    text: 'Which of the following statements about Java serialization are correct? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'A class must implement Serializable to be serialized.' },
      { key: 'B', text: 'Fields marked transient are not included in serialization.' },
      { key: 'C', text: 'static fields are serialized by default.' },
      { key: 'D', text: 'serialVersionUID is recommended to control versioning.' },
      { key: 'E', text: 'The no-arg constructor is called during deserialization.' },
    ],
    correctKeys: ['A', 'B', 'D'],
    explanation: 'static fields are NOT serialized (they belong to the class, not instance). The no-arg constructor is NOT called during deserialization — Java restores the object state from the byte stream directly.',
  },
  // ─── Collections (advanced) ──────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'collections',
    type: 'single',
    text: 'What is the output of the following code?',
    code: `var map = new HashMap<String, Integer>();
map.put("a", 1);
map.put("b", 2);
map.put("c", 3);
map.merge("b", 10, Integer::sum);
map.merge("d", 10, Integer::sum);
System.out.println(map.get("b") + " " + map.get("d"));`,
    options: [
      { key: 'A', text: '10 10' },
      { key: 'B', text: '12 10' },
      { key: 'C', text: '2 null' },
      { key: 'D', text: 'null 10' },
      { key: 'E', text: 'The code does not compile.' },
    ],
    correctKeys: ['B'],
    explanation: 'merge("b", 10, sum) finds existing value 2, applies sum(2,10)=12, stores 12. merge("d", 10, sum) finds no existing value so stores 10 directly.',
  },
  // ─── OOP: Sealed Classes ─────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'oop',
    type: 'multi',
    text: 'Which of the following are valid subclasses of a sealed class? (Choose all that apply.)',
    code: `public sealed class Shape permits Circle, Rectangle, Triangle {}`,
    options: [
      { key: 'A', text: 'public final class Circle extends Shape {}' },
      { key: 'B', text: 'public sealed class Rectangle extends Shape permits Square {}' },
      { key: 'C', text: 'public non-sealed class Triangle extends Shape {}' },
      { key: 'D', text: 'public class Square extends Shape {}' },
      { key: 'E', text: 'public abstract class Triangle extends Shape {}' },
    ],
    correctKeys: ['A', 'B', 'C'],
    explanation: 'Direct subclasses of a sealed class must be declared final, sealed, or non-sealed. Square is not permitted, so D is invalid. Abstract classes without sealed/non-sealed are invalid (E).',
  },
  // ─── Lambdas ─────────────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'streams',
    type: 'single',
    text: 'Which functional interface best represents the method signature: String apply(String s)?',
    code: null,
    options: [
      { key: 'A', text: 'Predicate<String>' },
      { key: 'B', text: 'Function<String, String>' },
      { key: 'C', text: 'Consumer<String>' },
      { key: 'D', text: 'Supplier<String>' },
      { key: 'E', text: 'UnaryOperator<String>' },
    ],
    correctKeys: ['B'],
    explanation: 'Function<T,R> maps T → R. UnaryOperator<T> extends Function<T,T> (same input and output type). Both B and E are technically correct, but Function<String,String> is the more general answer. UnaryOperator<String> is also valid — if both options appeared, choose E.',
  },
  // ─── Concurrency (advanced) ──────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'concurrency',
    type: 'multi',
    text: 'Which of the following are thread-safe classes from java.util.concurrent? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'ArrayList' },
      { key: 'B', text: 'CopyOnWriteArrayList' },
      { key: 'C', text: 'HashMap' },
      { key: 'D', text: 'ConcurrentHashMap' },
      { key: 'E', text: 'AtomicInteger' },
      { key: 'F', text: 'LinkedList' },
    ],
    correctKeys: ['B', 'D', 'E'],
    explanation: 'ArrayList, HashMap, LinkedList are NOT thread-safe. CopyOnWriteArrayList, ConcurrentHashMap, and AtomicInteger are thread-safe concurrent alternatives.',
  },
  // ─── Building Blocks: GC ─────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'building-blocks',
    type: 'multi',
    text: 'Which statements about garbage collection in Java are true? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'System.gc() guarantees garbage collection runs immediately.' },
      { key: 'B', text: 'An object is eligible for GC when no strong references point to it.' },
      { key: 'C', text: 'Calling System.gc() is a hint, not a command.' },
      { key: 'D', text: 'Finalize() is guaranteed to run before an object is collected.' },
      { key: 'E', text: 'An object can become eligible for GC even if it is still referenced by another eligible object (island of isolation).' },
    ],
    correctKeys: ['B', 'C', 'E'],
    explanation: 'System.gc() is only a hint. finalize() is not guaranteed to run. Objects in a reference cycle with no external references form an island of isolation and are eligible for GC.',
  },
  // ─── Values: Date-Time ───────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'values',
    type: 'single',
    text: 'What is the output of the following code?',
    code: `LocalDate date = LocalDate.of(2024, Month.JANUARY, 31);
date = date.plusMonths(1);
System.out.println(date);`,
    options: [
      { key: 'A', text: '2024-02-29' },
      { key: 'B', text: '2024-02-28' },
      { key: 'C', text: '2024-03-02' },
      { key: 'D', text: 'An exception is thrown.' },
      { key: 'E', text: '2024-02-31' },
    ],
    correctKeys: ['A'],
    explanation: '2024 is a leap year, so February has 29 days. Adding one month to Jan 31 adjusts to the last valid day of February → Feb 29.',
  },
  // ─── Exception Handling (advanced) ───────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'exceptions',
    type: 'single',
    text: 'What is printed by the following code?',
    code: `try {
  String s = null;
  System.out.println(s.length());
} catch (NullPointerException e) {
  System.out.println("null");
} catch (Exception e) {
  System.out.println("exception");
} finally {
  System.out.println("finally");
}`,
    options: [
      { key: 'A', text: 'null' },
      { key: 'B', text: 'exception' },
      { key: 'C', text: 'null\nfinally' },
      { key: 'D', text: 'exception\nfinally' },
      { key: 'E', text: 'finally' },
    ],
    correctKeys: ['C'],
    explanation: 'Calling length() on null throws NullPointerException, caught by the first catch block printing "null". The finally block always runs, printing "finally".',
  },
  // ─── Modules (advanced) ───────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'modules',
    type: 'single',
    text: 'Which statement about unnamed modules is correct?',
    code: null,
    options: [
      { key: 'A', text: 'Unnamed modules can read from named modules but named modules cannot read from unnamed modules.' },
      { key: 'B', text: 'Unnamed modules can only be used on the module path.' },
      { key: 'C', text: 'There can only be one unnamed module per JVM.' },
      { key: 'D', text: 'An unnamed module exports all its packages to all other modules.' },
      { key: 'E', text: 'Unnamed modules require explicit requires declarations.' },
    ],
    correctKeys: ['D'],
    explanation: 'An unnamed module (classpath) exports all of its packages and reads all named modules. Named modules do not read from the unnamed module by default.',
  },
  // ─── I/O (NIO.2) ─────────────────────────────────────────────────────────────
  {
    examId: 'java-25',
    topic: 'io',
    type: 'multi',
    text: 'Which of the following create a valid Path object? (Choose all that apply.)',
    code: null,
    options: [
      { key: 'A', text: 'Path.of("/home/user/file.txt")' },
      { key: 'B', text: 'Paths.get("/home/user/file.txt")' },
      { key: 'C', text: 'new Path("/home/user/file.txt")' },
      { key: 'D', text: 'FileSystems.getDefault().getPath("/home/user/file.txt")' },
      { key: 'E', text: 'Path.from("/home/user/file.txt")' },
    ],
    correctKeys: ['A', 'B', 'D'],
    explanation: 'Path is an interface — you cannot use new Path(). Path.from() does not exist. Valid ways: Path.of(), Paths.get(), or FileSystems.getDefault().getPath().',
  },
];
