---
version: 1.0
updatedAt: 2026-08-13
title: "Task Cancellation: Interrupção Feita Corretamente"
summary: "Como Thread.interrupt() funciona de fato como uma flag de status cooperativa, por que engolir InterruptedException é o bug de concorrência mais comum, e como cancelar tasks corretamente via política de interrupção e Future.cancel()."
---
## Objective

`Thread.interrupt()` não interrompe nada. Ele apenas vira um boolean por thread — o interrupt status — e nada mais; se essa flag chega a mudar o comportamento da thread alvo depende inteiramente de o código dessa thread se dar ao trabalho de checá-la, seja explicitamente via `Thread.isInterrupted()`, seja implicitamente por estar bloqueada dentro de um método que já a checa por você (`Thread.sleep()`, `Object.wait()`, `BlockingQueue.take()/put()`, e a maioria das outras chamadas bloqueantes de `java.util.concurrent`, que respondem limpando a flag e lançando `InterruptedException`). Escrever código cancelável corretamente significa tratar essa flag da forma certa: checá-la em pontos seguros e — de forma crítica — nunca capturar `InterruptedException` e descartá-la, já que fazer isso torna a thread silenciosamente não interruptível pelo resto de sua vida.

## Use Cases

- Escrever um loop de longa duração (uma worker thread, um poller em background, um job em lote) que precisa parar prontamente quando solicitado, sem corromper o que estava em andamento.
- Revisar um bloco `catch (InterruptedException e) { }` durante um code review — reconhecendo-o como um bug, não uma questão de estilo.
- Decidir se o código que você está escrevendo pode chamar `interrupt()` em uma thread, ou se precisa em vez disso cancelar através do dono dessa thread (tipicamente um `Future` vindo de um `ExecutorService`).
- Combinar um timeout com cancelamento: dar a uma task um prazo e cancelá-la se ela ultrapassar esse prazo.

## Deep Dive

### 1. Uma flag de status, não um sinal de parada

`interrupt()` define um boolean na `Thread` alvo. Esse é o mecanismo inteiro. O que acontece depois depende de onde essa thread está:

```java
Thread worker = new Thread(() -> System.out.println("running"));
worker.start();
worker.interrupt(); // sets the flag; does not pause, kill, or redirect anything
```

Se a thread alvo está fazendo trabalho comum, ligado à CPU, nada acontece até que o próprio código da thread decida olhar para a flag. Um loop corretamente ciente de interrupção a checa entre unidades de trabalho, em um ponto onde parar é seguro:

```java
class Worker implements Runnable {
    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            doUnitOfWork(); // one safe, self-contained chunk of work
        }
        // loop exits on its own terms — never mid-update
    }
}
```

Se a thread alvo está, em vez disso, bloqueada dentro de um método *interruptível* — `Thread.sleep()`, `Object.wait()`, `Thread.join()`, ou uma chamada bloqueante como `BlockingQueue.take()`/`put()` — a JVM percebe a interrupção por você: ela limpa a flag e lança `InterruptedException` ali mesmo, acordando a thread imediatamente em vez de fazê-la esperar até a próxima sondagem explícita:

```java
class Consumer implements Runnable {
    private final BlockingQueue<String> queue;

    Consumer(BlockingQueue<String> queue) {
        this.queue = queue;
    }

    @Override
    public void run() {
        try {
            while (!Thread.currentThread().isInterrupted()) {
                String item = queue.take(); // blocks — and IS interruptible
                process(item);
            }
        } catch (InterruptedException e) {
            // take() already cleared the interrupt status when it threw it;
            // see section 2 for what to do here instead of nothing.
            Thread.currentThread().interrupt();
        }
    }
}
```

Note a checagem explícita de `isInterrupted()` mesmo com `take()` já sendo interruptível: se a flag foi definida *antes* de a thread chegar a chamar `take()` de novo, a checagem a captura imediatamente, em vez de iniciar outra espera bloqueante primeiro.

### 2. O bug de InterruptedException engolida

O erro mais comum nessa área é capturar `InterruptedException` e não fazer nada com ela:

```java
// WRONG — do not do this
public void run() {
    try {
        while (!Thread.currentThread().isInterrupted()) {
            queue.put(nextItem());
        }
    } catch (InterruptedException e) {
        // swallowed: nothing here restores the flag or tells anyone
    }
}
```

Lembre-se: um método bloqueante limpa o interrupt status no exato momento em que lança `InterruptedException` para sinalizá-lo. Se o bloco catch não faz nada, essa limpeza é permanente — todo e qualquer traço de que essa thread já foi solicitada a parar desaparece. Qualquer código mais acima na call stack que depois checar `isInterrupted()` verá `false`, como se o cancelamento nunca tivesse sido solicitado. A thread agora é efetivamente não interruptível pelo resto de sua vida, mesmo que o contrato da API prometesse que ela poderia ser interrompida.

Existem exatamente duas respostas corretas. A melhor, quando a assinatura do seu método permite, é propagar a exceção e deixar o chamador lidar com ela:

```java
// RIGHT — propagate
public String getNextTask(BlockingQueue<String> queue) throws InterruptedException {
    return queue.take(); // let InterruptedException bubble up unmodified
}
```

Quando você não pode propagar — mais comumente porque está dentro de `Runnable.run()`, que não tem uma cláusula `throws` para adicionar `InterruptedException` — restaure o status em vez de descartá-lo, chamando `Thread.currentThread().interrupt()` antes de retornar:

```java
// RIGHT — restore, when propagation isn't possible
public void run() {
    try {
        while (!Thread.currentThread().isInterrupted()) {
            queue.put(nextItem());
        }
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt(); // put the flag back before returning
    }
}
```

Isso devolve a flag ao lugar, de forma que qualquer código que checar `isInterrupted()` em seguida — o thread pool dono dessa thread, um chamador mais acima na pilha, outra iteração de loop — ainda descubra que um pedido de cancelamento aconteceu, mesmo que este método específico já tenha feito sua própria limpeza local.

### 3. Política de interrupção: você não é dono da thread

Uma política de interrupção é a resposta para "o que essa thread faz quando é interrompida?" — geralmente "parar assim que for prático, limpar, sair". A regra importante é *quem* define essa política: quem é dono da thread, não quem por acaso está rodando nela. Código submetido a um thread pool é um convidado numa thread que não possui; o `ExecutorService` é o dono, e ele já se comprometeu a tratar interrupção como "cancelar a task atual". Inventar um segundo mecanismo de cancelamento privado em cima dessa thread emprestada cria dois sinais competindo em vez de um só:

```java
// Avoid on a pooled task — this is a private cancellation channel
// competing with the pool's own interruption-based one.
class MyTask implements Runnable {
    private volatile boolean stop;

    void requestStop() {
        stop = true;
    }

    @Override
    public void run() {
        while (!stop) {
            doWork();
        }
    }
}
```

```java
// Prefer this on a pooled task: rely on the interruption
// mechanism the ExecutorService already implements.
class MyTask implements Runnable {
    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            doWork();
        }
    }
}

ExecutorService pool = Executors.newFixedThreadPool(4);
Future<?> handle = pool.submit(new MyTask());
handle.cancel(true); // the pool's interruption policy takes it from here
```

O outro lado da mesma regra: também não chame `interrupt()` diretamente em uma thread que você não possui — você não sabe qual task está rodando nela no momento nem qual é a política de interrupção dessa task. Cancele através da abstração que o dono lhe deu (um `Future`, um método `cancel()`/`shutdown()`), não invadindo a thread diretamente.

### 4. `Future.cancel(boolean mayInterruptIfRunning)`

Para uma task submetida a um `ExecutorService`, `Future.cancel(boolean)` é a API de cancelamento padrão, de nível mais alto — é o que a seção 3 já estava chamando com `handle.cancel(true)`. Quando `mayInterruptIfRunning` é `true` e a task está rodando no momento, o executor chama `interrupt()` na thread que a executa internamente; quando `false`, a task só é impedida de começar se ainda não tiver começado. Combinado com um timeout, isso dá a você "rode isso, mas desista e cancele se demorar demais":

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
Future<String> future = executor.submit(this::slowComputation);

try {
    String result = future.get(2, TimeUnit.SECONDS);
    System.out.println(result);
} catch (TimeoutException e) {
    future.cancel(true); // interrupt the task if it's still running
} catch (ExecutionException e) {
    throw new RuntimeException(e.getCause());
} finally {
    executor.close();
}
```

Chamar `cancel(true)` é inofensivo mesmo que a task já tenha terminado — cancelar uma task já concluída simplesmente não tem efeito nenhum — motivo pelo qual é seguro chamá-lo incondicionalmente em um bloco `finally` sempre que o resultado deixou de importar, seja porque `get()` deu timeout, lançou exceção, ou você simplesmente parou de se importar com a resposta.

## Trade-offs

- **Interrupção é consultiva, não preemptiva** — uma thread que nunca checa `isInterrupted()` e nunca chama um método bloqueante interruptível simplesmente nunca percebe que foi interrompida; não há como forçá-la a parar de fora.
```java
Thread t = new Thread(() -> {
    long x = 0;
    while (true) { x++; } // no isInterrupted() check, no blocking call
});
t.start();
t.interrupt(); // flag is set; the loop above never looks at it
```
- **Restaurar vs. propagar é uma decisão real de design, não boilerplate** — propagar empurra `InterruptedException` (e a cláusula `throws`) para todo chamador acima na cadeia; restaurar mantém a assinatura do seu método limpa, mas significa que a flag fica sem checagem até que algum código que a sonda mais adiante finalmente o faça.
- **Algumas chamadas bloqueantes simplesmente não respondem a interrupção** — I/O síncrono clássico de socket (`InputStream.read()`/`OutputStream.write()` em um `Socket` comum) ignora `interrupt()` completamente; a solução costumeira é fechar o socket subjacente para que a chamada bloqueada falhe com uma exceção em vez disso, e não há uma correção geral limpa além dessa.
```java
Socket socket = new Socket(host, port);
Thread reader = new Thread(() -> {
    try {
        socket.getInputStream().read(); // blocks; interrupt() has no effect here
    } catch (IOException e) {
        // thrown once the socket is closed from outside
    }
});
reader.start();
reader.interrupt(); // does nothing to unblock read()
socket.close();     // this is what actually unblocks it
```
- **`cancel(true)` só garante entrega, não conformidade** — ele diz a você que a interrupção foi entregue com sucesso à thread em execução, não que a task percebeu e de fato parou; uma task que ignora seu próprio interrupt status continua rodando não importa quantas vezes `cancel()` seja chamado.

## Documentation Links

- [Thread.interrupt() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#interrupt()) — doc
- [Thread.isInterrupted() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#isInterrupted()) — doc
- [Thread.interrupted() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#interrupted()) — doc
- [InterruptedException — java.lang API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InterruptedException.html) — doc
- [Future.cancel(boolean) — java.util.concurrent.Future API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html#cancel(boolean)) — doc
