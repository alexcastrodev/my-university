---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Files and databases cover most batch input, but sometimes the data lives behind an existing Spring service, arrives on a JMS destination, or sits in a source Spring Batch ships no reader for. All three cases still reduce to the same one-method contract: `ItemReader<T>.read()` returns the next item, or `null` at end of input, feeding one item at a time into a chunk step (see `spring-batch-chunk-processing`). This concept covers three ways to source such input — reusing a bean method, draining a queue, and hand-writing a reader.

`ItemReaderAdapter` turns any existing bean method into a reader; `JmsItemReader` pulls one message per `read()`; and a custom `ItemReader` implements the contract directly, adding `ItemStream` when it must be restartable. Unlike `FlatFileItemReader` (`spring-batch-reading-flat-files`) or the JDBC/JPA cursor and paging readers (`spring-batch-database-item-readers`), the adapter and JMS readers do not automatically persist their position, so restart-where-you-stopped is something you either forgo or implement yourself against the execution context.

## Use Cases

- Reusing an existing `ProductService` (a POJO, a DAO, or a remote EJB3 proxy) that already returns domain objects, instead of duplicating its data-access logic inside a reader.
- Draining a JMS queue or topic during a scheduled batch window to throttle costly processing, rather than reacting to every message the instant it arrives.
- Reading from a source with no built-in reader — listing files in a directory, walking an in-memory structure, or paging a remote web API.
- Making a hand-written reader restartable so a failed job resumes at the next unread item rather than re-reading everything from the top.

## Deep Dive

### Reusing a Spring service as a reader: `ItemReaderAdapter`

`ItemReaderAdapter` delegates each `read()` to a configured method on a target bean. The contract is narrow: the delegate method must take **no parameters** and return **one item** of the reader's type (or `null` at end). Because services usually hand back a whole `List`, you wrap the service in a thin adapter that doles out elements one at a time:

```java
public class ProductServiceAdapter implements InitializingBean {
    private ProductService productService;
    private List<Product> products;

    public void afterPropertiesSet() {
        this.products = productService.getProducts();   // load once at startup
    }

    public Product nextProduct() {                      // no args, one item or null
        return products.isEmpty() ? null : products.remove(0);
    }

    public void setProductService(ProductService productService) {
        this.productService = productService;
    }
}
```

`targetObject` plus `targetMethod` are the entire wiring — on each `read()` the adapter invokes `nextProduct()` and returns its result:

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.adapter.ItemReaderAdapter">
  <property name="targetObject" ref="productServiceAdapter"/>
  <property name="targetMethod" value="nextProduct"/>
</bean>

<bean id="productServiceAdapter"
      class="com.manning.sbia.reading.service.ProductServiceAdapter">
  <property name="productService" ref="productService"/>
</bean>
```

The same reader config works for a remote EJB3 if you swap the delegate for a `<jee:remote-slsb>` proxy — Spring Remoting (Hessian/Burlap) makes the remote service look local. The catch: the delegate is entirely outside Spring Batch, so nothing is written to the execution context and this reader is **not restartable**.

### Reading from a queue: `JmsItemReader`

Spring Batch layers its JMS support on Spring's `JmsTemplate`. Each `read()` receives one message payload from the template's default destination:

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.jms.JmsItemReader">
  <property name="itemType" value="com.manning.sbia.reading.Product"/>
  <property name="jmsTemplate" ref="jmsTemplate"/>
</bean>

<bean id="jmsTemplate" class="org.springframework.jms.core.JmsTemplate">
  <property name="connectionFactory" ref="jmsFactory"/>
  <property name="defaultDestination" ref="productDestination"/>
  <property name="receiveTimeout" value="500"/>
  <property name="sessionTransacted" value="true"/>
</bean>
```

`itemType` tells the reader the payload class (set it to `Message` to get the raw JMS message). Why read a queue from a batch at all, when JMS is event-driven? To **throttle**: you postpone expensive processing to a chosen window (nightly, every ten minutes) and pace hardware load instead of processing each arrival immediately.

The transactional caveat matters here. JMS consumption is transactional, so a chunk that rolls back can cause the same message to be **redelivered** — the `ItemReader.read()` contract itself warns that "in a transactional setting, [the] caller might get the same item twice ... if the first call was in a transaction that rolled back." A JMS-fed step must therefore tolerate duplicates with idempotent writes or dedup keys, which ties directly to retry and skip handling (`spring-batch-fault-tolerant-step-configuration`).

### Writing a custom `ItemReader` (and making it restartable)

When no built-in reader fits, implement `ItemReader<T>` directly. The whole contract is one method: return items one by one, and `null` to signal end-of-input. Spring Batch calls `read()` until it returns `null`:

```java
public class ListDirectoryItemReader implements ItemReader<File> {
    private final List<File> files;

    public ListDirectoryItemReader(File directory) {
        if (directory == null || !directory.isDirectory()) {
            throw new IllegalArgumentException("The specified file must be a directory.");
        }
        this.files = new ArrayList<>(Arrays.asList(directory.listFiles()));
    }

    public File read() {
        return files.isEmpty() ? null : files.remove(0);
    }
}
```

This works, but it is stateful and forgets its position: on restart it starts over. To resume where it left off, also implement `ItemStream` — or the combined `ItemStreamReader` — which adds three lifecycle hooks around `read()` that save and restore position in the step's `ExecutionContext`:

```java
public class ListDirectoryItemReader implements ItemStreamReader<File> {
    private static final String INDEX_KEY = "current.index";
    private List<File> files;
    private int currentIndex = 0;

    public File read() {
        return currentIndex < files.size() ? files.get(currentIndex++) : null;
    }

    public void open(ExecutionContext ctx) throws ItemStreamException {
        currentIndex = ctx.containsKey(INDEX_KEY) ? (int) ctx.getLong(INDEX_KEY) : 0;
    }

    public void update(ExecutionContext ctx) throws ItemStreamException {
        ctx.putLong(INDEX_KEY, currentIndex);          // persisted at each chunk commit
    }

    public void close() throws ItemStreamException { }
}
```

Spring Batch calls `open` once when the step starts (restoring `current.index` if a prior run stored it), `update` at every chunk commit (so the latest position is saved inside the same transaction), and `close` at the end. Because the position rides in the persisted `ExecutionContext` — the same mechanism the built-in file and database readers use (`spring-batch-reading-flat-files`, `spring-batch-database-item-readers`) and that step/job listeners can also read (`spring-batch-execution-listeners`) — a restart resumes at the next unread item. The adapter and JMS readers above skip this bookkeeping, so they are not restartable out of the box.

### Book vs. today: contracts unchanged, classes relocated in 6.0

Two things are worth flagging since 2012 (the book targets Spring Batch 2.x with XML config).

First, the abstractions carry over unchanged: `ItemReaderAdapter`, the `read()`-returns-`null` contract, and `ItemStream`/`ItemStreamReader` (`open`/`update`/`close`) all still work the same way. What changed is where they live. Spring Batch 6.0 moved the infrastructure item classes out of `org.springframework.batch.item.*` into `org.springframework.batch.infrastructure.item.*`, so today it is `org.springframework.batch.infrastructure.item.adapter.ItemReaderAdapter`, `...infrastructure.item.jms.JmsItemReader`, and `...infrastructure.item.ItemStreamReader` (the pre-6.0 Javadoc paths now 404). Config style also shifted: the XML `batch:` namespace is deprecated in 6.0, so you register these readers as Java `@Bean`s (setting `targetObject`/`targetMethod` via setters for the adapter). `JmsItemReader` additionally gained a constructor that injects the `JmsOperations` template (since 6.0), reflecting 6.0's move toward constructor injection, though its `jmsTemplate` setter remains.

Second, `JmsItemReader` still ships in 6.0, but pulling messages through a batch reader is niche today. Message-driven ingestion is usually handled by Spring's messaging stack — an `@JmsListener` or a Spring Cloud Stream binder — that lands messages in a store (a table, a log, object storage), which a plain database or file batch then reads with a restartable reader. That keeps the step restartable and idempotent instead of fighting JMS redelivery inside the chunk. Confirmed via the Spring Batch 6.0.x API Javadoc for `ItemReaderAdapter` and `JmsItemReader` (both now under `org.springframework.batch.infrastructure.item.*`) and the Spring Batch reference "Creating Custom ItemReaders and ItemWriters".

## Trade-offs

- **`ItemReaderAdapter` reuse vs. no restart** — Wrapping an existing service is near-zero code and avoids duplicating data-access logic, but the delegate lives outside Spring Batch, so nothing is written to the execution context; a mid-run failure restarts the read from scratch. Fine for small or idempotent loads, risky for long ones.
- **Load-once vs. stream** — The book's adapter loads the whole `getProducts()` result into memory in `afterPropertiesSet()` and hands out elements; that is simple but defeats streaming and can exhaust the heap on large sets. A delegate that genuinely pages or streams one item per call scales far better.
- **JMS reader vs. message-driven + store** — A `JmsItemReader` lets a scheduled batch throttle message processing, but a rolled-back chunk can redeliver messages, forcing idempotent writes and duplicate handling. Landing messages in a store via `@JmsListener`/Spring Cloud Stream and batching over that store sidesteps redelivery and keeps the step cleanly restartable.
- **Custom `ItemReader` vs. `ItemStreamReader`** — Implementing only `read()` is the least code and is perfectly correct for stateless sources; the reference guide recommends staying stateless when you can. Add `ItemStream` only when resume-where-it-stopped matters, since you then own the `open`/`update`/`close` bookkeeping and its correctness.
- **Build vs. reuse a reader** — Before writing a custom reader, check the built-ins (flat file, XML, JDBC/JPA, adapter); a custom reader means you own paging, buffering, and restart semantics the shipped readers already provide. Reach for custom only when no built-in source fits.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 5, "Reading data", sections 5.6-5.8, "Services as input" / "Reading from JMS" / "Implementing custom readers", p. 151-156 — doc
- [Spring Batch Reference — Creating Custom ItemReaders and ItemWriters](https://docs.spring.io/spring-batch/reference/readers-and-writers/custom.html) — doc
- [Spring Batch 6.0 API — ItemReaderAdapter (org.springframework.batch.infrastructure.item.adapter)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/adapter/ItemReaderAdapter.html) — doc
- [Spring Batch 6.0 API — JmsItemReader (org.springframework.batch.infrastructure.item.jms)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/jms/JmsItemReader.html) — doc
