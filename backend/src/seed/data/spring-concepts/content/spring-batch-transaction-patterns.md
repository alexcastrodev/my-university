---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Most steps touch a single transactional resource — one database — and the chunk transaction from `spring-batch-chunk-processing`, driven by the `DataSourceTransactionManager` covered in `spring-batch-transaction-configuration`, is enough. The hard case is a step that touches **two** transactional resources that must commit together or not at all. The classic example is reading an order from a JMS queue and writing it to a database in the same unit of work: if the database commit succeeds but the message is lost, or the message is consumed but the write fails, the two systems drift out of sync. A transaction that spans multiple resources is a *global* (or *distributed*) transaction, and enforcing the ACID properties across every participant is genuinely hard.

*Spring Batch in Action* lays out four patterns, from heavyweight-but-correct to cheap-but-approximate: (1) **global XA transactions** coordinated by a JTA transaction manager; (2) the **shared-resource** pattern that collapses two resources into one so a plain local transaction suffices; (3) the **best-effort 1PC** pattern that orders the JMS and database commits to shrink the failure window; and (4) **duplicate handling** — manual dedup or idempotency — to clean up after best-effort's residual risk. The `JmsItemReader` that feeds these steps is covered in `spring-batch-custom-and-service-readers`; here the focus is purely the transactional glue.

## Use Cases

- Reading orders from a JMS queue and updating an inventory table in one atomic step, so a crash never loses an order nor applies it twice.
- Spanning a transaction over two databases — for example, keeping Spring Batch's execution metadata in one schema and business data in another — while staying on local transactions.
- The money-transfer shape: debiting an account in one database and crediting another, where consistency (the "C" in ACID) spans both.
- Getting atomicity across a queue and a database *without* paying for an XA coordinator when throughput matters more than perfect exactly-once.
- Synchronizing a file flush with the database commit (the `FlatFileItemWriter` `transactional` flag) — the same best-effort idea applied to a file, since there is no XA over a filesystem.

## Deep Dive

### Global (XA) transactions: a `JtaTransactionManager` coordinates 2PC

When two real resources must be atomic, the textbook answer is XA — a two-phase commit driven by a JTA transaction manager. Spring hides it behind the `PlatformTransactionManager` abstraction; the JTA-backed implementation is `JtaTransactionManager`. Crucially, Spring does **not** provide a JTA manager — `JtaTransactionManager` is only a bridge to a real one (a Java EE server's, or a standalone provider such as Atomikos, or in 2012 Bitronix/JOTM). Each resource must expose an XA-aware driver — implementations of `javax.sql.XAConnection` / `XADataSource`, or an XA `ConnectionFactory` for JMS — so the coordinator can enlist it in the distributed transaction.

```xml
<!-- Bridge to a standalone JTA/XA coordinator (Atomikos, Narayana, ...) -->
<bean id="transactionManager"
      class="org.springframework.transaction.jta.JtaTransactionManager"/>

<job id="importOrdersJob" xmlns="http://www.springframework.org/schema/batch">
  <step id="importOrdersStep">
    <tasklet transaction-manager="transactionManager">
      <chunk reader="jmsReader" writer="databaseWriter"
             commit-interval="100" reader-transactional-queue="true"/>
    </tasklet>
  </step>
</job>
```

Point the tasklet's `transaction-manager` at the JTA bridge, and both the XA `ConnectionFactory` and the XA `DataSource` enlist automatically — the application writes no XA-specific code. The price is real: a coordinator to operate, XA drivers on every resource, precise transaction logs, and measurable overhead, because XA is inherently slower than a local transaction. Reach for it only when you truly need bulletproof atomicity and can afford the operational weight.

The book's first piece of advice, though, is to avoid this situation entirely. Local transactions — one resource, the application demarcating begin/commit/rollback directly — are the common case, and they are fast, simple, and reliable. Before adding a JTA coordinator, question whether you really need a second database or a JMS queue at all; the three patterns below all exist to keep you on local transactions wherever the topology allows.

### The shared-resource pattern: collapse two resources into one

The cheapest way to make a global transaction disappear is to arrange for the two "resources" to be the *same* physical resource. If both logical resources live in one database instance, a single **local** transaction covers everything — no coordinator, no XA, no 2PC. The book's example uses two Oracle schemas in one instance: schema A reaches schema B's tables through synonyms over the same connection.

```xml
<!-- One physical database instance behind one DataSource; schema A refers to
     schema B's tables via synonyms, so a single local transaction spans both. -->
<bean id="transactionManager"
      class="org.springframework.jdbc.datasource.DataSourceTransactionManager">
  <property name="dataSource" ref="dataSource"/>
</bean>
```

A common application is batch metadata: teams often want Spring Batch's `BATCH_*` tables kept apart from business data, yet the counts of skips and retries must commit atomically with the business write. Host both in one instance and you keep them separate *and* synchronized on the plain local `DataSourceTransactionManager` from `spring-batch-transaction-configuration`. The limits are engine-specific (synonyms, explicit schema prefixes), and it only works when the resources can genuinely share an instance — but when it fits, it out-throughputs XA with far less configuration.

### Best-effort 1PC: synchronize the JMS commit around the DB commit

When the two resources really are a JMS queue and a database, Spring offers a middle path. Tell the `JmsTemplate` to use a **local JMS transaction** (`sessionTransacted=true`) and Spring transparently *synchronizes* it with the chunk's database transaction, committing the JMS session immediately **after** the database commit. The book calls this the *best-effort* pattern.

```xml
<bean id="jmsTemplate" class="org.springframework.jms.core.JmsTemplate">
  <property name="connectionFactory" ref="connectionFactory"/>
  <property name="defaultDestination" ref="orderQueue"/>
  <property name="receiveTimeout" value="100"/>
  <property name="sessionTransacted" value="true"/>  <!-- local JMS transaction -->
</bean>

<bean id="jmsReader" class="org.springframework.batch.item.jms.JmsItemReader">
  <property name="jmsTemplate" ref="jmsTemplate"/>
  <property name="itemType" value="javax.jms.Message"/>  <!-- pass the raw Message -->
</bean>
```

Pair this with `reader-transactional-queue="true"` on the `<chunk>` so Spring Batch disables its read-ahead cache and lets rolled-back messages return to the queue for re-reading (see `spring-batch-custom-and-service-readers`). Because the JMS commit is ordered *after* the database commit, you never lose a message. But a small window remains: if the database commits and the JMS commit then fails (say, a network blip), the broker redelivers the message and the job processes it again — a **duplicate**. Best-effort trades XA's ironclad atomicity for one cheap local transaction plus a rare duplicate.

The same synchronization is not JMS-specific. Spring Batch applies best-effort thinking to file output too: the `FlatFileItemWriter` `transactional` flag holds writes in a buffer and flushes only after the chunk commit, since there is no XA over a database and a filesystem. Any resource with transaction-like semantics can join a database commit this way.

### Handling the duplicates: manual dedup or idempotency

Best-effort's residual risk is duplicates, and there are exactly two ways to neutralize them.

**Manual detection** — track processed messages in a table, in the same transaction as the write, then filter redeliveries out. The writer records each order id as it applies the change:

```java
public class InventoryOrderWriter implements ItemWriter<Order> {
    private final JdbcTemplate jdbcTemplate;

    public InventoryOrderWriter(DataSource dataSource) {
        this.jdbcTemplate = new JdbcTemplate(dataSource);
    }

    public void write(List<? extends Order> orders) {
        for (Order order : orders) {
            updateInventory(order);   // the business change
            track(order);             // dedup bookkeeping — SAME transaction
        }
    }

    private void track(Order order) {
        jdbcTemplate.update(
            "insert into inventory_order (order_id, processing_date) values (?, ?)",
            order.getOrderId(), new Date());
    }
    // updateInventory(...) subtracts the ordered quantities
}
```

An `ItemProcessor` then filters out anything already processed by returning `null`. The JMS `getJMSRedelivered()` flag is a cheap short-circuit, so only redeliveries incur the database check:

```java
public class DuplicateOrderItemProcessor implements ItemProcessor<Message, Order> {
    private final JdbcTemplate jdbcTemplate;

    public Order process(Message message) throws Exception {
        Order order = extractOrder(message);
        if (message.getJMSRedelivered() && alreadyProcessed(order)) {
            return null;              // drop the duplicate
        }
        return order;
    }

    private boolean alreadyProcessed(Order order) {
        return jdbcTemplate.queryForInt(
            "select count(1) from inventory_order where order_id = ?",
            order.getOrderId()) > 0;
    }
}
```

**Idempotency** — the better option when it applies: design the write so re-processing the same message changes nothing. Marking an order shipped is naturally idempotent, so no tracking table and no filtering processor are needed:

```java
public class ShippedOrderWriter implements ItemWriter<Order> {
    private final JdbcTemplate jdbcTemplate;

    public void write(List<? extends Order> orders) {
        for (Order order : orders) {
            jdbcTemplate.update(
                "update orders set shipped = true where order_id = ?",
                order.getOrderId());   // running it twice yields the same state
        }
    }
}
```

Two practical notes on the manual approach. The tracking insert **must** run inside the same database transaction as the business write, or a crash between them reopens the exact hole you were closing. And when there is no natural business key like `orderId`, fall back to the JMS message id as the deduplication key.

The lesson the book drives home: there is no free exactly-once. You pick at-least-once delivery plus idempotency (or dedup), and let those absorb the duplicates that best-effort admits.

### Book vs. today: XA endures, but distributed 2PC fell out of favor

The machinery still exists. `PlatformTransactionManager` and `JtaTransactionManager` remain in Spring, and `JtaTransactionManager` is still just a bridge to a real coordinator. The biggest mechanical change is the namespace: Jakarta EE renamed `javax.transaction` → `jakarta.transaction` (and `javax.jms` → `jakarta.jms`), the baseline for Spring Framework 6 / Spring Boot 3; only the JDK's `javax.sql.XAConnection` kept its name. The live standalone providers today are **Atomikos** and **Narayana** — the book's JOTM and Bitronix are effectively unmaintained. App-server JTA is also less common now: Spring Boot 3 dropped its embedded Atomikos/Bitronix JTA starters, so its JTA auto-configuration targets a transaction manager retrieved from JNDI (an app server), and standalone use means wiring a provider yourself.

What really shifted is taste. Modern distributed systems overwhelmingly **avoid** cross-resource 2PC and reach instead for idempotency, the *transactional outbox* pattern (write the business row and an outbox row in one local transaction, then relay the message afterward — see the `outbox-pattern` concept), or broker-native transactions such as Kafka's transactional / exactly-once semantics. Read that list again: it is essentially the book's own advice — prefer local transactions, use best-effort 1PC, and lean on dedup or idempotency — which is why chapter 9's guidance has aged remarkably well. Confirmed via the Spring Framework reference "Application server-specific integration" (`JtaTransactionManager`) and the Spring Boot reference "Distributed Transactions (JTA)".

## Trade-offs

- **Global XA — correct but heavy** — 2PC gives true ACID across every resource, but you must run a JTA coordinator, provide XA drivers everywhere, and accept transaction-log overhead and slower commits. Reserve it for when nothing cheaper will do.
- **Shared-resource — cheap but constrained** — a single local transaction and the best throughput, but only when both resources can live in one database instance; it leans on engine-specific features (Oracle synonyms, schema prefixes) and couples the schemas together.
- **Best-effort 1PC — pragmatic middle** — one local JMS transaction synchronized around the DB commit costs almost nothing and never loses a message, but the ordering gap admits rare duplicates. It requires `sessionTransacted=true` and `reader-transactional-queue="true"`.
- **Dedup vs. idempotency** — a tracking table plus a filtering processor works for any write but adds a table, extra code, and a query, and the tracking insert must share the write's transaction; idempotency needs none of that but only exists when the operation is naturally repeatable.
- **Exactly-once is a mirage** — across a broker and a database you get at-least-once (plus idempotency/dedup) or at-most-once; treat any design that claims perfect exactly-once across independent resources without a coordinator with suspicion.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 9, "Transaction management", section 9.4, "Transaction management patterns", p. 259-274 — doc
- [Spring Framework Reference — Application server-specific integration (JTA `JtaTransactionManager`)](https://docs.spring.io/spring-framework/reference/data-access/transaction/application-server-integration.html) — doc
- [Spring Boot Reference — Distributed Transactions with JTA](https://docs.spring.io/spring-boot/reference/io/jta.html) — doc
