---
version: 1.0
updatedAt: 2026-08-18
title: CompletableFuture: Compondo Trabalho Assíncrono
summary: Como thenApply, thenCompose, thenCombine, allOf e os handlers de exceção compõem trabalho assíncrono sem bloquear — e as armadilhas de futures aninhados, common pool e exceções engolidas que vêm junto.
---
## Objective

`CompletableFuture<T>` é três coisas ao mesmo tempo. Ele *é* um `Future<T>`, então ainda tem `get()` e `cancel()`. É um **pipeline componível**: `thenApply()`, `thenCompose()`, `thenCombine()`, `exceptionally()` e companhia anexam trabalho que roda *quando* o valor chega, sem uma thread ficar bloqueada esperando por ele. E — a parte de onde vem o nome — é **completável de fora**: qualquer um que segure o objeto pode chamar `complete(value)` ou `completeExceptionally(ex)`, enquanto um `Future` comum só é completado pela tarefa que o produziu, de dentro do executor. Juntando tudo isso, temos um objeto de primeira classe representando "um valor que vai existir eventualmente", que você pode transformar, combinar e reagir a ele como uma variável comum. O conceito [[concurrency-utilities-executors-and-synchronizers]] defende usá-lo em vez do `Future` cru; este aqui é sobre a mecânica de composição em si.

## Use Cases

- Disparar várias chamadas assíncronas *independentes* — um serviço de usuário, um serviço de preços, um serviço de estoque — e combinar seus resultados quando todas terminarem, via `thenCombine()` para duas ou `allOf()` para várias.
- Encadear uma sequência de passos assíncronos *dependentes*, onde cada chamada precisa do resultado da anterior até para saber o que pedir: buscar o id da conta, depois buscar os pedidos dessa conta, depois enriquecer cada pedido. Isso é `thenCompose()`.
- Anexar tratamento de erro como parte do pipeline (`exceptionally()`, `handle()`) em vez de embrulhar um `get()` bloqueante em `try`/`catch` — o fallback fica junto do passo que ele protege, e a thread chamadora nunca bloqueia para saber da falha.
- Iniciar trabalho assíncrono a partir de um método por outro lado síncrono sem bloquear o chamador: um controller Spring MVC pode `return CompletableFuture<Response>` e o container de servlet libera a thread da requisição até o future completar.
- Fazer a ponte entre uma API baseada em callback ou listener (um handler NIO antigo, um par `onSuccess`/`onError` de um driver) e algo componível, entregando ao callback um `CompletableFuture` vazio para ele mesmo chamar `complete()`.

## Deep Dive

### Criando um: `supplyAsync`, `runAsync` e conclusão manual

```java
import java.util.concurrent.*;

// Returns a value. Runs on ForkJoinPool.commonPool() by default.
CompletableFuture<Integer> price = CompletableFuture.supplyAsync(() -> computePrice("SKU-1"));

// No return value — a side effect only.
CompletableFuture<Void> logged = CompletableFuture.runAsync(() -> auditLog("priced SKU-1"));

// Already-known value, no async work at all (useful in tests and cache hits).
CompletableFuture<Integer> cached = CompletableFuture.completedFuture(42);
```

Tanto `supplyAsync` quanto `runAsync` recebem um segundo argumento opcional, um `Executor`. **Sem ele, o trabalho roda no `ForkJoinPool.commonPool()` compartilhado** — o mesmo pool que `parallelStream()` usa (veja [[fork-join-framework]]). Esse padrão é ótimo para transformações curtas e não bloqueantes, e uma armadilha real para qualquer coisa pesada de CPU ou bloqueante:

```java
ExecutorService io = Executors.newFixedThreadPool(16);

// Explicit pool: this call blocks on a socket, and it must not do that on the common pool.
CompletableFuture<String> body = CompletableFuture.supplyAsync(() -> httpGet(url), io);
```

A terceira forma de criação é o construtor nu, para fazer a ponte com uma API que só sabe te chamar de volta:

```java
CompletableFuture<Response> bridge(Request req) {
    CompletableFuture<Response> cf = new CompletableFuture<>();
    legacyClient.send(req, new Callback() {
        public void onSuccess(Response r) { cf.complete(r); }            // fulfils it
        public void onFailure(Throwable t) { cf.completeExceptionally(t); } // fails it
    });
    return cf;                       // returned before it has a value
}
```

`complete()` retorna `true` se essa chamada foi a que transicionou o future para concluído, `false` se ele já estava completo — então o primeiro chamador vence e os seguintes são silenciosamente ignorados, exatamente o que você quer quando um callback pode disparar um sucesso e um timeout correndo em paralelo.

### `thenApply` e `thenApplyAsync`: transformando o resultado

`thenApply(Function<T, U>)` produz um novo `CompletableFuture<U>` com o valor transformado. Nada bloqueia; a função roda depois, quando o future anterior completa.

```java
CompletableFuture<Integer> cents = CompletableFuture.supplyAsync(() -> fetchPriceString("SKU-1")) // "19.99"
        .thenApply(String::trim)
        .thenApply(s -> s.replace(".", ""))
        .thenApply(Integer::parseInt);   // CompletableFuture<Integer>, still not blocking

int value = cents.join();                // only here does the caller wait
```

A variante sem `Async` roda a função **em qualquer thread que tenha completado o future anterior** — ou na própria thread chamadora, se o future já estava completo quando `thenApply` foi invocado. Isso é barato e correto para mapeamentos triviais. Quando a transformação é trabalho de verdade, use `thenApplyAsync` para que ela seja entregue a um pool em vez de ocupar a thread de outra pessoa:

```java
// Bad: renderPdf() runs on the HTTP client's I/O callback thread, blocking its event loop.
CompletableFuture<byte[]> a = fetchInvoice(id).thenApply(inv -> renderPdf(inv));

// Good: the heavy step is dispatched to a pool chosen for it.
CompletableFuture<byte[]> b = fetchInvoice(id).thenApplyAsync(inv -> renderPdf(inv), renderPool);
```

Todo método de composição tem esse par: `thenAccept`/`thenAcceptAsync` (consome, retorna `Void`), `thenRun`/`thenRunAsync` (ignora o valor, roda um `Runnable`), e assim por diante.

### `thenCompose` vs `thenApply`: a armadilha do future aninhado

A distinção é inteiramente sobre o que sua função retorna. Se ela retorna um valor comum, use `thenApply`. Se ela retorna *outro* `CompletableFuture` — porque o próximo passo é em si assíncrono — `thenApply` embrulha esse future dentro do seu future e você acaba com um tipo duplamente aninhado:

```java
CompletableFuture<Long>    findAccountId(String email) { ... }
CompletableFuture<Account> loadAccount(long id)        { ... }

// Wrong: the function returns CompletableFuture<Account>, so thenApply gives you a future of a future.
CompletableFuture<CompletableFuture<Account>> nested =
        findAccountId(email).thenApply(id -> loadAccount(id));

Account a = nested.join().join();     // two joins — the smell that says you used the wrong method
```

`thenCompose` achata isso — a mesma relação que `flatMap` tem com `map` em um `Stream` ou um `Optional`:

```java
// Right: one future, one result type.
CompletableFuture<Account> account =
        findAccountId(email).thenCompose(id -> loadAccount(id));

CompletableFuture<List<Order>> orders =
        findAccountId(email)
            .thenCompose(id -> loadAccount(id))
            .thenCompose(acct -> loadOrders(acct.region(), acct.id()));  // each step needs the last
```

Note que a segunda chamada a `loadOrders` nem pode ser *iniciada* até `loadAccount` terminar — essa é a propriedade definidora de uma cadeia `thenCompose`, e a razão pela qual ela é a ferramenta errada para chamadas que não dependem umas das outras.

### `thenCombine`: juntando dois futures independentes

Quando duas chamadas não têm dependência entre si, elas deveriam rodar concorrentemente e só se encontrar no final. `thenCombine(other, BiFunction)` faz exatamente isso: os dois futures já estão em andamento, e a `BiFunction` roda assim que ambos terminam.

```java
CompletableFuture<User>  user  = CompletableFuture.supplyAsync(() -> fetchUser(id), io);
CompletableFuture<Quota> quota = CompletableFuture.supplyAsync(() -> fetchQuota(id), io);
// both HTTP calls are already running concurrently at this point

CompletableFuture<Dashboard> dash =
        user.thenCombine(quota, (u, q) -> new Dashboard(u, q));

Dashboard d = dash.join();   // total latency ≈ max(user, quota), not the sum
```

Compare as duas formas diretamente:

```java
// Dependent  — sequential by necessity: B needs A's result.       latency = A + B
findAccountId(email).thenCompose(id -> loadAccount(id));

// Independent — concurrent: neither needs the other's result.     latency = max(A, B)
fetchUser(id).thenCombine(fetchQuota(id), Dashboard::new);
```

Usar `thenCompose` onde `thenCombine` era o correto compila sem problemas e silenciosamente serializa duas chamadas que poderiam ter se sobreposto — um bug de latência sem nenhuma mensagem de erro.

### `allOf` e a pegadinha do `CompletableFuture<Void>`

`CompletableFuture.allOf(f1, f2, f3)` completa quando todos os argumentos tiverem completado. Ele **não** entrega os resultados — seu tipo de retorno é `CompletableFuture<Void>`, porque os argumentos são `CompletableFuture<?>` de tipos possivelmente diferentes e não há nada sensato para combiná-los:

```java
CompletableFuture<String>  a = CompletableFuture.supplyAsync(() -> callA(), io);
CompletableFuture<Integer> b = CompletableFuture.supplyAsync(() -> callB(), io);

CompletableFuture<Void> all = CompletableFuture.allOf(a, b);
// all.join() returns null — the results are still in a and b
```

O idioma correto é manter as referências originais e ler seus valores *depois* de `allOf` completar. Essas chamadas a `join()` não bloqueiam, porque `allOf` só completou depois que todos já haviam terminado:

```java
Report report = CompletableFuture.allOf(a, b)
        .thenApply(v -> new Report(a.join(), b.join()))   // safe: a and b are finished
        .join();
```

Para um fan-out homogêneo, colete os futures numa lista primeiro e depois faça um stream sobre ela:

```java
List<CompletableFuture<Price>> futures = skus.stream()
        .map(sku -> CompletableFuture.supplyAsync(() -> fetchPrice(sku), io))
        .toList();                                        // toList() first — all calls now in flight

List<Price> prices = CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
        .thenApply(v -> futures.stream().map(CompletableFuture::join).toList())
        .join();
```

O `.toList()` no primeiro pipeline é essencial: um stream preguiçoso só iniciaria cada `supplyAsync` conforme a operação terminal fosse puxando, anulando o efeito de fan-out.

### `anyOf`: o primeiro que vencer, ao custo do tipo

```java
CompletableFuture<String> replicaA = CompletableFuture.supplyAsync(() -> read("replica-a"), io);
CompletableFuture<String> replicaB = CompletableFuture.supplyAsync(() -> read("replica-b"), io);

CompletableFuture<Object> first = CompletableFuture.anyOf(replicaA, replicaB);
String winner = (String) first.join();   // cast required — anyOf is Object-typed
```

`anyOf` completa com o resultado de qualquer input que complete primeiro, sucesso *ou* falha — uma falha rápida vence um sucesso lento. E ele apenas ignora o perdedor; não o cancela, então a leitura mais lenta da réplica continua rodando até o fim em segundo plano.

### Falha: `exceptionally`, `handle` e `whenComplete`

Uma exceção lançada em qualquer ponto da cadeia pula todo `thenApply`/`thenCompose` a jusante e viaja até o primeiro handler capaz de lidar com ela.

```java
CompletableFuture<Price> priced = CompletableFuture.supplyAsync(() -> fetchPrice(sku), io)
        .exceptionally(ex -> Price.UNKNOWN);   // recover with a fallback; pipeline continues
```

- **`exceptionally(Function<Throwable, T>)`** — roda *apenas* em caso de falha, retorna um valor de substituição do mesmo tipo. O bloco `catch` do pipeline.
- **`handle(BiFunction<T, Throwable, U>)`** — roda em *ambos* os caminhos, recebendo `(result, null)` em caso de sucesso e `(null, throwable)` em caso de falha, e retorna um novo valor que pode mudar o tipo. É assim que se implementa "aconteça o que aconteça, produza isto" e ainda saber o que aconteceu.
- **`whenComplete(BiConsumer<T, Throwable>)`** — um observador. Ele vê o resultado mas não pode mudá-lo: o valor passa inalterado, e **uma falha ainda se propaga adiante** depois que o consumer roda. O bloco `finally` do pipeline.

```java
CompletableFuture<String> result = CompletableFuture.supplyAsync(() -> callService(), io)
        .whenComplete((v, ex) -> metrics.record(ex == null ? "ok" : "fail"))  // observes only
        .handle((v, ex) -> ex == null ? v : "degraded: " + ex.getMessage());  // decides the outcome
```

Se você trocar essas duas chamadas de posição, o comportamento muda de forma relevante: depois que `handle` recuperar o valor, `whenComplete` veria um estágio *bem-sucedido* e registraria `"ok"` para uma chamada que na verdade falhou.

Um detalhe que costuma pegar as pessoas: o `Throwable` entregue a um estágio *a jusante* geralmente é um `CompletionException` embrulhando a falha real, não a falha em si.

```java
.exceptionally(ex -> {
    // ex is CompletionException; the IOException you threw is one level down
    Throwable cause = (ex instanceof CompletionException ce) ? ce.getCause() : ex;
    log.warn("lookup failed", cause);
    return Price.UNKNOWN;
})
```

O Java 9 adicionou dois helpers de timeout no mesmo espírito — `orTimeout(2, TimeUnit.SECONDS)` faz o future falhar com um `TimeoutException` se ele não tiver completado a tempo, e `completeOnTimeout(fallback, 2, TimeUnit.SECONDS)` o completa com um valor padrão em vez disso.

### `get()` vs `join()`

Ambos esperam pelo resultado. Diferem apenas na disciplina de exceções:

| | lança em caso de falha | checada? |
|---|---|---|
| `get()` | `ExecutionException` (mais `InterruptedException`) | sim |
| `join()` | `CompletionException` | não |

Ambos embrulham a mesma exceção original, acessível via `getCause()`. Como as exceções de `get()` são checadas, ele não pode ser usado dentro de uma lambda que não as declare — que é o caso de toda operação de `Stream`:

```java
// Does not compile: unhandled ExecutionException / InterruptedException in the lambda.
List<Price> prices = futures.stream().map(CompletableFuture::get).toList();

// Compiles: join() throws only the unchecked CompletionException.
List<Price> prices = futures.stream().map(CompletableFuture::join).toList();
```

Essa é toda a razão de `join()` existir, e por que ele é o método a que você recorre dentro de pipelines. Reserve `get(timeout, unit)` para o caso em que você genuinamente precisa de uma espera limitada, já que `join()` não tem sobrecarga com timeout.

## Trade-offs

- **O `commonPool()` padrão é o pool errado para a maioria do trabalho real** — `supplyAsync` sem um `Executor` roda no `ForkJoinPool.commonPool()`, que é dimensionado como `availableProcessors() - 1` e compartilhado com todo `parallelStream()` da JVM. Uma tarefa bloqueante ou que satura a CPU ali faz o código de parallel-stream não relacionado morrer de fome, e esse código faz o mesmo com o seu. (Numa máquina de um único núcleo, o common pool tem paralelismo zero e cada tarefa ganha sua própria thread nova — comportamento diferente de novo, para o mesmo código-fonte.)
  ```java
  // 8 blocking calls on a 4-core box: the common pool has ~3 workers, so they queue,
  // and every parallelStream() elsewhere in the JVM queues behind them too.
  var futures = urls.stream().map(u -> CompletableFuture.supplyAsync(() -> httpGet(u))).toList();

  // Fix: give the blocking work its own executor.
  var futures = urls.stream().map(u -> CompletableFuture.supplyAsync(() -> httpGet(u), io)).toList();
  ```
- **Cadeias longas são genuinamente difíceis de debugar, não apenas verbosas** — essa é a crítica padrão e bem merecida da API. Cada estágio é uma lambda separada invocada de dentro da infraestrutura do pool, então um stack trace mostra a engrenagem do framework em vez do caminho que seu código percorreu, e nenhum breakpoint único fica "dentro" do fluxo. Código síncrono ganha um trace que se lê como o programa; um pipeline encadeado, não.
  ```text
  java.util.concurrent.CompletionException: java.lang.NumberFormatException: For input string: "n/a"
      at java.base/java.util.concurrent.CompletableFuture.encodeThrowable(...)
      at java.base/java.util.concurrent.CompletableFuture$UniApply.tryFire(...)
      at java.base/java.util.concurrent.CompletableFuture$AsyncSupply.run(...)
      at java.base/java.util.concurrent.ForkJoinTask$RunnableExecuteAction.exec(...)
  Caused by: java.lang.NumberFormatException: For input string: "n/a"
      at PriceService.lambda$quote$3(PriceService.java:41)   <- the only line that is yours
  ```
- **Uma exceção numa cadeia que ninguém aguarda simplesmente desaparece** — um `CompletableFuture` que falhou não imprime nada, não chega a um `UncaughtExceptionHandler` e não derruba a JVM. Ele fica ali guardando uma exceção que ninguém pediu. Composição do tipo "dispara e esquece" portanto perde falhas silenciosamente, a menos que você termine toda cadeia com `join()`/`get()` ou um handler explícito.
  ```java
  // Nothing is ever printed; the parse failure is stored in a future no one reads.
  CompletableFuture.supplyAsync(() -> "n/a")
                   .thenApply(Integer::parseInt)
                   .thenAccept(n -> cache.put(sku, n));   // never runs — and never complains

  // Fix: end every chain with a handler (or join it).
  CompletableFuture.supplyAsync(() -> "n/a")
                   .thenApply(Integer::parseInt)
                   .thenAccept(n -> cache.put(sku, n))
                   .exceptionally(ex -> { log.error("warm-up failed", ex); return null; });
  ```
- **`allOf`/`anyOf` perdem informação de tipo na fronteira da API** — `allOf` retorna `CompletableFuture<Void>` e `anyOf` retorna `CompletableFuture<Object>`, então o sistema de tipos para de ajudar exatamente onde um fan-out é mais propenso a erros. Ambos precisam do idioma auxiliar (manter referências, ou um cast) em vez de compor de forma limpa.
  ```java
  CompletableFuture<String> a = ..., b = ...;
  String s = CompletableFuture.anyOf(a, b).join();     // error: Object cannot be converted to String
  String t = (String) CompletableFuture.anyOf(a, b).join();  // the cast the API forces on you
  ```
- **Para fan-out com cancelamento, `StructuredTaskScope` hoje é a ferramenta com formato melhor** — um scope cancela automaticamente as ramificações perdedoras ou irmãs e amarra o ciclo de vida de cada subtarefa ao bloco que a envolve, exatamente o que `allOf`/`anyOf` não fazem (veja [[structured-concurrency]]). `CompletableFuture` continua sendo a escolha certa onde o trabalho é genuinamente independente, reativo, ou completado externamente — uma ponte de callback, um aquecimento de cache, um controller retornando um future para seu container — nenhum dos quais se encaixa num ciclo de vida limitado a um bloco.

## Documentation Links

- [CompletableFuture — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html) — doc
- [CompletionStage — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletionStage.html) — doc
- [ForkJoinPool.commonPool() — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ForkJoinPool.html#commonPool()) — doc
