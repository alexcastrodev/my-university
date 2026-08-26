---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Once you understand the file writers (`spring-batch-writing-files`) and database writers (`spring-batch-database-item-writers`), the last piece of the write side is *reusing* and *composing* writers. Every `ItemWriter<T>` still receives the **whole chunk at once**, so an advanced writer is either a thin bridge to code you already have, or a wrapper that hands that chunk to several other writers. This concept covers four moves: turning an existing service into a writer with `ItemWriterAdapter`, pushing items to niche targets (`JmsItemWriter`, `SimpleMailMessageItemWriter`), hand-writing a custom `ItemWriter`, and — the real payoff — fanning out or routing a chunk with `CompositeItemWriter` and `ClassifierCompositeItemWriter`.

`ItemWriterAdapter` is the exact write-side mirror of the reader adapter in `spring-batch-custom-and-service-readers`: the reader adapter calls a no-arg method that *returns* one item, while the writer adapter calls a one-arg method that *consumes* one item. Everything here still hangs off the chunk step (`spring-batch-chunk-processing`): the reader and processor fill a chunk, the advanced writer flushes or dispatches it, and the whole thing commits inside one transaction at the chunk boundary.

## Use Cases

- Reusing an existing `ProductService.write(product)` bean as the step's writer instead of writing a new class, when the persistence logic already lives in a service.
- Extracting several bean properties as separate arguments for a legacy multi-argument service method (`PropertyExtractingDelegatingItemWriter`).
- Fan-out: writing every processed item to a flat file **and** a relational table in one step (`CompositeItemWriter`).
- Routing: sending `C`/`U`/`D` (or valid vs. rejected) records to different destination writers based on a field (`ClassifierCompositeItemWriter`).
- Niche integration: dropping each item on a JMS queue (`JmsItemWriter`) or sending a welcome email per row (`SimpleMailMessageItemWriter`).

## Deep Dive

### Reusing a service as a writer: `ItemWriterAdapter`

If a plain bean already knows how to persist an item, `ItemWriterAdapter` delegates writing to it — for each item in the chunk it invokes one method, passing the item as the argument. The delegate is ordinary code with no Spring Batch types:

```java
public class ProductService {
    public void write(Product product) {   // one item in, void out
        // existing persistence / business logic
    }
}
```

You wire it with `targetObject` (the service) and `targetMethod` (the method name); the book uses XML:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.adapter.ItemWriterAdapter">
  <property name="targetObject" ref="productService"/>
  <property name="targetMethod" value="write"/>
</bean>
<bean id="productService" class="com.manning.sbia.ch06.service.ProductService"/>
```

This is the symmetric twin of `ItemReaderAdapter` (`spring-batch-custom-and-service-readers`): same `targetObject`/`targetMethod` wiring, opposite data direction. When the service method takes several primitive arguments rather than the item itself, switch to `PropertyExtractingDelegatingItemWriter`, which pulls named properties off the item and spreads them across the call — here `write(id, name, description, price)`:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.adapter.PropertyExtractingDelegatingItemWriter">
  <property name="targetObject" ref="productService"/>
  <property name="targetMethod" value="write"/>
  <property name="fieldsUsedAsTargetMethodArguments">
    <list><value>id</value><value>name</value><value>description</value><value>price</value></list>
  </property>
</bean>
```

Because the delegate lives outside Spring Batch, neither adapter records anything in the execution context — restartability is the delegate's own problem.

### Niche targets: JMS and email item writers

Two ready-made writers cover message and mail targets. `JmsItemWriter` sends each item to the default destination of a Spring `JmsTemplate`, so a step can publish products to a billing system with configuration only:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.jms.JmsItemWriter">
  <property name="jmsTemplate" ref="jmsTemplate"/>
</bean>
```

`SimpleMailMessageItemWriter` sends a `SimpleMailMessage` per item through a `MailSender`. Since the writer only *sends*, you pair it with an `ItemProcessor` that turns each domain object into a ready-to-send message, then wire the `mailSender`:

```xml
<bean id="mailMessageItemWriter"
      class="org.springframework.batch.item.mail.SimpleMailMessageItemWriter">
  <property name="mailSender" ref="javaMailSender"/>
</bean>
```

Both still ship today but are niche (see *Book vs. today*): email in particular is non-transactional, so a rolled-back chunk cannot un-send mail.

### Writing a custom `ItemWriter`: the `write(Chunk)` contract

When nothing built-in fits, implement the interface directly. The whole contract is one method that receives the chunk; you loop and persist. The book writes a JDBC upsert; here it is in the **modern** signature, which takes a `Chunk` instead of a `List`:

```java
public class JdbcProductItemWriter implements ItemWriter<Product> {
    private final JdbcTemplate jdbcTemplate;
    public JdbcProductItemWriter(JdbcTemplate jdbcTemplate) { this.jdbcTemplate = jdbcTemplate; }

    @Override
    public void write(Chunk<? extends Product> chunk) {   // was List<? extends Product> in the book
        for (Product item : chunk) {
            int updated = jdbcTemplate.update("UPDATE PRODUCT SET NAME=?, PRICE=? WHERE ID=?",
                    item.getName(), item.getPrice(), item.getId());
            if (updated == 0) {
                jdbcTemplate.update("INSERT INTO PRODUCT (ID, NAME, PRICE) VALUES (?, ?, ?)",
                        item.getId(), item.getName(), item.getPrice());
            }
        }
    }
}
```

For a database writer like this, restartability is a *reader* concern: the writer simply persists whatever the reader pushes, and a rolled-back chunk is re-read on restart. File-based writers are the ones that must resume mid-resource, which the shipped implementations already handle (`spring-batch-writing-files`).

### Fan-out with `CompositeItemWriter` vs. routing with `ClassifierCompositeItemWriter`

A chunk step allows exactly **one** writer, so writing to two targets means composing. `CompositeItemWriter` implements the Composite pattern: it holds an ordered list of delegates and passes **every** chunk to **all** of them, in order. Use it to write each item to more than one place — say a delimited file and a fixed-width file, or a file and a database:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.support.CompositeItemWriter">
  <property name="delegates">
    <list>
      <ref local="delimitedProductItemWriter"/>
      <ref local="fixedWidthProductItemWriter"/>
    </list>
  </property>
</bean>
```

`ClassifierCompositeItemWriter` does the opposite: it sends **each item to exactly one** delegate, chosen at runtime by a `Classifier`. Given an input carrying an `OPERATION` column (`C` create, `U` update, `D` delete), you route items to insert/update/delete writers. The book's router returns the operation key via the `@Classifier` annotation:

```java
public class ProductRouterClassifier {
    @Classifier
    public String classify(Product product) {
        return product.getOperation();   // "C", "U", or "D"
    }
}
```

A `BackToBackPatternClassifier` maps that key to a writer through its `matcherMap`, and the `ClassifierCompositeItemWriter` wraps it:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.support.ClassifierCompositeItemWriter">
  <property name="classifier">
    <bean class="org.springframework.batch.classify.BackToBackPatternClassifier">
      <property name="routerDelegate"><bean class="com.manning.sbia.ch06.advanced.ProductRouterClassifier"/></property>
      <property name="matcherMap">
        <map>
          <entry key="C" value-ref="insertJdbcBatchItemWriter"/>
          <entry key="U" value-ref="updateJdbcBatchItemWriter"/>
          <entry key="D" value-ref="deleteJdbcBatchItemWriter"/>
        </map>
      </property>
    </bean>
  </property>
</bean>
```

The contrast is the whole point: **composite = fan-out** (one item written N times, to N targets), **classifier = routing** (one item written once, to the target its classification picks). Both delegate to real writers such as the `JdbcBatchItemWriter` from `spring-batch-database-item-writers`.

### Book vs. today: the 6.0 relocation, `write(Chunk)`, and builders

Four changes matter since the book (Spring Batch 2.x, 2012). First, the **6.0 package relocation**: everything in `spring-batch-infrastructure` moved from `org.springframework.batch.*` to `org.springframework.batch.infrastructure.*`. So today it is `org.springframework.batch.infrastructure.item.adapter.ItemWriterAdapter`, `...infrastructure.item.support.CompositeItemWriter`, `...infrastructure.item.support.ClassifierCompositeItemWriter`, `...infrastructure.item.jms.JmsItemWriter`, and `...infrastructure.item.mail.SimpleMailMessageItemWriter` — the book's `org.springframework.batch.item.*` paths now 404.

Second, the write signature: `write(List<? extends T>)` (book) became `write(Chunk<? extends T>)` in **5.0**, where `Chunk` is `org.springframework.batch.infrastructure.item.Chunk`. Third, since **4.0** fluent builders replace the XML — `CompositeItemWriterBuilder` and `ClassifierCompositeItemWriterBuilder`, and the classifier is now usually a plain lambda instead of `BackToBackPatternClassifier`:

```java
@Bean
public ClassifierCompositeItemWriter<Product> productItemWriter(
        ItemWriter<Product> insert, ItemWriter<Product> update, ItemWriter<Product> delete) {
    Map<String, ItemWriter<? super Product>> routes = Map.of("C", insert, "U", update, "D", delete);
    return new ClassifierCompositeItemWriterBuilder<Product>()
            .classifier(product -> routes.get(product.getOperation()))   // org.springframework.classify.Classifier
            .build();
}
```

Fourth, the surrounding style: `javax.*` became `jakarta.*` in 5.0, and the XML `batch:` namespace is deprecated as of 6.0 (removal planned for 7.0), so Java config plus builders is the recommended form. Notably, the adapter and composite/classifier writers all carry over unchanged in behavior; the `Classifier`/`BackToBackPatternClassifier`/`@Classifier` types still exist but now live in spring-retry's `org.springframework.classify` package, not the book's `org.springframework.batch.classify`. The JMS and email writers also survive but are niche — message ingestion is typically handled by Spring's messaging stack today. Confirmed via the Spring Batch 6.0.x API Javadoc for `ItemWriterAdapter`, `CompositeItemWriter`, `ClassifierCompositeItemWriter`, `JmsItemWriter`, and `SimpleMailMessageItemWriter` (all under `org.springframework.batch.infrastructure.item.*`), the `CompositeItemWriterBuilder`/`ClassifierCompositeItemWriterBuilder` Javadoc, the Spring Batch 6.0 Migration Guide, and the spring-retry `org.springframework.classify` sources.

## Trade-offs

- **Fan-out vs. routing** — `CompositeItemWriter` writes every item to *all* delegates (multi-target duplication, e.g. file + DB); `ClassifierCompositeItemWriter` writes each item to *one* delegate chosen by a `Classifier` (partitioning, e.g. valid vs. rejected). Reach for composite when you want the same data in several places, classifier when different items belong in different places.
- **Adapter reuse vs. custom writer** — `ItemWriterAdapter` is near-zero code and reuses tested service logic, but the delegate is invisible to Spring Batch, so nothing is checkpointed and errors are per-item calls. A custom `ItemWriter` receiving the whole `Chunk` can batch the write into one round-trip and control transaction/flush behavior, at the cost of writing it yourself.
- **Composite ordering and rollback** — delegates fire in list order inside the one chunk transaction, so a database delegate rolls back cleanly, but a non-transactional delegate that ran earlier (a file line, a JMS send, an email) cannot be undone if a later delegate throws. Order transactional writes last, or accept the possibility of duplicate side effects on retry.
- **Classifier miss** — if the `Classifier` returns a key with no mapped writer, the item has nowhere to go; a `BackToBackPatternClassifier` needs a catch-all (`*`) entry or you risk a runtime failure on an unexpected value.
- **Niche writers, non-transactional targets** — `SimpleMailMessageItemWriter` and `JmsItemWriter` are convenient but sit outside the chunk transaction's guarantees (mail is not transactional; JMS may redeliver). Prefer landing items in a store and integrating asynchronously when correctness matters, rather than sending irreversible messages mid-chunk.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 6, "Writing data", sections 6.4-6.9, "Adapting existing services for reuse" … "Advanced writing techniques", p. 183-192 — doc
- [Spring Batch Reference — Creating Custom ItemReaders and ItemWriters](https://docs.spring.io/spring-batch/reference/readers-and-writers/custom.html) — doc
- [Spring Batch 6.0 API — ClassifierCompositeItemWriter (org.springframework.batch.infrastructure.item.support)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/support/ClassifierCompositeItemWriter.html) — doc
- [Spring Batch 6.0 API — CompositeItemWriter (org.springframework.batch.infrastructure.item.support)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/support/CompositeItemWriter.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
