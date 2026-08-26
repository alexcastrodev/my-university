---
version: 1.0
updatedAt: 2026-08-21
title: ThreadLocal: Estado por Thread, Vazamentos e InheritableThreadLocal
summary: ThreadLocal dá a cada thread sua própria cópia isolada de uma variável através de um mapa por thread, o que é poderoso mas vaza em threads de pool a menos que seja combinado com remove, e InheritableThreadLocal copia esse valor para threads filhas apenas no momento da criação.
---
## Objective

`ThreadLocal<T>` (`java.lang.ThreadLocal`) fornece uma variável isolada por thread: toda thread que chama `get()` ou `set()` na mesma instância de `ThreadLocal` enxerga e modifica sua própria cópia independente, invisível para todas as outras threads. É declarada uma vez, compartilhada, e idiomaticamente `static final` — a instância em si nunca guarda um valor; ela é uma chave que cada thread resolve contra seu próprio armazenamento privado. Essa isolação por thread é exatamente o que a torna perigosa de esquecer: em uma thread de pool que sobrevive a qualquer tarefa individual, um valor definido e nunca removido continua vivo no armazenamento daquela thread indefinidamente. `ScopedValue` (veja o conceito `scoped-values`) foi finalizado no Java 25 especificamente para substituir o caso de uso comum de contexto de requisição por uma alternativa imutável e com limpeza automática — mas `ThreadLocal` e sua subclasse `InheritableThreadLocal` continuam amplamente usados no ecossistema (MDCs de logging, vinculação de conexões JDBC, contextos de segurança) e vale a pena entendê-los em seus próprios termos.

## Use Cases

- Carregar um pedaço de contexto por thread — um ID de correlação de requisição, a transação atual, uma instância de `SimpleDateFormat` — através de código que não o recebe como parâmetro.
- Dar suporte ao contexto de diagnóstico de frameworks de logging (o MDC do SLF4J/Logback é baseado em thread-local internamente; veja o conceito `logging-in-java` para a API do MDC em si) para que uma linha de log emitida no fundo de uma call stack ainda carregue o ID de requisição definido no ponto de entrada.
- Dar a cada thread seu próprio objeto auxiliar não thread-safe (formatadores, geradores de números aleatórios, buffers) em vez de sincronizar o acesso a uma única instância compartilhada.
- Propagar um valor automaticamente para threads worker geradas por uma thread pai, via `InheritableThreadLocal`, sem passá-lo por todo construtor e chamada de método pelo caminho.

## Deep Dive

### Declarando e usando um ThreadLocal: uma instância, várias cópias independentes

```java
public class RequestContext {
    // static final — uma única chave compartilhada para o programa inteiro
    static final ThreadLocal<String> CURRENT_USER = ThreadLocal.withInitial(() -> "anonymous");
}

// Thread A
RequestContext.CURRENT_USER.set("alice");
System.out.println(RequestContext.CURRENT_USER.get());   // "alice"

// Thread B, rodando concorrentemente
System.out.println(RequestContext.CURRENT_USER.get());   // "anonymous" — sua própria cópia, intocada pela Thread A
```

Ambas as threads chamam `get()`/`set()` no exato mesmo objeto `CURRENT_USER`, mas nunca observam o valor uma da outra. `withInitial(Supplier<T>)` fornece o valor que uma thread enxerga na primeira vez que chama `get()` sem ter chamado `set()` antes; um simples `new ThreadLocal<>()` faz essa primeira leitura ser `null` por padrão.

### O mecanismo: cada Thread possui um ThreadLocalMap, indexado pelo próprio ThreadLocal

A isolação não é mágica — é um hash map. Todo objeto `Thread` carrega um campo interno `ThreadLocalMap`. Chamar `threadLocal.set(value)` não armazena nada dentro da instância de `ThreadLocal`; ela busca o mapa da própria `Thread.currentThread()` e armazena o valor lá, indexado pela própria instância de `ThreadLocal` (via `System.identityHashCode`, não `equals`/`hashCode`):

```java
// conceitualmente, o que set() faz:
Thread t = Thread.currentThread();
t.threadLocalMap.put(this /* a instância do ThreadLocal */, value);

// e o que get() faz:
Thread t = Thread.currentThread();
Object value = t.threadLocalMap.get(this);
```

É por isso que um único `static final ThreadLocal` compartilhado nunca colide entre threads: existe exatamente um mapa por thread, e a instância de `ThreadLocal` é apenas uma chave de busca no mapa da thread que estiver perguntando. Threads diferentes, mapas diferentes, mesmo objeto-chave — nenhuma célula mutável compartilhada em lugar nenhum.

### O vazamento de memória: threads de pool nunca soltam o que carregavam

Um `ExecutorService` reutiliza o mesmo conjunto fixo de threads em várias tarefas — uma thread nunca morre entre tarefas, então seu `ThreadLocalMap` também nunca é coletado pelo garbage collector entre tarefas. Um valor definido com `set()` e nunca removido com `remove()` fica preso àquela thread de pool, invisível e sem uso, até que algo o sobrescreva ou a própria thread eventualmente termine:

```java
static final ThreadLocal<byte[]> BUFFER = new ThreadLocal<>();

ExecutorService pool = Executors.newFixedThreadPool(4);

for (int i = 0; i < 1000; i++) {
    pool.submit(() -> {
        BUFFER.set(new byte[1_000_000]);   // 1 MB, "só para esta tarefa"
        process(BUFFER.get());
        // sem remove() — o array continua alcançável através do
        // ThreadLocalMap da thread de pool muito depois desta tarefa retornar
    });
}
```

Com apenas 4 threads no pool, esse loop parece que deveria segurar no máximo 4 MB de cada vez — mas cada uma das 4 threads fica sobrescrevendo *sua própria* entrada no mapa a cada tarefa que pega, então o vazamento aqui é realmente "um array obsoleto de 1 MB por thread, substituído a cada execução" em vez de 1000 arrays se acumulando; o perigo é mais grave quando tarefas diferentes usam chaves `ThreadLocal` *diferentes* ou pulam condicionalmente o `set()`, deixando entradas antigas sem uma escrita posterior para substituí-las. De qualquer forma, o objeto permanece alcançável enquanto a thread viver e nada remover a entrada — invisível para o código que submeteu a tarefa, e não é algo que um profiler rotulado "tarefa X" vai apontar, porque a tarefa X já terminou.

A correção é a limpeza incondicional em um bloco `finally` ao redor do código que chama `set()`:

```java
pool.submit(() -> {
    BUFFER.set(new byte[1_000_000]);
    try {
        process(BUFFER.get());
    } finally {
        BUFFER.remove();   // desvincula do ThreadLocalMap desta thread de pool
    }
});
```

`remove()` apaga a entrada do mapa da thread atual completamente — não apenas a redefine para o valor inicial — então o objeto referenciado se torna elegível para coleta de lixo assim que nada mais o segurar, e a próxima tarefa naquela thread começa do zero.

### InheritableThreadLocal: copiado no momento da criação do filho, não uma visão ao vivo

`InheritableThreadLocal<T>` estende `ThreadLocal<T>` e adiciona um comportamento: quando uma thread cria uma nova `Thread`, o `ThreadLocalMap` da filha é inicializado com uma cópia de todo valor `InheritableThreadLocal` que a pai tinha vinculado *naquele momento*:

```java
static final InheritableThreadLocal<String> TRACE_ID = new InheritableThreadLocal<>();

TRACE_ID.set("trace-abc");

Thread child = new Thread(() -> {
    System.out.println(TRACE_ID.get());   // "trace-abc" — copiado quando esta Thread foi criada
});
child.start();
```

A cópia acontece uma única vez, dentro da chamada da thread pai a `new Thread(...)` — não é um vínculo ao vivo de volta para a pai. Um valor que a pai define *depois* que a filha já existe nunca chega até ela:

```java
static final InheritableThreadLocal<String> TRACE_ID = new InheritableThreadLocal<>();

TRACE_ID.set("trace-abc");
Thread child = new Thread(() -> {
    sleep(100);
    System.out.println(TRACE_ID.get());   // ainda "trace-abc" — não o valor definido abaixo
});
child.start();

TRACE_ID.set("trace-xyz");   // o valor da própria pai muda; a filha já tem sua cópia
```

Duas consequências decorrem de "cópia na criação": as threads worker de um pool são criadas uma vez e reutilizadas para muitas tarefas, então um `InheritableThreadLocal` vinculado na thread *submissora* é copiado para o mapa de uma worker apenas na primeira vez que essa worker é gerada — tarefas posteriores submetidas por outros chamadores não recebem uma cópia nova, porque nenhuma `Thread` nova está sendo criada por tarefa. E por padrão a cópia é uma simples cópia de referência (`childValue()` retorna o valor da pai sem alteração), então um valor *mutável* compartilhado dessa forma é o mesmo objeto tanto na pai quanto na filha, sem nenhuma sincronização entre elas — sobrescrever `childValue(T parentValue)` é como uma subclasse pode fazer uma cópia profunda ou transformá-lo em vez disso.

## Trade-offs

- **Vaza na reutilização, não em threads de execução única.** Um `ThreadLocal` deixado sem `remove()` em uma `Thread` que roda uma tarefa e morre é inofensivo — a `Thread` inteira, mapa incluído, vira lixo. O risco é específico de threads worker de vida longa, que é exatamente o que todo servidor baseado em executor usa.
- **`remove()` é responsabilidade de quem chama, sempre, em todo caminho.** Nada obriga isso — uma exceção lançada antes de `remove()` ser alcançado em código sem proteção pula a limpeza por completo.

  ```java
  BUFFER.set(data);
  process(data);        // lança exceção
  BUFFER.remove();       // nunca alcançado — precisa estar em um finally
  ```

- **`InheritableThreadLocal` só dispara em `new Thread(...)`, não em `ExecutorService.submit(...)` para um pool já em execução.** Código que espera que o contexto "simplesmente flua" para tarefas submetidas, da mesma forma que flui para uma thread filha criada manualmente, vai descobrir que ele simplesmente não chega, porque a thread worker já existia antes do valor ser definido.
- **Leituras obsoletas parecem leituras corretas.** `get()` retornando `null` ou um valor inicial é indistinguível de "nada foi definido nesta thread" — um valor vazado ou obsoleto de uma tarefa anterior na mesma thread de pool retorna de forma tão limpa quanto um valor novo, sem nenhuma exceção para sinalizar o erro.
- **`ScopedValue` elimina toda essa classe de vazamento por construção onde se aplica** — veja o conceito `scoped-values` para a alternativa imutável e com desmontagem automática; ele cobre propagação de contexto de requisição e fan-out de concorrência estruturada, os dois casos para os quais `ThreadLocal`/`InheritableThreadLocal` são mais buscados hoje.

## Documentation Links

- [ThreadLocal — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html) — doc
- [InheritableThreadLocal — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InheritableThreadLocal.html) — doc
