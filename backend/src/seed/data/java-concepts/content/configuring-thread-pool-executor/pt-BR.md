---
version: 1.0
updatedAt: 2026-08-14
title: Configurando e Dimensionando Thread Pools
summary: "Cobre a fórmula do JCIP para calcular um tamanho ótimo de thread pool e a API do ThreadPoolExecutor para filas de trabalho, políticas de saturação, thread factories e hooks de extensão."
---
## Objective

Ir além de "quantas threads" e entrar na superfície real de configuração do
`ThreadPoolExecutor`: a fórmula de dimensionamento precisa do livro *Java
Concurrency in Practice* de Brian Goetz et al. (Capítulo 7, "Applying Thread
Pools"), e os parâmetros de construtor e hooks usados para transformar um
tamanho escolhido num pool funcional e bem comportado — escolha de fila de
trabalho, políticas de saturação para o que acontece quando essa fila enche,
thread factories customizadas, e os hooks de extensão
`beforeExecute`/`afterExecute`/`terminated`. A entrada `thread-pool-sizing` de
`jvm-concepts` já cobre a intuição de dimensionamento CPU-bound vs. I/O-bound
qualitativamente (com seus próprios números de benchmark) — esse enquadramento
não é repetido aqui.

## Use Cases

- Calcular um tamanho de pool alvo a partir de uma razão medida ou perfilada
  entre tempo de espera e tempo de computação, em vez de chutar.
- Decidir entre uma fila ilimitada, uma fila limitada, ou um handoff síncrono
  ao configurar um `ThreadPoolExecutor` para um servidor sob carga.
- Escolher o que deve acontecer quando uma fila de trabalho limitada enche —
  lançar exceção, descartar, descartar-o-mais-antigo, ou empurrar o trabalho de
  volta para quem chamou.
- Nomear threads do pool, definir um `UncaughtExceptionHandler`, ou
  customizar a criação de threads com um `ThreadFactory` para que thread dumps
  e logs de erro fiquem legíveis.
- Estender `ThreadPoolExecutor` com `beforeExecute`/`afterExecute`/`terminated`
  para adicionar logging, medição de tempo, ou coleta de estatísticas em torno
  da execução de tarefas.

## Deep Dive

### A fórmula de dimensionamento

Para tarefas puramente compute-intensive, um sistema com N<sub>cpu</sub>
processadores geralmente atinge utilização ótima com um thread pool de
N<sub>cpu</sub> + 1 threads. (Mesmo threads compute-intensive ocasionalmente
sofrem um page fault ou pausam por algum outro motivo, então uma thread
"extra" pronta para executar evita que ciclos de CPU fiquem ociosos quando
isso acontece.)

Para tarefas que também incluem I/O ou outras operações bloqueantes, você
quer um pool maior, já que nem todas as threads serão escalonáveis o tempo
todo. Para dimensionar o pool corretamente, você precisa estimar a razão
entre tempo de espera e tempo de computação para suas tarefas — essa
estimativa não precisa ser precisa e pode ser obtida por profiling ou
instrumentação, ou o tamanho do pool pode ser ajustado rodando a aplicação
sob vários tamanhos de pool diferentes com uma carga de benchmark e
observando a utilização de CPU.

Dadas estas definições:

- N<sub>cpu</sub> = número de CPUs
- U<sub>cpu</sub> = utilização de CPU alvo, 0 < U<sub>cpu</sub> ≤ 1
- W/C = razão entre tempo de espera e tempo de computação

o tamanho ótimo do pool para manter os processadores na utilização desejada
é:

```
Nthreads = Ncpu * Ucpu * (1 + W/C)
```

Você pode determinar o número de CPUs em runtime com:

```java
int N_CPUS = Runtime.getRuntime().availableProcessors();
```

Ciclos de CPU não são o único recurso que um thread pool pode precisar
gerenciar — memória, file handles, socket handles e conexões de banco de
dados também podem restringir o dimensionamento. Calcular uma restrição de
tamanho de pool para esses recursos é mais fácil: some quanto desse recurso
cada tarefa exige e divida pela quantidade total disponível; o resultado é um
limite superior para o tamanho do pool. Quando tarefas exigem um recurso
poolado como conexões de banco de dados, o tamanho do thread pool e o tamanho
do pool de recursos afetam um ao outro — se cada tarefa exige uma conexão, o
tamanho efetivo do thread pool é limitado pelo tamanho do connection pool, e
vice-versa.

### Criação e desmonte de threads

O construtor geral de `ThreadPoolExecutor` expõe os controles diretamente:

```java
public ThreadPoolExecutor(int corePoolSize,
                           int maximumPoolSize,
                           long keepAliveTime,
                           TimeUnit unit,
                           BlockingQueue<Runnable> workQueue,
                           ThreadFactory threadFactory,
                           RejectedExecutionHandler handler) { ... }
```

O core pool size é o tamanho alvo: a implementação tenta manter o pool nesse
tamanho mesmo quando não há tarefas para executar, e não vai criar mais
threads do que isso a menos que a fila de trabalho esteja cheia. O maximum
pool size é o limite superior de quantas threads do pool podem estar ativas
ao mesmo tempo. Uma thread ociosa por mais tempo que o keep-alive time se
torna candidata a ser eliminada e pode ser terminada se o tamanho atual do
pool exceder o core size. Ajustar o core pool size e o keep-alive time
permite que o pool recupere recursos de threads ociosas — mas isso é um
trade-off: eliminar threads ociosas incorre em latência adicional depois, se
as threads precisarem ser criadas de novo quando a demanda aumentar.

`newFixedThreadPool` define tanto o core quanto o maximum pool size para o
tamanho pedido, criando o efeito de um timeout infinito. `newCachedThreadPool`
define o maximum pool size para `Integer.MAX_VALUE` e o core pool size para
zero com um timeout de um minuto, criando um pool infinitamente expansível
que se contrai novamente quando a demanda diminui.

### Gerenciando tarefas enfileiradas

`ThreadPoolExecutor` permite fornecer uma `BlockingQueue` para segurar tarefas
aguardando execução. Existem três abordagens básicas:

- **Fila ilimitada** — o padrão para `newFixedThreadPool` e
  `newSingleThreadExecutor`, usando uma `LinkedBlockingQueue` ilimitada.
  Tarefas se enfileiram se todas as threads de trabalho estiverem ocupadas,
  mas a fila pode crescer sem limite se tarefas continuarem chegando mais
  rápido do que podem ser executadas.
- **Fila limitada** — como uma `ArrayBlockingQueue`, uma
  `LinkedBlockingQueue` limitada, ou uma `PriorityBlockingQueue`. Filas
  limitadas ajudam a prevenir esgotamento de recursos, mas levantam a
  questão do que fazer com novas tarefas quando a fila está cheia (uma
  política de saturação — veja abaixo). Com uma fila de trabalho limitada, o
  tamanho da fila e o tamanho do pool precisam ser ajustados juntos: uma
  fila grande com um pool pequeno pode reduzir uso de memória, uso de CPU e
  troca de contexto, ao custo de potencialmente restringir o throughput.
- **Handoff síncrono** — para pools muito grandes ou ilimitados, uma
  `SynchronousQueue` ignora o enfileiramento completamente e entrega tarefas
  diretamente de produtores para threads de trabalho. Ela não é
  verdadeiramente uma fila: para colocar um elemento nela, outra thread já
  precisa estar esperando para aceitar o handoff. Se nenhuma thread está
  esperando mas o pool está abaixo do seu tamanho máximo,
  `ThreadPoolExecutor` cria uma nova thread; caso contrário a tarefa é
  rejeitada de acordo com a política de saturação. `SynchronousQueue` é uma
  escolha prática só se o pool for ilimitado ou se rejeitar tarefas em
  excesso for aceitável — `newCachedThreadPool` usa uma.

Uma fila FIFO (`LinkedBlockingQueue` ou `ArrayBlockingQueue`) inicia tarefas
na ordem de chegada. Para mais controle sobre a ordem de execução, uma
`PriorityBlockingQueue` ordena tarefas por prioridade, definida pela ordem
natural (se as tarefas implementam `Comparable`) ou por um `Comparator`.

Limitar o thread pool ou a fila de trabalho só é adequado quando as tarefas
são independentes — com tarefas que dependem de outras tarefas, pools ou
filas limitados podem causar deadlock por fome de threads, então uma
configuração ilimitada como `newCachedThreadPool` é usada em vez disso.

### Políticas de saturação

Quando uma fila de trabalho limitada enche, a política de saturação entra em
jogo — ela também se aplica quando uma tarefa é submetida a um `Executor`
que já foi desligado. A política é definida chamando
`setRejectedExecutionHandler`, e o JDK fornece quatro implementações de
`RejectedExecutionHandler`:

- **`AbortPolicy`** (o padrão) — `execute` lança a exceção unchecked
  `RejectedExecutionException`; quem chamou pode capturá-la e implementar seu
  próprio tratamento de overflow.
- **`DiscardPolicy`** — descarta silenciosamente a tarefa recém-submetida se
  ela não puder ser enfileirada.
- **`DiscardOldestPolicy`** — descarta a tarefa que seria executada em
  seguida, depois tenta resubmeter a nova tarefa. (Se a fila de trabalho for
  uma fila de prioridade, isso descarta o elemento de maior prioridade,
  então combinar discard-oldest com uma fila de prioridade não é uma boa
  ideia.)
- **`CallerRunsPolicy`** — uma forma de throttling: não descarta tarefas nem
  lança exceção, mas executa a tarefa recém-submetida na thread que chamou
  `execute` em vez de numa thread do pool. Isso desacelera o fluxo de novas
  tarefas, já que essa thread que chamou não consegue submeter mais trabalho
  enquanto está ocupada executando a tarefa empurrada de volta — dando tempo
  para as threads de trabalho se recuperarem. À medida que o pool fica
  sobrecarregado, o trabalho é gradualmente empurrado para fora: das threads
  do pool para a fila de trabalho, para a aplicação e (num servidor de rede)
  eventualmente para a camada TCP e o cliente, permitindo uma degradação
  mais graciosa.

```java
ThreadPoolExecutor executor
    = new ThreadPoolExecutor(N_THREADS, N_THREADS,
        0L, TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<Runnable>(CAPACITY));
executor.setRejectedExecutionHandler(
    new ThreadPoolExecutor.CallerRunsPolicy());
```

Não existe uma política de saturação predefinida que faça `execute` bloquear
quando a fila está cheia; o mesmo efeito pode ser obtido com um `Semaphore`
limitando a taxa de injeção de tarefas (usando uma fila ilimitada, já que não
há motivo para limitar tanto o tamanho da fila quanto a taxa de injeção).

### Thread factories

Sempre que um thread pool precisa criar uma thread, ele o faz através de um
`ThreadFactory`:

```java
public interface ThreadFactory {
    Thread newThread(Runnable r);
}
```

A factory padrão cria uma nova thread não-daemon sem configuração especial.
Motivos para fornecer uma customizada incluem especificar um
`UncaughtExceptionHandler` para threads do pool, instanciar uma subclasse
customizada de `Thread` (por exemplo uma que faz logging de debug), modificar
a prioridade da thread ou o status de daemon, ou simplesmente dar às threads
do pool nomes mais significativos para facilitar a leitura de thread dumps e
logs de erro:

```java
public class MyThreadFactory implements ThreadFactory {
    private final String poolName;

    public MyThreadFactory(String poolName) {
        this.poolName = poolName;
    }

    public Thread newThread(Runnable runnable) {
        return new MyAppThread(runnable, poolName);
    }
}
```

`MyAppThread` (uma subclasse customizada de `Thread`) é onde essa
customização de fato vive — ela pode aceitar um nome específico do pool,
instalar um `UncaughtExceptionHandler` customizado que registra a falha, e
manter estatísticas de quantas threads foram criadas e estão atualmente
vivas.

Se uma aplicação depende de políticas de segurança para conceder permissões
a codebases específicas, `Executors.privilegedThreadFactory()` constrói
threads do pool com as mesmas permissões, `AccessControlContext` e
`contextClassLoader` da thread que criou a factory — do contrário threads do
pool herdam permissões de qualquer cliente que estiver chamando `execute` ou
`submit` no momento em que uma nova thread é necessária, o que pode causar
exceções confusas relacionadas a segurança.

A maioria das opções de construtor — core pool size, maximum pool size,
keep-alive time, thread factory, rejected execution handler — também podem
ser alteradas após a construção via setters. Se o executor veio de um dos
factory methods de `Executors` (exceto `newSingleThreadExecutor`), ele pode
ser convertido (cast) para `ThreadPoolExecutor` para acessar esses setters:

```java
ExecutorService exec = Executors.newCachedThreadPool();
if (exec instanceof ThreadPoolExecutor)
    ((ThreadPoolExecutor) exec).setCorePoolSize(10);
else
    throw new AssertionError("Oops, bad assumption");
```

`Executors.unconfigurableExecutorService` envolve um `ExecutorService`
existente expondo só a interface `ExecutorService`, então ele não pode ser
reconfigurado — útil ao expor um executor a código em que você não confia
para não modificá-lo. `newSingleThreadExecutor` retorna seu resultado
envolto dessa forma, precisamente porque deixar alguém aumentar o pool size
de um executor de thread única minaria a garantia de execução sequencial que
ele promete.

### Estendendo ThreadPoolExecutor

`ThreadPoolExecutor` foi projetado para extensão, com três hooks que uma
subclasse pode sobrescrever: `beforeExecute`, `afterExecute` e `terminated`.

- `beforeExecute` e `afterExecute` rodam na thread que executa a tarefa,
  então podem ser usados para logging, medição de tempo, monitoramento ou
  coleta de estatísticas. `afterExecute` é chamado tanto se a tarefa
  completou normalmente quanto se lançou uma `Exception` — mas não se a
  tarefa completou com um `Error`. Se `beforeExecute` lança uma
  `RuntimeException`, a tarefa não é executada e `afterExecute` não é
  chamado.
- `terminated` é chamado depois que o pool completa o shutdown — uma vez que
  todas as tarefas terminaram e todas as threads de trabalho encerraram.
  Pode liberar recursos, fazer notificação ou logging, ou finalizar
  estatísticas.

#### Exemplo: adicionando estatísticas a um thread pool

Como `beforeExecute` e `afterExecute` rodam na thread que executa, um valor
guardado num `ThreadLocal` por `beforeExecute` pode ser recuperado por
`afterExecute` para cronometrar a tarefa — `TimingThreadPool` usa isso para
acumular uma contagem de tarefas e tempo total de processamento, depois
reporta a média em `terminated`:

```java
public class TimingThreadPool extends ThreadPoolExecutor {
    private final ThreadLocal<Long> startTime = new ThreadLocal<Long>();
    private final Logger log = Logger.getLogger("TimingThreadPool");
    private final AtomicLong numTasks = new AtomicLong();
    private final AtomicLong totalTime = new AtomicLong();

    protected void beforeExecute(Thread t, Runnable r) {
        super.beforeExecute(t, r);
        log.fine(String.format("Thread %s: start %s", t, r));
        startTime.set(System.nanoTime());
    }

    protected void afterExecute(Runnable r, Throwable t) {
        try {
            long endTime = System.nanoTime();
            long taskTime = endTime - startTime.get();
            numTasks.incrementAndGet();
            totalTime.addAndGet(taskTime);
            log.fine(String.format("Thread %s: end %s, time=%dns",
                     t, r, taskTime));
        } finally {
            super.afterExecute(r, t);
        }
    }

    protected void terminated() {
        try {
            log.info(String.format("Terminated: avg time=%dns",
                     totalTime.get() / numTasks.get()));
        } finally {
            super.terminated();
        }
    }
}
```

## Trade-offs

- **Filas ilimitadas são simples mas arriscam esgotamento de recursos** —
  `newFixedThreadPool` e `newSingleThreadExecutor` têm por padrão uma
  `LinkedBlockingQueue` ilimitada, então tarefas se enfileiram barato, mas se
  as chegadas continuarem superando a execução, a fila (e eventualmente a
  memória) podem se esgotar. Filas limitadas restringem esse risco mas
  forçam uma decisão sobre o que fazer quando enchem.
- **Uma fila limitada precisa de uma política de saturação, e a padrão lança
  exceção** — deixe `RejectedExecutionHandler` sem definir e uma fila cheia
  dispara `AbortPolicy`, lançando `RejectedExecutionException` para quem
  chamou. Trocá-la muda o comportamento inteiramente, ex.: descartando
  silenciosamente em vez de falhar ruidosamente:
  ```java
  executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardPolicy());
  ```
- **`CallerRunsPolicy` limita o produtor em vez de falhar** — executar a
  tarefa rejeitada na thread que chamou significa que essa thread não pode
  submeter mais trabalho até terminar, o que empurra a contrapressão de
  volta para o que estiver gerando tarefas (ex.: conexões de rede
  chegando) em vez de descartá-las ou rejeitá-las de imediato.
- **Fila grande + pool pequeno troca throughput por menor uso de recursos**
  — combinar uma fila limitada grande com poucas threads reduz custos de
  memória, CPU e troca de contexto, mas pode restringir quanto trabalho
  realmente é feito concorrentemente; o tamanho da fila e o tamanho do pool
  precisam ser ajustados como um par, não independentemente.
- **Eliminar threads ociosas (core size pequeno) economiza recursos mas
  adiciona latência** — deixar o core pool encolher quando ocioso libera
  memória, mas se a demanda voltar de repente, novas threads precisam ser
  criadas antes que essas tarefas possam começar a rodar.

## Documentation Links

- [ThreadPoolExecutor — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html) — doc
- [RejectedExecutionHandler — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/RejectedExecutionHandler.html) — doc
- [ThreadFactory — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadFactory.html) — doc
