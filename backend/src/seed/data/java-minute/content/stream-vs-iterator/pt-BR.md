---
version: 1.0
updatedAt: 2026-10-07
question: Qual é a diferença entre um stream e um iterator?
---
## Question

# Qual é a diferença entre um stream e um iterator?

## Short Answer

Eles não são a mesma interface.

## Less Short Answer

Existem algumas semelhanças entre os dois. Por exemplo, ambos podem ser definidos sobre quase qualquer fonte de dados, ou até sobre nenhuma fonte: você pode criar iterators e streams que não são apoiados por nenhum tipo de estrutura de dados em memória.

```java
// um iterator sem coleção por trás: ele calcula seus elementos
Iterator<Integer> counter = new Iterator<>() {
    private int next = 0;
    public boolean hasNext() { return next < 5; }
    public Integer next() { return next++; }
};

// um stream também sem coleção por trás
Stream<Integer> evens = Stream.iterate(0, n -> n + 2).limit(5);
```

## Iterator: Um Elemento Depois do Outro

Um iterator tem dois métodos principais: `hasNext()`, para verificar se ainda existem elementos a consumir, e `next()`, que retorna o próximo elemento. Você também pode chamar `remove()` para remover o elemento atual da fonte, e `forEachRemaining()` para passar os elementos restantes para um consumer.

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bob", "Carl", "Dan"));
Iterator<String> it = names.iterator();

String first = it.next();           // "Ana", puxado por você
if (it.next().startsWith("B")) {
    it.remove();                    // remove "Bob" da própria lista
}
it.forEachRemaining(System.out::println); // Carl, Dan

System.out.println(names); // [Ana, Carl, Dan]: a fonte foi modificada
```

## Stream: Um Pipeline de Processamento

Um stream, por outro lado, não te entrega elementos um depois do outro. Um stream define um pipeline de processamento de dados, feito principalmente de cálculos de map, filter e reduce, e que você pode decidir executar em paralelo.

```java
List<String> names = List.of("Ana", "Bob", "Carl", "Dan");

int totalLength = names.parallelStream()
        .filter(name -> name.length() == 3)
        .map(String::length)
        .reduce(0, Integer::sum);   // 9
```

Enquanto um iterator pode remover elementos da sua fonte de dados, a especificação de um stream diz que ele não deve modificar a sua fonte. O `filter()` constrói um novo resultado, e a lista fica intacta:

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bob", "Carl"));
List<String> withoutBob = names.stream()
        .filter(name -> !name.equals("Bob"))
        .toList();

System.out.println(names);      // [Ana, Bob, Carl]: inalterada
System.out.println(withoutBob); // [Ana, Carl]
```

## ListIterator: Andando para Trás

Uma última palavra: para listas, você também tem a interface `ListIterator`, que oferece a iteração clássica para frente, mas também a navegação para trás com `hasPrevious()` e `previous()`.

```java
List<String> names = List.of("Ana", "Bob", "Carl");
ListIterator<String> it = names.listIterator(names.size()); // começa no final

while (it.hasPrevious()) {
    System.out.println(it.previous()); // Carl, Bob, Ana
}
```

## One Last Word

Bacana!

## References

- [Java Coding Tip #401: What Is the Difference Between a Stream and an Iterator?](https://youtube.com/shorts/oLbaRK87JdI) (video)
- [Iterator (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html) (doc)
- [ListIterator (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ListIterator.html) (doc)
- [java.util.stream, Non-interference (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html#NonInterference) (doc)
