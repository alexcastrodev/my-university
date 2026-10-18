---
version: 1.0
updatedAt: 2026-08-07
title: A Classe TreeSet
summary: Como o TreeSet mantém os elementos em ordem crescente via uma estrutura de árvore, por que a unicidade ali é decidida por compareTo() em vez de equals(), e o custo O(log n) que isso paga.
---
## Objective

Entender `TreeSet`, a implementação de `NavigableSet` apoiada em uma estrutura de árvore: os elementos são mantidos em ordem crescente automaticamente, pela ordenação natural ou por um `Comparator` fornecido, em troca de operações logarítmicas em vez de tempo constante.

## Use Cases

- Precisar que os elementos estejam sempre em ordem, sem uma etapa de ordenação separada depois de cada inserção.
- Recuperar o elemento mínimo/máximo, ou um intervalo ordenado inteiro, diretamente em vez de varrer a coleção.
- Buscas por correspondência mais próxima (o menor ≥ x, o maior ≤ x) via os métodos de `NavigableSet` — veja o conceito da interface Set para o detalhamento completo de `ceiling`/`floor`/`higher`/`lower`.
- Produzir uma view deduplicada *e* ordenada de uma entrada arbitrária em uma única estrutura.

## Deep Dive

### TreeSet estende AbstractSet, implementa NavigableSet

```java
class TreeSet<E>
```

Quatro construtores:

```java
TreeSet<String> a = new TreeSet<>();                          // natural ordering
TreeSet<String> b = new TreeSet<>(List.of("C", "A", "B"));    // from a collection, natural ordering
TreeSet<String> c = new TreeSet<>(Comparator.reverseOrder());  // custom ordering
TreeSet<String> d = new TreeSet<>((SortedSet<String>) someSortedSet);
```

```mermaid
classDiagram
    class Collection { <<interface>> }
    class Set { <<interface>> }
    class SortedSet { <<interface>> }
    class NavigableSet { <<interface>> }
    class AbstractSet { <<abstract>> }
    class TreeSet
    Collection <|-- Set
    Set <|-- SortedSet
    SortedSet <|-- NavigableSet
    Set <|.. AbstractSet
    AbstractSet <|-- TreeSet
    NavigableSet <|.. TreeSet
```

### A ordem crescente é automática

```java
TreeSet<String> ts = new TreeSet<>();
ts.add("C"); ts.add("A"); ts.add("B"); ts.add("E"); ts.add("F"); ts.add("D");
System.out.println(ts); // [A, B, C, D, E, F] — sorted, regardless of insertion order
```

### Veja acontecendo: add() caindo na posição ordenada

Os mesmos seis elementos, na mesma ordem de chegada de acima — cada `add()` cai diretamente em sua posição final na ordem crescente, não no final como faria um `ArrayList` comum:

```viz
type: formula
capacity = count
slot = rank(item)
---
C
A
B
E
F
D
```

O slot 0 é o menor elemento visto em *todo* o conjunto, não o primeiro a ser adicionado — essa é a diferença entre a garantia de ordenação do `NavigableSet` e a ordem de inserção de um `LinkedHashSet`.

### Consultas por intervalo via NavigableSet

```java
ts.subSet("C", "F"); // [C, D, E] — >= C, < F
```

`subSet`/`headSet`/`tailSet` retornam uma view `NavigableSet` viva, apoiada em `ts`, não uma cópia — veja o conceito da interface Set para as sobrecargas com limite inclusivo e os métodos de correspondência mais próxima (`ceiling`, `floor`, `higher`, `lower`).

## Trade-offs

- **Operações O(log n), não O(1)** — `add`/`remove`/`contains` percorrem a árvore para manter a ordem, então um `TreeSet` é consistentemente mais lento que um `HashSet` para simples teste de pertencimento; pague esse custo só quando a ordenação for de fato utilizada.
- **A unicidade é decidida por `compareTo()` (ou pelo `Comparator` fornecido), não por `equals()`/`hashCode()`** — dois elementos que a ordenação considera iguais (`compareTo() == 0`) são tratados como duplicados mesmo que `equals()` dissesse o contrário:

  ```java
  record Item(String name, int rank) {}
  Comparator<Item> byRank = Comparator.comparingInt(Item::rank);
  TreeSet<Item> ts = new TreeSet<>(byRank);
  ts.add(new Item("a", 1));
  ts.add(new Item("b", 1));  // rejected — compareTo() says rank 1 == rank 1, even though not equals()
  System.out.println(ts.size()); // 1
  ```
- **Os elementos precisam ser mutuamente comparáveis, e nada garante isso em tempo de compilação quando nenhum `Comparator` é fornecido** — inserir um objeto que na verdade não pode ser comparado aos demais compila sem problemas e falha só no ponto em que uma comparação é forçada, como um `ClassCastException` lançado de dentro de `compareTo()`, não do próprio `TreeSet`.

## Lab

Neste lab você recebe a classe `ScoreBoard`, que guarda pontuações em um `TreeSet<Integer>`, e usa a ordenação permanente e as buscas de vizinho mais próximo do `NavigableSet` (`ceiling` e `floor`) em vez de ordenar uma lista toda vez que precisa de ordem. A ideia central é perceber que um `TreeSet` já mantém tudo ordenado e responde perguntas que um `Set` comum não consegue.

**O cenário**

Um placar registra as pontuações de um jogo e precisa dizer a maior, a menor e qual é a pontuação mais próxima de um alvo, para cima ou para baixo.

- `ScoreBoard.java`: guarda `scores` (um `TreeSet<Integer>`). Todos os métodos são seus.

**O que você vai fazer, passo a passo**

1. **Registrar (TODO-00).** Em `record()`, adicione a pontuação. Registrar uma que já existe não muda nada, que é a semântica de `Set`.
2. **Extremos (TODO-01 e TODO-02).** `highest()` devolve a maior e `lowest()` a menor. Quando nada foi registrado, deixe a exceção natural acontecer, sem capturar e relançar. Pense qual método do `TreeSet` lança nesse caso, em vez de devolver `null`.
3. **Vizinho para cima (TODO-03).** Em `closestAtLeast()`, devolva a menor pontuação registrada que seja `>= target`, ou `null` se nenhuma servir. É o `ceiling`.
4. **Vizinho para baixo (TODO-04).** Em `closestAtMost()`, devolva a maior pontuação registrada que seja `<= target`, ou `null`. É o `floor`.

**Como saber que terminou**

`mvn test` fica todo verde. Você deve conseguir explicar por que nenhum desses métodos precisou ordenar nada e o que `ceiling` e `floor` devolvem quando o alvo já está no conjunto.

**Desafios opcionais**

- **TODO-05:** implemente `between()`, devolvendo todas as pontuações do intervalo fechado `[low, high]` como um `SortedSet<Integer>`.

**Pré-requisitos:** sintaxe básica de Java e familiaridade com a interface `Set`.

**Como rodar:** clone o repositório, entre em `java-concepts/tree-set` e rode `mvn test` (ou, da raiz, `mvn -pl java-concepts/tree-set test`). Os métodos pendentes lançam `UnsupportedOperationException("Not implemented yet.")` com um comentário `TODO-NN`, então os testes vermelhos são o seu checklist.

## Documentation Links

- *Java: The Complete Reference*, 12th Edition (Herbert Schildt) — Chapter 20, pp. 592–593 — book
- [TreeSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeSet.html) — doc
- [NavigableSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/NavigableSet.html) — doc
