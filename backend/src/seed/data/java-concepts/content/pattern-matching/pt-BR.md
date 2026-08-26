---
version: 1.0
updatedAt: 2026-07-26
title: Pattern Matching
summary: Como instanceof, switch e record patterns permitem testar a estrutura de um objeto e extrair seus dados em um único passo, em vez de fazer cast depois de checar o tipo.
---
## Objective

Entender pattern matching: um `pattern` é um teste realizado sobre um valor (o `target`) que, quando casa, tanto confirma a forma do valor quanto extrai dados dele para variáveis de pattern — substituindo o velho idiom "checa o tipo, depois faz cast" por uma única expressão.

## Use Cases

- Substituir `instanceof` + cast explícito por um único `instanceof` pattern que checa e vincula a variável ao mesmo tempo.
- Ramificar sobre uma hierarquia de tipos (ex.: um `Shape` sealed) com pattern labels de `switch` em vez de uma cadeia de `if`/`else instanceof`.
- Desestruturar um `record` diretamente em um `instanceof` ou em um label `case`, extraindo seus componentes sem chamar cada accessor manualmente.
- Adicionar condições extras a um case com guards `when`, sem aninhar um `if` dentro do corpo do case.
- Tratar `null` explicitamente como seu próprio label `case null` em vez de se proteger contra `NullPointerException` antes do `switch`.

## Deep Dive

### instanceof: pattern match vs comparação de tipo

`instanceof` continua funcionando como uma comparação de tipo simples, mas também age como o *operador de pattern match* quando seu operando direito é um pattern:

```java
if (s instanceof Rectangle r) {
    System.out.println(r.length() * r.width());
}
```

`Rectangle r` aqui é um **type pattern**: um tipo mais uma única variável de pattern. Se `s` é um `Rectangle`, o teste tem sucesso e `r` é inicializado com `s`, já em cast — sem precisar de um `(Rectangle) s` separado. Se falha, `r` simplesmente não está em escopo.

### Type patterns e generics: ainda só tipos reifiable

Vincular uma variável de pattern não relaxa a restrição de longa data do `instanceof` sobre tipos genéricos: o tipo de referência em um pattern ainda precisa ser **reifiable** — totalmente conhecido em runtime — então um tipo parametrizado como `List<String>` é ilegal, vincule ou não uma variável:

```java
static void plain(Object obj) {
    if (obj instanceof List<String>) { }        // error: Object cannot be safely cast to List<String>
}

static void withPattern(Object obj) {
    if (obj instanceof List<String> list) { }    // same error — the pattern variable changes nothing
}
```

Ambos falham com o mesmo erro de compilador, exatamente `Object cannot be safely cast to List<String>` — a conveniência de cast-e-vincular do pattern matching não vem com uma isenção especial do erasure. As únicas formas genéricas que `instanceof` aceita são o wildcard sem limite e o tipo raw, ambos reifiable:

```java
if (obj instanceof List<?> list) {   // legal: unbounded wildcard is reifiable
    System.out.println(list.size());
}

if (obj instanceof List list) {      // legal: raw type is reifiable
    list.add("oops");                // warning: [unchecked] unchecked call to add(E) as a member of the raw type List
}
```

O pattern de tipo raw compila sem problemas por si só — o warning `unchecked` só aparece onde o tipo raw é de fato *usado* de uma forma que o erasure não consegue verificar (aqui, `add`), a mesma regra que já se aplica a qualquer variável de tipo raw fora do pattern matching.

### Record patterns

Um **record pattern** combina um tipo record com uma lista de patterns que casa com seus componentes, então ele consegue desestruturar dados aninhados em um único passo:

```java
record Point(double x, double y) {}

if (obj instanceof Point(double a, double b)) {
    System.out.println(a + b);
}
```

Record patterns aninham, então um record de records pode ser achatado diretamente no pattern:

```java
record Line(Point start, Point end) {}

if (obj instanceof Line(Point(double x1, double y1), Point(double x2, double y2))) {
    System.out.println(Math.hypot(x2 - x1, y2 - y1));
}
```

### Pattern matching com switch

Patterns podem aparecer como labels `case`, transformando uma cadeia de checagens `instanceof` em um único `switch`:

```java
static double getArea(Shape s) {
    return switch (s) {
        case Rectangle r -> r.length() * r.width();
        case Circle c    -> c.radius() * c.radius() * Math.PI;
        default          -> throw new IllegalArgumentException("Unrecognized shape");
    };
}
```

Quando `Shape` é `sealed` e todo subtipo permitido tem um case, o compilador verifica a exaustividade sozinho e `default` pode ser removido.

### Guarded patterns (when)

Uma cláusula `when` anexa uma condição booleana a um label de pattern; o label só casa se o pattern *e* o guard forem verdadeiros:

```java
switch (obj) {
    case String s when s.length() == 1 -> System.out.println("Short: " + s);
    case String s                      -> System.out.println(s);
    default                             -> System.out.println("Not a string");
}
```

Guards não participam da checagem de dominância da mesma forma que patterns simples, então o compilador permite que um pattern com guard fique antes de um label constante com o qual também poderia casar.

### Tratando null explicitamente

`switch` costumava lançar `NullPointerException` sobre um seletor `null`. Um `switch` de pattern pode, em vez disso, casar com `null` diretamente:

```java
switch (obj) {
    case null     -> System.out.println("null!");
    case String s -> System.out.println("String");
    default       -> System.out.println("Something else");
}
```

`null` só pode ser combinado com `default` (`case null, default ->`), nunca com outro label de pattern.

### Exaustividade com tipos sealed

Sem `sealed`, o compilador não consegue saber todos os subtipos possíveis, então uma expressão `switch` de pattern sem `default` falha ao compilar:

```java
interface Shape {}
record Circle(double radius) implements Shape {}
record Rectangle(double length, double width) implements Shape {}

static double area(Shape s) {
    return switch (s) {           // error: the switch expression does not cover all possible input values
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.length() * r.width();
    };
}
```

Selar `Shape` a exatamente esses dois subtipos permitidos deixa o compilador provar que o `switch` é exaustivo, então ele compila sem `default`:

```java
sealed interface Shape permits Circle, Rectangle {}
record Circle(double radius) implements Shape {}
record Rectangle(double length, double width) implements Shape {}

static double area(Shape s) {
    return switch (s) {           // compiles: Circle + Rectangle cover every permitted subtype
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.length() * r.width();
    };
}
```

### MatchException em recompilação desatualizada

Adicione um terceiro subtipo permitido à hierarquia sealed acima:

```java
sealed interface Shape permits Circle, Rectangle, Triangle {}
record Triangle(double base, double height) implements Shape {}
```

Se `Shape` e `Triangle` são recompilados mas a classe contendo `area(Shape s)` não é, esse arquivo `.class` ainda acha que `Circle`/`Rectangle` são exaustivos. Chamar `area(new Triangle(3, 4))` contra o bytecode desatualizado compila normalmente na hora, mas lança `MatchException` em runtime — recompilar `area` também transforma isso de volta em um erro de compilação exigindo um case para `Triangle`.

### Escopo de variável de pattern e fall-through

Uma variável de pattern só está em escopo para o guard e o corpo do seu próprio label. Na forma com dois-pontos, cair (fall-through) *além* de um label de pattern para o próximo é um erro de compilação, porque o próximo label não enxerga a variável do anterior:

```java
switch (obj) {
    case Character c:
        System.out.println("char");
        // falls through
    case Integer i:              // error: variable c is already in scope, control falls through
        System.out.println(i);
}
```

Remover o fall-through (ou usar a seta `->` em cada case, que nunca cai) corrige isso:

```java
switch (obj) {
    case Character c -> System.out.println("char: " + c);
    case Integer i    -> System.out.println("int: " + i);
    default           -> System.out.println("other");
}
```

## Trade-offs

- **Concisão vs. familiaridade** — pattern matching remove o cast redundante depois de uma checagem `instanceof`, mas parece pouco familiar para desenvolvedores acostumados com o idiom clássico "checa então faz cast".
- **Exaustividade exige tipos sealed** — `switch` sobre patterns só pula `default` com segurança quando a hierarquia do alvo é `sealed`; sobre uma interface simples, um `default` faltando é um erro de compilação:

```java
interface Shape {}                     // not sealed
switch (s) {                           // error: not exhaustive, needs default
    case Circle c    -> ...;
    case Rectangle r -> ...;
}
```

- **Risco de recompilação** — se uma hierarquia sealed ganha um novo subtipo permitido e só algumas classes são recompiladas, um `switch` antes exaustivo pode lançar `MatchException` em runtime em vez de falhar ao compilar:

```java
sealed interface Shape permits Circle, Rectangle, Triangle {} // Triangle added, area() not recompiled
area(new Triangle(3, 4)); // MatchException at runtime
```

- **O escopo de uma variável de pattern é estreito** — uma variável vinculada em um label `case` só está em escopo para o guard e o corpo desse label (ou, na forma com dois-pontos, até o fim do seu grupo de statements), então cair além de um label de pattern é um erro em tempo de compilação:

```java
case Character c:
    // falls through
case Integer i:   // error: c falls through into this label
```

- **Uma variável de pattern não concede isenção do erasure para generics** — `obj instanceof List<String> list` falha com exatamente o mesmo erro de compilação que `obj instanceof List<String>` sem pattern; só o wildcard sem limite (`List<?>`) ou o tipo raw (`List`) são legais, e recorrer ao tipo raw reintroduz o território comum de warning unchecked assim que ele é usado de forma genérica:

```java
if (obj instanceof List<String> list) { }   // error: Object cannot be safely cast to List<String>
```

## Documentation Links

- [Pattern Matching — Java SE 26 Language Guide](https://docs.oracle.com/en/java/javase/26/language/pattern-matching.html) — doc
