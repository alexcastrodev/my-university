---
version: 1.0
updatedAt: 2026-08-13
title: As Ferramentas de Concorrência: Executors, Sincronizadores e Locks
summary: O kit java.util.concurrent — executors e thread pools, Callable/Future, primitivas de coordenação como CountDownLatch e Semaphore, Locks explícitos e variáveis atômicas — como alternativa de mais alto nível ao código artesanal com Thread e synchronized.
---
## Objective

`Thread`, `Runnable` e `synchronized` (cobertos em profundidade pelo conceito
irmão sobre o [modelo de thread legado vs. virtual](../thread-model-legacy-vs-virtual-threads.md))
são as *primitivas* que Java sempre teve para concorrência. O JDK 5 adicionou uma camada
acima delas — as **ferramentas de concorrência** (concurrency utilities), espalhadas por
`java.util.concurrent`, `java.util.concurrent.atomic` e `java.util.concurrent.locks` — que dá aos
programas ferramentas de mais alto nível, feitas sob medida, em vez de código artesanal
com `wait()`/`notify()`: thread pools gerenciados por um `Executor`, tarefas que retornam
um valor via `Callable`/`Future`, sincronizadores prontos (`Semaphore`, `CountDownLatch`,
`CyclicBarrier`), uma alternativa explícita ao `synchronized` chamada `Lock`, e variáveis
atômicas sem lock. Este conceito cobre esse kit; o framework Fork/Join (adição do JDK 7
para paralelismo do tipo dividir-para-conquistar) é um conceito separado, mas
intimamente relacionado.

## Use Cases

- Rodar um número limitado de tarefas concorrentes — handlers HTTP, jobs em background —
  sem criar uma `Thread` bruta por tarefa, submetendo-as a um `ExecutorService` com pool.
- Obter um resultado (ou uma exceção checada) de volta de uma computação em background via
  `Callable`+`Future`, em vez de escrever num campo compartilhado que um `Runnable`
  altera.
- Fazer uma thread esperar várias outras terminarem uma sequência de inicialização única
  (`CountDownLatch`), ou fazer um grupo fixo de threads se encontrar repetidamente no
  mesmo ponto de um loop (`CyclicBarrier`).
- Limitar o acesso concorrente a um recurso restrito — um pool de conexões, um rate
  limit — a no máximo *N* threads de cada vez com um `Semaphore`.
- Precisar de `tryLock()` (nunca bloquear), um lock que pode ser adquirido através de
  múltiplos métodos sem aninhar blocos `synchronized`, ou `await()`/`signal()` por
  condição — nada disso o `synchronized` comum oferece.
- Manter um contador ou flag compartilhado simples sob atualizações concorrentes sem
  usar lock nenhum, via `AtomicInteger`/`AtomicLong`.

## Deep Dive

### ExecutorService e thread pools

Um `Executor` desacopla *submeter* uma tarefa de decidir como (e em qual thread)
ela roda. `ExecutorService` estende isso com controle de ciclo de vida — `submit()`/
`execute()` para entregar trabalho, `shutdown()` para parar de aceitar trabalho novo assim
que as tarefas já enfileiradas terminarem. `Executors` é a fábrica: `newFixedThreadPool(n)`
limita o pool a `n` threads, `newCachedThreadPool()` cresce sob demanda e reutiliza
threads ociosas, `newScheduledThreadPool(n)` adiciona execução com atraso/periódica.

```java
import java.util.concurrent.*;

class SimpExec {
  public static void main(String[] args) {
    ExecutorService es = Executors.newFixedThreadPool(2);

    System.out.println("Starting");

    // Four tasks share a pool of two threads.
    es.execute(new MyThread("A"));
    es.execute(new MyThread("B"));
    es.execute(new MyThread("C"));
    es.execute(new MyThread("D"));

    es.shutdown(); // without this call, the program never terminates
    System.out.println("Done");
  }
}

class MyThread implements Runnable {
  String name;
  MyThread(String n) { name = n; }

  public void run() {
    for (int i = 0; i < 5; i++) {
      System.out.println(name + ": " + i);
    }
  }
}
```

Apenas duas das quatro tarefas `MyThread` rodam a cada instante; as outras esperam uma
thread do pool ficar livre. `shutdown()` não é limpeza opcional — um `ExecutorService`
que nunca é desligado mantém suas threads vivas e a JVM rodando.

### Callable e Future: tarefas que retornam um valor

`Runnable.run()` não retorna nada e não pode declarar uma exceção checada. `Callable<V>`
resolve os dois problemas: seu único método, `V call() throws Exception`, retorna um
resultado e tem permissão para falhar. Submeter um `Callable` a um `ExecutorService`
retorna um `Future<V>` — um handle para um resultado que ainda não existe. `Future.get()`
bloqueia até a tarefa terminar (ou até um timeout, na sobrecarga que recebe um
`TimeUnit`) e ou retorna o valor ou relança a falha da tarefa embrulhada num
`ExecutionException`.

```java
import java.util.concurrent.*;

class CallableDemo {
  public static void main(String[] args) {
    ExecutorService es = Executors.newFixedThreadPool(3);
    Future<Integer> f;
    Future<Double> f2;
    Future<Integer> f3;

    System.out.println("Starting");

    f = es.submit(new Sum(10));
    f2 = es.submit(new Hypot(3, 4));
    f3 = es.submit(new Factorial(5));

    try {
      System.out.println(f.get());
      System.out.println(f2.get());
      System.out.println(f3.get());
    } catch (InterruptedException exc) {
      System.out.println(exc);
    } catch (ExecutionException exc) {
      System.out.println(exc);
    }

    es.shutdown();
    System.out.println("Done");
  }
}

class Sum implements Callable<Integer> {
  int stop;
  Sum(int v) { stop = v; }

  public Integer call() {
    int sum = 0;
    for (int i = 1; i <= stop; i++) sum += i;
    return sum;
  }
}

class Hypot implements Callable<Double> {
  double side1, side2;
  Hypot(double s1, double s2) { side1 = s1; side2 = s2; }

  public Double call() {
    return Math.sqrt((side1 * side1) + (side2 * side2));
  }
}

class Factorial implements Callable<Integer> {
  int stop;
  Factorial(int v) { stop = v; }

  public Integer call() {
    int fact = 1;
    for (int i = 2; i <= stop; i++) fact *= i;
    return fact;
  }
}
```

Todos os três métodos `call()` rodam concorrentemente no pool; `get()` em cada `Future`
simplesmente espera aquela tarefa específica. `Future` é anterior ao `CompletableFuture`
(adicionado no Java 8): ele não tem como anexar um callback ou encadear uma computação de
continuação — `get()` é a única saída, e ele bloqueia a thread chamadora.
`CompletableFuture` adiciona `thenApply()`/`thenCompose()`/`thenCombine()` e companhia
para compor trabalho assíncrono sem bloquear; prefira-o ao `Future` bruto em código novo.

### Primitivas de coordenação: CountDownLatch, CyclicBarrier e Semaphore

Essas três resolvem formatos diferentes do mesmo problema — "fazer threads esperarem
umas pelas outras" — e escolher a errada geralmente significa lutar contra a API em vez
de usá-la.

**`CountDownLatch`** é um portão de uso único: criado com uma contagem de eventos a
esperar, ele abre permanentemente assim que `countDown()` tiver sido chamado esse número
de vezes. Não pode ser resetado nem reutilizado.

```java
import java.util.concurrent.CountDownLatch;

class CDLDemo {
  public static void main(String[] args) {
    CountDownLatch cdl = new CountDownLatch(5);

    System.out.println("Starting");

    new Thread(new MyThread(cdl)).start();

    try {
      cdl.await(); // blocks until the count reaches zero
    } catch (InterruptedException exc) {
      System.out.println(exc);
    }

    System.out.println("Done");
  }
}

class MyThread implements Runnable {
  CountDownLatch latch;
  MyThread(CountDownLatch c) { latch = c; }

  public void run() {
    for (int i = 0; i < 5; i++) {
      System.out.println(i);
      latch.countDown(); // decrement count
    }
  }
}
```

**`CyclicBarrier`** faz um conjunto *fixo* de threads se encontrar num ponto e depois se
reseta automaticamente, então pode ser reutilizado em rodadas repetidas — útil quando o
mesmo grupo de threads precisa se sincronizar uma vez por iteração de loop em vez de uma
única vez para sempre:

```java
CyclicBarrier barrier = new CyclicBarrier(3, () ->
    System.out.println("All three reached the barrier"));

// each of the three worker threads, once per round:
barrier.await(); // blocks until all 3 have called await(), then all resume together
```

**`Semaphore`** conta *permits* em vez de chegadas: `acquire()` bloqueia apenas quando a
contagem de permits já é zero, e `release()` devolve um. Com uma contagem inicial de 1
ele se comporta como um mutex; com uma contagem maior, limita o acesso concorrente a
esse número de threads.

```java
import java.util.concurrent.Semaphore;

class SemDemo {
  public static void main(String[] args) {
    Semaphore sem = new Semaphore(1);

    new Thread(new IncThread(sem, "A")).start();
    new Thread(new DecThread(sem, "B")).start(); // mirrors IncThread, decrements
  }
}

class Shared {
  static int count = 0;
}

class IncThread implements Runnable {
  String name;
  Semaphore sem;
  IncThread(Semaphore s, String n) { sem = s; name = n; }

  public void run() {
    try {
      sem.acquire(); // blocks here if the permit is already taken
      for (int i = 0; i < 5; i++) {
        Shared.count++;
        System.out.println(name + ": " + Shared.count);
        Thread.sleep(10); // give the other thread a chance to try acquire()
      }
    } catch (InterruptedException exc) {
      System.out.println(exc);
    }
    sem.release();
  }
}
```

Sem o par `acquire()`/`release()`, as duas threads intercalariam seus incrementos e
decrementos em `Shared.count`; com um único permit, uma thread roda seu loop inteiro de
cinco iterações antes de a outra ser deixada entrar. Dois sincronizadores mais
especializados vivem no mesmo pacote — `Exchanger`, que emparelha exatamente duas
threads para trocar um valor, e `Phaser`, que generaliza `CyclicBarrier` para múltiplas
fases nomeadas — recorra a eles apenas quando nenhum dos três acima se encaixar.

### Locks explícitos: Lock, ReentrantLock e Condition

`Lock` é uma interface — `lock()`, `unlock()`, `tryLock()`, `newCondition()` — que faz o
mesmo trabalho que `synchronized`, mas como um objeto comum em vez de uma palavra-chave da
linguagem. `ReentrantLock` é sua implementação padrão: uma thread que já detém o lock pode
readquiri-lo (cada chamada `lock()` precisa ser pareada com um `unlock()`).

```java
import java.util.concurrent.locks.*;

class LockDemo {
  public static void main(String[] args) {
    ReentrantLock lock = new ReentrantLock();

    new Thread(new LockThread(lock, "A")).start();
    new Thread(new LockThread(lock, "B")).start();
  }
}

class Shared {
  static int count = 0;
}

class LockThread implements Runnable {
  String name;
  ReentrantLock lock;
  LockThread(ReentrantLock lk, String n) { lock = lk; name = n; }

  public void run() {
    try {
      lock.lock(); // blocks here if another thread already holds the lock
      Shared.count++;
      System.out.println(name + ": " + Shared.count);
      Thread.sleep(1000); // proves the second thread really does wait
    } catch (InterruptedException exc) {
      System.out.println(exc);
    } finally {
      lock.unlock(); // must run even if the try block throws
    }
  }
}
```

Diferente do `synchronized`, que libera automaticamente quando o bloco termina, `Lock`
não dá nenhuma garantia desse tipo — `unlock()` pertence a um bloco `finally`, sempre. Em
troca, `Lock` oferece o que `synchronized` não consegue: `tryLock()` para tentar a
aquisição sem bloquear, e `newCondition()` para múltiplos conjuntos de espera
independentes no mesmo lock (versus `Object.wait()`/`notify()`, do qual todo objeto tem
apenas um).

### Variáveis atômicas: atualizações sem lock

Classes de `java.util.concurrent.atomic` como `AtomicInteger` e `AtomicLong` fazem
get/set/compare-and-swap como uma única operação de hardware ininterruptível — sem
`Lock`, sem `synchronized`, e sem bloqueio, para o caso comum de um único contador ou
flag compartilhado.

```java
import java.util.concurrent.atomic.AtomicInteger;

class AtomicDemo {
  public static void main(String[] args) {
    new Thread(new AtomThread("A")).start();
    new Thread(new AtomThread("B")).start();
    new Thread(new AtomThread("C")).start();
  }
}

class Shared {
  static AtomicInteger ai = new AtomicInteger(0);
}

class AtomThread implements Runnable {
  String name;
  AtomThread(String n) { name = n; }

  public void run() {
    for (int i = 1; i <= 3; i++) {
      // getAndSet() reads the old value and stores a new one, atomically —
      // no two threads can interleave inside that read-then-write.
      System.out.println(name + " got: " + Shared.ai.getAndSet(i));
    }
  }
}
```

Nenhuma thread consegue observar `ai` no meio de uma atualização, e nenhum lock é
adquirido ou liberado em momento algum. Além de `get()`/`set()`/`compareAndSet()`/
`getAndSet()`, o pacote também tem `LongAdder`/`DoubleAdder` (somas cumulativas) e
`LongAccumulator`/`DoubleAccumulator` (operações de combinação especificadas pelo
usuário) para contadores de alta contenção onde até um loop de compare-and-swap atômico
vira um gargalo.

## Trade-offs

- **Dimensionar o thread pool é um problema de tuning que agora é seu** —
  `newFixedThreadPool(2)` limita a concorrência a 2 independentemente de quantas tarefas
  forem submetidas, então 4 tarefas se enfileiram em pares em vez de todas rodarem ao
  mesmo tempo; um pool pequeno demais subutiliza os núcleos disponíveis, um pool grande
  demais arrisca o mesmo esgotamento de recursos que os pools existem para evitar. Não
  há um número certo único — depende de as tarefas serem CPU-bound ou I/O-bound.
- **`Lock` troca liberação automática por disciplina manual** — `synchronized` libera seu
  monitor quando o bloco termina, com ou sem exceção; `Lock.unlock()` não acontece a menos
  que você o chame, então pular o `finally` deixa o lock preso para sempre depois de uma
  exceção.
  ```java
  lock.lock();
  doWork();       // throws
  lock.unlock();  // never reached — lock is now stuck locked, every future
                   // lock() from any thread blocks forever
  ```
- **`Future.get()` bloqueia; ele não compõe** — chamar `get()` prende a thread chamadora
  até a tarefa terminar, e não existe forma nativa de encadear uma ação de continuação
  ou combinar dois `Future`s sem bloquear em cada um por vez. `CompletableFuture`
  (Java 8) existe justamente para fechar essa lacuna com composição baseada em
  callback — prefira-o quando o fluxo de trabalho precisar reagir a um resultado em vez
  de apenas esperar por um.
- **Escolher o sincronizador errado custa uma reescrita, não um erro de compilação** — um
  portão de inicialização de uso único implementado com `CyclicBarrier` "funciona" até a
  segunda rodada do loop precisar que a barreira reinicie, ou um rendezvous repetido
  implementado com `CountDownLatch` "funciona" até a segunda rodada precisar esperar de
  novo — nada detecta a incompatibilidade até o código realmente rodar uma segunda vez.
- **Atômicos só cobrem uma única variável de cada vez** — `AtomicInteger` torna uma
  leitura-modificação-escrita atômica, mas atualizar dois atômicos relacionados juntos
  não é:
  ```java
  AtomicInteger balance = new AtomicInteger(100);
  AtomicInteger txCount = new AtomicInteger(0);
  balance.addAndGet(-50); // atomic on its own...
  txCount.incrementAndGet(); // ...but another thread can observe the gap
                              // between these two calls — this pair still
                              // needs a Lock or synchronized block to be
                              // atomic together.
  ```

## Documentation Links

- [ExecutorService — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html) — doc
- [Executors — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html) — doc
- [Future — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html) — doc
- [CompletableFuture — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html) — doc
- [CountDownLatch — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html) — doc
- [Semaphore — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html) — doc
- [ReentrantLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html) — doc
- [AtomicInteger — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html) — doc
