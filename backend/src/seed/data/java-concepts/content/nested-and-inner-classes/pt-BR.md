---
version: 1.0
updatedAt: 2026-08-19
title: Classes Aninhadas e Internas
summary: Os quatro tipos de classe-dentro-de-classe — nested static, inner, local e anônima — diferem pela quantidade de contexto do enclosing que cada uma captura, e saber qual delas você escreveu revela o que ela alcança, o que mantém vivo em memória, e se uma lambda ou um record diriam a mesma coisa melhor.
---
## Objective

Uma *nested class* é qualquer classe declarada dentro de outra classe ou dentro de um método. Java tem quatro tipos, e eles diferem em exatamente um eixo: **quanto do contexto do enclosing cada uma captura**. Uma classe nested `static` não captura nada. Uma inner class (uma member class não-`static`) captura a *instância* do enclosing. Uma local class captura a instância do enclosing *e* locals effectively final. Uma anonymous class é uma local class sem nome, declarada e instanciada em uma única expressão. Saber qual tipo você escreveu diz o que ela alcança, o que a mantém viva em memória, e se uma lambda ou um `record` diriam a mesma coisa com menos código.

## Use Cases

- Um holder de dados privado ou um tipo de nó usado só por uma classe — um `Node`, `Entry` ou `Builder` nested `static` que não tem motivo para se referir de volta ao seu dono.
- Uma view ou iterator sobre o estado do objeto enclosing — uma inner class, porque ela genuinamente precisa dos campos da instância enclosing para fazer seu trabalho.
- Uma classe auxiliar necessária a exatamente um método, onde promovê-la a member ampliaria seu escopo sem motivo — uma local class.
- Uma implementação avulsa que precisa dos próprios campos, de vários métodos, ou de uma superclasse — uma anonymous class, onde uma lambda não consegue chegar.
- Uma implementação avulsa de uma interface de método único — escreva uma **lambda** em vez de uma anonymous class; esse é o padrão moderno.
- Capturar um tipo genérico completo em runtime (um "supertype token") — um dos poucos lugares restantes onde uma anonymous class é necessária e uma lambda não consegue substituir.

## Deep Dive

### Os quatro tipos lado a lado

```java
public class Demo {
    private int count = 7;

    static class Node<T> {                 // 1. static nested: no enclosing instance
        T value;
        Node(T v) { value = v; }
    }

    class Counter {                        // 2. inner: has an enclosing Demo
        int doubled() { return count * 2; }
    }

    void locals() {
        int base = 10;
        class Local {                      // 3. local: captures `base` and the enclosing Demo
            int plus() { return base + count; }
        }
        System.out.println(new Local().plus());   // 17
    }

    Runnable anon() {                      // 4. anonymous: declared and instantiated at once
        return new Runnable() {
            @Override public void run() { System.out.println(count); }
        };
    }
}
```

Cada tipo ganha seu próprio arquivo de classe, e o esquema de nomeação diz qual é qual:

```
Demo.class            Demo$Node.class       ← static nested / inner: Outer$Name
Demo$Counter.class    Demo$1Local.class     ← local: Outer$<n><Name>
Demo$1.class                                ← anonymous: Outer$<n>, no name at all
```

Uma lambda não produz nenhum arquivo de classe — ela é gerada em runtime:

```java
System.out.println(anon().getClass().getName());  // Demo$1
System.out.println(lam().getClass().getName());   // Demo$$Lambda/0x00007fe001042a38
```

### static nested vs. inner: a referência sintética ao enclosing

A diferença não é apenas estilística. Uma inner class que usa a instância enclosing ganha um campo sintético `this$0` que a segura, e seu construtor recebe a instância enclosing como um primeiro parâmetro oculto:

```java
class InnerIter implements Iterator<String> {   // inner
    int i = 0;
    public boolean hasNext() { return i < items.size(); }
    public String next() { return items.get(i++); }
}

static class StaticIter implements Iterator<String> {  // static nested
    private final List<String> snapshot;
    int i = 0;
    StaticIter(List<String> snapshot) { this.snapshot = snapshot; }
    public boolean hasNext() { return i < snapshot.size(); }
    public String next() { return snapshot.get(i++); }
}
```

Reflita sobre as duas e a instrumentação oculta aparece:

```java
InnerIter  ctor: [class Leak]        fields: [int i, final Leak this$0]
StaticIter ctor: [interface List]    fields: [private final List snapshot, int i]
```

Uma classe nested `static` *não pode* carregar essa referência, então também não pode ler o estado da instância — essa é a troca que você está fazendo:

```java
public class E2 {
    int field = 1;
    static class Nested {
        int read() { return field; }
    }
}
// error: non-static variable field cannot be referenced from a static context
```

### Instanciar uma inner class exige uma instância enclosing

Como uma inner class tem uma instância enclosing implícita, `new Inner()` só funciona onde `this` está disponível. A partir de um contexto estático, falha:

```java
public class E1 {
    class Inner { int x; }
    static void tryIt() {
        Inner i = new Inner();
    }
}
// error: non-static variable this cannot be referenced from a static context
```

A forma qualificada fornece a instância enclosing explicitamente:

```java
Demo d = new Demo();
Demo.Counter c = d.new Counter();      // the `outer.new Inner()` syntax
```

### Local classes: captura e o relaxamento do Java 16

Uma local class enxerga os locals effectively final do seu método. Reatribuir um local capturado é um erro de compilação:

```java
void m() {
    int base = 1;
    Supplier<Integer> s = () -> base;
    base = 2;
}
// error: local variables referenced from a lambda expression must be final or effectively final
```

Desde o JDK 16 (JEP 395), o corpo de um método também pode declarar `record`, `enum` e `interface` locais — todos implicitamente static, então não capturam nada:

```java
void locals() {
    record Pair(String k, int v) {}          // local record — implicitly static
    class Local { int plus() { return 1; } } // local class — captures
    System.out.println(new Pair("a", 1));    // Pair[k=a, v=1]
}
```

A mesma JEP derrubou a regra antiga de que uma inner class não podia declarar membros `static`, então isto agora compila:

```java
class Counter {
    static final String KIND = "counter";    // legal since JDK 16; was a compile error before
}
```

Qualquer material sobre Java anterior ao JDK 16 vai te dizer que inner classes não podem ter membros `static` — essa regra não existe mais.

### Anonymous classes: o que a sintaxe consegue e não consegue expressar

A forma `new Type() { ... }` declara uma classe que estende ou implementa `Type` e a instancia de uma vez. Ela não tem nome, então não pode ter construtor:

```java
Comparator<String> c = new Comparator<String>() {
    Comparator(int n) {}
    public int compare(String a, String b) { return 0; }
};
// error: invalid method declaration; return type required
```

A inicialização precisa passar por inicializadores de campo ou por um bloco de inicialização de instância. O que uma anonymous class *tem* é sua própria identidade: `this` se refere à instância anônima, e a instância enclosing precisa da forma qualificada.

```java
Runnable r = new Runnable() {
    @Override public void run() {
        System.out.println("anon this = " + this.getClass().getName());
        System.out.println("outer this = " + Demo.this.getClass().getName());
    }
};
// anon this = Demo$1
// outer this = Demo
```

### Quando uma lambda substitui uma anonymous class — e quando não

O idioma clássico de GUI é uma anonymous class implementando uma interface de método único:

```java
button.addActionListener(new ActionListener() {
    @Override public void actionPerformed(ActionEvent evt) {
        System.out.println("Thanks for pressing me");
    }
});
```

Para qualquer interface *funcional* — um único método abstrato — a lambda é a forma moderna, e essa recomendação não mudou:

```java
button.addActionListener(evt -> System.out.println("Thanks for pressing me"));
```

Uma lambda não é uma classe, então quatro coisas mantêm as anonymous classes vivas.

Um alvo do tipo classe *abstrata* não é uma interface funcional:

```java
abstract static class Task { abstract void run(); }
Task t = () -> System.out.println("x");
// error: incompatible types: Task is not a functional interface
```

`this` dentro de uma lambda é a instância *enclosing*, não a lambda — então uma lambda não consegue se referir a si mesma, e a recursão falha:

```java
IntUnaryOperator fact = n -> n <= 1 ? 1 : n * fact.applyAsInt(n - 1);
// error: variable fact might not have been initialized
```

Uma anonymous class tem um `this` de verdade e recursa sem problemas:

```java
IntUnaryOperator fact = new IntUnaryOperator() {
    public int applyAsInt(int n) { return n <= 1 ? 1 : n * this.applyAsInt(n - 1); }
};
System.out.println(fact.applyAsInt(5));   // 120
```

E uma *subclasse* anônima registra seu supertipo genérico no arquivo de classe, que é como os supertype tokens funcionam — uma lambda não tem supertipo para inspecionar:

```java
static abstract class TypeRef<T> {
    Type type() {
        return ((ParameterizedType) getClass().getGenericSuperclass()).getActualTypeArguments()[0];
    }
}

var tok = new TypeRef<Map<String, List<Integer>>>() {};
System.out.println(tok.type());
// java.util.Map<java.lang.String, java.util.List<java.lang.Integer>>
```

### Quando um record substitui um data holder nested

O idioma da era dos livros para uma tupla privada é uma nested class `static` mutável:

```java
public class AllClasses {
    public class Data {
        int x;
        int y;
    }
}
```

Se ela é de fato só um par de valores, um `record` nested é a declaração mais curta e mais segura — é implicitamente static, imutável, e traz `equals`/`hashCode`/`toString` de brinde:

```java
public class AllClasses {
    record Data(int x, int y) {}
}
```

Recorra a uma classe nested `static` em vez disso quando o holder for genuinamente mutável, precisar estender algo, ou precisar esconder parte do seu estado.

### Classe top-level package-private vs. classe nested

Uma classe que não é `public` também pode simplesmente viver ao lado da classe principal, no mesmo arquivo. Ela não é nested, então não tem instância enclosing e não tem `$` no nome — e é um membro de primeira classe do seu pacote, usável pelo nome simples em qualquer lugar daquele pacote:

```java
public class AllClasses {
    record Data(int x, int y) {}
}

/** Same file as AllClasses, but a separate top-level class. */
class AnotherClass {
    AnotherClass() {
        Data d = new Data(1, 2);
    }
}
// error: cannot find symbol — symbol: class Data, location: class AnotherClass
```

O `Data` nested é package-private, então é *alcançável*, mas só através da sua classe enclosing — seu nome simples está escopado a `AllClasses`:

```java
class AnotherClass {
    AnotherClass() {
        AllClasses.Data d = new AllClasses.Data(1, 2);   // compiles: Data[x=1, y=2]
    }
}
```

Essa qualificação extra é todo o ponto: aninhar diz "isso pertence a `AllClasses`". Use uma classe top-level separada quando o helper for infraestrutura no nível do pacote que outras classes legitimamente precisam nomear diretamente.

## Trade-offs

- **Uma inner class mantém o objeto enclosing vivo** — a referência sintética `this$0` significa que uma instância inner de vida longa (um iterator cacheado, um listener registrado) prende todo o objeto enclosing em memória. Tornar a classe `static` é o conserto fiscalizável, porque aí a linguagem proíbe a referência:

```java
class InnerIter implements Iterator<String> { /* uses items */ }
// fields: [int i, final Leak this$0]   ← holds the enclosing Leak

static class StaticIter implements Iterator<String> { /* takes a snapshot */ }
// fields: [private final List snapshot, int i]   ← no this$0 possible
```

- **`static` custa acesso, não só retenção** — a mesma remoção de `this$0` é o motivo pelo qual uma classe nested `static` não consegue ler os campos da instância enclosing, então a escolha é retenção versus alcance, não "static é sempre melhor".

- **Anonymous classes não podem ser construídas, reutilizadas ou nomeadas** — nenhum construtor é permitido, o tipo não tem nome para declarar uma variável, e referir-se a `OtherClass$1` de outro lugar é pego em tempo de compilação. Se você precisa de qualquer uma dessas coisas, deveria ter sido uma named class:

```java
Comparator<String> c = new Comparator<String>() {
    Comparator(int n) {}          // error: invalid method declaration; return type required
    public int compare(String a, String b) { return 0; }
};
```

- **Lambdas são mais concisas, mas estritamente menos capazes** — elas só têm como alvo interfaces funcionais, e seu `this` é a instância enclosing, então sem autorreferência e sem supertype token:

```java
IntUnaryOperator fact = n -> n <= 1 ? 1 : n * fact.applyAsInt(n - 1);
// error: variable fact might not have been initialized
```

- **`javac` pode elidir uma referência ao enclosing não usada, mas não projete contando com isso** — uma inner class que nunca toca a instância enclosing atualmente não ganha um campo `this$0`, mas seu construtor ainda exige uma instância; adicionar uma única referência a um campo externo silenciosamente reinstaura o campo. Trate `static` como a garantia e a elisão como um detalhe de otimização.

```java
class NeverUsesOuter { int n = 1; }
// ctor: [class T2]   fields: [int n]   ← param kept, field elided
```

- **Declarações profundamente aninhadas prejudicam a legibilidade** — uma anonymous class dentro de uma local class dentro de uma inner class é legal e ilegível. O ponto de aninhar é sinalizar "isso só existe para seu dono"; passado um nível de aninhamento, esse sinal se perde e uma classe top-level ou package-private nomeada comunica melhor.

## Documentation Links

- [Inner Classes and Enclosing Instances — JLS 8.1.3 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.1.3) — doc
- [Local Class and Interface Declarations — JLS 14.3 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.3) — doc
- [Anonymous Class Declarations — JLS 15.9.5 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.9.5) — doc
- [Nested Classes — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/javaOO/nested.html) — doc
- [Lambda Expressions — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/javaOO/lambdaexpressions.html) — doc
- [JEP 395: Records — relaxed static members in inner classes, local records](https://openjdk.org/jeps/395) — doc
