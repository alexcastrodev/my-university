---
version: 1.0
updatedAt: 2026-08-02
title: "Generics: Tipos Limitados, Wildcards e Erasure"
summary: Como tipos parametrizados movem casts e verificações de incompatibilidade de tipo do runtime para o tempo de compilação, o que tipos limitados e wildcards PECS (extends/super) realmente restringem, e por que erasure significa que só existe, de fato, um arquivo de classe por tipo genérico em tempo de execução.
---
## Objective

Uma classe, interface ou método genérico recebe o tipo com o qual opera como um parâmetro — escrito entre colchetes angulares, como `Gen<T>` — em vez de fixar um tipo específico ou recorrer a `Object` e fazer cast. O compilador substitui o tipo real em cada ponto de uso e o verifica, de modo que uma categoria inteira de `ClassCastException` em runtime vira um erro de compilação.

## Use Cases

- Escrever um único container/algoritmo (uma pilha, um par, um cache) que funciona identicamente para `String`, `Integer` ou qualquer outro tipo de referência, sem duplicar a classe por tipo.
- Restringir um parâmetro de tipo a "qualquer coisa com um `doubleValue()`" (`<T extends Number>`) para que um método possa chamar métodos numéricos nele sem um cast inseguro.
- Escrever um método que aceita "uma `List` de qualquer coisa" (`List<?>`) quando o método só lê da lista e não se importa com o que está dentro.
- Escrever um método que aceita "um destino que pode conter esse tipo ou um supertipo dele" (`? super T`) quando o método só escreve na coleção.

## Deep Dive

### Parâmetros de tipo e argumentos de tipo

```java
class Gen<T> {
    private T ob;
    Gen(T o) { ob = o; }
    T getOb() { return ob; }
}

Gen<Integer> iOb = new Gen<Integer>(88);   // Integer is the type argument for T
int v = iOb.getOb();                        // no cast needed — return type is already Integer
```

`T` é um placeholder preenchido com o argumento de tipo (`Integer` aqui) em todo ponto onde é usado dentro de `Gen` — o campo, o parâmetro do construtor e o tipo de retorno de `getOb()` viram todos `Integer` para essa instância. Uma segunda instância, `Gen<String>`, tem sua própria visão totalmente `String` da mesma classe — mas `iOb = strOb;` entre uma referência `Gen<Integer>` e uma `Gen<String>` não compila, mesmo que ambas sejam "um `Gen`": argumentos de tipo diferentes as tornam tipos incompatíveis.

Generics só aceitam tipos de referência como argumentos — `Gen<int>` não compila — mas o autoboxing torna as classes wrapper (`Integer`, `Double`, ...) transparentes o suficiente para que isso raramente seja uma restrição real.

### Tipos limitados (bounded types)

Um `<T>` sem limite pode ser qualquer tipo de referência, o que impede chamar qualquer coisa mais específica que os métodos de `Object` nele. `extends` restringe o parâmetro de tipo a uma classe/interface e seus subtipos:

```java
class Stats<T extends Number> {
    T[] nums;
    Stats(T[] o) { nums = o; }
    double average() {
        double sum = 0.0;
        for (T num : nums) sum += num.doubleValue();   // legal: T is-a Number
        return sum / nums.length;
    }
}
```

Como `T` é limitado por `Number`, o compilador sabe que todo `T` tem `doubleValue()` — e, como efeito colateral, `Stats<String>` deixa de compilar por completo, já que `String` não é um `Number`. Um limite pode combinar uma classe e interfaces com `&` (`<T extends MyClass & Comparable<T>>`), mas a classe — se houver — precisa vir primeiro.

### Argumentos wildcard: `?`, `? extends`, `? super`

Um parâmetro de método tipado como `Stats<T>` só aceita objetos `Stats` cujo argumento de tipo seja exatamente aquele mesmo `T`. Para aceitar *qualquer* `Stats`, use um wildcard:

```java
boolean isSameAvg(Stats<?> ob) {
    return average() == ob.average();
}
```

`Stats<?>` casa com `Stats<Integer>`, `Stats<Double>`, qualquer coisa — o wildcard não afrouxa com o que objetos `Stats` podem ser *criados* (isso ainda é governado pelo próprio limite `extends Number` de `Stats`), ele só permite que um método aceite a família inteira.

Wildcards podem, elas mesmas, ser limitadas, o que importa quando um tipo genérico está numa hierarquia de classes:

```java
class Coords<T extends TwoD> { T[] coords; /* ... */ }

// accepts Coords<ThreeD> and Coords<FourD>, rejects Coords<TwoD>
void showXYZ(Coords<? extends ThreeD> c) { /* ... */ }
```

O mnemônico (PECS — *Producer Extends, Consumer Super*) é sobre a direção em que os dados fluem: `? extends T` quando o parâmetro só *produz* valores que você lê (você não pode adicionar a ele com segurança — o compilador não sabe se é de fato um `List<ThreeD>` ou `List<FourD>`); `? super T` quando o parâmetro só *consome* valores que você escreve (qualquer supertipo de `T` pode legalmente conter um `T`).

### Métodos e construtores genéricos

Um método pode declarar seus próprios parâmetros de tipo mesmo dentro de uma classe não genérica — a lista de parâmetros vem antes do tipo de retorno:

```java
static <T extends Comparable<T>, V extends T> boolean isIn(T x, V[] y) {
    for (V v : y) if (v.compareTo(x) == 0) return true;
    return false;
}

isIn(2, nums);                    // T and V both inferred as Integer, no explicit type args needed
GenMethDemo.<Integer, Integer>isIn(2, nums);   // same call, type arguments spelled out (rarely needed)
```

`V extends T` aqui significa "`V` precisa ser `T`, ou um subtipo dele" — misturar um array `Integer` e um `String` na mesma chamada é um erro de compilação, não uma surpresa em runtime. Construtores podem ser genéricos da mesma forma, mesmo quando a classe que os contém não é.

### Interfaces e hierarquias genéricas

```java
interface MinMax<T extends Comparable<T>> {
    T min();
    T max();
}

class MyClass<T extends Comparable<T>> implements MinMax<T> { /* ... */ }
```

Uma classe que implementa uma interface genérica precisa, ela mesma, ser genérica (ou vincular a interface a um tipo concreto, ex.: `implements MinMax<Integer>`) — não existe forma de "esquecer" o parâmetro de tipo no meio de uma hierarquia. A mesma regra de repasse se aplica a uma superclasse genérica: `class Gen2<T> extends Gen<T>` precisa carregar `T` mesmo que `Gen2` nunca o use diretamente, só para satisfazer `Gen`.

### Erasure

Em tempo de compilação, toda informação de tipo genérico é *apagada* (erasure): cada parâmetro de tipo é substituído por seu limite (`Object` se não limitado), e o compilador insere os casts necessários para que o código se comporte como se existisse uma versão específica do tipo. Em tempo de execução existe exatamente um arquivo de classe para `Gen`, não um por argumento de tipo — `Gen<Integer>` e `Gen<String>` são o mesmo `.class`.

```java
class Gen2 extends Gen<String> {
    @Override
    String getOb() { return super.getOb(); }   // erasure expects Object getOb()
}
```

O compilador resolve a incompatibilidade gerando um *bridge method* sintético (`Object getOb()` que chama a versão `String`) — invisível no código-fonte, visível apenas na saída do `javap`.

Erasure também é o motivo pelo qual duas sobrecargas que diferem só por dois parâmetros de tipo distintos podem ser ambíguas (ambas viram `Object` após o erasure), pelo qual não é possível fazer `new T[10]` (o compilador não sabe que tipo de array alocar), e pelo qual uma classe genérica não pode estender `Throwable` (não existe uma classe de exceção específica por tipo no nível do bytecode).

## Trade-offs

- **Tipos limitados trocam flexibilidade por garantias do compilador.** `Stats<T extends Number>` não pode mais ser instanciada com um tipo não numérico — esse é o objetivo, não uma limitação.
  ```java
  class Stats<T extends Number> { /* ... */ }
  // Stats<String> s;  // compile error: String is not a Number
  ```
- **Tipos raw (uma classe genérica usada sem nenhum argumento de tipo) existem só para interoperabilidade legada e descartam silenciosamente a segurança de tipos** — o compilador ainda emite avisos *unchecked*, mas uma atribuição inválida agora falha em runtime em vez de em tempo de compilação.
  ```java
  Gen raw = new Gen(Double.valueOf(98.6));
  int i = (Integer) raw.getOb();   // compiles, throws ClassCastException at runtime
  ```
- **Um array genérico de um argumento de tipo específico não pode ser criado** — só um com wildcard — porque a JVM precisa de um tipo de componente concreto para o `new`, e o erasure já descartou essa informação no momento em que o array seria alocado.
  ```java
  // Gen<Integer>[] gens = new Gen<Integer>[10];   // won't compile
  Gen<?>[] gens = new Gen<?>[10];                   // OK
  ```
- **O operador diamond (`<>`) e `var` reduzem verbosidade, mas só funcionam onde o compilador consegue inferir o argumento de tipo pelo contexto** — uma atribuição ou chamada de construtor, não uma declaração de campo isolada. A legibilidade não é afetada de outra forma: o comportamento em runtime após o erasure é idêntico de qualquer jeito.

## Documentation Links

- [Generics (The Java Tutorials) — Oracle](https://docs.oracle.com/javase/tutorial/java/generics/index.html) — doc
- [Java Language Specification — Chapter 4.5, Parameterized Types](https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.5) — doc
- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
