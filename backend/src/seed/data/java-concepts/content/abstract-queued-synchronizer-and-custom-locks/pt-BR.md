---
version: 1.0
updatedAt: 2026-08-13
title: AbstractQueuedSynchronizer — o que existe por baixo de Lock e Semaphore
summary: A maquinaria interna compartilhada — um campo de estado, uma fila de threads e alguns hooks sobrescrevíveis — sobre a qual ReentrantLock, Semaphore e CountDownLatch são construídos.
---
## Objective

O conceito complementar sobre [utilitários de concorrência](concurrency-utilities-executors-and-synchronizers.md)
cobre `ReentrantLock`, `Semaphore` e `CountDownLatch` de fora — chamar
`lock()`, chamar `acquire()`, chamar `await()`. Este conceito é sobre o que existe por baixo
dos três: `java.util.concurrent.locks.AbstractQueuedSynchronizer` (AQS), uma única
classe que implementa a parte difícil e fácil de errar que todo sincronizador
bloqueante precisa — uma fila thread-safe de threads bloqueadas, e a lógica para dar park e unpark
nelas corretamente — para que `ReentrantLock`, `Semaphore`, `CountDownLatch`,
`ReentrantReadWriteLock` e `FutureTask` não precisem reimplementar isso do zero cada um.
Uma subclasse de AQS só precisa responder a uma pergunta restrita em um punhado de métodos
`protected`: dado o estado atual, esse sincronizador específico permite que a thread
chamadora prossiga agora?

## Use Cases

- Entender *por que* `ReentrantLock.tryAcquire()` e `Semaphore.tryAcquireShared()`
  se comportam da forma que se comportam sob contenção, em vez de tratá-los como caixas-pretas.
- Construir um sincronizador customizado quando nenhuma das classes padrão de
  `java.util.concurrent` se encaixa exatamente no formato de espera/liberação necessário — um latch de disparo único, um gate de recurso
  com regras de admissão customizadas — sem escrever manualmente o parking de threads e uma
  fila de espera.
- Ler um thread dump ou stack trace que menciona
  `AbstractQueuedSynchronizer$Node` ou `ConditionObject` e saber o que o produziu —
  qualquer chamada bloqueada a `ReentrantLock.lock()`, `Semaphore.acquire()` ou
  `CountDownLatch.await()` passa pelos internos de AQS.
- Reconhecer o mesmo padrão `getState()`/`compareAndSetState()` em classes não relacionadas
  do JDK e saber que é o mesmo mecanismo subjacente, não três implementações independentes.

## Deep Dive

### A forma que todo sincronizador compartilha

Um lock, um semaphore, um latch e uma barrier parecem não relacionados a partir de suas APIs públicas,
mas estruturalmente são os mesmos três ingredientes:

1. **Algum estado** que determina se uma thread pode prosseguir — mantido/não-mantido para um
   lock, permits restantes para um semaphore, contagem-até-zero para um latch.
2. **Operações de acquire e release** que verificam esse estado e, se ele permite
   prosseguir, o atualizam — caso contrário a thread chamadora precisa esperar.
3. **Uma fila de threads bloqueadas** esperando o estado se tornar favorável, que
   precisa ser acordada (algumas ou todas) sempre que um release tornar o progresso possível.

Cada uma dessas classes poderia reimplementar o parking de threads, uma fila de espera
interna, e a lógica propensa a race conditions para verificar-estado/enfileirar/parkar atomicamente — e errar
sutilmente sob contenção. AQS existe para que isso aconteça exatamente uma vez.
Ela possui:

- Um único campo de estado `int`, exposto às subclasses apenas por meio de três
  métodos `protected final`: `getState()`, `setState(int)` e
  `compareAndSetState(int expect, int update)`.
- Uma fila FIFO de threads esperando para adquirir, gerenciada inteiramente dentro de AQS — uma
  subclasse nunca toca a fila diretamente.
- A maquinaria de bloqueio/desbloqueio: `acquire(int)`/`release(int)` para modo
  exclusivo, `acquireShared(int)`/`releaseShared(int)` para modo compartilhado, além de
  variantes interruptíveis e com timeout de cada uma.

O que uma subclasse fornece é apenas o *significado* de acquire e release para o seu
sincronizador específico, sobrescrevendo um pequeno subconjunto de métodos-hook `protected`
que AQS chama de volta:

```java
// exclusive mode (e.g. a lock — only one thread can hold it)
protected boolean tryAcquire(int arg)         { ... }
protected boolean tryRelease(int arg)         { ... }
protected boolean isHeldExclusively()         { ... }

// shared mode (e.g. a semaphore or latch — many threads can hold it at once)
protected int     tryAcquireShared(int arg)   { ... } // negative = failed
protected boolean tryReleaseShared(int arg)   { ... }
```

O loop canônico que AQS executa internamente, em linhas gerais, é: verificar se o
estado atual permite a aquisição via o hook `try*`; se não, enfileirar a thread
chamadora (se ainda não estiver na fila) e parkeá-la; uma vez desparkeada, tentar o hook de novo. `release`
atualiza o estado via o hook e, se o hook reportar que o release pode ter
desbloqueado alguém, acorda as threads enfileiradas para que elas tentem novamente `tryAcquire`/
`tryAcquireShared`. Nada desse loop, da fila, ou do parking é algo que uma
subclasse escreve — ela só escreve os métodos `try*`.

### Um exemplo mínimo funcional: um latch de disparo único sobre AQS

Um latch binário — fechado até que alguém o abra, e então permanentemente aberto — precisa
de exatamente um bit de estado. Codifique-o como estado AQS `0` (fechado) ou `1` (aberto), e
delegue a um `Sync` interno privado em vez de estender AQS diretamente (o mesmo
padrão que todo sincronizador do JDK segue, para que a superfície pública do próprio latch
permaneça apenas `await()`/`signal()` em vez de vazar toda a API pública de AQS):

```java
import java.util.concurrent.locks.AbstractQueuedSynchronizer;

public class OneShotLatch {
    private final Sync sync = new Sync();

    public void await() throws InterruptedException {
        sync.acquireSharedInterruptibly(0); // arg is unused here
    }

    public void signal() {
        sync.releaseShared(0); // arg is unused here
    }

    private static class Sync extends AbstractQueuedSynchronizer {
        protected int tryAcquireShared(int ignored) {
            // Succeed (return >= 0) only once the latch is open.
            return (getState() == 1) ? 1 : -1;
        }

        protected boolean tryReleaseShared(int ignored) {
            setState(1); // latch is now open, permanently
            return true; // let every queued (and future) acquirer proceed
        }
    }
}
```

Traçando o que acontece: uma thread chamando `await()` invoca
`acquireSharedInterruptibly(0)`, que chama `tryAcquireShared`. Enquanto
`getState() == 0`, isso retorna `-1` (falha), então AQS parkeia a thread chamadora em
sua fila interna. Quando alguma outra thread chama `signal()`, `releaseShared(0)`
chama `tryReleaseShared`, que define o estado como `1` e retorna `true`. AQS
interpreta esse `true` como "uma thread bloqueada pode agora ter sucesso" e acorda as
threads enfileiradas, cada uma das quais executa `tryAcquireShared` novamente — agora retornando `1` porque
`getState() == 1` — e prossegue. Uma thread que chama `await()` *depois* que `signal()`
já rodou nunca chega a bloquear: `tryAcquireShared` tem sucesso na primeira tentativa.
Isso é o latch inteiro — cerca de uma dúzia de linhas, sem fila escrita à mão, sem
`wait()`/`notifyAll()` escritos à mão.

### ReentrantLock sobre AQS: estado como contador de posse

`ReentrantLock` é o caso de modo exclusivo: apenas uma thread pode mantê-lo, mas essa
thread pode readquiri-lo (cada `lock()` precisa de um `unlock()` correspondente). Ele se mapeia sobre
AQS usando o estado como um **contador de posse** em vez de um booleano, mais um campo
extra próprio — a thread proprietária — que AQS não rastreia:

```java
// simplified from the non-fair ReentrantLock.Sync.tryAcquire
protected boolean tryAcquire(int acquires) {
    Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // lock is free — try to claim it
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (current == getExclusiveOwnerThread()) {
        // already ours — this is a reentrant acquisition, just bump the count
        setState(c + acquires);
        return true;
    }
    return false; // held by another thread
}
```

Estado `0` significa não mantido. A primeira chamada `lock()` vê `c == 0` e usa
`compareAndSetState(0, 1)` — não um `setState` simples, porque outra thread poderia
estar competindo para reivindicar o mesmo lock no mesmo instante, e apenas um
compare-and-set pode vencer. Uma segunda chamada `lock()` da *mesma* thread (aquisição
reentrante — o cenário que a seção Trade-offs do conceito complementar
menciona: chamadas `lock()` precisam ser balanceadas por chamadas `unlock()`) vê `current ==
getExclusiveOwnerThread()` e simplesmente incrementa o contador em vez de bloquear em
si mesma. `tryRelease` é o espelho: decrementa o contador e só
reporta o lock como liberado (deixando AQS acordar uma thread enfileirada) quando o contador
chega a zero novamente — então um `ReentrantLock` travado duas vezes precisa de duas chamadas `unlock()`
antes que qualquer outra thread possa adquiri-lo. `Lock.newCondition()` retorna um `new
ConditionObject()` — uma classe interna não-estática que o próprio AQS fornece — e é por isso que
`ReentrantLock` ganha múltiplos wait sets independentes praticamente de graça.

`Semaphore` e `CountDownLatch` seguem o mesmo padrão em modo compartilhado em vez
de exclusivo: o estado de `Semaphore` é os permits restantes, e seu
loop `tryAcquireShared`/`tryReleaseShared` roda sobre `compareAndSetState` exatamente como
o `OneShotLatch` acima, tentando novamente sob contenção em vez de bloquear, até que ou
não haja mais permits suficientes ou o compare-and-set vença. O estado de `CountDownLatch`
é o próprio valor de contagem regressiva. `FutureTask` e
`ReentrantReadWriteLock` também são construídos sobre AQS — `FutureTask` codifica o status da tarefa
(não-iniciada/em-execução/concluída/cancelada) como o estado, e
`ReentrantReadWriteLock` divide seu único estado `int` em duas metades de 16 bits, uma
para o contador de read-lock e outra para o contador de write-lock, roteando as threads leitoras
pelo caminho de aquisição compartilhada e o escritor pelo caminho de aquisição exclusiva
da mesma instância de AQS.

## Trade-offs

- **AQS é um detalhe de implementação do qual você herda corretude, não uma API que
  você chama no dia a dia** — recorrer a ela diretamente só compensa quando nenhuma classe
  existente em `java.util.concurrent` (`Semaphore`, `CountDownLatch`,
  `ReentrantLock`, `BlockingQueue`) já expressa a condição de espera necessária;
  construir um sincronizador customizado é estritamente mais difícil de acertar do que compor
  os existentes.
- **Um sincronizador construído sobre AQS deve delegar a ela via um `Sync` interno privado,
  não estendê-la diretamente** — estender AQS publicamente expõe métodos como
  `acquire(int)`/`release(int)` no próprio tipo do sincronizador, permitindo que chamadores
  manipulem a fila ou o estado diretamente e corrompam invariantes que o sincronizador
  deveria garantir:
  ```java
  // fragile: OneShotLatch IS an AQS, so its acquire/release are public too
  public class OneShotLatch extends AbstractQueuedSynchronizer { ... }
  new OneShotLatch().acquireShared(0); // callers can bypass await()/signal()

  // robust: OneShotLatch HAS an AQS, hidden in a private field
  public class OneShotLatch {
      private final Sync sync = new Sync(); // Sync extends AQS, but stays private
      public void await() throws InterruptedException { sync.acquireSharedInterruptibly(0); }
  }
  ```
- **Os métodos-hook `try*` devem usar `compareAndSetState`, não `setState`, quando
  outra thread pode estar competindo para mudar o mesmo estado** — `setState` é uma
  escrita simples; duas threads que observam um lock não mantido e ambas chamam uma lógica
  estilo `setState(0, 1)` com uma escrita simples podem ambas acreditar que o adquiriram.
  `compareAndSetState(expected, new)` só tem sucesso se o estado ainda
  corresponder ao que foi observado por último, e é exatamente por isso que os trechos de `ReentrantLock` e
  `Semaphore` acima tentam novamente em loop em vez de escrever incondicionalmente.
- **Escolher modo exclusivo vs. compartilhado é uma decisão de design sem volta** — um
  sincronizador que só implementa `tryAcquire`/`tryRelease` (exclusivo) não tem
  caminho para que múltiplas threads o mantenham simultaneamente, e um que só
  implementa `tryAcquireShared`/`tryReleaseShared` não tem o conceito de uma única
  thread proprietária; adaptar o outro modo depois significa adicionar o par
  faltante de métodos-hook e repensar a codificação do estado do zero, da mesma forma que
  `ReentrantReadWriteLock` precisou dividir seu estado em duas metades para suportar ambos os
  modos em uma única instância.

## Documentation Links

- [AbstractQueuedSynchronizer — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html) — doc
- [AbstractQueuedSynchronizer.ConditionObject — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.ConditionObject.html) — doc
- [ReentrantLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html) — doc
- [Semaphore — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Semaphore.html) — doc
- [CountDownLatch — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CountDownLatch.html) — doc
- [ReentrantReadWriteLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html) — doc
