---
version: 1.0
updatedAt: 2026-08-02
title: Records e Tipos Sealed
summary: Como um record reduz uma classe carregadora de dados a uma linha (construtores canônico/compacto, equals/hashCode/toString de graça, imutabilidade rasa), e como classes/interfaces sealed substituem o "qualquer um pode estender isso" por uma lista permits explícita e exaustiva — a combinação que torna seguro modelar hierarquias fechadas.
---
## Objective

Um `record` é um carregador de dados imutável gerado pelo compilador — você declara os componentes uma vez e ganha de graça um construtor, acessores, `equals`, `hashCode` e `toString`. Uma classe ou interface `sealed` restringe quais outros tipos podem estendê-la ou implementá-la. Nenhum dos dois precisa do outro, mas juntos eles permitem modelar um conjunto fixo e fechado de alternativas — o que há de mais próximo de um tipo de dado algébrico em Java — onde é o compilador, e não uma revisão de código, quem garante que o conjunto nunca cresça por acidente.

## Use Cases

- Agregar um punhado de valores imutáveis (um par de coordenadas, um valor monetário com sua moeda, um intervalo mín/máx) em um tipo de verdade em vez de um `Map<String, Object>` ou um conjunto paralelo de arrays.
- Modelar um conjunto fixo de resultados — um `Result` que é ou `Success` ou `Failure`, um `Shape` que só pode ser `Circle`, `Square` ou `Triangle` — e deixar o compilador acusar qualquer código que esqueça de tratar um deles.
- Validar ou normalizar os valores que um carregador de dados pode conter, no momento em que ele é construído, sem escrever à mão a lista completa de parâmetros de um construtor.
- Publicar um tipo de biblioteca cujas implementações você quer controlar completamente, mas ainda deixando espaço para que uma implementação específica permaneça aberta para extensão.

## Deep Dive

### Records: o compilador escreve o boilerplate

```java
record Point(int x, int y) {}

Point p = new Point(3, 4);
p.x();          // 3 — accessor named after the component, not getX()
p.equals(new Point(3, 4));  // true — structural equality
p.toString();   // "Point[x=3, y=4]"
```

Declarar `record Point(int x, int y) {}` gera: um campo `private final` por componente, acessores públicos com exatamente o mesmo nome dos componentes, um construtor canônico cuja lista de parâmetros segue a ordem dos componentes, e implementações de `equals`/`hashCode`/`toString` baseadas em todos os componentes. Um record é implicitamente `final` — não pode ser estendido — e ele mesmo não pode `extend` outra classe (ele estende implicitamente `java.lang.Record`, algo que você não pode substituir).

### Construtores compactos: valide sem repetir a lista de parâmetros

```java
record Range(int min, int max) {
    Range {  // compact constructor — no parameter list, no explicit assignment
        if (min > max) {
            throw new IllegalArgumentException("min must be <= max");
        }
    }
}
```

Um construtor compacto tem implicitamente os mesmos parâmetros dos componentes do record. O que você fizer com eles dentro do bloco — validar, normalizar, dar `trim()` numa string — acontece antes de serem atribuídos aos campos ao final do bloco; você não atribui (e não pode atribuir) os campos você mesmo. Esse é o lugar idiomático para rejeitar dados inválidos, já que ele roda em todo caminho de construção, inclusive frameworks de desserialização que chamam o construtor canônico.

### Construtores não canônicos precisam delegar

```java
record Employee(String name, int idNum) {
    static final int PENDING_ID = -1;

    Employee(String name) {          // non-canonical: must call another constructor via this(...)
        this(name, PENDING_ID);
    }
}
```

Qualquer construtor adicional precisa chamar o construtor canônico (direta ou transitivamente) via `this(...)` como sua primeira instrução — ele não pode atribuir os campos por conta própria. Isso garante que todo objeto do tipo record passe pela mesma lógica de validação/normalização, não importa qual construtor o criou.

### Tipos sealed: fechando o conjunto de subtipos

```java
sealed interface Shape permits Circle, Square, Triangle {}

record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}
record Triangle(double base, double height) implements Shape {}
```

Toda classe nomeada em uma cláusula `permits` precisa estender/implementar diretamente o tipo sealed, e cada uma delas precisa, por sua vez, ser declarada `final`, `sealed` ou `non-sealed` — não existe uma quarta opção irrestrita. `non-sealed` é a válvula de escape deliberada: ela reabre exatamente aquele ramo da hierarquia para subclassamento arbitrário, enquanto todos os outros ramos permanecem fechados. Se todo subtipo permitido estiver no mesmo arquivo do tipo sealed (e tiver acesso padrão/de pacote), a cláusula `permits` pode ser omitida — o compilador a infere a partir do que está declarado ao lado.

### Interface sealed + implementações em record: a combinação idiomática

Combinar os dois dá uma hierarquia que é ao mesmo tempo fechada (nada fora de `permits` pode aparecer) e exaustivamente desestruturável — um `switch` sobre os subtipos permitidos de um tipo sealed pode ser exaustivo sem um ramo `default`, porque o compilador consegue provar que todo caso está coberto. Como de fato casar e desestruturar essa hierarquia com padrões `switch`/`instanceof` é um conceito à parte — veja `pattern-matching` — este aqui trata do lado da modelagem: desenhar a forma fechada que esses padrões depois consomem.

## Trade-offs

- **A imutabilidade de um record é rasa.** A referência do próprio record para um componente não pode mudar após a construção, mas se esse componente for ele mesmo um objeto mutável, nada impede que você mute o que ele aponta.
  ```java
  record Team(String name, List<String> members) {}
  var t = new Team("Blue", new ArrayList<>(List.of("Ana")));
  t.members().add("Bo");   // compiles fine — the List itself is still mutable
  ```
- **Um record nunca pode dar `extend` em uma classe — classes sealed (não interfaces sealed implementadas por records) são a ferramenta certa quando você precisa de herança de verdade e de uma hierarquia fechada ao mesmo tempo.**
  ```java
  record Circle(double radius) extends Shape {}  // compile error: no extends clause allowed for records
  ```
- **Selar uma hierarquia é um compromisso que se propaga para fora — adicionar um subtipo permitido obriga a revisitar todo `switch` exaustivo sobre ela.** Esse é o objetivo (o compilador não deixa um caso novo passar sem tratamento), mas significa que a lista `permits` de um tipo sealed não é uma decisão a se tomar levianamente numa base de código grande.
  ```java
  // add Triangle to Shape's permits clause, and this switch stops compiling
  // until a `case Triangle` branch is added — even though nothing else changed:
  String describe(Shape s) {
      return switch (s) {
          case Circle c -> "circle";
          case Square sq -> "square";
      };
  }
  ```
- **Padrões de record (JDK 21) e padrões sem nome (JDK 21, JEP 456) tornam a desestruturação de records dentro de um `switch` bem mais concisa do que quando os records surgiram no JDK 16** — por exemplo, casar `Point(var x, _)` para vincular só `x` e descartar `y` com `_`. Esse refinamento pertence à mecânica do pattern matching em si, não ao que um record ou um tipo sealed *é*, então é coberto em profundidade pelo conceito `pattern-matching`, não aqui.

## Documentation Links

- [Java SE Language Documentation — Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html) — doc
- [Java SE Language Documentation — Sealed Classes and Interfaces](https://docs.oracle.com/en/java/javase/25/language/sealed-classes-interfaces.html) — doc
- [JEP 395: Records](https://openjdk.org/jeps/395) — doc
- [JEP 409: Sealed Classes](https://openjdk.org/jeps/409) — doc
- [JEP 456: Unnamed Variables & Patterns](https://openjdk.org/jeps/456) — doc
