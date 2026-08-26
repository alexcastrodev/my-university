---
version: 1.0
updatedAt: 2026-08-19
title: "Sequenced Collections: SequencedCollection, SequencedSet, SequencedMap"
summary: "As interfaces SequencedCollection/SequencedSet/SequencedMap da JEP 431 dão a toda coleção com uma ordem de encontro real — List, Deque, LinkedHashSet, TreeSet, LinkedHashMap, TreeMap — uma API uniforme de getFirst/getLast/addFirst/addLast/reversed(), excluindo deliberadamente HashSet, HashMap e PriorityQueue, já que nenhuma delas tem uma ordem de encontro estável para expor."
---
## Objective

Antes do JDK 21, "pegar o primeiro elemento" significava algo diferente para cada tipo de coleção: `list.get(0)` para uma `List`, `deque.getFirst()` para uma `Deque`, e para um `LinkedHashMap` não havia método direto nenhum — você recorria a pegar um iterator e chamar `next()` uma vez. A JEP 431 unifica isso: qualquer coleção com uma **ordem de encontro** definida — um primeiro elemento genuíno, um último elemento, e uma relação de sucessor estável entre eles — agora implementa `SequencedCollection`, `SequencedSet` ou `SequencedMap`, que adicionam `getFirst()`/`getLast()`, `addFirst()`/`addLast()`, `removeFirst()`/`removeLast()` e uma view `reversed()` a todo tipo que tenha essa ordem, em vez de cada família de coleção inventar sua própria versão parcial da mesma ideia.

## Use Cases

- Ler ou remover a cabeça/cauda de qualquer coleção ordenada — `List`, `Deque`, `LinkedHashSet`, `TreeSet` — através de um único nome de método consistente, em vez de lembrar qual tipo usa `get(0)` e qual usa `getFirst()`.
- Iterar um `LinkedHashMap` do mais recentemente inserido para o menos recente (ou vice-versa) sem reverter manualmente um key set ou manter uma estrutura separada — `map.reversed()` ou `map.sequencedEntrySet()`.
- Implementar um cache com eviction LRU: `LinkedHashMap` já rastreia a ordem de inserção, e `SequencedMap` dá a você `pollFirstEntry()`/`putLast()` para gerenciar diretamente a fronteira de eviction.
- Obter uma *view* em ordem reversa de uma lista ou de um sorted set para iteração, sem o `Collections.reverse(list)` mutante nem construir uma segunda cópia revertida.
- Escrever código genérico contra `SequencedCollection<E>` que funciona sem alterações seja qual for o tipo que o chamador passe — uma `List`, um `ArrayDeque`, ou um `LinkedHashSet`.

## Deep Dive

### As três interfaces

```java
interface SequencedCollection<E> extends Collection<E> {
    SequencedCollection<E> reversed();
    void addFirst(E e);      // optional — UnsupportedOperationException if unmodifiable
    void addLast(E e);       // optional
    E getFirst();            // NoSuchElementException if empty
    E getLast();             // NoSuchElementException if empty
    E removeFirst();         // optional
    E removeLast();          // optional
}
```

`SequencedSet<E>` estende tanto `Set<E>` quanto `SequencedCollection<E>`, e restringe o tipo de retorno de `reversed()` para `SequencedSet<E>` — um set revertido continua sendo um set. `SequencedMap<K,V>` estende `Map<K,V>` com os equivalentes orientados a entry:

```java
interface SequencedMap<K,V> extends Map<K,V> {
    SequencedMap<K,V> reversed();
    Map.Entry<K,V> firstEntry();
    Map.Entry<K,V> lastEntry();
    Map.Entry<K,V> pollFirstEntry();
    Map.Entry<K,V> pollLastEntry();
    V putFirst(K k, V v);
    V putLast(K k, V v);
    SequencedSet<K>            sequencedKeySet();
    SequencedCollection<V>     sequencedValues();
    SequencedSet<Entry<K,V>>   sequencedEntrySet();
}
```

### Quem é retrofitado, e quem não é

```
List            → SequencedCollection   (ArrayList, LinkedList, ...)
Deque           → SequencedCollection   (ArrayDeque, LinkedList, ...)
LinkedHashSet   → SequencedSet
SortedSet       → SequencedSet          (so TreeSet gets it too)
LinkedHashMap   → SequencedMap
SortedMap       → SequencedMap          (so TreeMap gets it too)
```

`HashSet` e `HashMap` deliberadamente **não** são retrofitados — a ordem de iteração deles é um detalhe de implementação da tabela hash, não uma ordem de encontro real, então adicionar `getFirst()`/`getLast()` ali prometeria uma estabilidade que a classe nunca foi projetada para fornecer. `PriorityQueue` é excluída pelo mesmo motivo de fundo: iterar sobre ela não visita os elementos em ordem de prioridade, então um `getFirst()` que retornasse "a cabeça da iteração" representaria incorretamente, de forma silenciosa, o que a fila realmente ordena.

### Acesso uniforme, uma linha cada

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bo", "Cid"));
names.getFirst();          // "Ana" — no more names.get(0)
names.getLast();           // "Cid" — no more names.get(names.size() - 1)
names.addFirst("Zed");     // [Zed, Ana, Bo, Cid]

LinkedHashMap<String,Integer> scores = new LinkedHashMap<>();
scores.put("a", 1); scores.put("b", 2); scores.put("c", 3);
scores.firstEntry();        // a=1 — first inserted
scores.lastEntry();         // c=3 — last inserted
scores.putFirst("z", 0);    // moves/creates "z" as the new first entry
```

`getFirst()`/`getLast()` lançam `NoSuchElementException` numa coleção vazia — uma exceção deliberada e verificável, diferente de `list.get(0)` numa lista vazia, que lança `IndexOutOfBoundsException` para o que é, na prática, a mesma condição de "não há nada aqui". Essa diferença fica visível no momento em que você escreve código genericamente contra `SequencedCollection<E>` em vez de uma `List` específica.

### `reversed()` é uma view viva, não uma cópia

```java
List<Integer> nums = new ArrayList<>(List.of(1, 2, 3));
List<Integer> rev = nums.reversed();
System.out.println(rev);        // [3, 2, 1]

nums.add(4);
System.out.println(rev);        // [4, 3, 2, 1] — rev reflects the mutation
```

Essa é a mesma relação que `Collections.unmodifiableList` ou um `subList` têm com sua coleção de apoio — `reversed()` retorna uma view genuína apoiada na coleção original, então uma mudança estrutural em um dos lados fica visível através do outro. Ela substitui o idioma antigo de chamar o `Collections.reverse(list)` mutante (que reordena permanentemente a lista original) só para iterar de trás para frente uma vez:

```java
// before JEP 431 — mutates the list just to read it in reverse
Collections.reverse(names);
for (String n : names) { /* ... */ }
Collections.reverse(names);           // and reverse it back

// JDK 21+ — no mutation, no need to reverse back
for (String n : names.reversed()) { /* ... */ }
```

### Um cache LRU usando SequencedMap diretamente

```java
class LruCache<K,V> extends LinkedHashMap<K,V> {
    private final int capacity;
    LruCache(int capacity) { super(16, 0.75f, true); this.capacity = capacity; }

    void put2(K k, V v) {
        if (containsKey(k)) putLast(k, v);      // move to most-recently-used position
        else {
            put(k, v);
            if (size() > capacity) pollFirstEntry();   // evict the least-recently-used entry
        }
    }
}
```

O terceiro argumento do construtor de `LinkedHashMap` (`accessOrder = true`) já reordena entries a cada `get()`; `putLast`/`pollFirstEntry` de `SequencedMap` dão à lógica de eviction e reinserção uma API direta e nomeada, em vez de depender do hook de override `removeEldestEntry()` do próprio `LinkedHashMap`.

## Trade-offs

- **Isso é uma adição pura, não uma substituição.** Nenhum método existente foi depreciado ou removido — `list.get(0)` continua funcionando exatamente como antes; `SequencedCollection` só adiciona uma segunda forma, mais geral, de dizer a mesma coisa, o que importa ao escrever código genérico entre `List`/`Deque`/`LinkedHashSet`, e não quando se trabalha com um único tipo concreto já conhecido.
- **A exclusão de `HashSet`/`HashMap`/`PriorityQueue` é um recurso, não uma lacuna.** Retrofitá-las teria feito uma promessa sobre estabilidade de iteração que nenhuma das três consegue de fato cumprir — se você precisa de semântica de primeiro/último, a solução é trocar para `LinkedHashSet`/`LinkedHashMap`/uma estrutura ordenada de verdade, não perguntar por que `HashMap` não tem `firstEntry()`.
- **Uma view `reversed()` ser viva, não uma cópia, é um comportamento real para se projetar em torno dele.** Passar uma view `list.reversed()` para algum lugar que depois muta a lista original altera o que a view produz na próxima leitura — geralmente o comportamento desejado para um relatório vivo, um bug se o chamador assumiu um snapshot; tire uma cópia explícita (`new ArrayList<>(list.reversed())`) quando uma ordem congelada é o que de fato se precisa.
- **Isso se encaixa sobre a hierarquia de tipos já existente, então um tipo já tinha cobertura parcial antes do JDK 21** — `Deque` já tinha `getFirst()`/`addFirst()` etc. muito antes de `SequencedCollection` existir; a JEP 431 não adicionou comportamento novo a `Deque`, ela deu um nome a essa forma que já existia e estendeu essa mesma forma para `List`, `LinkedHashSet` e o lado dos maps, que antes não tinham nada comparável.

## Documentation Links

- [JEP 431: Sequenced Collections](https://openjdk.org/jeps/431) — doc
- [SequencedCollection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html) — doc
- [SequencedMap — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedMap.html) — doc
- [SequencedSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedSet.html) — doc
- [Creating Sequenced Collections, Sets, and Maps — Oracle Java SE 25 documentation](https://docs.oracle.com/en/java/javase/25/core/creating-sequenced-collections-sets-and-maps.html) — doc
