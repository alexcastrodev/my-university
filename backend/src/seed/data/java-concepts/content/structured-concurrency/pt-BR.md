---
version: 1.0
updatedAt: 2026-08-18
title: "Concorrência Estruturada: StructuredTaskScope"
summary: "StructuredTaskScope (ainda preview no Java 25, JEP 505) transforma um fan-out de subtarefas concorrentes em um bloco try-with-resources que é dono do tempo de vida delas — nenhuma tarefa pode sobreviver ao seu escopo, as tarefas irmãs são canceladas automaticamente em caso de falha, e a operação inteira aparece aninhada em um thread dump em vez de como um pool plano de Futures."
---
## Objective

Concorrência estruturada diz que se uma tarefa se divide em subtarefas concorrentes, todas elas voltam para o mesmo lugar — o bloco que as iniciou. `StructuredTaskScope` (JEP 505, **ainda uma feature preview no Java 25**, sua *quinta* iteração de preview, com uma sexta já planejada para o JDK 26) transforma isso em um formato de nível de linguagem em vez de uma convenção: um scope é um bloco `try`-with-resources que é dono de toda tarefa iniciada dentro dele, e a chave de fechamento não é executada até que toda subtarefa tenha terminado ou sido cancelada. Compare isso com o padrão não estruturado que todo desenvolvedor Java já conhece — `executor.submit()` te entrega um `Future` que você pode retornar, guardar em um campo, ou simplesmente esquecer, e a tarefa por trás dele continua rodando muito depois que o método que a criou já retornou. Com um scope não existe essa saída: "disparar e esquecer" é estruturalmente impossível, tarefas irmãs são canceladas automaticamente quando uma delas falha, e o relacionamento pai/filho aparece como aninhamento real em um thread dump em vez de um pool plano de threads anônimas.

## Use Cases

- Fan-out de I/O onde você precisa de *todas* as respostas: chamar duas ou três microsserviços concorrentemente, combinar seus resultados, e falhar a operação inteira rapidamente se qualquer um deles falhar — sem escrever manualmente a lógica de "cancelar os outros".
- Substituir um pipeline `CompletableFuture.allOf()` / `anyOf()` feito à mão quando o que você realmente quer é *cancelamento* com curto-circuito do ramo perdedor (um padrão de chamada redundante/hedged-request), não apenas descartar seu resultado eventual.
- Adicionar um prazo a toda uma operação de fan-out como uma propriedade do scope, em vez de passar um timeout por cada chamada individual `Future.get(...)`.
- Tornar uma operação concorrente legível em um thread dump: subtarefas aparecem aninhadas sob a thread dona do scope, então um fan-out travado é diagnosticável em vez de ser uma parede de threads virtuais sem atribuição.
- Propagar contexto de requisição (usuário, tenant, trace id) para subtarefas concorrentes — subtarefas iniciadas em um scope herdam os bindings de `ScopedValue` do chamador, então não há passagem explícita nem limpeza de `ThreadLocal`.

## Deep Dive

### A linha de base não estruturada: gerenciamento de `ExecutorService` e `Future`

Esse é o formato que a maior parte do código existente tem. Funciona, mas nada nele é imposto.

```java
// Unstructured: correct behaviour is entirely up to the author.
Profile loadProfile(long id) throws Exception {
    ExecutorService es = Executors.newVirtualThreadPerTaskExecutor();
    try {
        Future<String>      user   = es.submit(() -> fetchUser(id));
        Future<List<Order>> orders = es.submit(() -> fetchOrders(id));

        String u;
        try {
            u = user.get();               // blocks
        } catch (ExecutionException e) {
            orders.cancel(true);          // hand-written: cancel the sibling
            throw e;
        }

        List<Order> o;
        try {
            o = orders.get();
        } catch (ExecutionException e) {
            // user already finished; nothing to cancel, but if it hadn't...
            throw e;
        }
        return new Profile(u, o);
    } finally {
        es.shutdown();                    // easy to forget
    }
}
```

Três coisas aqui são pura convenção. As chamadas de cancelar-o-irmão são escritas à mão e fáceis de fazer errado (ou de omitir para um ramo, como acima). O `shutdown()` no `finally` é a única coisa que amarra o tempo de vida da tarefa ao tempo de vida do método — remova-o e as tarefas sobrevivem à chamada. E nada impede um chamador de escrever `return es.submit(...)` e entregar o `Future` para fora do método completamente, ponto em que o tempo de vida da tarefa fica ilimitado. Veja [[concurrency-utilities-executors-and-synchronizers]] para a história completa de `Future`/`CompletableFuture` sobre a qual isso se apoia.

### A versão estruturada da mesma operação

```java
// preview — requires --enable-preview
import java.util.concurrent.StructuredTaskScope;
import java.util.concurrent.StructuredTaskScope.Subtask;

Profile loadProfile(long id) throws InterruptedException {
    try (var scope = StructuredTaskScope.open()) {
        Subtask<String>      user   = scope.fork(() -> fetchUser(id));
        Subtask<List<Order>> orders = scope.fork(() -> fetchOrders(id));

        scope.join();                      // wait for all; throws if any failed
        return new Profile(user.get(), orders.get());
    }                                      // close() -> cancels any straggler
}
```

Mesmo trabalho, sem nenhuma dessa burocracia. `StructuredTaskScope.open()` é uma **fábrica estática** — a classe não tem construtores públicos, o que é uma das mudanças de API entre iterações de preview. `fork()` retorna um `Subtask<T>`, *não* um `Future<T>`: é um simples porta-resultado sem semântica de "`get()` te bloqueia" e sem `cancel()`. O bloqueio acontece em exatamente um lugar, `scope.join()`, e o `close()` do scope garante que, quando o controle sai do bloco, nada iniciado dentro dele ainda está rodando.

### Políticas de conclusão: `Joiner`

A política padrão é "esperar por todos, cancelar tudo na primeira falha". Outras políticas são selecionadas passando um `Joiner` para `open()`:

| Factory | Policy |
|---------|--------|
| `StructuredTaskScope.open()` | Wait for all, cancel on failure |
| `StructuredTaskScope.open(Joiner.anySuccessfulResultOrThrow())` | First success wins |
| `StructuredTaskScope.open(Joiner.allSuccessfulOrThrow())` | All must succeed |

Com `anySuccessfulResultOrThrow()`, o próprio `join()` retorna o valor vencedor e os perdedores são cancelados — essa é a peça que `CompletableFuture.anyOf()` não oferece, já que `anyOf()` simplesmente ignora o ramo mais lento enquanto ele continua rodando:

```java
// preview
String fetchFastest(long id) throws InterruptedException {
    try (var scope = StructuredTaskScope.open(
             StructuredTaskScope.Joiner.<String>anySuccessfulResultOrThrow())) {
        scope.fork(() -> fetchFrom("replica-a", id));
        scope.fork(() -> fetchFrom("replica-b", id));
        return scope.join();               // first success; the loser is cancelled
    }
}
```

`allSuccessfulOrThrow()` faz `join()` retornar um `Stream<Subtask<T>>` das subtarefas concluídas, o que é conveniente para um fan-out homogêneo sobre uma lista de entradas.

### O que a falha de fato faz

```java
// preview
try (var scope = StructuredTaskScope.open()) {
    Subtask<String>      user   = scope.fork(() -> fetchUser(id));          // slow, 5s
    Subtask<List<Order>> orders = scope.fork(() -> { throw new IOException("orders down"); });

    scope.join();                          // returns after ~0s, not 5s
    return new Profile(user.get(), orders.get());   // never reached
} catch (StructuredTaskScope.FailedException e) {
    // e.getCause() is the IOException thrown by the orders subtask
    throw new ProfileUnavailableException(e.getCause());
}
```

No momento em que `orders` lança exceção, o scope cancela `user` — sua thread é interrompida, e `join()` retorna imediatamente em vez de esperar a chamada lenta terminar. `join()` então lança `FailedException` envolvendo a exceção original. Isso é o que a versão anterior com `ExecutorService` precisava de chamadas explícitas `cancel(true)` para aproximar, e se aplica a toda subtarefa, não só às que você lembrou de escrever um `catch` para tratar.

Ler um `Subtask` no momento errado é um erro definitivo em vez de um bloqueio silencioso:

```java
// preview
try (var scope = StructuredTaskScope.open()) {
    Subtask<String> user = scope.fork(() -> fetchUser(id));
    String s = user.get();                 // IllegalStateException — join() not called yet
    scope.join();
}
```

### Configuração: prazos, thread factory e herança de `ScopedValue`

Uma segunda sobrecarga de `open()` recebe uma função de configuração, então um timeout pertence à operação inteira em vez de a cada chamada individual:

```java
// preview
try (var scope = StructuredTaskScope.open(
         StructuredTaskScope.Joiner.<Void>awaitAllSuccessfulOrThrow(),
         cf -> cf.withName("load-profile")
                 .withTimeout(Duration.ofSeconds(2)))) {
    scope.fork(() -> { audit(id); return null; });
    scope.fork(() -> { warmCache(id); return null; });
    scope.join();                          // TimeoutException after 2s; both cancelled
}
```

`withName(...)` é o que torna o scope identificável em um thread dump, com suas subtarefas aninhadas embaixo dele. Subtarefas também herdam os bindings de `ScopedValue` do dono (`ScopedValue` em si é uma feature *final*, não-preview, a partir do Java 25), então o contexto da requisição flui para o fan-out sem ser passado explicitamente:

```java
// preview (the scope; ScopedValue itself is standard in 25)
private static final ScopedValue<String> TENANT = ScopedValue.newInstance();

ScopedValue.where(TENANT, "acme").run(() -> {
    try (var scope = StructuredTaskScope.open()) {
        scope.fork(() -> {
            TENANT.get();                  // "acme" — inherited from the scope owner
            return fetchUser(id);
        });
        scope.join();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
});
```

### Compilando e rodando

Features preview vêm desligadas por padrão e não são binariamente compatíveis entre releases, então tanto `javac` quanto `java` precisam da flag, mais um release explícito:

```bash
javac --release 25 --enable-preview Profile.java
java  --enable-preview Profile
```

Sem isso, a compilação falha completamente:

```text
error: StructuredTaskScope is a preview API and is disabled by default.
  (use --enable-preview to enable preview APIs)
```

## Trade-offs

- **Ainda é preview no Java 25, e a API genuinamente mudou de formato cinco vezes** — código escrito contra um preview anterior não compila no Java 25. A antiga subclasse `ShutdownOnFailure` e os construtores públicos se foram, substituídos por fábricas estáticas e `Joiner`; trate qualquer tutorial pré-25 como errado, não meramente desatualizado.
```java
// Pre-Java-25 preview shape — does not compile on 25
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) { // error: cannot find symbol
    scope.join();
    scope.throwIfFailed();                                      // error: cannot find symbol
}
```
- **Toda compilação *e* toda execução precisam de `--enable-preview`** — essa flag precisa chegar à sua ferramenta de build, ao seu test runner, à sua IDE e ao seu comando de lançamento em produção, e um arquivo de classe compilado com features preview se recusa a carregar em qualquer outra versão de JDK. Essa é uma restrição real de deployment, não uma caixinha para marcar.
```text
java.lang.UnsupportedClassVersionError: Preview features are not enabled for Profile
  (class file version 69.65535). Try running with '--enable-preview'
```
- **Desenhada em torno de threads virtuais, mas não as exige** — a thread factory padrão cria uma thread virtual por subtarefa, que é o pareamento pretendido com [[thread-model-legacy-vs-virtual-threads]]; você *pode* iniciar threads de plataforma em vez disso, mas aí a economia de "uma thread barata por tarefa" que torna o fan-out gratuito desaparece, e um fan-out grande volta a ser um problema de threads de SO.
```java
// preview — platform threads in a scope: legal, but against the design intent
try (var scope = StructuredTaskScope.open(
         StructuredTaskScope.Joiner.<Void>awaitAllSuccessfulOrThrow(),
         cf -> cf.withThreadFactory(Thread.ofPlatform().factory()))) {
    scope.fork(() -> { work(); return null; });
    scope.join();
}
```
- **"Nenhuma tarefa pode sobreviver ao seu scope" é uma limitação tanto quanto uma feature** — se você genuinamente precisa de trabalho em segundo plano do tipo disparar-e-esquecer que continua depois que a requisição atual retorna, um scope é a ferramenta errada por construção: `close()` vai bloquear até ele terminar ou cancelá-lo. Um `ExecutorService` simples, com tempo de vida amarrado à aplicação, não à chamada, ainda é a resposta nesse caso.
```java
// A Subtask handed out of the scope is useless afterwards
Subtask<String> escaped;
try (var scope = StructuredTaskScope.open()) {
    escaped = scope.fork(() -> fetchUser(id));
    scope.join();
}                                          // close() ends the task's life here
escaped.get();                             // IllegalStateException — scope is closed
```
- **O estilo de `join()` bloqueante soa estranho para times acostumados com cadeias de `CompletableFuture`** — concorrência estruturada deliberadamente coloca a espera de volta no chamador (barata, porque o chamador costuma ser uma thread virtual) em vez de compor callbacks, e hábitos de code review construídos em torno de pipelines não bloqueantes tendem a sinalizar isso como uma regressão à primeira vista.

## Documentation Links

- [JEP 505: Structured Concurrency (Fifth Preview)](https://openjdk.org/jeps/505) — doc
- [StructuredTaskScope — Java SE 25 API docs (preview)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html) — doc
- [JEP 506: Scoped Values](https://openjdk.org/jeps/506) — doc
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
