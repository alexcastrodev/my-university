---
version: 1.0
updatedAt: 2026-07-22
question: Como limitar o número de acessos concorrentes a um recurso?
---
## Question

# Como limitar o número de acessos concorrentes a um recurso?

## Short Answer

Esse é o trabalho de um **semáforo**. O JDK vem com a classe `Semaphore` justamente para isso: limitar quantas threads podem usar um recurso ao mesmo tempo, de uma forma que diz claramente, no próprio código, "eu quero limitar o acesso concorrente a isso".

## What It Is

Um semáforo mantém um número fixo de **permissões (permits)**. Uma thread chama `acquire()` antes de usar o recurso — o que bloqueia se não houver permissão disponível — e `release()` quando termina, devolvendo a permissão para outra thread usar:

```java
var semaphore = new Semaphore(10);
try {
    semaphore.acquire();
    scope.fork(Service::readData);
} finally {
    semaphore.release();
}
```

Essa é uma abordagem muito mais explícita e reveladora de intenção do que uma alternativa comum: criar um `ExecutorService` dedicado, com um pool de threads de tamanho fixo, dimensionado para o limite que você quer.

```java
var executor = Executors.newFixedThreadPool(10);
executor.submit(Service::readData);
```

Esse truque funciona, mas esconde a real intenção atrás de uma abstração não relacionada (um pool de threads), e é fácil de usar mal ou perder o controle conforme a base de código cresce.

## A Stream-Based Alternative

Desde que o Java adicionou os **stream gatherers** (JEP 485), existe uma terceira opção para esse mesmo problema quando você está processando um stream de requisições: `Gatherers.mapConcurrent(maxConcurrency, mapper)`.

Você passa uma concorrência máxima e uma função de mapeamento. Cada mapeamento roda de forma concorrente, mas o número de mapeamentos ativos em qualquer momento nunca ultrapassa `maxConcurrency` — internamente, é sustentado pelo mesmo tipo de limitação baseada em permissões que um semáforo oferece, sem que você precise gerenciar um você mesmo.

## Practical Example

```java
var requests = List.of(/* suas requisições */);

var results = requests.stream()
    .gather(Gatherers.mapConcurrent(
        10, // concorrência máxima
        Service::readData))
    .toList();
```

Aqui, até 10 chamadas a `Service::readData` rodam concorrentemente; o resto espera a vez automaticamente conforme vagas vão abrindo.

## Solution and Conclusion

Prefira `Semaphore` quando precisar de controle explícito e reutilizável sobre o acesso a um recurso em caminhos de código arbitrários. Prefira `Gatherers.mapConcurrent` quando o trabalho é naturalmente expresso como um stream de requisições sendo mapeadas para respostas — isso mantém o código mais simples e a intenção óbvia.

Um aviso importante: nunca combine esse gatherer com um **stream paralelo** — os dois mecanismos de concorrência entram em conflito e o resultado é uma bagunça. Fique com um stream sequencial simples; `mapConcurrent` já gerencia a concorrência pra você.

## References

- [Java Coding Tip #379: Limiting Concurrent Access](https://www.youtube.com/shorts/q-coQ6MBjeE) — video
- [Semaphore — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html) — doc
- [Gatherers.mapConcurrent — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html#mapConcurrent(int,java.util.function.Function)) — doc
- [JEP 485: Stream Gatherers](https://openjdk.org/jeps/485) — doc
