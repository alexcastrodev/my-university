---
version: 1.0
updatedAt: 2026-08-21
title: Collectors de Stream e Streams Paralelas
summary: Um mergulho profundo nos Collectors de múltiplos níveis (groupingBy, partitioningBy, toMap, teeing, Collector.of customizado) e na mecânica e nas armadilhas das streams paralelas.
---
## Objective

[Stream API Fundamentals](/java-concepts/stream-api-fundamentals) cobre o formato básico do pipeline e menciona `Collectors` e `parallelStream()` de passagem. Este conceito aprofunda exatamente esses dois pontos: os collectors de múltiplos níveis e combinadores além de `toList()`/`groupingBy()`, como escrever um `Collector` do zero, e o que de fato acontece — mecanicamente e em termos de risco — quando uma stream roda em paralelo em vez de sequencialmente.

## Use Cases

- Produzir um `Map` aninhado em uma única passagem — por exemplo, pedidos agrupados por status e, dentro de cada status, agrupados novamente ou agregados (contagem, soma, média).
- Dividir uma coleção em exatamente dois grupos (aprovado/reprovado, válido/inválido) com um único teste booleano em vez de duas passagens separadas de `filter()`.
- Construir um `Map<K, V>` a partir de uma stream onde chaves podem colidir, decidindo explicitamente o que acontece com o valor em vez de deixar uma chave duplicada explodir em runtime.
- Calcular dois agregados relacionados (soma e contagem, mínimo e máximo) em uma única passagem sobre os dados em vez de iterar duas vezes.
- Escrever um `Collector` para um formato de resultado que os `Collectors` prontos não oferecem (por exemplo, acumular direto em um tipo de valor imutável).
- Acelerar um cálculo caro por elemento, com uso intenso de CPU, sobre uma grande coleção em memória, paralelizando-o — e saber quando essa aposta não compensa.

## Deep Dive

### Agrupamento em múltiplos níveis com `groupingBy` e um collector downstream

`Collectors.groupingBy(classifier)` sozinho produz `Map<K, List<T>>`. Passar um segundo collector, *downstream*, muda o que acaba em cada bucket em vez de uma lista crua — e esse collector downstream pode ele mesmo ser outro `groupingBy`, produzindo um mapa aninhado:

```java
record Order(String status, String region, double amount) {}

List<Order> orders = List.of(
    new Order("SHIPPED", "EU", 120.0),
    new Order("SHIPPED", "EU", 80.0),
    new Order("SHIPPED", "US", 50.0),
    new Order("PENDING", "EU", 30.0)
);

// one level: status -> count
Map<String, Long> countByStatus = orders.stream()
    .collect(Collectors.groupingBy(Order::status, Collectors.counting()));
// {SHIPPED=3, PENDING=1}

// two levels: status -> region -> total amount
Map<String, Map<String, Double>> totalByStatusAndRegion = orders.stream()
    .collect(Collectors.groupingBy(
        Order::status,
        Collectors.groupingBy(Order::region, Collectors.summingDouble(Order::amount))
    ));
// {SHIPPED={EU=200.0, US=50.0}, PENDING={EU=30.0}}
```

O `groupingBy` externo constrói o `Map` de nível superior; cada valor nesse mapa é, por sua vez, o resultado de rodar *toda a stream restante daquele bucket* através do collector downstream. Nada aqui é tratado como caso especial — `groupingBy` simplesmente delega para qualquer `Collector` que receba, o que explica por que um `groupingBy` pode ser aninhado dentro de outro `groupingBy` sem nenhuma superfície de API extra.

### `partitioningBy`: o caso especial de dois buckets

`partitioningBy` é um `groupingBy` restrito a um `Predicate`, então o classificador só produz `true`/`false` — e, diferente de `groupingBy`, ambas as chaves sempre estão presentes no resultado, mesmo que um bucket fique vazio:

```java
List<Integer> numbers = List.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

Map<Boolean, List<Integer>> evenOdd = numbers.stream()
    .collect(Collectors.partitioningBy(n -> n % 2 == 0));
// {false=[1, 3, 5, 7, 9], true=[2, 4, 6, 8, 10]}

Map<Boolean, Long> evenOddCounts = numbers.stream()
    .collect(Collectors.partitioningBy(n -> n % 2 == 0, Collectors.counting()));
// {false=5, true=5}
```

Um `groupingBy` com um predicado equivalente retornaria apenas as chaves que de fato ocorreram (uma stream de números todos pares omitiria `false` por completo); `partitioningBy` sempre retorna um mapa com duas entradas, com `true` e `false` presentes.

### `toMap` e a armadilha da chave duplicada

`Collectors.toMap(keyMapper, valueMapper)` constrói um `Map` diretamente a partir de uma stream, mas não tem ideia do que fazer quando dois elementos mapeiam para a mesma chave — seu comportamento padrão é falhar ruidosamente:

```java
record Employee(String department, String name) {}

List<Employee> employees = List.of(
    new Employee("ENGINEERING", "Alice"),
    new Employee("ENGINEERING", "Bob"),   // same department key as Alice
    new Employee("SALES", "Carol")
);

Map<String, String> byDept = employees.stream()
    .collect(Collectors.toMap(Employee::department, Employee::name));
// IllegalStateException: Duplicate key ENGINEERING (attempted merging values Alice and Bob)
```

A correção é a sobrecarga de três argumentos, que recebe uma função `BinaryOperator<V>` de merge dizendo exatamente à `toMap` o que fazer com os valores colidentes em vez de lançar exceção:

```java
Map<String, String> byDept = employees.stream()
    .collect(Collectors.toMap(
        Employee::department,
        Employee::name,
        (existing, incoming) -> existing + ", " + incoming   // merge function
    ));
// {ENGINEERING=Alice, Bob, SALES=Carol}
```

Uma sobrecarga de quatro argumentos ainda recebe um supplier de `Map` (por exemplo, `TreeMap::new`) quando a ordem de inserção ou a ordem de classificação do mapa resultante importa.

### `teeing`: combinando dois collectors em um resultado (Java 12+)

`Collectors.teeing(downstream1, downstream2, merger)` roda a *mesma* stream através de dois collectors independentes em uma única passagem, e então combina os dois resultados com uma `BiFunction`. O exemplo canônico é uma média calculada sem duas operações terminais separadas:

```java
record Sample(double value) {}

List<Sample> samples = List.of(new Sample(4.0), new Sample(8.0), new Sample(6.0));

double average = samples.stream()
    .collect(Collectors.teeing(
        Collectors.summingDouble(Sample::value),   // downstream 1: sum
        Collectors.counting(),                      // downstream 2: count
        (sum, count) -> sum / count                  // merger
    ));
// 6.0
```

Sem `teeing`, o mesmo resultado exigiria ou duas passagens sobre a stream (impossível se a stream já foi consumida após a primeira) ou `summaryStatistics()`; `teeing` justifica seu uso especificamente quando os dois agregados combinados ainda não são cobertos por um único collector de resumo pronto.

### Escrevendo um `Collector` customizado com `Collector.of`

`Collector.of` constrói um `Collector` fornecendo as mesmas quatro peças que `stream-api-fundamentals` introduz conceitualmente (`supplier`, `accumulator`, `combiner`, `finisher`), para um formato de resultado que nenhum dos métodos de fábrica embutidos em `Collectors` produz diretamente — aqui, juntando nomes em uma `String` imutável separada por vírgulas, envolvida em um pequeno tipo de valor:

```java
record NameList(String joined) {}

Collector<String, StringJoiner, NameList> toNameList = Collector.of(
    () -> new StringJoiner(", "),               // supplier: new empty container
    StringJoiner::add,                            // accumulator: fold one element in
    StringJoiner::merge,                           // combiner: merge two containers (parallel)
    joiner -> new NameList(joiner.toString())     // finisher: container -> final result
);

NameList names = Stream.of("Alice", "Bob", "Carol").collect(toNameList);
// NameList[joined=Alice, Bob, Carol]
```

Como o finisher aqui faz trabalho de verdade (`StringJoiner` não é ele mesmo o tipo de resultado), esse collector *não* declara `Characteristics.IDENTITY_FINISH` — em contraste com `Collectors.toList()`, onde o container de acumulação já *é* o resultado e o finisher é pulado.

### Como uma stream paralela de fato divide o trabalho

`parallelStream()` não implementa gerenciamento de threads na mão: ela obtém um `Spliterator` da fonte, que divide recursivamente os dados em pedaços (`trySplit()`), e submete esses pedaços como tarefas ao `ForkJoinPool` comum — o mesmo motor de dividir-para-conquistar coberto em [Fork/Join Framework](/java-concepts/fork-join-framework). Uma fonte que se divide de forma barata e uniforme (um `ArrayList`, um array) paraleliza bem; uma que só pode ser dividida percorrendo-a nó a nó (uma `LinkedList`) ou que não tem uma estrutura genuína de acesso aleatório (uma stream apoiada em I/O) ganha pouco ou nada, porque o `Spliterator` não consegue dividi-la eficientemente.

```java
List<Integer> big = IntStream.rangeClosed(1, 10_000_000).boxed().toList();

long expensiveCount = big.parallelStream()
    .filter(StreamCollectorsAndParallelStreams::isPrime)   // non-trivial per-element cost
    .count();
```

Paralelismo é uma aposta: só compensa quando a fonte é grande *e* o trabalho por elemento é caro o suficiente para amortizar a sobrecarga de coordenação de fork/split/merge. Um `parallelStream()` sobre dez inteiros pequenos com um predicado barato tipicamente perde para a versão sequencial diretamente, porque a sobrecarga de dividir a fonte e mesclar resultados parciais custa mais do que simplesmente rodar tudo em uma única thread.

### Lambdas com estado em streams paralelas: uma race concreta

Toda operação fornecida a uma stream paralela — um predicado de `filter`, uma ação de `forEach`, um accumulator — precisa ser **stateless e non-interfering**, ou seja, não pode mutar estado compartilhado fora de si mesma. Escrever em um `ArrayList` simples de dentro de um `forEach` paralelo quebra essa regra, porque `ArrayList.add` não é thread-safe:

```java
List<Integer> results = new ArrayList<>();

IntStream.rangeClosed(1, 100_000)
    .parallel()
    .forEach(results::add);   // multiple threads calling add() on the same ArrayList concurrently

System.out.println(results.size());
// unreliable: sometimes < 100000, occasionally throws ArrayIndexOutOfBoundsException
// or ConcurrentModificationException, depending on how the internal resize races land
```

Várias threads de trabalho chamam `add()` no mesmo array de apoio ao mesmo tempo; `ArrayList` não faz nenhum lock, então um resize disparado por uma thread pode ser invisível a outra no meio de uma escrita, corrompendo o array ou perdendo elementos. A correção é deixar a própria maquinaria de coleta da stream cuidar da concorrência em vez de compartilhar estado mutável manualmente:

```java
List<Integer> results = IntStream.rangeClosed(1, 100_000)
    .parallel()
    .boxed()
    .collect(Collectors.toList());   // collect() is safe under parallel execution by construction
```

### Ordem: `forEach` vs `forEachOrdered`

Uma stream sequencial sempre processa elementos na ordem de encontro. Uma stream paralela não: `forEach()` em uma stream paralela deixa que a thread de trabalho que terminar um pedaço primeiro emita sua saída primeiro, então a ordem impressa pode diferir da ordem da fonte a cada execução:

```java
List.of(1, 2, 3, 4, 5).parallelStream()
    .forEach(System.out::println);
// order varies between runs: e.g. 3 1 4 2 5

List.of(1, 2, 3, 4, 5).parallelStream()
    .forEachOrdered(System.out::println);
// always 1 2 3 4 5 — but pays the cost of reassembling encounter order across threads
```

`forEachOrdered()` restaura a ordem de encontro fazendo a stream armazenar em buffer e remontar os resultados de acordo com a posição na fonte antes de emiti-los, o que reintroduz exatamente a coordenação entre threads que rodar sem ordem estava tentando evitar — é a escolha certa quando a ordem de saída importa, e a opção padrão errada nos demais casos.

## Trade-offs

- **`groupingBy` com um collector downstream compõe de graça, mas mapas aninhados ficam mais difíceis de consumir quanto mais fundo vão.** Um `groupingBy` de dois níveis é idiomático; três ou mais níveis geralmente fica melhor como um pequeno record ou um `Map` plano com uma chave composta.
- **`partitioningBy` sempre retorna ambas as chaves `true` e `false`, mesmo quando um lado está vazio** — código que assume que uma chave ausente significa "nenhum elemento desse tipo" vai interpretar mal um resultado de `partitioningBy` da forma como interpretaria corretamente um de `groupingBy`.
  ```java
  Map<Boolean, List<Integer>> r = List.of(1, 3, 5).stream()
      .collect(Collectors.partitioningBy(n -> n % 2 == 0));
  // {false=[1, 3, 5], true=[]}  -- true is present and empty, not absent
  ```
- **`toMap` sem uma função de merge é uma bomba de runtime, não de compile-time.** A forma de dois argumentos só falha quando uma chave duplicada de fato aparece nos dados, então pode passar por code review e testes em um dataset que por acaso não colide, e explodir em produção no dia em que colidir.
  ```java
  Stream.of("a", "b", "a").collect(Collectors.toMap(s -> s, s -> 1));
  // IllegalStateException: Duplicate key a
  ```
- **`teeing` é uma otimização de passagem única, não um ganho de legibilidade por si só.** Ela se justifica quando dois agregados genuinamente precisam compartilhar uma única travessia de uma stream cara de produzir ou de uso único; para uma fonte barata de percorrer duas vezes, duas chamadas `collect()` separadas costumam ser mais claras.
- **O combiner de um `Collector` customizado só é exercitado sob execução paralela.** Um `Collector.of(...)` cujo combiner esteja sutilmente errado (não verdadeiramente associativo, ou que mute seu primeiro argumento de um jeito que o finisher não espera) pode passar em toda execução sequencial de testes e só se comportar mal quando o mesmo collector for usado com `parallelStream()`.
- **Paralelizar uma stream pequena ou barata por elemento é uma perda líquida, não algo neutro.** A coordenação de fork/split/merge tem um custo real e fixo que um laço sequencial curto simplesmente não paga.
- **Compartilhar estado mutável dentro da lambda de uma stream paralela é uma data race, não uma lentidão.** Isso corrompe resultados (escritas perdidas, `ArrayIndexOutOfBoundsException`, `ConcurrentModificationException`) em vez de apenas rodar mais devagar, porque o contrato de paralelismo assume operações non-interfering e a JVM não faz nada para impor isso.
- **`forEachOrdered()` recompra ordem determinística ao custo da coordenação que o paralelismo tentava eliminar.** Usá-lo em toda stream paralela anula boa parte do propósito de paralelizar; é uma correção pontual para os pipelines específicos em que a ordem de saída é de fato observável.

## Documentation Links

- [Collectors — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html) — doc
- [Collector — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collector.html) — doc
- [Stream — Java SE 25 API (see the "Parallelism" section)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html) — doc
- [java.util.stream package summary — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html) — doc
