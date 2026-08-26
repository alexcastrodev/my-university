---
version: 1.0
updatedAt: 2026-08-13
title: "Reduzindo Contenção de Locks: Escopo, Granularidade e Striping"
summary: "Técnicas concretas para diminuir o impacto de um lock contencioso — reduzir seu escopo, dividi-lo ou fazer striping, evitar campos quentes, e quando trocá-lo por um read-write lock ou um atomic."
---
## Objective

Uma classe protegida por um único lock pode estar perfeitamente correta e ainda assim ser o motivo pelo qual um servidor para de escalar: toda thread que precisa do lock fica na fila atrás de quem quer que o esteja segurando, então adicionar mais threads (ou cores) só aumenta a fila em vez de aumentar a vazão. Este conceito assume que a correção já está resolvida — os conceitos irmãos sobre [AQS](abstract-queued-synchronizer-and-custom-locks.md) e [prevenção de deadlock](deadlock-lock-ordering-and-avoidance.md) cobrem o que existe por baixo de um lock e como evitar corrompê-lo ou travá-lo — e faz a próxima pergunta: uma vez que um lock correto virou um gargalo de contenção, quais são as alavancas concretas disponíveis, mais ou menos em ordem de quão cirúrgica (vs. invasiva) cada uma é.

## Use Cases

- Um profiler ou um thread dump mostra muitas threads bloqueadas esperando pelo mesmo monitor, e a utilização de CPU está baixa mesmo havendo bastante trabalho enfileirado — o sintoma clássico de um lock quente, não de hardware insuficiente.
- Uma classe que começou com um lock protegendo "o estado do objeto" cresceu até ter vários campos logicamente não relacionados sob esse mesmo lock, então operações sem relação nenhuma agora concorrem entre si sem motivo real.
- Um contador compartilhado ou um campo de tamanho em cache é atualizado a cada escrita numa estrutura de dados bem particionada, e esse único campo é a última coisa ainda forçando os escritores a se serializar.
- Decidir se uma estrutura compartilhada com leitura intensa deve continuar usando locking exclusivo ou migrar para uma divisão leitor/escritor, antes de recorrer a algo mais drástico como uma reescrita completa para um algoritmo lock-free.

## Deep Dive

### 1. Performance vs. escalabilidade, e por que a Lei de Amdahl define o teto

"Mais rápido" e "escala melhor" são propriedades diferentes. Uma mudança que torna uma execução single-threaded mais rápida (melhor cache, um algoritmo mais barato) pode ser neutra ou até prejudicial para a escalabilidade; uma mudança que faz um programa escalar melhor entre muitos cores (dividir o trabalho em pedaços independentes) pode adicionar overhead que torna o caso single-threaded mais lento. Para um servidor concorrente, vazão e escalabilidade — quanto trabalho é feito conforme carga e hardware crescem — geralmente importam mais do que economizar milissegundos em uma única requisição.

A Lei de Amdahl quantifica o porquê: se `F` é a fração do trabalho de uma tarefa que precisa rodar de forma serial — porque está protegida por um único lock, ou de outra forma não pode ser dividida entre threads — então, em `N` processadores, o speedup máximo possível em relação a rodar em um único processador é:

```
speedup(N) = 1 / (F + (1 - F) / N)
```

Conforme `N → ∞`, essa expressão converge para `1/F` — um teto rígido que nenhuma quantidade de hardware adicional consegue ultrapassar. A fração serial domina mais rápido do que a intuição sugere. Considere `F = 0,05` (só 5% do trabalho é serializado, 95% é perfeitamente paralelo):

```java
static double speedup(double serialFraction, int processors) {
    return 1.0 / (serialFraction + (1 - serialFraction) / processors);
}

speedup(0.05, 8);   // ≈ 5.93x  — on 8 processors
speedup(0.05, 64);  // ≈ 15.42x — 8x more hardware, not even 3x more speedup
speedup(0.05, 1_000_000); // ≈ 19.9996x — converging on the ceiling
// the theoretical limit as N -> infinity is 1 / 0.05 = 20x, forever
```

Ir de 8 para 64 processadores é um investimento de 8x em hardware por mal 2,6x mais speedup, e nenhuma quantidade de processadores — nem 64, nem um milhão — vai passar de 20x enquanto esses 5% continuarem seriais. É isso que motiva toda técnica abaixo: nenhuma delas muda *o que* o programa computa, todas existem puramente para reduzir `F` — a parcela da execução do programa forçada a passar por um único portão serializado — para que adicionar threads continue valendo a pena.

### 2. Reduzindo o escopo do lock — "entra e sai rápido"

A alavanca mais barata: segurar o lock só pelas instruções que de fato tocam estado compartilhado, e mover todo o resto — formatação de string, logging, parsing, qualquer I/O — para fora do bloco `synchronized`. A contenção depende de com que frequência um lock é solicitado *e* por quanto tempo ele é segurado; reduzir o tempo de posse ataca diretamente o segundo fator, sem exigir mudança de design.

```java
// Before: the lock is held for the entire method, including work
// that never touches sharedCounts.
@ThreadSafe
public class MetricsRecorder {
    @GuardedBy("this")
    private final Map<String, Long> sharedCounts = new HashMap<>();

    public synchronized void recordEvent(String name) {
        sharedCounts.merge(name, 1L, Long::sum);           // needs the lock

        String message = String.format("[%s] event=%s count=%d",
                Instant.now(), name, sharedCounts.get(name)); // doesn't
        logger.info(message);                                 // doesn't
    }
}
```

```java
// After: only the map access is synchronized; formatting and logging
// run with no lock held at all.
@ThreadSafe
public class MetricsRecorder {
    @GuardedBy("this")
    private final Map<String, Long> sharedCounts = new HashMap<>();

    public void recordEvent(String name) {
        long count;
        synchronized (this) {
            count = sharedCounts.merge(name, 1L, Long::sum);
        }
        String message = String.format("[%s] event=%s count=%d",
                Instant.now(), name, count);
        logger.info(message);
    }
}
```

A versão refatorada reduz o número de instruções executadas sob o lock, o que, pela Lei de Amdahl, diminui `F` para esse método — a parcela serializada agora é só uma atualização de map, em vez de uma atualização de map mais formatação mais uma chamada de I/O ao framework de logging. Existe um piso para essa técnica: um bloco `synchronized` pode ficar pequeno demais se deixar de cobrir tudo que um invariante precisa (veja Trade-offs), e como a própria sincronização tem um custo não nulo, dividir um bloco em vários só compensa quando o trabalho movido para fora é "substancial" — não para uma única operação aritmética.

### 3. Reduzindo granularidade: dividindo um lock, depois fazendo striping

Se um lock protege várias partes *independentes* do estado, threads que tocam partes diferentes ainda concorrem entre si puramente por compartilharem um lock, não por compartilharem dados. Dividir o lock remove esse acoplamento acidental.

```java
// Before: one lock serializes two unrelated kinds of updates.
@ThreadSafe
public class ServerStats {
    @GuardedBy("this") private final Set<String> activeUsers = new HashSet<>();
    @GuardedBy("this") private final Set<String> activeQueries = new HashSet<>();

    public synchronized void userLoggedIn(String u)  { activeUsers.add(u); }
    public synchronized void queryStarted(String q)  { activeQueries.add(q); }
}
```

```java
// After: each independent piece of state gets its own lock, so a login
// and a query no longer block each other.
@ThreadSafe
public class ServerStats {
    @GuardedBy("userLock") private final Set<String> activeUsers = new HashSet<>();
    @GuardedBy("queryLock") private final Set<String> activeQueries = new HashSet<>();
    private final Object userLock = new Object();
    private final Object queryLock = new Object();

    public void userLoggedIn(String u) {
        synchronized (userLock) { activeUsers.add(u); }
    }
    public void queryStarted(String q) {
        synchronized (queryLock) { activeQueries.add(q); }
    }
}
```

Dividir um lock em dois só ajuda sob contenção moderada — num lock raramente contencioso, não há nada para dividir; num lock massivamente contencioso, dois locks fortemente contenciosos são só uma pequena melhoria em relação a um. **Lock striping** é o que faz isso escalar mais: em vez de um lock por variável lógica, você faz hash de um conjunto grande e fixo de itens contra um array pequeno e fixo de locks, de modo que a contenção se espalhe por todo o array em vez de se concentrar em um ou dois locks.

```java
// Sketch: N independent buckets, guarded by a much smaller, fixed
// array of stripe locks — contention only happens between the
// fraction of operations that hash to the *same* stripe.
public class StripedCounterMap {
    private static final int STRIPE_COUNT = 16;
    private final Object[] stripeLocks = new Object[STRIPE_COUNT];
    private final Map<String, Long>[] buckets = new HashMap[STRIPE_COUNT];

    { for (int i = 0; i < STRIPE_COUNT; i++) stripeLocks[i] = new Object(); }

    private int stripeFor(String key) {
        return Math.abs(key.hashCode() % STRIPE_COUNT);
    }

    public void increment(String key) {
        int stripe = stripeFor(key);
        synchronized (stripeLocks[stripe]) {
            buckets[stripe].merge(key, 1L, Long::sum);
        }
    }
}
```

Com um hash razoavelmente uniforme, 16 stripes cortam a contenção em qualquer lock isolado para aproximadamente 1/16 do que um único lock veria. O número de stripes pode crescer conforme a contagem de processadores cresce — o que, visto pela Lei de Amdahl, é exatamente por que striping escala mais do que uma divisão única em dois: `F` continua diminuindo conforme o número de stripes cresce, enquanto dividir em dois locks só o reduz uma vez. O custo é que operações que precisam de *todos* os stripes de uma vez (redimensionar a estrutura inteira, ou um `size()` exato) ficam mais caras, já que precisam adquirir alguns ou todos os locks de stripe em vez de apenas um. `ConcurrentHashMap` é o exemplo canônico do mundo real de levar essa ideia ainda mais longe — seu design atual de CAS a nível de bin combinado com `synchronized` é coberto em profundidade pelo conceito irmão sobre [coleções concorrentes](concurrent-collections-and-compound-actions.md); o ponto a levar daqui é só que lock striping generaliza para locking por bucket, e o `ConcurrentHashMap` moderno generaliza isso mais uma vez para CAS por bin com sincronização só numa colisão real.

### 4. Evitando campos quentes

Dividir e fazer striping só ajudam quando as partes do estado são de fato independentes. Um único campo que toda operação precisa tocar — um total corrente, um tamanho em cache — continua sendo um gargalo não importa quão bem particionado esteja o resto, porque todo escritor ainda tem que se serializar nesse campo. É isso que acontece quando um contador feito à mão é mantido atualizado a cada escrita só para deixar as leituras baratas: o campo "quente" vira a única coisa ainda forçando todos os escritores a concorrer.

`java.util.concurrent.atomic.LongAdder` (e `LongAccumulator` para combinar operações além de soma) existem justamente para isso: em vez de um único `long` que toda thread atualiza, eles mantêm um conjunto interno de variáveis que cresce sob contenção, de modo que escritores concorrentes normalmente atualizam variáveis diferentes e raramente colidem. A troca é uma leitura `sum()` que custa mais (ela soma as variáveis internas e não é um snapshot atômico — atualizações concorrentes durante a leitura podem ou não estar incluídas) em troca de escritas que continuam baratas e livres de contenção mesmo sob uso concorrente intenso:

```java
// AtomicLong: every increment retries a compare-and-swap against the
// *same* memory location — under high contention, many threads spin
// retrying against one another.
AtomicLong atomicHits = new AtomicLong();
atomicHits.incrementAndGet();
long total = atomicHits.get(); // exact, but every writer contends here

// LongAdder: increments are spread across internal cells, so
// concurrent writers usually don't collide at all.
LongAdder adderHits = new LongAdder();
adderHits.increment();
long approxTotal = adderHits.sum(); // combines the cells; not an atomic snapshot
```

Para um contador que é escrito muito mais do que é lido — contagem de requisições, totais de cache hit — `LongAdder` é quase sempre a melhor escolha em relação a `AtomicLong`; para um campo lido tão frequentemente quanto (ou mais que) é escrito, ou um cujo valor exato precisa ser observado atomicamente junto com outro estado, a troca não compensa e um atomic simples ou um lock ainda é a ferramenta certa.

### 5. Alternativas ao locking exclusivo, em resumo

Existem mais duas opções para quando o *padrão de acesso* em si não precisa de locking exclusivo, em vez de precisar de um lock mais estreito ou dividido. Ambas têm sua mecânica de uso coberta pelo conceito irmão de [utilitários de concorrência](concurrency-utilities-executors-and-synchronizers.md) — o ponto aqui é *por que* recorrer a uma delas em vez de continuar reduzindo o escopo ou dividindo:

- **`ReadWriteLock`** (`ReentrantReadWriteLock`) se encaixa em dados que são lidos muito mais do que são escritos: qualquer número de leitores pode segurar o lock de leitura simultaneamente, e só um escritor precisa de acesso exclusivo. Dividir ou fazer striping não ajuda uma estrutura com leitura intensa da mesma forma que deixar os leitores pararem de bloquear uns aos outros ajuda.
- **Variáveis atômicas** substituem um lock completamente no caso mais simples: uma única variável sem invariante ligando-a a nenhum outro campo. Assim que uma classe passa a ter mais de um campo quente, ou campos que precisam mudar juntos atomicamente, atomics simples deixam de ser suficientes e a escolha volta a ser escopo/granularidade/striping, ou um lock explícito.

## Trade-offs

- **Reduzir o escopo de um lock tem um piso — requisitos de atomicidade não encolhem só porque o código ao redor encolheu.** Uma operação que atualiza duas variáveis participantes do mesmo invariante precisa manter ambas as atualizações dentro de um único bloco `synchronized`; dividi-las em dois blocos menores "por escalabilidade" quebra a correção em vez de melhorar a performance.
  ```java
  // Wrong: balance and lastUpdated can now be observed out of sync
  // by another thread between the two blocks.
  synchronized (this) { balance -= amount; }
  synchronized (this) { lastUpdated = Instant.now(); }
  ```
- **Mais locks significa mais lugares onde um deadlock pode se formar.** Dividir um lock em vários, ou fazer striping em muitos, só compensa se nenhum caminho de código jamais precisar segurar mais de um deles ao mesmo tempo numa ordem que não seja consistente em todo lugar — veja o conceito irmão sobre [prevenção de deadlock](deadlock-lock-ordering-and-avoidance.md) para a disciplina de ordenação exigida assim que há mais de um lock.
- **Striping troca memória e operações sobre a estrutura inteira por concorrência.** Um único lock custa um objeto; N stripes custam N. Operações que precisam da estrutura *inteira* — um resize completo, um `size()` exato entre todos os stripes — ficam mais caras porque precisam tocar todo stripe, às vezes todos de uma vez, em vez do único lock que precisariam antes.
- **Uma correção de campo quente que troca exatidão por vazão não é de graça — ela muda o que os chamadores podem assumir.** `LongAdder.sum()` não é um snapshot atômico, então código que precisa de uma contagem exata e pontual (por exemplo, para decidir se um recurso atingiu um limite rígido) pode observar um total obsoleto ou em trânsito, e precisa tolerar isso, ou recorrer a um campo que continue exato ao custo de contenção.
- **Nada disso vale a pena fazer sem uma medição mostrando que a contenção de lock é de fato o gargalo.** Dividir ou fazer striping em locks pouco contenciosos rende pouca melhoria e ainda adiciona risco de deadlock e complexidade de código à toa; faça profiling ou um thread dump antes para confirmar que o lock em questão é o que está realmente quente.

## Documentation Links

- [LongAdder — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html) — doc
- [LongAccumulator — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAccumulator.html) — doc
- [AtomicLong — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicLong.html) — doc
- [ConcurrentHashMap — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html) — doc
- [ReentrantReadWriteLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html) — doc
- [ReadWriteLock — java.util.concurrent.locks](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReadWriteLock.html) — doc
