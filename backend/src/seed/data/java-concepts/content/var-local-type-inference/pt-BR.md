---
version: 1.0
updatedAt: 2026-08-18
title: "var: Inferência de Tipo de Variável Local"
summary: "var permite que o compilador infira o tipo estático de uma variável local a partir do seu inicializador — não é tipagem dinâmica nem Object, e combiná-lo com o operador diamond silenciosamente produz ArrayList<Object>."
---
## Objective

Entender `var` (JEP 286, Java 10): uma forma de *inferência de tipo de variável local*, em que o compilador deriva o tipo estático da variável a partir do seu inicializador em tempo de compilação. `var` não é tipagem dinâmica nem um sinônimo de `Object` — o tipo inferido é fixado para sempre naquela declaração e é imposto exatamente com o mesmo rigor de se você o tivesse escrito por extenso. Seu valor está em remover ruído de tipo redundante quando o lado direito já declara o tipo (`var list = new ArrayList<String>();`), não em economizar teclas por economizar.

## Use Cases

- Eliminar um nome de tipo duplicado quando uma chamada de construtor ou factory já o anuncia, especialmente para tipos genéricos longos (`var users = new ArrayList<User>();`, `var index = new ConcurrentHashMap<String, List<Order>>();`).
- Loops `for` aprimorados e try-with-resources, em que o tipo declarado só repete o que já está visível do lado direito (`for (var entry : map.entrySet())`).
- Locais que guardam o resultado de uma chamada encadeada de stream ou builder cujo tipo é verboso, mas óbvio pelas linhas ao redor.
- Capturar o tipo de uma expressão de classe anônima — incluindo membros que ela declara além do seu supertipo — o que não pode ser escrito explicitamente de forma alguma.

## Deep Dive

### Onde `var` é permitido

`var` é legal apenas para variáveis *locais* que têm um inicializador, além das variáveis de loop e de recurso, que são locais disfarçadas:

```java
var greeting = "hello";                        // String
var counts = new HashMap<String, Integer>();   // HashMap<String, Integer>

for (var entry : counts.entrySet()) { }        // enhanced-for element
for (var i = 0; i < 10; i++) { }               // basic-for init clause

try (var in = Files.newInputStream(path)) { }  // try-with-resources
```

`var` é um *nome de tipo reservado*, não uma palavra-chave, então código existente que usa `var` como identificador continua compilando:

```java
int var = 3;                 // legal: var is not a keyword
var var = 3;                 // also legal, and also a terrible idea
```

### Onde `var` é proibido

Toda posição abaixo é um erro de compilação, porque a inferência só roda contra um inicializador local.

Campos — de instância ou estáticos — não têm inferência nenhuma:

```java
class Account {
    var balance = 0L;        // error: 'var' is not allowed here
    static var RATE = 0.05;  // error: 'var' is not allowed here
}
```

```java
class Account {
    long balance = 0L;       // fixed: write the type
    static double RATE = 0.05;
}
```

Parâmetros de método e tipos de retorno fazem parte da assinatura, contra a qual quem chama compila:

```java
var total(var amounts) { }   // error: 'var' is not allowed here (twice)
```

```java
long total(List<Long> amounts) { return 0L; }   // fixed
```

Parâmetros de cláusula catch nomeiam o tipo sendo capturado, que é o que seleciona o handler:

```java
try {
    Files.readString(path);
} catch (var e) {            // error: 'var' is not allowed here
    e.printStackTrace();
}
```

```java
try {
    Files.readString(path);
} catch (IOException e) {    // fixed
    e.printStackTrace();
}
```

Uma declaração sem inicializador não dá ao compilador nada de onde inferir — e o mesmo vale para um inicializador de array isolado, que por si só precisa de um tipo alvo:

```java
var x;                       // error: cannot infer type for local variable x
var nums = {1, 2, 3};        // error: array initializer needs an explicit target type
```

```java
String x = null;             // fixed: declare the type
var nums = new int[] {1, 2, 3};
```

A sintaxe legada de "colchetes depois do nome" para arrays não pode se combinar com `var`, e o mesmo vale para uma declaração composta:

```java
var arr[] = new int[3];      // error: 'var' is not allowed as an element type of an array
var a = 1, b = 2;             // error: 'var' is not allowed in a compound declaration
```

```java
var arr = new int[3];        // fixed
var a = 1;
var b = 2;
```

### `var` em parâmetros de lambda (Java 11+), tudo ou nada

Desde o Java 11, os parâmetros formais de uma lambda podem usar `var`, o que é o que permite anexar uma anotação ou um modificador a um parâmetro que, de outra forma, teria tipo implícito. A regra é que a lista de parâmetros precisa ser uniforme:

```java
BinaryOperator<Integer> ok = (var x, var y) -> x + y;   // fine: all var
```

```java
BinaryOperator<Integer> mixed1 = (var x, y) -> x + y;       // error: cannot mix 'var' and implicitly typed parameters
BinaryOperator<Integer> mixed2 = (var x, Integer y) -> x + y; // error: cannot mix 'var' and explicitly typed parameters
```

```java
BinaryOperator<Integer> a = (x, y) -> x + y;                 // fixed: all implicit
BinaryOperator<Integer> b = (Integer x, Integer y) -> x + y; // or all explicit
BinaryOperator<Integer> c = (var x, var y) -> x + y;         // or all var
```

Um único parâmetro `var` também mantém os parênteses — `var x -> x` não compila, só `(var x) -> x`.

### A inferência lê o tipo *estático* do inicializador

O tipo inferido é o que o compilador calcula estaticamente para o lado direito, não a classe em tempo de execução do valor:

```java
Object o = "hello";
var copy = o;                // copy is Object, not String
copy.length();               // error: cannot find symbol 'length' on Object
```

```java
CharSequence cs = "hello";
var s = cs.toString();       // s is String — the *declared return type* of toString()
```

É isso que faz a pegadinha do diamond morder. `new ArrayList<>()` infere seu argumento de tipo a partir de um tipo alvo; com `var` do lado esquerdo não há tipo alvo, então o único que sobra é `Object`:

```java
var list = new ArrayList<>();   // infers ArrayList<Object>, not a placeholder
list.add("a");
list.add(42);                   // compiles happily — everything is an Object
String first = list.get(0);     // error: incompatible types: Object cannot be converted to String
```

```java
var list = new ArrayList<String>();   // fixed: state the type argument
List<String> other = new ArrayList<>(); // or keep the explicit type and let diamond infer
```

Dois recursos de inferência que funcionam bem sozinhos se combinam num alargamento silencioso para `Object`.

### `var` captura tipos de classe anônima

Uma classe anônima tem um tipo que não tem nome, então ele não pode ser escrito em uma declaração. Declarar a variável como seu supertipo descarta esse tipo; `var` o preserva:

```java
Object obj = new Object() {
    void greet() { System.out.println("hi"); }
};
obj.greet();                 // error: cannot find symbol — Object has no greet()
```

```java
var obj = new Object() {
    void greet() { System.out.println("hi"); }
};
obj.greet();                 // works: obj has the anonymous class's own type
```

Essa é uma capacidade que `var` desbloqueia de forma exclusiva, não uma preferência de formatação. O mesmo se aplica a tipos de interseção produzidos por uma expressão condicional, que também não têm um nome que possa ser escrito.

### `null` sozinho não carrega tipo nenhum

`null` é atribuível a todo tipo de referência, então ele não fixa nada:

```java
var x = null;                // error: variable initializer is 'null'
```

Um cast fornece o tipo que faltava, e qualquer expressão tipada também:

```java
var x = (String) null;       // fine: x is String
var y = Optional.<String>empty().orElse(null);   // fine: y is String
```

### A captura effectively-final continua igual

A inferência muda como o tipo é escrito, não como a variável se comporta. Uma local `var` capturada por uma lambda ou classe interna ainda precisa ser final ou effectively final:

```java
var name = "ada";
name = "grace";                          // reassignment makes it *not* effectively final
Runnable r = () -> System.out.println(name);
// error: local variables referenced from a lambda expression must be final or effectively final
```

```java
var name = "ada";                        // never reassigned → effectively final
Runnable r = () -> System.out.println(name);   // fine
```

Locais `var` também podem ser marcadas como `final var` quando você quer deixar a restrição explícita.

## Trade-offs

- **A legibilidade corta nos dois sentidos** — `var` é uma vitória clara quando o inicializador nomeia o tipo, e uma perda clara quando o inicializador é uma chamada opaca. Na segunda forma, quem lê precisa consultar a assinatura do método ou depender de uma IDE para responder "o que é isso?", que é a crítica mais citada contra o uso excessivo de `var`:

```java
var users = new ArrayList<User>();   // obvious
var result = process(input);         // what is result? nothing on this line says
```

- **Literais numéricos inferem `int`, silenciosamente** — uma variável declarada explicitamente deixa o compilador alargar ou estreitar o literal contra o tipo declarado; `var` não tem tipo declarado para o qual alargar, então você precisa guiá-lo com um sufixo ou um cast:

```java
long id = 0;        // widened to long by the declared type
byte flag = 5;      // narrowed to byte by the declared type
var id2 = 0;        // int — not long
var flag2 = 5;      // int — not byte
var id3 = 0L;       // fixed: the suffix carries the type
var flag3 = (byte) 5;
```

- **`var` mais diamond silenciosamente produz `Object`** — os dois recursos de inferência se cancelam mutuamente, e o erro geralmente aparece longe da declaração, como um erro de compilação confuso ou uma `ClassCastException` depois de um salto sem checagem:

```java
var names = new ArrayList<>();   // ArrayList<Object>, though a List<String> was intended
names.add(42);                   // no complaint here
```

- **Custo zero em runtime** — o tipo é resolvido e embutido no arquivo de classe em tempo de compilação, então `var` emite exatamente o mesmo bytecode, byte a byte, que a declaração explícita. Não há checagem de tipo em runtime, nem reflexão, nem efeito na compatibilidade binária da classe envolvente; supor o contrário é um mal-entendido comum sobre o recurso.

- **Convenção de equipe importa mais que a regra** — como a linguagem permite `var` em qualquer lugar em que uma local seja permitida, a consistência precisa vir de um acordo de estilo (por exemplo: usar quando o lado direito é um construtor ou um cast, evitar para chamadas de método simples). Sem um, um código-base acaba misturando os dois estilos linha a linha sem nenhum motivo perceptível.

## Documentation Links

- [Local Variable Type Inference — Java SE developer guide](https://docs.oracle.com/en/java/javase/25/language/local-variable-type-inference.html) — doc
- [JEP 286: Local-Variable Type Inference](https://openjdk.org/jeps/286) — doc
