---
version: 1.0
updatedAt: 2026-08-13
title: BlockingQueue e o Padrão Produtor-Consumidor
summary: Como o put/take bloqueante de BlockingQueue reduz o padrão produtor-consumidor a poucas linhas de código, e por que filas limitadas (bounded) oferecem backpressure real em vez de apenas adiar um OutOfMemoryError.
---
## Objective

Entenda `BlockingQueue`: uma `Queue` cujos `put()` e `take()` bloqueiam em vez de falhar — `put()` espera por espaço quando a fila está cheia, `take()` espera por um elemento quando ela está vazia. Essa única propriedade é o que torna o padrão produtor-consumidor — código que identifica trabalho e o coloca em uma fila, desacoplado do código que o remove e o executa — trivial de implementar corretamente, sem nenhum `wait()`/`notify()` escrito à mão em lugar nenhum.

## Use Cases

- Passar itens de trabalho de uma ou mais threads produtoras para uma ou mais threads consumidoras sem que nenhum dos lados saiba nada sobre o outro.
- Construir uma fila de trabalho limitada (bounded) que aplica backpressure sobre os produtores quando os consumidores ficam para trás, em vez de deixar o uso de memória crescer sem limite.
- Processar itens em ordem de prioridade em vez de ordem de chegada, ainda usando o mesmo modelo de put/take bloqueante.
- Implementar um handoff direto — o item de um produtor vai direto para um consumidor que está esperando, sem nenhum armazenamento intermediário.
- Transferir com segurança um objeto mutável de uma thread para exatamente outra thread sem adicionar um lock ao redor do próprio objeto.

## Deep Dive

### O padrão produtor-consumidor e por que BlockingQueue o torna trivial

Um produtor identifica trabalho; um consumidor o executa. Conectá-los com uma `BlockingQueue` significa que nenhum dos lados chama o outro diretamente — ambos só conversam com a fila:

```java
import java.util.concurrent.*;

class ProducerConsumerDemo {
  public static void main(String[] args) {
    BlockingQueue<String> queue = new LinkedBlockingQueue<>(10);

    Runnable producer = () -> {
      try {
        for (int i = 0; i < 5; i++) {
          String item = Thread.currentThread().getName() + "-item-" + i;
          queue.put(item); // blocks here if the queue is already full
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    };

    Runnable consumer = () -> {
      try {
        while (true) {
          String item = queue.take(); // blocks here until an item exists
          System.out.println("processed " + item);
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    };

    new Thread(producer, "producer-1").start();
    new Thread(producer, "producer-2").start();
    new Thread(consumer, "consumer").start();
  }
}
```

Nenhum produtor sabe que o outro existe, e o consumidor não sabe nada sobre nenhum dos produtores — os três só interagem com `queue`. Não há contador compartilhado, nenhum bloco `synchronized`, e nenhum par `wait()`/`notify()` manual para errar; `put()` e `take()` já contêm toda a coordenação interna necessária. (O loop `while (true)` do consumidor nunca termina sozinho — um programa real precisa de uma forma de pará-lo, como uma interrupção ou um item sentinela "poison pill", o que é uma preocupação separada da própria fila.)

### Escolhendo uma implementação

`BlockingQueue` é uma interface; qual classe construir depende das necessidades de ordenação e capacidade:

```java
// Bounded FIFO, fixed-size array backing — good when the capacity is known
// up front and shouldn't grow, e.g. a buffer between a fast producer and a
// slower consumer.
BlockingQueue<Task> fixed = new ArrayBlockingQueue<>(256);

// FIFO, optionally bounded, linked-node backing — the general-purpose default;
// omit the capacity argument for an effectively unbounded queue.
BlockingQueue<Task> linked = new LinkedBlockingQueue<>(256);

// Orders by priority (Comparable or a Comparator), not arrival order — for
// processing urgent tasks before older, lower-priority ones.
BlockingQueue<Task> byPriority = new PriorityBlockingQueue<>(256, Comparator.comparingInt(Task::urgency));

// Zero capacity: put() doesn't return until a take() is there to receive the
// item directly, and vice versa — a pure handoff with no storage at all.
BlockingQueue<Task> handoff = new SynchronousQueue<>();
```

`SynchronousQueue` só faz sentido quando há consumidores suficientes para que um `put()` quase sempre encontre um já esperando — caso contrário o produtor simplesmente bloqueia sem nada enfileirado para mostrar por isso.

### Por que filas limitadas (bounded) importam

Uma fila ilimitada nunca rejeita um `put()`, o que parece conveniente mas só adia o problema real: se os produtores consistentemente ultrapassam os consumidores, a fila cresce sem limite até a JVM ficar sem heap.

```java
BlockingQueue<Task> unbounded = new LinkedBlockingQueue<>(); // no capacity argument
unbounded.put(task); // never blocks — if consumers can't keep up, this queue
                      // keeps growing until an OutOfMemoryError, later, elsewhere
```

Uma fila limitada transforma esse mesmo desequilíbrio em backpressure — o produtor bloqueia no momento em que não há mais espaço, o que é uma forma de autorregulação, não apenas um detalhe de economia de memória:

```java
BlockingQueue<Task> bounded = new ArrayBlockingQueue<>(100); // capacity fixed at 100
bounded.put(task); // blocks here once 100 items are already queued, until a
                    // consumer take()s one and frees a slot — the producer
                    // literally cannot get further ahead of the consumers
```

`offer()` (com ou sem timeout) é a alternativa não bloqueante na mesma fila — ela reporta falha em vez de esperar, útil para descartar carga em vez de pausar o produtor.

### Confinamento serial de threads (serial thread confinement)

Passar um objeto mutável através do par `put()`/`take()` de uma blocking queue transfere a propriedade da thread produtora para a thread consumidora. Contanto que o produtor nunca toque no objeto novamente depois que `put()` retorna, apenas uma thread tem acesso a ele por vez — então o objeto não precisa de nenhum lock próprio, mesmo não sendo thread-safe por si só.

```java
class MutableTask {
  private final StringBuilder log = new StringBuilder();
  void appendStep(String step) { log.append(step).append('\n'); }
}

BlockingQueue<MutableTask> queue = new LinkedBlockingQueue<>();

// producer thread
MutableTask task = new MutableTask();
task.appendStep("collected");
queue.put(task);          // ownership transfers to whichever thread take()s it
// the producer must not call task.appendStep(...) again after this line

// consumer thread
MutableTask received = queue.take();
received.appendStep("processed"); // safe: this thread now has exclusive access
```

A sincronização interna de `BlockingQueue` garante que o consumidor veja toda escrita que o produtor fez antes do handoff — a mesma garantia de visibilidade que toda publicação segura sempre exige — sem que nenhum dos lados precise de `synchronized` no próprio `MutableTask`. `Deque` também tem uma prima bloqueante — `BlockingDeque`, implementada por `LinkedBlockingDeque` — que suporta o mesmo modelo de put/take em ambas as extremidades e está por trás de designs de work-stealing, onde cada consumidor possui sua própria deque e só acessa a cauda de outra quando a sua própria está vazia.

## Trade-offs

- **Filas ilimitadas trocam bloqueio agora por um `OutOfMemoryError` depois** — nada em `LinkedBlockingQueue()` (sem argumento) impede um produtor descontrolado; o descompasso entre taxa de produção e taxa de consumo não desaparece, ele só fica invisível até o heap se encher:

  ```java
  BlockingQueue<Task> q = new LinkedBlockingQueue<>();
  // put() always succeeds immediately — the imbalance is silently accumulating
  ```
- **`SynchronousQueue` só funciona quando já existe um consumidor esperando** — sem consumidores prontos, `put()` bloqueia com zero itens armazenados em qualquer lugar, o que é um modo de falha bem diferente de uma fila que pelo menos guarda trabalho enquanto espera:

  ```java
  BlockingQueue<Task> handoff = new SynchronousQueue<>();
  handoff.put(task); // blocks indefinitely if no thread is currently in take()
  ```
- **`PriorityBlockingQueue` é ilimitada e abre mão da ordem FIFO** — itens com a mesma prioridade não têm ordem relativa garantida, e como qualquer fila ilimitada ela ainda pode crescer sem limite se os produtores ultrapassarem os consumidores.
- **`put()` e `take()` declaram `InterruptedException`, então cada chamador precisa decidir como reagir a ela** — engolir a exceção silenciosamente (um bloco `catch` vazio) descarta a informação de que a thread foi solicitada a parar; restaurar a interrupção (`Thread.currentThread().interrupt()`) ou propagar a exceção checked são as duas opções corretas, não ignorá-la.
- **Um loop consumidor construído sobre `take()` nunca termina sozinho** — `while (true) { queue.take(); ... }` não tem condição natural de término, então um desligamento real precisa de um sinal explícito (interromper a thread consumidora, ou fazer os produtores enfileirarem um item "poison pill" reconhecível) que a própria fila não fornece.

## Documentation Links

- [BlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html) — doc
- [ArrayBlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html) — doc
- [LinkedBlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html) — doc
- [PriorityBlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/PriorityBlockingQueue.html) — doc
- [SynchronousQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html) — doc
- [BlockingDeque — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingDeque.html) — doc
- [LinkedBlockingDeque — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingDeque.html) — doc
