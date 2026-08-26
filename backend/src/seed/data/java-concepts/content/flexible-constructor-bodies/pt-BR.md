---
version: 1.0
updatedAt: 2026-08-19
title: Corpos de Construtor Flexíveis
summary: "Desde o JDK 25, um construtor pode executar statements antes de super(...) ou this(...), dividindo seu corpo em um prólogo que valida argumentos e inicializa seus próprios campos e um epílogo que finalmente pode usar o objeto em construção."
---
## Objective

Durante a maior parte da história do Java, o corpo de um construtor tinha que *começar* com `super(...)` ou `this(...)`, então validação e preparação de argumentos precisavam ser contrabandeadas para um método estático auxiliar ou para a própria lista de argumentos. **Corpos de construtor flexíveis** (JEP 513, finalizado no JDK 25) derrubam essa regra sintática: statements agora podem aparecer antes da invocação explícita de construtor. Esses statements formam o *prólogo* do construtor; tudo depois da invocação é o *epílogo*. Código do prólogo roda em um *early construction context*, onde não pode tocar no objeto em construção — com uma exceção deliberada: pode atribuir campos declarados na sua própria classe que não têm inicializadores. Essa exceção é o que permite que uma subclasse se inicialize completamente *antes* que um construtor de superclasse possa observá-la.

## Use Cases

- Falhar rápido em argumentos inválidos antes de fazer o trabalho potencialmente desperdiçado de rodar o construtor da superclasse.
- Computar um valor não trivial uma vez e usá-lo para vários argumentos do construtor da superclasse, em vez de uma cadeia de helpers estáticos.
- Inicializar campos da subclasse *antes* de `super(...)`, para que um construtor de superclasse que chama um método sobrescrevível não possa observá-los como `null` ou `0`.
- Normalizar ou transformar um argumento (trim, parse, clamp, default) em forma de statement legível em vez de aninhado dentro da chamada `super(...)`.
- Validar os argumentos de um construtor não canônico de um `record` antes de delegar para o canônico com `this(...)`.
- Substituir o idioma `super(..., verifyAge(age))`, onde um helper `private static` existia só para satisfazer a regra antiga.

## Deep Dive

### A restrição antiga e o workaround do helper estático

Suponha que `Person` aceite qualquer idade não negativa, mas um `Employee` precise ter entre 18 e 67. Sob a regra antiga, a checagem só podia rodar *depois* do construtor da superclasse:

```java
class Employee extends Person {
    Employee(int age) {
        super(age);                 // potentially unnecessary work runs first
        if (age < 18 || age > 67)
            throw new IllegalArgumentException("age out of range: " + age);
    }
}
```

Para falhar rápido, você tinha que içar a checagem para um método `static` e embutir a chamada como um argumento:

```java
class Employee extends Person {
    private static int verifyAge(int value) {
        if (value < 18 || value > 67)
            throw new IllegalArgumentException("age out of range: " + value);
        return value;
    }
    Employee(int age) {
        super(verifyAge(age));      // the only place code could run
    }
}
```

No JDK 25 a checagem é só um statement:

```java
class Employee extends Person {
    Employee(int age) {
        if (age < 18 || age > 67)
            throw new IllegalArgumentException("age out of range: " + age);
        super(age);                 // now fails fast, no helper needed
    }
}
```

Isso é linguagem padrão, não uma preview. Compila com um simples `javac Employee.java` — sem `--enable-preview`. Compilar para uma release mais antiga é que falha:

```
$ javac --release 24 Fcb.java
error: flexible constructors is not supported in -source 24
  (use -source 25 or higher to enable flexible constructors)
```

### Prólogo, epílogo, e a nova ordem de execução

O corpo de um construtor agora tem duas fases. O **prólogo** é o código antes da invocação explícita de construtor; o **epílogo** é o código depois dela.

```java
class D extends C {
    D() {
        // D prologue
        super();
        // D epilogue
    }
}
```

Prólogos rodam de baixo para cima conforme os construtores são invocados, depois os epílogos rodam de cima para baixo conforme eles retornam:

```
D prologue
--> C prologue
    --> B prologue
        --> A prologue
            --> Object constructor body
        --> A epilogue
    --> B epilogue
--> C epilogue
D epilogue
```

Se um construtor não tem invocação explícita, um `super()` implícito ainda é considerado como estando bem no início, então o corpo inteiro é epílogo e o prólogo é vazio. Código existente, portanto, se comporta exatamente como antes.

### Inicializando campos antes de super(...) — o ganho de segurança

A armadilha clássica: um construtor de superclasse chama um método que a subclasse sobrescreve, e a sobrescrita lê um campo da subclasse que ainda não foi atribuído.

```java
class Person {
    final int age;
    void show() { System.out.println("Age: " + age); }
    Person(int age) {
        if (age < 0) throw new IllegalArgumentException("negative age");
        this.age = age;
        show();                     // calls the override in Employee
    }
}

class Employee extends Person {
    String officeID;
    Employee(int age, String officeID) {
        super(age);
        this.officeID = officeID;   // too late — show() already ran
    }
    @Override void show() { System.out.println("Age: " + age + ", Office: " + officeID); }
}
```

`new Employee(42, "CAM-FORA")` imprime `Age: 42, Office: null`. Mover a atribuição para o prólogo corrige isso:

```java
class Employee extends Person {
    String officeID;
    Employee(int age, String officeID) {
        if (age < 18 || age > 67)
            throw new IllegalArgumentException("age out of range: " + age);
        this.officeID = officeID;   // assigned BEFORE super(...)
        super(age);
    }
    @Override void show() { System.out.println("Age: " + age + ", Office: " + officeID); }
}
```

```
Age: 42, Office: CAM-FORA
caught: age out of range: 9
```

Chamar métodos sobrescrevíveis a partir de um construtor ainda é má prática, mas agora uma subclasse pode se defender contra uma superclasse que faz isso.

### Early construction context: o que o prólogo não pode fazer

O prólogo e a lista de argumentos da invocação explícita formam juntos um **early construction context**. Código ali não pode usar `this`, explícita ou implicitamente. O único uso permitido da instância é uma *atribuição simples* a um campo declarado na mesma classe cuja declaração não tem inicializador:

```java
public class X1 {
    int i;
    String s = "hello";
    X1() {
        i = 42;                  // OK - uninitialized declared field
        s = "goodbye";           // error: cannot assign initialized field 's'
                                 //        before supertype constructor has been called
        super();
    }
}
```

Qualquer outro toque na instância é rejeitado:

```java
public class X2 {
    int i;
    X2(int n) {
        System.out.println(this);   // error: cannot reference this before supertype constructor...
        var x = this.i;             // error: cannot reference this ...
        var y = i;                  // error: cannot reference i ...
        hashCode();                 // error: cannot reference hashCode() ...
        super();
    }
}
```

`super` também está fora dos limites, já que os campos da superclasse ainda não existem:

```java
class Y3 { int i; void m() {} }
public class X3 extends Y3 {
    X3() {
        var x = super.i;   // error: cannot reference super before supertype constructor has been called
        super.m();         // error: cannot reference super ...
        super();
    }
}
```

Um statement `return` é legal no epílogo mas não no prólogo:

```java
public class X5 {
    X5(int n) {
        if (n < 0) return;
        super();
    }
}
// error: 'return' not allowed before explicit constructor invocation
```

Lançar uma exceção, por outro lado, é explicitamente permitido no prólogo — esse é justamente o ponto do fail-fast.

### Classes aninhadas: a instância envolvente está liberada

A instância envolvente de uma classe interna já existe antes da instância interna ser criada, então o prólogo *pode* usá-la — por nome simples ou via `Outer.this`:

```java
class Outer {
    int i = 5;
    void hello() { System.out.println("Hello from outer"); }
    class Inner {
        int j;
        Inner() {
            var x = i;               // OK - field of the enclosing instance
            var y = Outer.this.i;    // OK - explicitly qualified
            hello();                 // OK - method of the enclosing instance
            super();
            this.j = x + y;          // epilogue: `this` is now usable
        }
    }
}
// prints "Hello from outer", then 10
```

O caso espelhado é proibido. Dentro do próprio construtor de `Outer`, `new Inner()` realmente significa `this.new Inner()`, e `this` ainda não está disponível:

```java
public class X4 {
    class Inner {}
    X4() {
        var x = new Inner();
        super();
    }
}
// error: cannot reference this before supertype constructor has been called
```

### Records e enums

Um construtor canônico de record ainda não pode conter uma invocação explícita de construtor de forma alguma, então a divisão prólogo/epílogo não se aplica a ele:

```java
public record Canon(int v) {
    public Canon(int v) {
        if (v < 0) throw new IllegalArgumentException();
        super();
        this.v = v;
    }
}
// error: invalid canonical constructor in record Canon
//   (canonical constructor must not contain explicit constructor invocation)
```

Construtores não canônicos de record *se beneficiam*, porque delegam com `this(...)` e agora podem validar primeiro:

```java
public record Range(int lo, int hi) {
    Range(int hi) {
        if (hi < 0) throw new IllegalArgumentException("negative: " + hi);
        this(0, hi);
    }
}

new Range(5);    // Range[lo=0, hi=5]
new Range(-1);   // caught: negative: -1
```

Construtores de enum ganham o mesmo benefício para suas delegações `this(...)`; ainda não podem invocar um construtor de superclasse.

## Trade-offs

- **A invocação ainda precisa ser um statement de nível superior do corpo** — a JVM permitiria uma invocação por caminho de código, mas a gramática da linguagem não. Ramificar para duas chamadas `super(...)` diferentes é rejeitado, então a seleção genuinamente condicional de superclasse ainda precisa de uma static factory ou de um salto via `this(...)`:

```java
public class X8 {
    X8(int n) {
        if (n > 0) { super(); } else { super(); }
    }
}
// error: explicit constructor invocation not allowed here
```

- **Não utilizável se você compilar para uma release mais antiga** — o recurso é padrão no JDK 25, mas não há história de backport, então uma biblioteca que ainda mantém um baseline de JDK 21 ou JDK 17 não pode adotá-lo. Essa restrição afeta bibliotecas por muito mais tempo do que aplicações.

- **Campos com inicializadores não podem ser atribuídos no prólogo** — a regra é sobre campos declarados *não inicializados*, então a inicialização antes de `super()` só está disponível onde você também não escreveu um inicializador inline. Remover o inicializador para habilitar isso pode ser um refactor real:

```java
String s = "hello";
// in the prologue:
s = "goodbye";   // error: cannot assign initialized field 's' before supertype constructor has been called
```

- **Código do prólogo não pode chamar seus próprios helpers de instância** — um método de validação precisa ser `static` (ou movido para dentro do prólogo inline), que é exatamente a restrição sob a qual o idioma antigo do `verifyAge` vivia. O ganho é que o *call site* não precisa mais ser uma expressão de argumento:

```java
hashCode();   // error: cannot reference hashCode() before supertype constructor has been called
```

- **Ferramentas existentes assumiam o formato antigo** — linters, formatadores, style checkers, analisadores estáticos e highlighters de sintaxe há muito codificam "invocação de construtor vem primeiro". Alguns vão sinalizar código correto ou indentá-lo errado até serem atualizados.

- **Fica mais fácil escrever construtores que fazem coisa demais** — a restrição antiga desencorajava acidentalmente lógica pesada de construtor. Com a restrição removida, um construtor pode crescer um longo prólogo de validação e computação que um método static factory expressaria com mais clareza. Isso é um julgamento de caso a caso, não uma regra.

## Documentation Links

- [Flexible Constructor Bodies — Java Language Updates, Release 25](https://docs.oracle.com/en/java/javase/25/language/flexible-constructor-bodies.html) — doc
- [JEP 513: Flexible Constructor Bodies (final in JDK 25)](https://openjdk.org/jeps/513) — doc
- [JEP 447: Statements before super(...) (first preview, JDK 22)](https://openjdk.org/jeps/447) — doc
- [Constructor Body — JLS 8.8.7 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.8.7) — doc
- [Constructor Invocations — JLS 8.8.7.1 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.8.7.1) — doc
