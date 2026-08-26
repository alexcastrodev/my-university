---
version: 1.0
updatedAt: 2026-08-13
title: Encerrando um ExecutorService, e Como a JVM Decide Sair
summary: Compara o shutdown() gracioso com o shutdownNow() agressivo, o idioma awaitTermination()/close(), poison pills para consumidores baseados em fila, handlers de exceção não capturada, e shutdown hooks da JVM e daemon threads.
---
## Objective

Iniciar um `ExecutorService` ou uma worker thread é a metade fácil do seu ciclo de vida;
pará-lo de forma limpa é a metade fácil de errar. `shutdown()` e
`shutdownNow()` oferecem dois modos de encerramento diferentes com um trade-off real entre
segurança e responsividade, nenhum dos dois bloqueia por si só, um design produtor-consumidor
construído sobre uma `BlockingQueue` precisa de seu próprio sinal cooperativo para parar, uma
thread que morre por uma exceção não capturada faz isso silenciosamente a menos que algo esteja
registrado para perceber, e a própria JVM decide se sai enquanto suas threads ainda estão
rodando com base em um único boolean por thread. Este conceito cobre os quatro: encerrar um
executor, sinalizar um consumidor baseado em fila para parar, capturar a morte não percebida de
uma thread, e a mecânica de daemon/user thread e shutdown hook que governa a saída da JVM.

## Use Cases

- Encerrar um thread pool quando uma aplicação (ou um componente com um ciclo de vida mais
  curto que a JVM inteira) termina de usá-lo, sem abandonar trabalho que já está enfileirado.
- Construir um pipeline produtor-consumidor sobre uma `BlockingQueue` onde o consumidor
  precisa de um sinal confiável de "não vem mais trabalho" que não pode entrar em race com
  itens ainda sendo enfileirados.
- Garantir que o crash de uma background thread de longa duração apareça nos logs em vez de
  desaparecer silenciosamente.
- Decidir se uma background thread deve manter a JVM viva até terminar, ou deve ser abandonada
  automaticamente assim que toda outra thread tiver terminado.
- Registrar limpeza (flush de buffers, fechamento de arquivos) que precisa rodar quando a JVM
  encerra normalmente, inclusive com Ctrl-C.

## Deep Dive

### `shutdown()` vs `shutdownNow()`, e esperar por qualquer um dos dois terminar

`shutdown()` é o modo gracioso: o executor para de aceitar novas tasks, mas
tudo que já está enfileirado ou rodando tem permissão para terminar.

```java
ExecutorService pool = Executors.newFixedThreadPool(4);
pool.execute(task1);
pool.execute(task2);

pool.shutdown(); // no new tasks accepted; task1/task2 run to completion
pool.execute(task3); // rejected — throws RejectedExecutionException
```

`shutdownNow()` é o modo agressivo: também para de aceitar novas tasks, mas
além disso interrompe toda task atualmente rodando (usando o mesmo
mecanismo de interrupção coberto no conceito complementar sobre
[cancelamento de tasks e interrupção](task-cancellation-and-interruption.md) —
se uma task realmente para depende de se o código dela checa
`isInterrupted()` ou chama um método bloqueante interrompível) e retorna a
`List<Runnable>` de tasks que foram submetidas mas nunca chegaram a começar, para que
quem chamou possa logá-las ou resubmetê-las depois:

```java
List<Runnable> neverStarted = pool.shutdownNow();
// neverStarted contains queued tasks that hadn't begun running yet;
// tasks already in progress get interrupt()ed, not force-killed
```

Nenhuma das duas chamadas bloqueia até o pool realmente terminar — `shutdown()` e
`shutdownNow()` retornam imediatamente. `awaitTermination(long, TimeUnit)` é a
chamada separada que bloqueia até o pool ter terminado de encerrar ou o timeout
expirar (ela retorna `true`/`false` de acordo). Combinar as duas em
"encerre graciosamente, mas desista e force depois de um prazo" é um idioma
padrão:

```java
pool.shutdown(); // 1. stop accepting new work, let existing work finish
try {
    if (!pool.awaitTermination(60, TimeUnit.SECONDS)) {
        pool.shutdownNow(); // 2. timeout elapsed — force it
        if (!pool.awaitTermination(60, TimeUnit.SECONDS)) {
            System.err.println("Pool did not terminate");
        }
    }
} catch (InterruptedException e) {
    pool.shutdownNow(); // this thread was interrupted while waiting — force it too
    Thread.currentThread().interrupt();
}
```

`ExecutorService` estende `AutoCloseable` desde o Java 19, através de um método `close()`
default que é um atalho para aproximadamente esse idioma: ele chama `shutdown()`, depois
espera (por padrão indefinidamente, em pequenas esperas repetidas) pelo término, chamando
`shutdownNow()` se a thread chamadora for interrompida enquanto espera. Isso torna um
executor usável diretamente em try-with-resources para o caso comum:

```java
try (ExecutorService pool = Executors.newFixedThreadPool(4)) {
    pool.execute(task1);
    pool.execute(task2);
} // close() runs automatically: shutdown() + wait for termination
```

`close()` é uma conveniência para o caso comum, não um substituto para o
idioma explícito acima — recorra a `shutdown()` + `awaitTermination()` (com um
fallback de `shutdownNow()`) sempre que precisar de um timeout específico, precisar inspecionar
a lista de tasks que nunca começaram, ou precisar reagir de forma diferente a um timeout
do que "continuar esperando."

### Poison pills: um sinal cooperativo de encerramento através da fila de trabalho

O `shutdown()` de um thread pool funciona porque o executor é dono da fila e das
worker threads. Um design produtor-consumidor feito à mão sobre uma `BlockingQueue`
simples não tem um método de ciclo de vida embutido assim — a thread consumidora simplesmente
faz loop em `queue.take()` para sempre. Uma **poison pill** resolve isso sem um canal de
cancelamento separado: é um valor sentinela designado que significa "pare" quando o
consumidor o retira da fila, enviado através da *mesma* fila usada para itens de trabalho reais.

```java
private static final Task POISON_PILL = new Task(); // recognizable sentinel

// consumer
while (true) {
    Task task = queue.take();
    if (task == POISON_PILL) {
        break; // no more work is coming — exit the loop
    }
    process(task);
}

// producer, when done submitting real work
queue.put(POISON_PILL);
```

Como a fila é FIFO, quaisquer itens de trabalho reais enfileirados antes da pílula têm
garantia de serem retirados (e processados) antes da pílula chegar — o produtor
só precisa parar de submeter trabalho real assim que submeter a pílula. Isso só funciona
de forma limpa quando o número de produtores e consumidores é conhecido de antemão: com
múltiplos consumidores, uma pílula só diz a um único consumidor para parar, então o
produtor precisa enfileirar uma pílula por consumidor; com múltiplos produtores, cada um
precisaria concordar sobre quando submeter sua própria pílula para que a fila não acabe
com trabalho ativo misturado depois que a primeira chegar. Também depende de a fila
ser efetivamente ilimitada do ponto de vista do produtor — um produtor
bloqueado em uma fila limitada cheia não consegue colocar sua pílula.

### Handlers de exceção não capturada: percebendo uma thread que morreu silenciosamente

Quando o `run()` de uma thread lança uma exceção que ninguém dentro dela capturou, a thread
simplesmente termina. Por padrão, nada nisso é ruidoso: o tratamento embutido da JVM
imprime um stack trace em `System.err` e a thread se vai — nenhuma
exceção é lançada para nenhuma outra thread, nenhuma flag é setada em lugar algum que o
resto do programa possa ver. Para uma thread de vida curta isso costuma ser tranquilo; para
um worker de longa duração ou um poller em background, significa que a thread pode
desaparecer e ninguém percebe até que o trabalho que ela deveria estar fazendo pare de acontecer.

```java
Thread worker = new Thread(() -> {
    throw new RuntimeException("boom");
});
worker.start();
// stack trace goes to stderr; the rest of the application keeps running,
// unaware the thread is gone, unless something below is registered
```

`Thread.setUncaughtExceptionHandler` registra um handler em uma thread;
`Thread.setDefaultUncaughtExceptionHandler` registra um fallback usado por qualquer
thread que não tenha o seu próprio. Registrar um transforma a morte silenciosa em
um evento logado:

```java
Thread worker = new Thread(() -> {
    throw new RuntimeException("boom");
});
worker.setUncaughtExceptionHandler((t, e) ->
    logger.log(Level.SEVERE, "Thread " + t.getName() + " died", e));
worker.start();
```

Para threads de pool, defina o handler através de uma `ThreadFactory` customizada passada ao
construtor do `ThreadPoolExecutor`, já que você não tem uma referência direta a cada
worker thread que o pool cria. Note a assimetria entre os estilos de submissão:
uma task submetida com `execute()` chega ao handler de exceção não capturada se
lançar uma exceção; uma task submetida com `submit()` não chega — sua exceção é capturada
no `Future` retornado e só surge quando algo chama `get()`, então
um `Future` não verificado cuja task lançou uma exceção falha tão silenciosamente quanto uma
thread não tratada, mas por um mecanismo diferente.

### Shutdown hooks da JVM e daemon threads

O encerramento *ordenado* da JVM — disparado quando a última thread não-daemon termina,
alguém chama `System.exit()`, ou um sinal externo como Ctrl-C chega — primeiro
executa todo shutdown hook registrado. Um shutdown hook é uma `Thread` comum,
registrada mas não iniciada, passada para `Runtime.getRuntime().addShutdownHook()`;
a JVM a inicia (concorrentemente com quaisquer outros hooks, em ordem não especificada) como
parte do encerramento:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    logger.info("Flushing and closing resources before exit");
    resource.close();
}));
```

Hooks são úteis para limpeza de última chance — fazer flush de logs, liberar recursos
nativos que o SO não vai recuperar sozinho — mas cada hook que a JVM precisa executar
atrasa a saída do processo inteiro, então eles devem fazer seu trabalho rapidamente e não
depender de outros serviços que já podem estar sendo encerrados concorrentemente. Um
encerramento *abrupto* (`Runtime.halt()`, ou o SO matando o processo) pula os
hooks completamente.

Separadamente dos hooks, toda thread é ou uma thread **daemon** ou uma thread comum
("user"), controlada por `Thread.setDaemon(true)` antes da thread iniciar.
A distinção só importa para uma coisa: se a JVM espera por aquela thread
antes de sair. Uma user thread mantém a JVM viva — o processo não sai enquanto
mesmo uma thread não-daemon ainda estiver rodando. Uma daemon thread não faz isso: assim que
todas as threads restantes forem daemon, a JVM inicia seu encerramento ordenado
independentemente do que aquelas daemon threads ainda estejam fazendo, e quando a JVM efetivamente
para, quaisquer daemon threads ainda rodando são simplesmente abandonadas — nenhum bloco `finally`
roda, nenhuma stack é desenrolada, a thread simplesmente deixa de existir.

```java
Thread daemon = new Thread(() -> {
    while (true) {
        cleanupExpiredCacheEntries();
        sleepQuietly(60_000);
    }
});
daemon.setDaemon(true); // must be called before start()
daemon.start();
// the JVM can exit while this loop is still running mid-iteration —
// no cleanup code here is guaranteed to run before that happens

Thread user = new Thread(() -> writeImportantFile());
user.start();
// the JVM will NOT exit until this thread finishes on its own
```

Isso torna daemon threads apropriadas para tarefas de manutenção em background cuja perda no
encerramento é inofensiva (um limpador de cache em memória, um logger periódico de estatísticas), e
inapropriadas para qualquer coisa que precise rodar até o fim ou limpar de forma confiável —
esse trabalho pertence a uma user thread, ou atrás de um método de shutdown explícito que
a aplicação chama e espera.

## Trade-offs

- **`shutdown()` é mais seguro mas em aberto; `shutdownNow()` é limitado no tempo mas mais arriscado**
  — o encerramento gracioso nunca corrompe uma task interrompendo-a no meio do trabalho, mas
  não dá nenhum limite de quanto tempo esvaziar a fila leva; o encerramento agressivo
  retorna rapidamente mas qualquer task que não trate a interrupção de forma limpa pode deixar
  trabalho pela metade.
- **Esquecer `awaitTermination()` transforma o encerramento em um no-op do ponto de vista
  de quem chamou** — `shutdown()` retorna imediatamente, então código que encerra e
  logo em seguida prossegue (fecha um recurso que as tasks do pool ainda precisam, sai de
  `main`) entra em race com as tasks ainda em execução.
  ```java
  pool.shutdown();
  resource.close(); // may run while pool tasks are still using resource —
                     // shutdown() alone gave no guarantee they'd finished
  ```
- **Poison pills precisam de um número conhecido e fixo de produtores e consumidores** — o
  esquema degrada rapidamente com um conjunto dinâmico de qualquer um dos dois: um número
  variável de produtores precisa coordenar quem envia a pílula final, e múltiplos
  consumidores precisam cada um da sua própria pílula, ou um pode sair enquanto outros ainda
  estão esperando por trabalho que nunca vai chegar.
- **Uma exceção não tratada em uma task submetida com `submit()` falha tão silenciosamente
  quanto uma exceção não tratada em uma thread comum** — registrar um handler de exceção
  não capturada não faz nada nesse caso, porque `submit()` nunca deixa a
  exceção chegar ao handler; só chamar `Future.get()` (e capturar
  `ExecutionException`) a traz à tona.
  ```java
  Future<?> f = pool.submit(() -> { throw new RuntimeException("boom"); });
  // no handler fires, nothing is logged automatically —
  // the exception is sitting inside f until something calls f.get()
  ```
- **O código de limpeza de uma daemon thread não tem garantia de rodar** — código que
  depende de um bloco `finally` ou de uma flag de shutdown dentro de uma daemon thread para
  liberar um recurso pode simplesmente nunca ter a chance, se a JVM decidir sair
  enquanto aquela thread está no meio de um loop.

## Documentation Links

- [ExecutorService — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html) — doc
- [ExecutorService.shutdown() — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html#shutdown()) — doc
- [ExecutorService.shutdownNow() — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html#shutdownNow()) — doc
- [ExecutorService.awaitTermination(long, TimeUnit) — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html#awaitTermination(long,java.util.concurrent.TimeUnit)) — doc
- [ExecutorService.close() — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html#close()) — doc
- [BlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html) — doc
- [Thread.setUncaughtExceptionHandler — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#setUncaughtExceptionHandler(java.lang.Thread.UncaughtExceptionHandler)) — doc
- [Thread.setDefaultUncaughtExceptionHandler — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#setDefaultUncaughtExceptionHandler(java.lang.Thread.UncaughtExceptionHandler)) — doc
- [Thread.UncaughtExceptionHandler — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.UncaughtExceptionHandler.html) — doc
- [Runtime.addShutdownHook(Thread) — java.lang.Runtime API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Runtime.html#addShutdownHook(java.lang.Thread)) — doc
- [Thread.setDaemon(boolean) — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#setDaemon(boolean)) — doc
- [Thread.isDaemon() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#isDaemon()) — doc
