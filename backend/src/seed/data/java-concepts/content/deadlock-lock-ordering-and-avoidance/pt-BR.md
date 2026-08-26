---
version: 1.0
updatedAt: 2026-08-13
title: "Deadlock: Ordem de Locks, Open Calls e Como Evitá-lo"
summary: Como deadlocks de ordem de lock acontecem entre threads, e como uma ordem consistente de locks, open calls e tentativas de lock com timeout previnem e diagnosticam esse problema.
---

## Objective

Deadlock acontece quando duas ou mais threads seguram, cada uma, um lock de que a outra precisa, e nenhuma libera o que segura até conseguir o que está esperando — um ciclo no grafo "está esperando por um lock segurado por". A JVM não detecta nem se recupera de deadlock como um banco de dados faz com transações: uma vez que um conjunto de threads entra em deadlock, essas threads estão perdidas para sempre, e o único conserto é reiniciar o processo. A causa mais comum é o deadlock de ordem de lock — duas threads adquirindo os mesmos dois locks em ordem oposta — e a prevenção confiável é uma ordem de aquisição de locks consistente e global, combinada com manter as regiões travadas pequenas o suficiente para nunca chamarem código que você não controla.

## Use Cases

- Qualquer método que precise segurar dois locks ao mesmo tempo para manter uma operação atômica — o exemplo clássico é transferir fundos entre duas contas, onde ambos os saldos precisam ser atualizados juntos.
- Sistemas com pools de recursos (pools de conexão com banco de dados, caches guardados por semáforo) onde uma tarefa pode precisar de uma permissão de mais de um pool ao mesmo tempo.
- Objetos cooperantes que se chamam de volta um ao outro enquanto sincronizados — por exemplo, um dispatcher que notifica um worker, e o worker que reporta de volta ao dispatcher.
- Diagnosticar um servidor de produção travado: ler um thread dump para descobrir quais threads estão em deadlock e em quais locks.

## Deep Dive

### 1. O deadlock canônico de ordem de lock

Duas threads adquirindo os mesmos dois locks em ordem oposta é o caso clássico dos livros-texto. Considere uma transferência de fundos ingênua entre dois objetos `Account`:

```java
// Warning: deadlock-prone
public void transferMoney(Account fromAccount, Account toAccount, BigDecimal amount)
        throws InsufficientFundsException {
    synchronized (fromAccount) {
        synchronized (toAccount) {
            if (fromAccount.getBalance().compareTo(amount) < 0) {
                throw new InsufficientFundsException();
            }
            fromAccount.debit(amount);
            toAccount.credit(amount);
        }
    }
}
```

Isso parece seguro isoladamente — ambos os locks são sempre adquiridos antes de tocar qualquer um dos saldos. Mas a *ordem* em que os locks são tomados depende de qual conta é passada como `fromAccount` e qual como `toAccount`, e isso depende de argumentos em tempo de execução, não de nada visível ao ler um único call site. Se a thread A executa `transferMoney(alice, bob, amt)` enquanto a thread B executa concorrentemente `transferMoney(bob, alice, amt)`, o intercalamento

```
Thread A: synchronized (alice)          // A holds alice's lock
Thread B: synchronized (bob)            // B holds bob's lock
Thread A: synchronized (bob)   -> BLOCKS, waiting on B
Thread B: synchronized (alice) -> BLOCKS, waiting on A
```

deixa as duas threads esperando para sempre: A segura `alice` e quer `bob`; B segura `bob` e quer `alice`. Nenhuma das duas jamais liberará o que segura, porque a liberação só acontece depois que o bloco `synchronized` aninhado é concluído. Este é um deadlock de ordem de lock *dinâmico* — o bug não é visível olhando só para `transferMoney`, porque os dois call sites (`transferMoney(alice, bob, ...)` e `transferMoney(bob, alice, ...)`) são cada um, individualmente, "razoáveis"; eles só são incompatíveis entre si.

### 2. O conserto: uma ordem de locks global e consistente

Se toda thread que precisa dos mesmos dois locks sempre os adquire na mesma ordem, a espera cíclica não pode se formar. Como a ordem dos argumentos passados para `transferMoney` está fora do nosso controle, induzimos uma ordenação sobre os dois objetos `Account` usando uma chave estável e comparável — `System.identityHashCode` funciona quando as contas não têm uma chave natural:

```java
private static final Object tieLock = new Object();

public void transferMoney(Account fromAcct, Account toAcct, BigDecimal amount)
        throws InsufficientFundsException {
    int fromHash = System.identityHashCode(fromAcct);
    int toHash = System.identityHashCode(toAcct);

    if (fromHash < toHash) {
        synchronized (fromAcct) {
            synchronized (toAcct) {
                doTransfer(fromAcct, toAcct, amount);
            }
        }
    } else if (fromHash > toHash) {
        synchronized (toAcct) {
            synchronized (fromAcct) {
                doTransfer(fromAcct, toAcct, amount);
            }
        }
    } else {
        // Vanishingly rare identityHashCode collision: fall back to a
        // tie-breaking lock so only one thread at a time risks an
        // arbitrary acquisition order.
        synchronized (tieLock) {
            synchronized (fromAcct) {
                synchronized (toAcct) {
                    doTransfer(fromAcct, toAcct, amount);
                }
            }
        }
    }
}
```

Agora toda thread, independentemente de qual conta ela chama de "from" e qual de "to", trava primeiro a conta de hash de identidade menor. Tanto `transferMoney(alice, bob, ...)` quanto `transferMoney(bob, alice, ...)` convergem para a mesma ordem de aquisição, então o ciclo do Deep Dive 1 nunca pode ocorrer. Se `Account` tivesse uma chave natural única, imutável e comparável (um número de conta), ordenar por essa chave é mais simples e dispensa completamente o lock de desempate, já que duas contas distintas nunca podem colidir nela.

O mesmo princípio se aplica a deadlocks *estáticos* como o `LeftRightDeadlock`, onde um método faz `synchronized(left) { synchronized(right) {...} }` e outro faz `synchronized(right) { synchronized(left) {...} }` — o conserto é idêntico: escolha uma ordem global para `left`/`right` e nunca desvie dela. Isso também se estende a deadlocks entre objetos cooperantes: se um `Taxi` e seu `Dispatcher` seguram cada um seu próprio lock enquanto se chamam mutuamente, uma thread pode acabar segurando o lock de `Taxi` esperando pelo lock de `Dispatcher`, enquanto outra segura o lock de `Dispatcher` esperando pelo de `Taxi` — a mesma forma de espera cíclica, só que espalhada entre duas classes em vez de um único método.

### 3. Open calls — não chame código alheio enquanto segura um lock

O deadlock `Taxi`/`Dispatcher` acima tem uma causa raiz distinta de "ordem errada": cada classe chama um método no *outro* objeto enquanto segura seu próprio lock.

```java
// Warning: deadlock-prone — calls dispatcher while holding the Taxi lock
class Taxi {
    private final Dispatcher dispatcher;
    private Point location, destination;

    public synchronized void setLocation(Point location) {
        this.location = location;
        if (location.equals(destination)) {
            dispatcher.notifyAvailable(this); // alien call, lock still held
        }
    }
}

class Dispatcher {
    private final Set<Taxi> taxis = new HashSet<>();

    public synchronized void notifyAvailable(Taxi taxi) { /* ... */ }

    public synchronized Image getImage() {
        Image image = new Image();
        for (Taxi t : taxis) {
            image.drawMarker(t.getLocation()); // alien call, lock still held
        }
        return image;
    }
}
```

Uma chamada feita sem segurar nenhum lock é uma *open call*. Chamar um método desconhecido ou sobrescrevível ("alheio") enquanto se segura um lock é arriscado justamente porque uma chamada de método deveria ser uma barreira de abstração — você não sabe, e não deveria precisar saber, o que acontece do outro lado. Esse método pode tentar adquirir um lock próprio (incluindo, transitivamente, o próprio lock que você já está segurando — deadlock instantâneo), ou pode simplesmente rodar por muito mais tempo do que o esperado, bloqueando toda outra thread que precise do seu lock nesse meio tempo.

O conserto é encolher a região sincronizada de modo que a chamada ao outro objeto aconteça depois que o lock é liberado:

```java
class Taxi {
    private final Dispatcher dispatcher;
    private Point location, destination;

    public void setLocation(Point location) {
        boolean reachedDestination;
        synchronized (this) {
            this.location = location;
            reachedDestination = location.equals(destination);
        }
        if (reachedDestination) {
            dispatcher.notifyAvailable(this); // open call, no lock held
        }
    }
}

class Dispatcher {
    private final Set<Taxi> taxis = new HashSet<>();

    public synchronized void notifyAvailable(Taxi taxi) { /* ... */ }

    public Image getImage() {
        Set<Taxi> copy;
        synchronized (this) {
            copy = new HashSet<>(taxis);
        }
        Image image = new Image();
        for (Taxi t : copy) {
            image.drawMarker(t.getLocation()); // open call, no lock held
        }
        return image;
    }
}
```

Isso troca uma pequena quantidade de atomicidade (`getImage` agora lê a localização de cada táxi em um instante ligeiramente diferente, em vez de um snapshot único e consistente) por um programa cuja ausência de deadlock é muito mais fácil de justificar: sem chamadas a código externo feitas enquanto se segura um lock, encontrar todo lugar onde múltiplos locks poderiam ser segurados simultaneamente vira um conjunto pequeno e enumerável, em vez de um mistério espalhado pelo programa inteiro. Como regra geral, mantenha blocos `synchronized` pequenos e limitados a tocar seu próprio estado guardado — nunca uma chamada a código que você não controla.

### 4. Detectando e mitigando deadlocks: `tryLock` e thread dumps

`synchronized` trava incondicionalmente — uma thread que não consegue o lock espera para sempre. `java.util.concurrent.locks.Lock` oferece uma saída: uma tentativa de aquisição com timeout.

```java
Lock lock1 = new ReentrantLock();
Lock lock2 = new ReentrantLock();

boolean transferWithTimeout() throws InterruptedException {
    while (true) {
        if (lock1.tryLock(500, TimeUnit.MILLISECONDS)) {
            try {
                if (lock2.tryLock(500, TimeUnit.MILLISECONDS)) {
                    try {
                        // do the transfer
                        return true;
                    } finally {
                        lock2.unlock();
                    }
                }
            } finally {
                lock1.unlock();
            }
        }
        // failed to get both locks within the timeout: back off and retry
        Thread.sleep(ThreadLocalRandom.current().nextInt(100));
    }
}
```

Se uma tentativa de lock expira, você não necessariamente sabe por quê — pode ser um deadlock, um loop infinito que está segurando o lock, ou apenas um vizinho incomumente lento — mas você recupera o controle em vez de bloquear para sempre, e pode logar, recuar com alguma aleatoriedade e tentar de novo.

Quando um deadlock já aconteceu, um thread dump é o diagnóstico padrão. Em um JDK atual, a forma recomendada de tirar um é `jcmd <pid> Thread.print` (adicione `-l` para incluir a posse de locks de `java.util.concurrent`). A ferramenta standalone mais antiga `jstack <pid>` ainda funciona e aceita a mesma flag `-l`, mas a documentação atual do JDK a marca como experimental e sem suporte, então `jcmd Thread.print` é a ferramenta a se buscar primeiro; enviar `SIGQUIT` (`kill -3` no Unix) para o processo da JVM também dispara a mesma rotina interna de thread dump da VM. Antes de imprimir, a JVM busca no seu grafo interno de "está esperando por" ciclos de lock; se encontra um, o dump inclui uma seção `Found one Java-level deadlock` nomeando exatamente quais threads e quais locks estão envolvidos.

Programaticamente, `java.lang.management.ThreadMXBean` expõe a mesma busca de ciclos em tempo de execução: `findMonitorDeadlockedThreads()` detecta ciclos entre monitores de objeto no estilo `synchronized`, enquanto `findDeadlockedThreads()` (desde o Java 6) cobre adicionalmente sincronizadores baseados em `Lock` que possuem dono, como `ReentrantLock`, tornando-o o mais completo dos dois para código que mistura locking intrínseco e explícito. Ambos retornam `null` quando nenhum deadlock é encontrado, e um array de IDs de threads em deadlock caso contrário, e nenhum dos dois detecta ciclos envolvendo virtual threads.

```java
ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();
long[] deadlocked = threadBean.findDeadlockedThreads();
if (deadlocked != null) {
    for (ThreadInfo info : threadBean.getThreadInfo(deadlocked, true, true)) {
        System.out.println(info);
    }
}
```

## Trade-offs

- **Ordenação global de locks exige disciplina no programa inteiro** — detectar um bug de ordem de lock significa auditar todo lugar onde mais de um lock é segurado junto, não só o método que você está editando no momento; um único call site que adquire os mesmos dois locks na ordem "errada" em qualquer parte do código reintroduz o risco.
- **Open calls trocam atomicidade por capacidade de análise** — encolher um bloco sincronizado para que uma chamada aconteça depois do `unlock()` pode transformar uma operação atômica em duas, então verifique se os chamadores realmente dependem da visão antiga de tudo-ou-nada do estado.
- **`tryLock` adiciona complexidade de retry por uma garantia probabilística** — ele converte um deadlock incondicional em um timeout recuperável, mas você precisa decidir o que "falhou em adquirir a tempo" significa para sua operação e implementar o backoff você mesmo; ele não previne deadlock tanto quanto permite que você escape dele.
  ```java
  if (!lock.tryLock(500, TimeUnit.MILLISECONDS)) {
      // caller must decide: retry, fail the request, or escalate
  }
  ```
- **Livelock não é deadlock** — uma thread em livelock nunca está bloqueada, está ativamente rodando e repetidamente tentando de novo uma operação que continua falhando (por exemplo, duas threads recuando uma para a outra em lockstep), então nada em um thread dump vai mostrar threads presas esperando por um lock; o conserto usual é adicionar aleatoriedade ao delay de retry para que as duas tentativas parem de colidir em lockstep.

## Documentation Links

- [ReentrantLock — tryLock(long, TimeUnit)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html) - doc
- [Lock interface](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Lock.html) - doc
- [ThreadMXBean — findDeadlockedThreads / findMonitorDeadlockedThreads](https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html) - doc
- [jcmd command reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html) - doc
- [jstack command reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jstack.html) - doc
