---
version: 1.0
updatedAt: 2026-08-19
title: Métodos Default, Static e Private em Interfaces
summary: Como métodos default, static e private permitem que uma interface carregue comportamento para que uma API publicada possa crescer sem quebrar quem a implementa, e as regras exatas que o Java usa quando dois defaults herdados colidem.
---
## Objective

Uma interface costumava ser apenas uma lista de assinaturas. Desde o Java 8 ela também pode carregar corpos: um método `default` fornece uma implementação herdada para que uma interface publicada possa ganhar novos métodos sem quebrar classes que já a implementam, e um método `static` coloca um utilitário ou factory na própria interface em vez de em uma classe helper separada. O Java 9 adicionou métodos `private` em interfaces para que esses corpos pudessem compartilhar lógica sem que essa lógica virasse API pública. O custo de herdar comportamento de mais de um supertipo é que conflitos se tornam possíveis, então a linguagem define exatamente qual método vence — e quando o compilador se recusa a adivinhar e força você a sobrescrever.

## Use Cases

- Adicionar um método a uma interface que terceiros já implementam, sem que todo implementador deixe de compilar — a razão pela qual `Collection.stream()`, `Collection.removeIf()` e `Iterable.forEach()` puderam ser introduzidos no Java 8.
- Dar a uma interface uma pequena quantidade de comportamento derivado, expresso puramente em termos de seus próprios métodos abstratos (`isEmpty()` em termos de `size()`, `describe()` em termos de um getter).
- Construir APIs no estilo combinator onde cada operação retorna uma nova instância da interface: `Comparator.thenComparing()`, `Comparator.reversed()`, `Predicate.and()`, `Function.andThen()`.
- Colocar métodos factory estáticos no tipo que eles produzem, em vez de em uma classe `XxxUtils`: `Comparator.comparing(...)`, `Comparator.naturalOrder()`, `List.of(...)`, `Map.entry(k, v)`, `Predicate.not(...)`.
- Fatorar uma etapa de validação ou normalização de vários métodos default para um único helper `private` que classes implementadoras não conseguem ver nem chamar.
- Resolver um diamante deliberado — uma classe que implementa duas interfaces que ambas fornecem um default para a mesma assinatura — sobrescrevendo e delegando com `Interface.super.method()`.

## Deep Dive

### Por que métodos default existem: fazer crescer uma interface já publicada

Compile um implementador contra a versão 1 de uma interface, depois adicione um método à interface e recompile *só a interface*:

```java
// Pipe.java, version 1
public interface Pipe { void send(String s); }

// MyPipe.java — compiled against version 1, never touched again
public class MyPipe implements Pipe {
    public void send(String s) { System.out.println("sent: " + s); }
}
```

```java
// Pipe.java, version 2 — a new method, with a body
public interface Pipe {
    void send(String s);
    default void sendAll(List<String> all) { for (String s : all) send(s); }
}
```

```
$ javac -d cls v1/Pipe.java MyPipe.java     # MyPipe.class built against v1
$ javac -d cls v2/Pipe.java                 # only the interface recompiled
$ java -cp cls Main                         # Main calls new MyPipe().sendAll(List.of("x","y"))
sent: x
sent: y
```

O `MyPipe.class` já compilado ganhou `sendAll` de graça. Declare o mesmo método como abstrato em vez disso e todo implementador existente para de compilar:

```java
public interface Pipe { void send(String s); void sendAll(List<String> all); }
```

```
MyPipe.java:1: error: MyPipe is not abstract and does not override abstract method sendAll(List<String>) in Pipe
public class MyPipe implements Pipe {
       ^
```

Essa é a motivação inteira: `stream()`, `spliterator()`, `removeIf()` e `toArray(IntFunction)` em `Collection`, e `forEach()` em `Iterable`, são todos métodos default, e é por isso que adicionar lambdas e streams no Java 8 não invalidou uma década de implementações de terceiros de `Collection`.

### O que um método de interface pode ser

Quatro formas mutuamente exclusivas, e um conjunto de modificadores que são ilegais:

```java
interface Demo {
    String status();                                    // implicitly public abstract, no body
    default String greet() { return "hi " + status(); } // public, has a body, inherited
    static String label() { return "Demo"; }            // public, has a body, NOT inherited
    private String inner() { return "OK"; }             // Java 9+, has a body, not visible outside
    private static String tag() { return "d"; }         // Java 9+, static variant
}
```

Tudo exceto um membro `private` é implicitamente `public`, então escrever `public` em um método de interface é redundante. Um método sem `private`, `default` ou `static` é implicitamente `abstract` e precisa terminar em ponto e vírgula; métodos `default`, `static` e `private` precisam ter um corpo em bloco. As combinações rejeitadas:

```java
interface Bad {
    private default String a() { return "x"; }  // error: illegal combination of modifiers: private and default
    final String b();                           // error: modifier final not allowed here
    synchronized default String c() { return "y"; } // error: modifier synchronized not allowed here
    private String d();                         // error: missing method body, or declare abstract
}
```

Um método default também não pode ter uma assinatura equivalente por override a um método não-private de `Object`, porque toda classe implementadora herdaria a versão de `Object` de qualquer forma e venceria silenciosamente:

```java
interface Named { default String toString() { return "named"; } }
// error: default method toString in interface Named overrides a member of java.lang.Object
```

### Herança em diamante de comportamento

Duas interfaces não relacionadas, cada uma com um default para a mesma assinatura, e uma classe implementando ambas. O compilador não escolhe:

```java
interface Hello { default String greet() { return "Hello"; } }
interface Howdy { default String greet() { return "Howdy"; } }

class Greeter implements Hello, Howdy { }
```

```
T1.java:3: error: types Hello and Howdy are incompatible;
class Greeter implements Hello, Howdy { }
^
  class Greeter inherits unrelated defaults for greet() from types Hello and Howdy
```

O conserto é sobrescrever, o que remove ambos os métodos herdados da consideração. Dentro do override, `Interface.super.method()` alcança o corpo default de uma superinterface específica:

```java
class Greeter implements Hello, Howdy {
    @Override public String greet() {
        return Hello.super.greet() + " / " + Howdy.super.greet();
    }
}
// prints: Hello / Howdy
```

O mesmo conflito também é reportado no nível de *interface*, então ele aparece assim que alguém escreve `interface AB extends A, B`, sem esperar por uma classe concreta. `Interface.super` tem escopo restrito: a interface nomeada precisa ser uma superinterface **direta** da declaração que a contém, então você não pode alcançar além de uma interface intermediária:

```java
interface Top { default String name() { return "top"; } }
interface Mid extends Top { }

class Bot implements Mid {
    public String name() { return Top.super.name(); }
}
```

```
T6.java:3: error: not an enclosing class: Top
```

`class Bot implements Mid, Top` (ou `Mid.super.name()`) compila; também não existe sintaxe para uma chamada interface-super de dentro de uma classe aninhada ou anônima, razão pela qual esse tipo de código costuma ser roteado através de um método privado da classe que a contém.

### Abstract vence default, e uma classe vence os dois

Um método default não satisfaz um método abstrato de mesma assinatura herdado de uma interface diferente. A especificação deliberadamente se recusa a assumir que os dois compartilham um contrato:

```java
interface A { default String greet() { return "Hello"; } }
interface B { String greet(); }

interface AB extends A, B { }
// error: interface AB inherits abstract and default for greet() from types A and B

class C implements A, B { }
// error: C is not abstract and does not override abstract method greet() in B
```

O único lugar onde a linguagem *de fato* escolhe silenciosamente é a hierarquia de classes: um método concreto herdado de uma superclasse sobrescreve um método default de uma superinterface — informalmente, "a classe vence".

```java
interface Greet { default String greet() { return "iface"; } }
class Base { public String greet() { return "class"; } }

class Sub extends Base implements Greet {
    public static void main(String[] a) { System.out.println(new Sub().greet()); }
}
// prints: class
```

### Reabstração e a regra do já-sobrescrito

Uma subinterface tem três opções para um default que herda: deixá-lo como está, sobrescrevê-lo com um novo corpo, ou redeclará-lo como abstrato — o que força implementadores a fornecer o seu próprio, e é a forma padrão de neutralizar um conflito deliberadamente:

```java
interface StrictPipe extends Pipe {
    void sendAll(List<String> all);   // re-abstracted: no body, so implementers must supply one
}

class P implements StrictPipe { public void send(String s) { } }
// error: P is not abstract and does not override abstract method sendAll(List<String>) in StrictPipe
```

Diamantes só são erro quando nenhum dos ramos já venceu. Se o default de uma superinterface sobrescreve o da outra, o sobrescrito não é reherdado e não há ambiguidade:

```java
interface Top    { default String name() { return "unnamed"; } }
interface Left  extends Top { default String name() { return "left"; } }
interface Right extends Top { }
interface Bottom extends Left, Right { }

class BotImpl implements Bottom {
    public static void main(String[] a) { System.out.println(new BotImpl().name()); }
}
// prints: left  — Right inherits name() from Top, but Left.name() already overrides it
```

### Métodos static em interfaces: factories no próprio tipo

Um método static de interface é um utilitário ou factory que conceitualmente pertence à interface, sem uma classe `XxxUtils` separada e sem risco de o helper ser confundido com parte do contrato que implementadores precisam satisfazer. `Comparator` é o exemplo canônico, misturando pontos de entrada estáticos com combinators default:

```java
List<String> names = new ArrayList<>(List.of("bob", "Al", "carol", "dan"));
names.sort(Comparator.comparing(String::length)         // static factory on the interface
                     .thenComparing(Comparator.naturalOrder())); // default combinator + another static
System.out.println(names);   // [Al, bob, dan, carol]
```

A pegadinha: métodos static de interface **não são herdados**, nem por subinterfaces nem por classes implementadoras. Eles precisam ser qualificados com o nome da interface:

```java
interface Util { static String help() { return "help"; } }
class Impl implements Util { }

class UseIt { void go() { System.out.println(Impl.help()); } }
```

```
T3.java:3: error: cannot find symbol
class UseIt { void go() { System.out.println(Impl.help()); } }
                                                 ^
  symbol:   method help()
  location: class Impl
```

`Util.help()` é a única forma válida. (Isso é o oposto de um método static de classe, que *é* herdado e pode ser chamado através do nome de uma subclasse.)

### Métodos private em interfaces: corpos compartilhados, API inalterada

Dois métodos default que precisam da mesma lógica helper tinham, antes do Java 9, só más opções: duplicar o código, ou adicionar um método público que ninguém deveria chamar. Um método `private` de interface resolve isso — de instância ou static, corpo obrigatório, nunca herdado, nunca sobrescrevível:

```java
interface Sized {
    int size();

    default boolean isEmpty()  { return checked() == 0; }
    default String describe()  { return "size=" + checked(); }

    private int checked() {                          // shared by both defaults
        int n = size();
        if (n < 0) throw new IllegalStateException("negative size: " + n);
        return n;
    }

    private static String tag() { return "Sized"; }  // private static variant
    static String label() { return tag() + " interface"; }
}

class Bag implements Sized {
    public int size() { return 3; }
    public static void main(String[] a) {
        Bag b = new Bag();
        System.out.println(b.isEmpty() + " " + b.describe() + " " + Sized.label());
    }
}
// prints: false size=3 Sized interface
```

`checked()` e `tag()` são invisíveis para `Bag` e para todo outro implementador, então a superfície publicada da interface continua sendo `size()`, `isEmpty()`, `describe()` e `label()`:

```java
class Impl2 implements Demo { void go() { System.out.println(inner()); } }
```

```
T4.java:2: error: cannot find symbol
  symbol:   method inner()
  location: class Impl2
```

Como um método private de interface nunca é herdado, ele também não pode sobrescrever nada — a linguagem garante que só métodos públicos de interface participam de override.

### Corpos não quebram interfaces funcionais

Só a contagem de métodos abstratos decide se uma interface é funcional, então métodos `default`, `static` e `private` podem ser adicionados livremente a um alvo de lambda:

```java
@FunctionalInterface
interface Tx {
    String apply(String in);                                       // the single abstract method

    default Tx andThen(Tx next) { return in -> next.apply(apply(in)); }
    static Tx identity() { return in -> in; }
    private static String tag() { return "Tx"; }
}

Tx up = String::toUpperCase;
System.out.println(up.andThen(s -> s + "!").apply("hi"));  // HI!
System.out.println(Tx.identity().apply("z"));              // z
```

É exatamente assim que `Function`, `Predicate` e `Comparator` continuam utilizáveis como alvos de lambda enquanto carregam uma dezena de combinators cada uma.

## Trade-offs

- **Um método default é herdado silenciosamente, e um método de superclasse vence ele silenciosamente.** Adicionar um default a uma interface pode não mudar nada para um implementador que já herda um método concreto de mesma assinatura de sua superclasse — a classe vence, e nenhum aviso é emitido:

```java
interface Greet { default String greet() { return "iface"; } }
class Base { public String greet() { return "class"; } }
class Sub extends Base implements Greet { }
new Sub().greet();   // "class" — the default never runs
```

- **O custo de um diamante recai sobre quem implementa, não sobre quem escreveu a interface.** Duas bibliotecas que independentemente adicionam um default para a mesma assinatura transformam qualquer classe que implemente as duas em um erro de compilação que ela mesma precisa consertar:

```java
class Greeter implements Hello, Howdy { }
// error: class Greeter inherits unrelated defaults for greet() from types Hello and Howdy
```

- **`Interface.super` alcança só superinterfaces diretas, e não a partir de classes aninhadas.** Não há forma de invocar o corpo default de uma superinterface avó, então uma hierarquia profunda deixa você reimplementando em vez de delegando:

```java
class Bot implements Mid { public String name() { return Top.super.name(); } }
// error: not an enclosing class: Top   (Mid sits between Bot and Top)
```

- **Corpos de interface ainda não podem guardar estado nem tocar métodos de `Object`.** Um método default só pode computar a partir dos próprios métodos abstratos da interface, e `equals`/`hashCode`/`toString` estão completamente fora dos limites:

```java
interface Named { default String toString() { return "named"; } }
// error: default method toString in interface Named overrides a member of java.lang.Object
```

- **Interfaces com corpos borram a linha que antes traçavam.** Um leitor não pode mais assumir que "interface" significa "só assinaturas", e a questão de design sobre quanto comportamento pertence a uma interface versus a uma classe abstrata esquelética ou a um wrapper agora é um julgamento, não uma restrição da linguagem.

## Documentation Links

- [Java Language Specification — 9.4, Interface Method Declarations](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.4) — doc
- [Java Language Specification — 9.4.1, Inheritance and Overriding](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.4.1) — doc
- [Java Language Specification — 9.4.1.3, Inheriting Methods with Override-Equivalent Signatures](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.4.1.3) — doc
- [Java Language Specification — 8.4.8.4, Inheriting Methods with Override-Equivalent Signatures (classes)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.4.8.4) — doc
- [Java Language Specification — 15.12.1, Determine Type to Search (TypeName.super)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.12.1) — doc
- [JEP 213: Milling Project Coin — private interface methods in Java 9](https://openjdk.org/jeps/213) — doc
- [Default Methods and Static Methods — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/IandI/defaultmethods.html) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
- [Comparator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html) — doc
