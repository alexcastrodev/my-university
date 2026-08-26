---
version: 1.0
updatedAt: 2026-08-02
title: Comparators e Algoritmos de Coleção
summary: "Como Comparator desacopla completamente a ordenação de um tipo (diferente do único compareTo() fixo de Comparable), como comparing()/thenComparing() constroem comparators de múltiplas chaves sem um compare() escrito à mão, e o que os algoritmos estáticos de Collections (sort, shuffle, views unmodifiable/synchronized/checked) realmente garantem."
---
## Objective

`Comparable` dá a um tipo exatamente uma ordenação natural, embutida na própria classe. `Comparator` desacopla a ordenação do tipo por completo — um `TreeSet`/`TreeMap` (ou qualquer chamada de sort) pode receber um `Comparator` diferente para cada caso de uso, e a classe utilitária `Collections` fornece um conjunto de algoritmos estáticos (`sort`, `shuffle`, `min`/`max`, `binarySearch` e os wrappers de view `unmodifiable`/`synchronized`/`checked`) que operam em qualquer `Collection` sem precisar de um método correspondente na própria coleção.

## Use Cases

- Ordenar a mesma lista de contas por nome em um relatório e por saldo em outro, sem alterar o `compareTo()` da própria classe `Account`.
- Ordenar por sobrenome, depois por primeiro nome em caso de empate — uma cadeia "compare por X depois por Y" construída a partir de dois comparators independentes.
- Decidir onde valores `null` devem ser ordenados (primeiro ou por último) sem tratar cada caso especialmente em todo comparator.
- Entregar uma view somente-leitura ou thread-safe de uma lista existente a outra parte do programa, sem copiá-la.
- Encontrar o mínimo/máximo de uma coleção, ou checar se uma lista ordenada contém um valor, sem escrever o loop ou a busca binária à mão.

## Deep Dive

### Comparator vs. Comparable

```java
class Account implements Comparable<Account> {
    String name;
    double balance;

    @Override
    public int compareTo(Account other) {
        return name.compareTo(other.name);   // the ONE natural ordering
    }
}
```

`Comparable.compareTo()` é um método que o próprio tipo implementa — uma única ordenação fixa, usada automaticamente por `Collections.sort()`, `TreeSet` e `TreeMap` quando nenhum comparator é fornecido. `Comparator<T>` vive totalmente fora do tipo:

```java
interface Comparator<T> {
    int compare(T obj1, T obj2);
}
```

Qualquer quantidade de instâncias de `Comparator<Account>` pode existir lado a lado — uma ordenando por saldo, outra por sobrenome — sem tocar em `Account` de forma alguma.

### Construindo comparators com comparing() e thenComparing()

Desde o Java 8, `Comparator` vem com métodos estáticos/default que constroem comparators a partir de uma função que extrai a chave, em vez de uma implementação completa de `compare()`:

```java
Comparator<Account> byBalance = Comparator.comparing(Account::balance);
Comparator<Account> byBalanceDesc = Comparator.comparing(Account::balance).reversed();
```

`thenComparing()` encadeia um segundo comparator que só roda quando o primeiro reporta um empate:

```java
Comparator<Account> byLastThenFirst =
    Comparator.comparing(Account::lastName)
              .thenComparing(Account::firstName);

accounts.sort(byLastThenFirst);
```

`Comparator.comparingInt()`/`comparingLong()`/`comparingDouble()` (e seus equivalentes `thenComparing`) existem especificamente para evitar autoboxing quando a chave é um tipo primitivo.

### Tratando nulls e construindo comparators de ordem reversa/natural sem uma classe

```java
Comparator<String> naturalOrder = Comparator.naturalOrder();
Comparator<String> reverse = Comparator.reverseOrder();
Comparator<String> nullsSafe = Comparator.nullsFirst(Comparator.naturalOrder());
```

`nullsFirst()`/`nullsLast()` envolvem outro comparator e decidem onde `null` é ordenado, em vez de todo comparator precisar da sua própria checagem de nulo.

### Os algoritmos de Collections

`Collections` é uma classe de métodos utilitários estáticos que funcionam em qualquer `Collection`/`List`, independentemente de qual implementação concreta é usada:

```java
List<Integer> list = new LinkedList<>(List.of(20, -8, 8, -20));

Collections.sort(list, Collections.reverseOrder());   // 20 8 -8 -20
Collections.shuffle(list);
int min = Collections.min(list);
int max = Collections.max(list);
```

Além de ordenar e embaralhar: `Collections.unmodifiableList()`/`unmodifiableSet()`/`unmodifiableMap()` retornam uma *view* somente-leitura apoiada na coleção original (mutar o original ainda aparece na view — não é uma cópia); `synchronizedList()`/`synchronizedSet()`/etc. retornam wrappers thread-safe (um iterator sobre um deles ainda precisa ser usado dentro de um bloco `synchronized`, já que a iteração em si não é atômica); e `checkedList()`/`checkedSet()`/etc. retornam uma "view dinamicamente type-safe" que lança `ClassCastException` imediatamente numa inserção incompatível, em vez de deixar isso corromper a coleção silenciosamente e aparecer depois numa leitura sem relação.

### List.sort() — o ponto de entrada moderno

O próprio `List` ganhou um método default `sort(Comparator)` no Java 8, então ordenar uma lista não exige mais passar por `Collections`:

```java
accounts.sort(Comparator.comparing(Account::balance));
```

`List.sort()` chama `Collections.sort()` internamente — os dois são equivalentes em comportamento, mas `list.sort(cmp)` se lê de forma mais direta que `Collections.sort(list, cmp)` e é a versão que a maioria do código atual usa.

## Trade-offs

- **Um tipo só pode ter um `Comparable.compareTo()`, então se duas ordenações independentes são genuinamente necessárias, um `Comparator` é a única opção** — tentar codificar uma segunda ordenação dentro de `compareTo()` (um campo flag, digamos) briga com o contrato em vez de usar a ferramenta feita exatamente para isso.
- **`Collections.unmodifiableList()` retorna uma *view*, não uma cópia defensiva — quem chama ainda pode ser surpreendido.**
  ```java
  List<String> mutable = new ArrayList<>(List.of("a", "b"));
  List<String> readOnly = Collections.unmodifiableList(mutable);
  mutable.add("c");
  System.out.println(readOnly);   // [a, b, c] — the "read-only" view changed too
  ```
- **`synchronizedList()`/`synchronizedSet()` tornam chamadas de método individuais thread-safe, mas a iteração não é atômica por cima disso** — iterar uma lista sincronizada de uma thread enquanto outra thread a modifica ainda precisa de um bloco `synchronized` manual em volta da iteração inteira, ou pode lançar `ConcurrentModificationException`.
- **`checkedList()`/`checkedSet()` trocam um pouco de overhead em runtime por falhar no ponto da inserção ruim de fato, não depois.** Vale a pena especificamente quando um tipo raw ou um cast inseguro torna possível que um elemento incompatível se infiltre numa coleção que, de resto, é genericamente tipada — do contrário é overhead sem nada para capturar.

## Documentation Links

- [Comparator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Comparator.html) — doc
- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
- [Collections — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html) — doc
- [List.sort() — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#sort(java.util.Comparator)) — doc
