---
version: 1.0
updatedAt: 2026-08-05
title: "Modelo de Threads: Controle Legado vs. Virtual Threads"
summary: Por que Thread.suspend/resume/stop foram descontinuados por corromperem estado compartilhado, o padrão de desligamento cooperativo que os substituiu, e por que virtual threads resolvem um problema diferente (custo de thread) em vez desse mesmo problema de corretude.
---
## Objective

O Java antigo (antes do Java 2) permitia pausar, reiniciar e matar uma thread de fora com `Thread.suspend()`, `resume()` e `stop()`. Os três foram descontinuados por serem capazes de corromper estado compartilhado, e a correção — desligamento cooperativo, verificado por flag, em vez de controle externo — ainda é o formato de um código correto de ciclo de vida de thread hoje em dia. O declínio deles não parou na descontinuação: `suspend()`/`resume()` foram removidos por completo da API no Java SE 23, e `stop()` — ainda presente e ainda descontinuado para remoção — agora sempre lança `UnsupportedOperationException` em vez de fazer qualquer coisa. Essa mesma era pré-2 também tratava uma `Thread` como um recurso caro, apoiado no SO, a ser racionado com pools. Virtual threads (JEP 444, padrão desde o Java 21) não mudam o motivo pelo qual `suspend`/`resume`/`stop` eram inseguros, mas eliminam o *motivo* pelo qual esses velhos hábitos de pooling existiam, para começo de conversa.

## Use Cases

- Reconhecer `Thread.suspend()`/`resume()`/`stop()` (ou código que ainda os chama) como um bug de corretude, não apenas um detalhe de estilo, ao ler ou portar código Java antigo.
- Implementar pausa/retomada/cancelamento de uma tarefa de longa duração usando uma flag verificada em vez de controle externo de thread.
- Decidir se um trecho de código concorrente precisa de um `ExecutorService` limitado (platform threads, um recurso escasso) ou pode simplesmente disparar uma virtual thread por tarefa (um recurso abundante) — a mesma pergunta de custo/pooling que a era do livro respondeu de uma única forma.

## Deep Dive

### Por que `suspend()`/`resume()`/`stop()` foram descontinuados

```java
// Legacy control API — deprecated since Java 1.2, shown for what NOT to do.
// On current JDKs this no longer even compiles as written; see below.
Thread worker = new Thread(() -> updateCriticalStructure());
worker.start();
worker.suspend(); // Thread.suspend() — removed from the API in Java SE 23
worker.stop();    // Thread.stop() — still present, but always throws now
```

`suspend()` congela uma thread onde quer que ela esteja — inclusive no meio de segurar um lock sobre uma estrutura de dados crítica. Como uma thread suspensa não libera o que ela detém, qualquer outra thread esperando pelo mesmo lock entra em deadlock: a única thread que poderia liberar o lock (chamando `resume()`) costuma ser uma thread *diferente* daquela que agora está bloqueada esperando por ele. `stop()` é pior: ele força a liberação de todo lock que a thread alvo detém, no ponto em que a execução estava, então uma estrutura de dados que estava sendo atualizada no meio fica em um estado corrompido — e esse estado corrompido agora fica visível para qualquer outra thread que estava esperando pelo lock recém-liberado.

Isso não é só cor histórica: ambos os métodos foram `@Deprecated(forRemoval = true)` por anos, e a JVM desde então foi cumprindo isso em etapas. `Thread.suspend()`/`resume()` primeiro passaram a sempre lançar `UnsupportedOperationException` (Java 20), depois foram removidos de `Thread` por completo no Java SE 23 — chamar `worker.suspend()` contra um JDK atual falha na compilação com "cannot find symbol". `Thread.stop()` seguiu o caminho mais brando: o método ainda está declarado em `Thread` (ainda descontinuado para remoção), mas seu corpo agora sempre lança `UnsupportedOperationException` incondicionalmente — ele compila, mas nunca mais consegue parar uma thread.

### A substituição: desligamento cooperativo via uma flag verificada

```java
class Worker extends Thread {
    private volatile boolean running = true;

    @Override
    public void run() {
        while (running) {
            doUnitOfWork();
        }
    }

    void requestStop() { // called from another thread
        running = false;
    }
}
```

Em vez de uma thread externa entrar e congelar/matar outra thread no meio de uma instrução, a thread alvo verifica sua própria flag em um ponto seguro entre unidades de trabalho e sai de `run()` por conta própria — nunca no meio de uma atualização, nunca segurando um lock que ela não sabe que está abandonando. É a mesma ideia que o próprio exemplo de suspend/resume baseado em `wait()`/`notify()` do livro demonstra, e é exatamente assim que o cancelamento cooperativo correto funciona ainda hoje (`Thread.interrupt()` mais um `isInterrupted()`/`InterruptedException` verificado é a versão da biblioteca padrão do mesmo padrão).

### O que virtual threads mudam — e o que não mudam

```java
// One virtual thread per task, no pool sizing decision to make
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Result> f1 = executor.submit(() -> callServiceA());
    Future<Result> f2 = executor.submit(() -> callServiceB());
}
```

O modelo de threading do livro trata uma `Thread` como um recurso escasso, apoiado no SO — um dos motivos pelos quais pools de threads (reutilizar um conjunto limitado de platform threads entre muitas tarefas) viraram prática padrão: criar milhares de platform threads arrisca esgotar recursos do SO. Virtual threads (JEP 444) são mapeadas muitos-para-um sobre um pequeno número de threads carrier (platform threads) e são desmontadas enquanto bloqueadas em I/O, então milhões podem existir ao mesmo tempo — a orientação oficial é explicitamente parar de fazer pooling delas e, em vez disso, criar uma por tarefa, usando um `Semaphore` se a concorrência precisar ser limitada. Isso não toca em nada no problema de `suspend`/`resume`/`stop` — uma virtual thread tem exatamente o mesmo contrato `java.lang.Thread` e corromperia estado exatamente da mesma forma se esses métodos descontinuados ainda funcionassem nela. Virtual threads resolvem um problema de custo/escala (quantas threads você pode se dar ao luxo de ter), não um problema de corretude (o que uma thread tem permissão de fazer com estado compartilhado enquanto está pausada ou morta).

## Trade-offs

- **A API antiga não recebeu só um aviso — a JVM acabou impondo isso.** `stop()` ainda compila (descontinuado para remoção), mas seu corpo agora sempre lança, então código antigo que o chama falha ruidosamente em tempo de execução em vez de corromper estado silenciosamente; `suspend()`/`resume()` foram mais longe e foram apagados de `Thread`, então código-fonte antigo que os chama nem compila mais.
```java
Thread t = new Thread(() -> {});
t.start();
t.stop();    // compiles; throws UnsupportedOperationException at run time
t.suspend(); // compile error: cannot find symbol — removed in Java SE 23
```
- **O desligamento cooperativo adiciona uma pequena dose de cerimônia** — o próprio laço da tarefa precisa verificar uma flag ou tratar `InterruptedException`, em vez do (inseguro) one-liner `stop()`; não existe forma de forçar o término de uma thread que não está cooperando, por design.
- **Hábitos de pooling da era das platform threads não desaparecem sozinhos** — código que envolve virtual threads em um `ExecutorService` de tamanho fixo (em vez de `newVirtualThreadPerTaskExecutor()`) mantém a mentalidade antiga de escassez e joga fora a maior parte da escalabilidade que as virtual threads oferecem, sem estar errado de nenhuma forma que o compilador consiga sinalizar.

## Documentation Links

- [Virtual Threads (Java SE developer guide)](https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html) — doc
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [Thread.stop() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#stop()) — doc
- [Why is Thread.stop deprecated and the ability to stop a thread removed?](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/doc-files/threadPrimitiveDeprecation.html) — doc
- [Java SE 25 Migration Guide — Removed APIs (Thread.suspend/resume)](https://docs.oracle.com/en/java/javase/25/migrate/removed-apis.html) — doc
