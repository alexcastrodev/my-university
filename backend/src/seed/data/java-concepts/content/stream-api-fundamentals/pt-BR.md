---
version: 1.0
updatedAt: 2026-08-05
title: Fundamentos da Stream API
summary: Por que uma stream é um conduto preguiçoso e de uso único em vez de uma estrutura de dados, como o formato do pipeline (fonte → operações intermediárias → operação terminal) faz com que filter-then-findFirst pare antecipadamente em vez de varrer tudo, como Collectors e as especializações de stream primitivas funcionam por baixo dos panos, e quando streams paralelas realmente ajudam.
---
## Objective

Uma stream (`java.util.stream`) é um conduto para dados, não uma estrutura de dados — ela nunca armazena elementos por si mesma, apenas os move de uma fonte (uma collection, um array, um canal de I/O) através de um pipeline de operações. Uma stream é de uso único: assim que uma operação *terminal* a consome, aquele objeto stream está esgotado, e obter uma nova significa voltar à fonte. A maioria das operações de uma stream são lambdas ou method references implementando as interfaces funcionais de `java.util.function` (`Predicate`, `Function`, `Consumer`, ...) — veja [Lambda Expressions](/java-concepts/lambda-expressions) para entender como elas são construídas e capturadas; este conceito assume esse mecanismo já conhecido e foca no que as streams fazem com ele: construir um pipeline avaliado preguiçosamente que filtra, transforma e reduz dados em um estilo mais próximo de uma consulta de banco de dados do que de um loop.

## Use Cases

- Substituir um `for` escrito à mão que filtra, transforma e coleta em uma única passagem por um pipeline declarativo `filter().map().collect()`.
- Buscar em uma fonte grande ou cara de produzir pela primeira correspondência sem processar o resto dela (`filter(...).findFirst()`), contando com preguiça (laziness) e curto-circuito em vez de um loop manual com retorno antecipado.
- Agregar dados — agrupando, particionando, unindo, sumarizando — com `Collectors` em vez de loops acumuladores feitos à mão.
- Executar o mesmo pipeline em múltiplos núcleos com `parallelStream()` quando a fonte é grande e o trabalho por elemento não é trivial.
- Iterar dados primitivos `int`/`long`/`double` sem fazer boxing de cada elemento em `Integer`/`Long`/`Double`, via `IntStream`/`LongStream`/`DoubleStream`.

## Deep Dive

### O formato do pipeline e a preguiça (laziness)

Todo pipeline de stream tem o mesmo formato de três partes: uma **fonte**, zero ou mais **operações intermediárias**, e exatamente uma **operação terminal**.

```java
long count = myList.stream()          // source
    .filter(n -> n % 2 == 0)          // intermediate
    .map(n -> n * n)                  // intermediate
    .count();                         // terminal
```

Operações intermediárias (`filter`, `map`, `sorted`, ...) cada uma retorna uma *nova* stream — elas nunca tocam a fonte nem executam nenhum código por si mesmas. Nada realmente executa até que uma operação terminal (`count`, `collect`, `forEach`, `reduce`, ...) seja chamada; nesse momento o pipeline roda elemento por elemento, puxando um valor por cada estágio intermediário antes de puxar o próximo. Isso é **avaliação preguiçosa (lazy evaluation)**, e é o que torna o curto-circuito possível:

```java
Optional<String> first = names.stream()
    .filter(n -> n.startsWith("A"))
    .findFirst();
```

`findFirst()` é uma operação terminal de curto-circuito: assim que `filter` produz um elemento correspondente, o pipeline para completamente de puxar mais elementos da fonte — o resto de `names` nunca sequer é visitado. Como o pipeline é conduzido elemento a elemento em vez de estágio a estágio (filtrar *tudo*, depois encontrar o primeiro), isso também funciona em uma fonte infinita:

```java
Stream.iterate(2, n -> n + 1)
    .filter(StreamApiFundamentals::isPrime)
    .findFirst();   // terminates — an eager "filter everything first" design couldn't
```

Uma stream também nunca modifica sua fonte: ordenar uma stream produz uma nova stream com uma nova ordem, a `List` subjacente permanece intocada.

### Obtendo uma stream

A fonte mais comum é uma collection, através dos dois métodos default que `Collection` ganhou no JDK 8:

```java
Stream<Integer> s1 = myList.stream();          // sequential
Stream<Integer> s2 = myList.parallelStream();   // parallel, if the environment supports it
```

Arrays passam pelo método estático `Arrays.stream()`:

```java
Stream<Address> addrStream = Arrays.stream(addresses);
IntStream ints = Arrays.stream(intArray);   // primitive overload
```

Outras fontes comuns: `Stream.of(a, b, c)` para um punhado literal de elementos, `IntStream.range(0, 10)` / `IntStream.rangeClosed(0, 10)` para sequências numéricas, `Stream.iterate(seed, next)` / `Stream.generate(supplier)` para streams computadas (potencialmente infinitas), e `BufferedReader.lines()` para uma stream apoiada em uma fonte de I/O. `BaseStream` (a interface raiz que todo tipo de stream estende) também estende `AutoCloseable`, então uma stream cuja fonte precisa ser fechada — uma apoiada em arquivo — pode ser gerenciada em try-with-resources; uma stream apoiada em collection nunca precisa disso.

### Operações intermediárias vs. terminais: stateless vs. stateful

Operações terminais consomem a stream e ou produzem um resultado (`min`, `max`, `count`, `collect`, `reduce`) ou executam uma ação (`forEach`). Assim que uma delas roda, a stream em que rodou está morta — reutilizar a referência lança exceção:

```java
Stream<Integer> s = myList.stream();
s.count();
s.forEach(System.out::println);   // IllegalStateException: stream has already been operated upon or closed
```

Operações intermediárias se dividem ainda mais em **stateless** e **stateful**. Uma operação stateless (`filter`, `map`, `peek`) processa cada elemento independentemente de todos os outros — ela pode emitir (ou transformar, ou descartar) um elemento no momento em que o vê, sem esperar por nada mais. Uma operação stateful (`sorted`, `distinct`, `limit`) precisa de informação sobre *outros* elementos para decidir o que fazer com o elemento atual — `sorted()` não pode emitir seu primeiro elemento de saída até ter visto todo o fluxo anterior, e `distinct()` precisa se lembrar de todo elemento que já emitiu para reconhecer uma repetição.

Essa distinção é exatamente o motivo pelo qual o exemplo de stream infinita acima funciona só porque `filter` vem antes de `findFirst`: uma operação stateless pode ser intercalada elemento por elemento com uma operação terminal de curto-circuito. Coloque uma operação stateful como `sorted()` nesse mesmo pipeline contra uma fonte infinita e ela trava para sempre, porque ordenar precisa ver tudo antes de poder produzir algo:

```java
Stream.iterate(1, n -> n + 1)
    .sorted()          // stateful: must exhaust the (infinite) source first
    .findFirst();      // never returns
```

`limit(n)` é a única operação capaz de transformar um pipeline que seria stateful de volta em algo seguro para fontes infinitas, porque ela mesma é de curto-circuito: `Stream.iterate(1, n -> n + 1).limit(5).sorted().toList()` termina, porque `limit` reduz a fonte a cinco elementos antes de `sorted` sequer rodar.

### O catálogo de Collectors e como um Collector customizado funciona

`collect()` é a operação terminal que transforma uma stream de volta em um resultado mutável — na maioria das vezes via um `Collector` já pronto da classe utilitária `Collectors`:

```java
List<String> names   = people.stream().map(Person::name).collect(Collectors.toList());
Set<String> unique    = people.stream().map(Person::city).collect(Collectors.toSet());
String csv            = people.stream().map(Person::name).collect(Collectors.joining(", "));
Map<String, List<Person>> byCity =
    people.stream().collect(Collectors.groupingBy(Person::city));
long count            = people.stream().collect(Collectors.counting());
DoubleSummaryStatistics stats =
    people.stream().collect(Collectors.summarizingDouble(Person::salary));
```

`groupingBy` também aceita um collector downstream, então agrupar e agregar se compõem em uma única chamada — `groupingBy(Person::city, Collectors.counting())` dá uma contagem populacional por cidade em vez de uma lista de `Person` por cidade.

Por baixo dos panos, `Collector<T, A, R>` é apenas uma interface simples com quatro componentes funcionais, e qualquer um dos métodos de fábrica de `Collectors` apenas monta essas peças:

```java
interface Collector<T, A, R> {
    Supplier<A> supplier();                  // creates a new, empty accumulation container
    BiConsumer<A, T> accumulator();           // folds one element into the container
    BinaryOperator<A> combiner();             // merges two containers (parallel streams)
    Function<A, R> finisher();                // converts the container into the final result
    Set<Characteristics> characteristics();   // hints: CONCURRENT, UNORDERED, IDENTITY_FINISH
}
```

`T` é o tipo do elemento da stream, `A` é o tipo do container mutável (muitas vezes invisível) que faz a acumulação, e `R` é o tipo do resultado final — para `toList()`, `A` e `R` por acaso são ambos `List<T>`, o que é o que `IDENTITY_FINISH` sinaliza (pule a chamada a `finisher()`, o container já *é* o resultado). Escrever um collector customizado é simplesmente fornecer essas quatro peças diretamente com `Collector.of(...)`, por exemplo `collect(HashSet::new, HashSet::add, HashSet::addAll)` — a sobrecarga de três argumentos de `collect()` é a mesma forma sem o wrapper `Collector`.

### Especializações de stream primitivas

`Stream<T>` só contém referências a objetos, então um `Stream<Integer>` faz boxing de todo `int` que toca. `IntStream`, `LongStream` e `DoubleStream` existem justamente para evitar isso: eles carregam valores primitivos `int`/`long`/`double` diretamente, com operações especializadas para primitivos (`sum()`, `average()`, `IntBinaryOperator` em vez de `BinaryOperator<Integer>`) para que nenhum boxing aconteça no meio do pipeline.

```java
int total = orders.stream()
    .mapToInt(Order::quantity)   // Stream<Order> -> IntStream, no boxing from here on
    .sum();

IntStream.rangeClosed(1, 100).filter(n -> n % 3 == 0).forEach(System.out::println);
```

`boxed()` converte uma stream primitiva de volta para `Stream<Integer>`/`Stream<Long>`/`Stream<Double>` quando um valor com boxing é realmente necessário downstream (um alvo `Collectors.toList()`, por exemplo, já que não existe `List<int>`).

### Streams paralelas: quando ajudam e quando atrapalham

`parallelStream()` (ou chamar `.parallel()` em uma stream sequencial) pede que o pipeline rode através do `ForkJoinPool` comum, dividindo a fonte e combinando resultados parciais. Qualquer operação usada em uma stream paralela — o predicado de `filter`, o acumulador e o combinador de `reduce`, o acumulador/combinador de um `Collector` customizado — precisa ser stateless, não-interferente e associativa, ou o resultado paralelo pode diferir do sequencial.

Paralelismo compensa quando a fonte é grande, o processamento de cada elemento não é trivial, e a fonte se divide de forma barata (um `ArrayList` ou um array se dividem bem; uma `LinkedList` ou uma stream apoiada em I/O não). Tende a *perder* para uma stream sequencial quando a fonte é pequena (o overhead de coordenação do fork/join ofusca o trabalho real), quando a operação é barata por elemento, ou quando uma operação stateful como `sorted()` força passagens extras de coordenação entre partições. `forEach()` em uma stream paralela também não preserva a ordem de encontro — `forEachOrdered()` é a alternativa ordenada quando a ordem de saída importa.

### Gatherers: operações intermediárias customizadas (JEP 485, finalizado no JDK 24)

As operações intermediárias predefinidas (`filter`, `map`, `sorted`, ...) cobrem a maioria das necessidades, mas nada na API clássica permite que código de usuário defina uma *nova* operação intermediária stateful — agrupar em lotes de tamanho fixo, ou uma acumulação contínua que emite a cada passo, anteriormente significava sair completamente da Stream API. `Stream.gather(Gatherer)`, finalizado no JDK 24 depois de duas rodadas de preview (JEP 461 no JDK 22, JEP 473 no JDK 23), preenche essa lacuna: um `Gatherer<T, A, R>` é construído com o mesmo formato de um `Collector` (um inicializador, um integrador, um combinador, um finalizador), mas produz uma *stream* em vez de um único resultado coletado, então ele se compõe com outras operações intermediárias e terminais.

```java
List<List<Integer>> batches = Stream.of(1, 2, 3, 4, 5, 6, 7)
    .gather(Gatherers.windowFixed(3))
    .toList();
// [[1, 2, 3], [4, 5, 6], [7]]

List<Integer> runningTotal = Stream.of(1, 2, 3, 4)
    .gather(Gatherers.scan(() -> 0, Integer::sum))
    .toList();
// [1, 3, 6, 10]
```

`java.util.stream.Gatherers` traz de fábrica um punhado de gatherers já prontos (`windowFixed`, `windowSliding`, `fold`, `scan`, `mapConcurrent`), e gatherers customizados são construídos com `Gatherer.of(...)`. Esta é a única parte da Stream API que é genuinamente nova desde um tratamento da era Java 17 — tudo mais coberto acima (`mapMulti`, `Stream.toList()`) já estava presente desde o JDK 16-17.

## Trade-offs

- **Uma stream é de uso único.** Chamar uma segunda operação terminal (ou intermediária) em uma stream já consumida lança exceção em tempo de execução, não em tempo de compilação — a referência ainda faz type-check, ela simplesmente não pode ser reutilizada.
  ```java
  Stream<String> s = list.stream();
  s.forEach(System.out::println);
  s.count();   // IllegalStateException: stream has already been operated upon or closed
  ```
- **Operações intermediárias stateful compram correção ao custo de buffering.** `sorted()` e `distinct()` não podem emitir nada até terem visto todo o fluxo anterior (ou até que um `limit()` antes delas o limite), diferente de `filter`/`map`, que fluem um elemento de cada vez e são o único tipo seguro para colocar diretamente antes de uma operação terminal de curto-circuito em uma fonte infinita.
- **Streams paralelas não são de graça — o overhead de coordenação pode exceder o trabalho economizado.** Uma coleção pequena, uma operação barata por elemento, ou uma fonte que resiste a divisão barata (listas encadeadas, streams apoiadas em I/O) comumente roda *mais devagar* em paralelo do que sequencial; paralelismo é uma aposta que só compensa quando o trabalho por elemento e o tamanho dos dados são grandes o suficiente para amortizar o overhead do fork/join.
- **O acumulador/combinador de um `reduce`/`collect` paralelo precisa ser associativo, ou o resultado se torna dependente da ordem e não confiável.** A falha clássica é reutilizar a mesma função para os dois papéis quando eles precisam ser diferentes — multiplicar as raízes quadradas de dois elementos não é a mesma operação que multiplicar dois produtos parciais já computados.
- **`forEach()` não garante a ordem de encontro em uma stream paralela.** Código que depende de processar elementos na ordem da fonte precisa de `forEachOrdered()` em vez disso, o que reintroduz a coordenação que `forEach()` estava evitando.

## Documentation Links

- [java.util.stream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html) — doc
- [Stream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html) — doc
- [Collector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html) — doc
- [Collectors — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html) — doc
- [Gatherer — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherer.html) — doc
- [Gatherers — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html) — doc
- [JEP 485: Stream Gatherers](https://openjdk.org/jeps/485) — doc
