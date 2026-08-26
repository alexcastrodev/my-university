---
version: 1.0
updatedAt: 2026-08-05
title: Expressões Lambda
summary: "Como uma expressão lambda implementa o único método abstrato de uma interface funcional, as formas de sintaxe com corpo de expressão vs. corpo de bloco, o catálogo java.util.function, a regra effectively-final por trás da captura de variáveis, e os quatro tipos de referência a método."
---
## Objective

Uma expressão lambda é um bloco de código anônimo e sem nome — essencialmente um método sem nome que nunca é executado sozinho. Em vez disso, ela fornece a implementação do único método abstrato declarado por uma *interface funcional*, e o compilador a transforma em um objeto que implementa essa interface no ponto onde é atribuída, passada, ou retornada. Uma referência a método (`ClassName::methodName`) é o atalho intimamente relacionado para a mesma ideia quando o corpo do lambda apenas chamaria um método já existente.

## Use Cases

- Passar um pedaço curto e de uso único de comportamento (uma regra de comparação, uma condição de filtro, um callback) como argumento de método sem declarar uma classe nomeada descartável.
- Substituir uma interface funcional escrita à mão (`Comparator`, um `Callback` customizado) por uma das interfaces padrão de `java.util.function`, para que a superfície de API não cresça a cada novo caso de uso.
- Postergar trabalho — um `Supplier<T>` que só computa seu valor se de fato solicitado, em vez de computá-lo avidamente no call site.
- Transformar um método existente (estático, de instância, ou um construtor) em um valor de interface funcional com `::`, quando o corpo do lambda não faria nada além de repassar seus argumentos para esse método.

## Deep Dive

### Interfaces funcionais: o contrato de único método abstrato

```java
interface MyNumber {
    double getValue();
}
```

`MyNumber` é uma *interface funcional* — às vezes chamada de **tipo SAM** (Single Abstract Method) — porque declara exatamente um método abstrato. Uma interface funcional define o *tipo alvo* de um lambda: uma expressão lambda só pode aparecer onde o compilador já sabe qual interface funcional ela deve implementar (uma atribuição, um argumento de método, um statement `return`, um cast, e mais alguns contextos).

```java
MyNumber myNum;
myNum = () -> 123.45;                  // lambda supplies the body of getValue()
System.out.println(myNum.getValue());  // 123.45
```

Atribuir o lambda não executa nada — cria uma instância de uma classe anônima implementando `MyNumber`, com o corpo de `getValue()` vindo do lambda. O código só roda quando `getValue()` é de fato chamado através de `myNum`. Métodos `default`, `static`, e `private` de interface não contam para a regra do "um método abstrato", e nem os métodos `public` que `Object` já fornece (`equals`, `hashCode`, `toString`) — uma interface funcional pode redeclará-los sem perder seu status.

### Sintaxe de lambda: corpos de expressão vs. corpos de bloco

```java
() -> 123.45                  // expression body, no parameters
(n) -> (n % 2) == 0           // expression body, one parameter, type inferred
(int n) -> (n % 2) == 0       // parameter type spelled out explicitly
n -> (n % 2) == 0             // parentheses are optional for exactly one parameter
(n, d) -> (n % d) == 0        // multiple parameters, comma-separated
```

Se o tipo de qualquer parâmetro é declarado explicitamente, *todos* precisam ser — `(int n, d) -> (n % d) == 0` não compila. Desde o JDK 11, `var` também é legal em uma lista de parâmetros de lambda (`(var n, var d) -> ...`), o que importa principalmente quando um parâmetro precisa de uma anotação enquanto seu tipo ainda é inferido.

Um **corpo de expressão** é uma única expressão cujo valor se torna o retorno implícito do lambda. Um **corpo de bloco** envolve statements em chaves e precisa de um `return` explícito:

```java
NumericFunc factorial = (n) -> {
    int result = 1;
    for (int i = 1; i <= n; i++) result = i * result;
    return result;             // required — a block body has no implicit return
};
```

Um `return` dentro de um lambda só sai do próprio lambda; ele nunca faz o método envolvente retornar.

Uma adição de sintaxe desde a linha de base do livro: o JDK 22 finalizou **variáveis sem nome** (JEP 456, prévia como JEP 443 no JDK 21), e o underscore `_` é legal em uma lista de parâmetros de lambda, não só em blocos `catch` ou patterns — ele marca um parâmetro que o lambda é obrigado a declarar mas nunca usa:

```java
map.computeIfAbsent(word, _ -> new TreeSet<>());        // one unused parameter
BiFunction<Integer, Integer, Integer> ignoreBoth = (_, _) -> 42;  // both unused
```

Um parâmetro descartado escrito como `_` não é um identificador de verdade — não pode ser referenciado no corpo, e mais de um `_` é permitido na mesma lista de parâmetros (diferente de um nome normal, que colidiria).

### Interfaces funcionais genéricas

Uma expressão lambda em si não pode declarar parâmetros de tipo — não pode ser genérica — mas a interface funcional que ela tem como alvo pode ser:

```java
interface SomeFunc<T> {
    T func(T n);
}

SomeFunc<String> reverse   = (str) -> new StringBuilder(str).reverse().toString();
SomeFunc<Integer> factorial = (n) -> { int r = 1; for (int i = 1; i <= n; i++) r *= i; return r; };
```

Uma interface genérica substitui a escrita de um par separado `StringFunc`/`NumericFunc` — o argumento de tipo no ponto de declaração (`SomeFunc<String>` vs. `SomeFunc<Integer>`) é o que fixa o tipo de parâmetro e retorno de `func` para aquela referência em particular.

### O catálogo `java.util.function`

Como o mesmo punhado de formas de entrada/saída recorre constantemente, o JDK as distribui prontas em `java.util.function`, então interfaces funcionais customizadas só são necessárias para formas que a biblioteca padrão não cobre:

```java
Function<String, Integer> length   = String::length;       // T -> R
Predicate<String> isEmpty          = String::isEmpty;      // T -> boolean
Supplier<List<String>> newList     = ArrayList::new;        // () -> R
Consumer<String> print             = System.out::println;  // T -> void
BiFunction<Integer, Integer, Integer> add = Integer::sum;  // (T, U) -> R
UnaryOperator<Integer> square      = n -> n * n;            // T -> T
BinaryOperator<Integer> max        = Integer::max;          // (T, T) -> T
```

`Predicate` adiciona métodos default (`and`, `or`, `negate`) para compor condições, e `Function` adiciona `andThen`/`compose` para encadeamento — ambos constroem um novo lambda a partir de dois já existentes em vez de escrever um corpo combinado à mão. Variantes especializadas para primitivos (`IntFunction`, `IntPredicate`, `ToIntFunction`, `IntUnaryOperator`, ...) existem puramente para evitar autoboxing de `int`/`long`/`double` via `Integer`/`Long`/`Double` a cada chamada.

### Captura de variáveis e a regra effectively-final

Um lambda pode livremente ler e escrever um campo de instância ou `static` de sua classe envolvente, e tem acesso ao `this` da instância envolvente (um lambda não ganha um `this` próprio). Uma variável *local* do escopo envolvente é diferente: pode ser lida, mas só se for **effectively final** — nunca reatribuída depois de sua primeira atribuição, esteja ela de fato declarada `final` ou não.

```java
int num = 10;
MyFunc myLambda = () -> System.out.println("num is " + num);  // fine — num never changes
```

```java
int num = 10;
MyFunc myLambda = () -> System.out.println("num is " + num);
num++;   // compile error: local variables referenced from a lambda expression
         // must be final or effectively final
```

A restrição existe porque o lambda pode sobreviver ao stack frame que declarou `num` — capturar um snapshot do valor é seguro, capturar uma variável que poderia mudar por baixo do lambda não é.

### Referências a método: quatro tipos

Uma referência a método (`::`) é uma forma de apontar para um método ou construtor existente sem chamá-lo — avaliada em um contexto de tipo alvo, ela produz uma instância da interface funcional compatível, exatamente como um lambda faria.

```java
// 1. static method reference — ClassName::methodName
outStr = stringOp(MyStringOps::strReverse, inStr);

// 2. bound instance method reference — objRef::methodName (object fixed at the reference)
MyStringOps strOps = new MyStringOps();
outStr = stringOp(strOps::strReverse, inStr);

// 3. unbound instance method reference — ClassName::instanceMethodName
//    the functional interface's first parameter supplies the invoking object,
//    the rest map to the method's own parameters: func(a, b) compiles as a.sameTemp(b)
int matches = counter(highTemps, HighTemp::sameTemp, highTemps[0]);

// 4. constructor reference — ClassName::new (and Type[]::new for arrays)
MyFunc<Integer> myClassCons = MyClass::new;
MyClass<Integer> mc = myClassCons.func(100);
MyArrayCreator<MyClass> arrCreator = MyClass[]::new;
MyClass[] twoElements = arrCreator.func(2);
```

Um método de superclasse também pode ser referenciado explicitamente com `super::name` ou `TypeName.super::name` (a segunda forma quando o tipo envolvente implementa mais de uma interface declarando `name`). Referências a método para métodos genéricos ou classes genéricas podem carregar um argumento de tipo explícito logo após o `::` (`MyArrayOps::<Integer>countMatching`), embora normalmente seja inferido e raramente precise ser escrito.

### Resolução de overload e ambiguidade

Como um lambda não tem tipo próprio — só o tipo alvo que o contexto atribui a ele — passar um para um método sobrecarregado pode ser ambíguo quando dois overloads aceitam interfaces funcionais diferentes que por acaso têm a mesma forma de método:

```java
interface Sayable { void say(); }
interface Doable  { void doIt(); }

void run(Sayable s) { s.say(); }
void run(Doable d)  { d.doIt(); }

run(() -> System.out.println("hi"));   // compile error: reference to run is ambiguous
```

`Sayable` e `Doable` são ambas "sem parâmetros, retorna void", então o lambda sem argumentos é compatível com qualquer um dos overloads e o compilador não tem base para preferir um. Um cast escolhe o tipo alvo explicitamente e resolve isso: `run((Sayable) () -> System.out.println("hi"));`.

## Trade-offs

- **A captura effectively-final é aplicada em tempo de compilação, não deixada por convenção.** Uma variável local que um lambda lê nunca pode ser reatribuída em nenhum lugar do seu escopo, dentro do lambda ou fora — isso é o que torna a captura segura, mas exclui padrões (uma variável de loop acumuladora, um contador mutável) que funcionariam bem em uma classe interna nomeada guardando um campo.
  ```java
  int total = 0;
  Runnable r = () -> System.out.println(total);
  total++;   // compile error: total is no longer effectively final
  ```
- **Duas interfaces funcionais com a mesma forma de método tornam uma chamada com overload ambígua**, porque o próprio lambda não carrega tipo nenhum para desambiguar — só um cast explícito para a interface pretendida resolve isso (veja o exemplo `Sayable`/`Doable` acima).
- **As exceções checadas de um lambda já precisam estar declaradas no método abstrato da interface funcional** — o lambda não pode introduzir uma exceção checada que a interface não prometeu.
  ```java
  interface DoubleNumericArrayFunc { double func(double[] n); }  // no throws clause

  DoubleNumericArrayFunc average = (n) -> {
      if (n.length == 0) throw new EmptyArrayException();  // compile error unless
      // ...                                                // func() declares "throws EmptyArrayException"
  };
  ```
- **Um lambda é mais difícil de debugar do que um método nomeado.** Stack traces mostram um nome de frame sintético como `lambda$main$0` em vez de um nome de método descritivo, e vários lambdas na mesma linha de código-fonte não dão ao debugger nada para distingui-los — extrair um corpo de lambda não trivial para um método nomeado (e referenciá-lo com `::`) muitas vezes se paga na primeira vez que precisa de um breakpoint.

## Documentation Links

- [java.util.function — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/package-summary.html) — doc
- [Function — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Function.html) — doc
- [Predicate — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Predicate.html) — doc
- [Supplier — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/function/Supplier.html) — doc
- [Java Language Specification — Section 15.27, Lambda Expressions](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.27) — doc
- [JEP 456: Unnamed Variables & Patterns](https://openjdk.org/jeps/456) — doc
