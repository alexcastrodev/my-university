---
version: 1.0
updatedAt: 2026-08-02
title: "Project Valhalla: Value Classes"
summary: Por que objetos custam mais que primitivos (identidade, header, alocação no heap, pressão sobre o GC), como Value Classes permitem que a JVM elimine esse overhead para tipos que são apenas seus dados, e por que List<int> ainda não existe por causa do type erasure dos generics.
---
## Objective

Entender o Project Valhalla: um esforço do OpenJDK, liderado por Brian Goetz desde 2014, para fechar a lacuna entre primitivos e objetos — "código como uma classe, funciona como um int" — permitindo que a JVM armazene certas classes como valores planos e sem identidade, em vez de objetos alocados no heap por trás de uma referência.

## Use Cases

- Modelar tipos de dados puros — `Money`, `Point`, `RGB`, `Complex`, `Duration` — onde o *valor* é todo o significado da instância e identidade (`==`) é irrelevante.
- Armazenar arrays ou coleções grandes de objetos pequenos (ex.: milhões de instâncias de `Point`) sem pagar um custo de header, referência e rastreamento de GC por objeto, para cada um deles.
- Evitar o custo escondido do autoboxing quando um primitivo precisa fluir por uma API genérica como `List<Integer>`.
- Entender por que `List<int>` ainda não é Java legal, e o que precisaria mudar (generics reificados/especializados) para que fosse.

## Deep Dive

### Dois mundos diferentes: primitivos vs. objetos

Desde o Java 1.0, primitivos e objetos vivem sob regras diferentes:

```java
int age = 30;        // stored directly, no identity, no header, minimal overhead
Integer boxed = 30;   // an object: identity, header, heap allocation, GC-tracked
```

Um `int` primitivo é só seus bits. Um `Integer` — mesmo envolvendo exatamente os mesmos 4 bytes — carrega um header de objeto, uma indireção de referência, e participa da coleta de lixo. A diferença de performance não é sobre os dados; é sobre tudo que o Java anexa a um objeto por cima dos dados.

### O problema do layout de memória

Considere uma classe simples de dois campos:

```java
class Point {
    int x;
    int y;
}
```

Um `Point[]` hoje é um array de *referências*, não um array de dados de `Point`:

```
Point[]
 ↓
+-----+      +-------+
| ref |----->| Point |
+-----+      +-------+
+-----+      +-------+
| ref |----->| Point |
+-----+      +-------+
```

Cada acesso significa seguir um ponteiro até um local separado no heap — "pointer chasing" — o que quebra a localidade de cache da CPU. O que Valhalla busca em vez disso é um layout plano e contíguo:

```
[x,y][x,y][x,y][x,y]
```

Sem indireção, sem alocações separadas — os valores ficam lado a lado na memória, exatamente como um array de primitivos.

### Value classes: identidade vs. valor

Uma **value class** é uma cujo significado está inteiramente em seus dados — duas instâncias com os mesmos valores *são* o mesmo valor. A identidade de objeto comum quebra isso hoje:

```java
Point p1 = new Point(1, 2);
Point p2 = new Point(1, 2);

p1 == p2   // false — two distinct objects, even with identical data
```

Tipos como `Point`, `Money`, ou `Complex` não precisam dessa distinção — só seus valores importam. Tipos como `User`, `Customer`, `Order`, ou `Session` ainda precisam: duas instâncias podem ter campos idênticos e ainda assim representar entidades diferentes, então eles mantêm o modelo de objeto tradicional. Value classes dão à JVM permissão para abandonar a identidade (e a maquinaria que vem junto com ela) para os tipos onde a identidade nunca teve significado, para começo de conversa.

### Boxing e seu custo escondido

Generics só aceitam tipos de referência, então `List<int>` nunca foi legal — só `List<Integer>`. Toda chamada de `add`/`get` faz boxing e unboxing silenciosamente:

```java
List<Integer> numbers = new ArrayList<>();
numbers.add(10);                 // compiler emits: numbers.add(Integer.valueOf(10))
int n = numbers.get(0);          // compiler emits: numbers.get(0).intValue()
```

Para uma lista de um milhão de inteiros, isso são um milhão de objetos `Integer` independentes, cada um com seu próprio header, padding de alinhamento e referência — por cima dos 4 bytes reais de dados que cada um representa. A maior parte da pegada de memória é contabilidade, não payload.

### Por que generics não conseguem enxergar primitivos: type erasure

Generics (Java 5) foram implementados via **type erasure**: em tempo de compilação, `List<String>`, `List<User>`, e `List<Integer>` colapsam todos para o mesmo `List` raw. Como `int` não é um tipo de referência, ele nunca conseguiu participar desse esquema:

```java
List<String> strings = new ArrayList<>();
List<Integer> ints = new ArrayList<>();
// after erasure, both are backed by the same raw List at the bytecode level
```

Isso preservou compatibilidade retroativa com código pré-generics, mas também é exatamente por que uma `List<int>` especializada e sem boxing nunca existiu.

## Trade-offs

- **Identidade vs. achatamento** — uma value class abre mão da semântica de identidade `==` em troca de deixar a JVM armazená-la de forma plana (em arrays, em campos de outros objetos) sem uma alocação de heap por instância. Tipos que genuinamente precisam de identidade (`User`, `Session`) não podem adotar esse modelo.
- **Status de preview** — a JEP 401 (Value Classes and Objects) mira o JDK 28 como feature de preview; a API e a semântica exata ainda podem mudar antes da finalização, então código de produção não deveria depender disso ainda.
- **A migração é opt-in, não automática** — classes existentes como os tipos wrapper (`Integer`, `Double`) podem evoluir em direção à semântica de valor (JEP 402), mas classes existentes arbitrárias não viram value classes de graça; um tipo precisa ser deliberadamente modelado como uma.
- **`List<int>` completa ainda precisa de mais do que value classes** — armazenamento achatado para tipos de valor é o primeiro passo; generics genuinamente reificados/especializados sobre primitivos são uma parte separada do projeto, ainda em estudo.

## Documentation Links

- [JEP 401: Value Classes and Objects (Preview)](https://openjdk.org/jeps/401) — doc
- [JEP 402: Enhanced Primitive Boxing (Preview)](https://openjdk.org/jeps/402) — doc
- [Project Valhalla — OpenJDK](https://openjdk.org/projects/valhalla/) — doc
- [Project Valhalla — State of Valhalla (Brian Goetz)](https://openjdk.org/projects/valhalla/design-notes/state-of-valhalla/01-background) — doc
