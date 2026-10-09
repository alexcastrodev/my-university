---
version: 1.0
updatedAt: 2026-10-09
title: equals() vs compareTo()
summary: Por que equals() retorna boolean e compareTo() retorna int, de onde cada um vem (Object vs Comparable), o que significa uma ordenação "consistente com equals", e por que new BigDecimal("1.0") não é igual a new BigDecimal("1.00").
---
## Objective

`equals()` e `compareTo()` respondem à pergunta "esses dois objetos são iguais?", mas vêm de lugares diferentes e dizem coisas diferentes. `equals(Object)` é declarado em `Object`, então todo objeto Java o possui, e retorna um `boolean`: igual ou não. `compareTo(T)` é declarado na interface `Comparable<T>`, então só os tipos que a implementam o possuem, e retorna um `int`: negativo se `this` é menor que o outro, zero se são iguais, positivo se `this` é maior. A resposta curta é "um retorna boolean, o outro retorna int". A resposta mais longa é que os dois deveriam concordar sobre o que "igual" significa, e quando não concordam (como em `BigDecimal`), coleções baseadas em um deles se comportam de forma diferente das coleções baseadas no outro.

## Use Cases

- Responder à pergunta de entrevista "qual a diferença entre `equals()` e `compareTo()`?" com mais do que os tipos de retorno.
- Decidir se uma classe precisa só de `equals()`/`hashCode()` (vai num `HashSet` ou é chave de `HashMap`) ou também de uma ordenação natural via `Comparable` (vai ser ordenada, ou vai num `TreeSet`/`TreeMap`).
- Comparar valores monetários guardados em `BigDecimal`, onde `new BigDecimal("1.0").equals(new BigDecimal("1.00"))` é `false`.
- Explicar por que os mesmos valores produzem um conjunto de tamanho 2 num `HashSet` e de tamanho 1 num `TreeSet`.

## Deep Dive

### De onde vem cada método

Toda classe herda `equals()` de `java.lang.Object`. A implementação padrão é identidade (`this == obj`); classes que representam valores a sobrescrevem.

`compareTo()` só existe se a classe implementa `java.lang.Comparable<T>`. Muitos tipos do JDK implementam: `String`, todos os wrappers de primitivos (`Integer`, `Long`, `Double`, `Character`, ...), `BigDecimal`, `BigInteger`, `LocalDate`, enums, e assim por diante. As suas próprias classes também podem implementar.

```java
public record Version(int major, int minor) implements Comparable<Version> {
    @Override
    public int compareTo(Version other) {
        int byMajor = Integer.compare(major, other.major);
        return byMajor != 0 ? byMajor : Integer.compare(minor, other.minor);
    }
}
```

O record ganha `equals()` de graça a partir dos componentes; a ordenação é algo que ele precisou declarar explicitamente.

### O que cada um retorna

`equals()` dá uma resposta sim/não. `compareTo()` dá uma direção, que é exatamente o que algoritmos de ordenação precisam:

```java
"apple".equals("banana");          // false

"apple".compareTo("banana");       // -1  (negative: "apple" comes first)
"b".compareTo("a");                // 1   (positive: "b" comes after)
"a".compareTo("a");                // 0   (equal)

Integer.valueOf(5).compareTo(7);   // -1
```

Só o sinal faz parte do contrato. `String.compareTo()` pode retornar `-1`, `-17` ou `-3000`; quem chama deve testar `< 0`, `== 0`, `> 0`, nunca `== -1`.

### Eles também diferem com null

`equals(null)` é obrigado a retornar `false`. `compareTo(null)` é obrigado a lançar exceção, porque não existe "direção" significativa em relação a null:

```java
"a".equals(null);      // false
"a".compareTo(null);   // NullPointerException
```

### Consistente com equals

A documentação de `Comparable` pede esta regra: `x.compareTo(y) == 0` deveria ter o mesmo valor lógico que `x.equals(y)`. Dois objetos iguais deveriam comparar como zero, e dois objetos que comparam como zero deveriam ser iguais. O JDK chama uma ordenação que satisfaz isso de *consistente com equals*. É fortemente recomendado, não obrigatório, e é nessa brecha que nascem os bugs.

Isso importa porque as coleções do JDK escolhem um dos dois métodos e ignoram o outro:

- `HashSet`, `HashMap`, `List.contains()`, `List.indexOf()` usam `equals()` (e `hashCode()`).
- `TreeSet`, `TreeMap`, `Collections.binarySearch()` usam `compareTo()` (ou um `Comparator`) e nunca chamam `equals()`.

Se os dois métodos discordam, os mesmos dados se comportam de forma diferente dependendo da coleção que os guarda.

### BigDecimal: a inconsistência famosa

Um `BigDecimal` é um inteiro não escalonado mais uma escala. `1.0` é `10 × 10^-1` e `1.00` é `100 × 10^-2`. `equals()` compara valor **e** escala; `compareTo()` compara só o valor numérico:

```java
BigDecimal a = new BigDecimal("1.0");
BigDecimal b = new BigDecimal("1.00");

a.equals(b);     // false  (different scale)
a.compareTo(b);  // 0      (same numeric value)
```

Coloque os mesmos dois objetos numa coleção baseada em hash e numa baseada em árvore e você recebe duas respostas diferentes:

```java
new HashSet<>(List.of(a, b)).size();   // 2  (uses equals)
new TreeSet<>(List.of(a, b)).size();   // 1  (uses compareTo)

Map<BigDecimal, String> hash = new HashMap<>();
hash.put(a, "x");
hash.get(b);                           // null

Map<BigDecimal, String> tree = new TreeMap<>();
tree.put(a, "x");
tree.get(b);                           // "x"
```

Para comparar `BigDecimal` numericamente, use `compareTo() == 0`. Se você precisa que valores como `1.0` e `1.00` sejam intercambiáveis como chaves de hash, normalize-os antes:

```java
a.stripTrailingZeros().equals(b.stripTrailingZeros());   // true
```

### Double: consistente, mas não com ==

`Double.equals()` e `Double.compareTo()` concordam entre si, mas ambos discordam do operador primitivo `==` em dois casos de borda:

```java
Double.valueOf(0.0).equals(-0.0);          // false
Double.valueOf(0.0).compareTo(-0.0);       // 1
0.0 == -0.0;                               // true

Double.valueOf(Double.NaN).equals(Double.NaN);     // true
Double.valueOf(Double.NaN).compareTo(Double.NaN);  // 0
Double.NaN == Double.NaN;                          // false
```

Os métodos do wrapper definem de propósito uma ordem total (necessária para ordenar e para que chaves `NaN` possam ser encontradas), enquanto `==` segue o IEEE 754.

## Trade-offs

- **Uma ordenação inconsistente com equals é legal e compila sem aviso, mas as coleções ordenadas passam a quebrar o contrato de `Set`/`Map`.** `Set` é especificado em termos de `equals()`, mas um `TreeSet` decide quem pertence a ele com `compareTo()`, então pode rejeitar um elemento que `equals()` considera novo.
  ```java
  Set<String> names = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
  names.add("Java");
  names.add("JAVA");   // returns false: "JAVA".equals("Java") is false,
  names.size();        // 1             but the comparator says 0
  ```
- **Implementar `Comparable` prende o tipo a uma única ordenação natural.** Qualquer outra ordenação precisa viver num `Comparator`; tentar encaixar duas ordenações num único `compareTo()` briga com o contrato. É uma decisão de design, não algo a demonstrar em código.
- **`compareTo()` escrito como subtração é mais curto, mas estoura.** `a - b` só tem o sinal certo quando a diferença cabe num `int`; `Integer.compare()` está sempre correto.
  ```java
  int a = Integer.MIN_VALUE, b = 1;
  a - b;                    // 2147483647  (positive: wrong)
  Integer.compare(a, b);    // -1          (negative: right)
  ```
- **Em `BigDecimal`, escolher entre `equals()` e `compareTo()` é escolher se a escala importa.** A escala é informação real (`10.00` diz "até o centavo", `10` não diz), então `equals()` não está errado, só é mais rígido do que a maioria do código de negócio espera.
  ```java
  new BigDecimal("10").equals(new BigDecimal("10.00"));        // false
  new BigDecimal("10").compareTo(new BigDecimal("10.00")) == 0; // true
  ```

## Documentation Links

- [Comparable (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) (doc)
- [Object.equals (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#equals(java.lang.Object)) (doc)
- [BigDecimal (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html) (doc)
- [Question 402: equals vs compareTo (YouTube Short)](https://youtube.com/shorts/bsB3rAGONI8) (video)
