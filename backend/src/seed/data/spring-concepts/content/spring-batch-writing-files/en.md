---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Writing is the final phase of chunk-oriented processing, and Spring Batch models it with one contract that mirrors the reader: `ItemWriter<T>`. Where the reader's `read()` returns one item at a time, the writer's `write(...)` receives the *entire chunk* as a list in a single call, once per transaction. That single-call-per-chunk shape is the whole point — it lets a writer batch its I/O (one JDBC batch, one buffer flush, one commit) instead of paying a round-trip per item. This concept covers writing to files: delimited and fixed-width flat files, XML, and rolling file sets.

For flat files, `FlatFileItemWriter` is the exact inverse of the reader's tokenize-then-map pipeline: a `FieldExtractor` turns each item into an array of field values, and a `LineAggregator` joins that array into a line. Swapping aggregators and extractors covers delimited vs. fixed-width output, computed fields, and per-type formatting, while optional header/footer callbacks and transactional buffering round out the file. `StaxEventItemWriter` does the same job for XML through a Spring OXM marshaller, and `MultiResourceItemWriter` rolls output across a set of files. The writer is the sink end of a chunk step (`spring-batch-chunk-processing`), and its output resource is typically late-bound to a job parameter (`spring-batch-step-scope-and-spel-late-binding`).

## Use Cases

- Exporting a processed product catalog to a comma-delimited CSV whose columns and order you control by name.
- Producing a fixed-width extract for a downstream mainframe, each field padded with `java.util.Formatter` patterns.
- Emitting a header line plus a footer that reports the run's write count and elapsed time.
- Marshalling domain objects into one streamed XML document under a chosen root tag.
- Splitting a very large export into capped N-item files (`products.xml.1`, `.2`, …) for downstream consumers.

## Deep Dive

### The `ItemWriter` contract: a whole chunk per `write`

The write phase hangs off one small interface. The 2012 book shows it taking a `List`:

```java
public interface ItemWriter<T> {
    void write(List<? extends T> items) throws Exception;
}
```

`write` is called **once per chunk**, not once per item — the mirror image of the reader's per-item `read()` (`spring-batch-reading-flat-files`). Spring Batch reads and (optionally) processes items one at a time, accumulates them, and then hands the finished list to the writer exactly once, right before it commits the chunk's transaction. Most writers "write a set of items all at once," which is precisely why the parameter is a list: a JDBC writer can issue one batched `PreparedStatement`, and a file writer can flush its buffer a single time. It is each writer's job to flush if applicable (a `FlatFileItemWriter` flushes the underlying stream; `HibernateItemWriter` flushes the session), after which Spring Batch commits. The chunk size — hence how many items land in each `write` — is the commit interval (`spring-batch-chunk-processing`):

```xml
<tasklet>
  <chunk reader="itemReader" writer="itemWriter" commit-interval="100"/>
</tasklet>
```

(The parameter type was renamed from `List` to `Chunk<? extends T>` in modern Spring Batch — see *Book vs. today*.)

### `FlatFileItemWriter`: the exact inverse of the reader

`FlatFileItemWriter` implements `ItemWriter` and `ItemStream`, and writes a file in three steps: an optional header (on stream `open`), one aggregated line per item, and an optional footer (on stream `close`). Turning an item into a line is the reverse of reading: the reader used a `LineTokenizer` to split a line into a `FieldSet` and a `FieldSetMapper` to build the object; the writer uses a `FieldExtractor` to pull the object apart into an `Object[]`, and a `LineAggregator` to join that array into a `String`.

```java
public interface LineAggregator<T> { String aggregate(T item); }
public interface FieldExtractor<T>  { Object[] extract(T item); }
```

A minimal delimited writer wires a `DelimitedLineAggregator` (default delimiter is the comma) around a `BeanWrapperFieldExtractor`, which names the properties to output and reflectively calls their getters — so you decide exactly which fields, and in which order, appear on the line:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.file.FlatFileItemWriter">
  <property name="resource" value="file:target/outputs/products.txt"/>
  <property name="shouldDeleteIfExists" value="true"/>
  <property name="lineAggregator">
    <bean class="org.springframework.batch.item.file.transform.DelimitedLineAggregator">
      <property name="delimiter" value=","/>
      <property name="fieldExtractor">
        <bean class="org.springframework.batch.item.file.transform.BeanWrapperFieldExtractor">
          <property name="names" value="id,price,name"/>
        </bean>
      </property>
    </bean>
  </property>
</bean>
```

`lineAggregator` is the one required property; `PassThroughLineAggregator` (a bare `toString()`) is the fallback when you have no field-level control to exert. For fixed-width output you swap in a `FormatterLineAggregator`, whose `format` is a `java.util.Formatter` pattern — `%-9s%6.2f%-30s` means a 9-char left-justified id, a 6-char price with 2 decimals, then a 30-char left-justified name. When the output needs derived columns, implement `FieldExtractor` directly:

```java
public class ProductFieldExtractor implements FieldExtractor<Product> {
    public Object[] extract(Product item) {
        return new Object[] { "BEGIN", item.getId(), item.getPrice(),
                item.getPrice().multiply(new BigDecimal("0.15")), // computed tax
                item.getName(), "END" };
    }
}
```

For a file that mixes types (phones and books), a custom `LineAggregator` can delegate to a per-`Class` map of aggregators — the write-side analogue of the reader's `PatternMatchingCompositeLineMapper`.

### Headers, footers, and transactional output

A header is written before any item, a footer after the last one, through the single-method callbacks `FlatFileHeaderCallback` (`writeHeader(Writer)`) and `FlatFileFooterCallback` (`writeFooter(Writer)`). A footer usually reports run statistics, so it needs the `StepExecution` — the callback also implements `StepExecutionListener` to capture it:

```java
public class ProductFooterCallback implements FlatFileFooterCallback, StepExecutionListener {
    private StepExecution stepExecution;
    public void writeFooter(Writer writer) throws IOException {
        writer.write("# Write count: " + stepExecution.getWriteCount());
    }
    public void beforeStep(StepExecution stepExecution) { this.stepExecution = stepExecution; }
}
```

(The book extends `StepExecutionListenerSupport`, a convenience base that Spring Batch 6.0 removes now that the listener interfaces carry default methods — implement the interface directly.) Register the callback as a step listener *and* set it as the writer's `footerCallback`.

Two properties govern the file's lifecycle: `shouldDeleteIfExists` (default `true`, so each run starts fresh) and `appendAllowed` (default `false`; set it to append to an existing file instead). The third, `transactional` (default `true`), is what makes file output safe inside a chunk: the writer buffers the chunk's aggregated lines and only writes them to the OS when the transaction commits, discarding the buffer on rollback so a failed chunk never leaves half-written or duplicated lines. The `ItemWriter` Javadoc states the same rule — `write` "is responsible for making sure that any internal buffers are flushed [and] to discard the output on a subsequent rollback."

### Writing XML with `StaxEventItemWriter`

`StaxEventItemWriter` is the write-side symmetry of `StaxEventItemReader` (`spring-batch-reading-xml-and-multiple-resources`). It streams with StAX (so heap stays flat regardless of output size) and delegates each object → XML conversion to a Spring OXM `Marshaller`, wrapping every fragment inside `rootTagName`:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.xml.StaxEventItemWriter">
  <property name="resource" value="file:target/outputs/products.xml"/>
  <property name="marshaller" ref="productMarshaller"/>
  <property name="rootTagName" value="products"/>
  <property name="overwriteOutput" value="true"/>
</bean>

<bean id="productMarshaller" class="org.springframework.oxm.xstream.XStreamMarshaller">
  <property name="aliases">
    <map><entry key="product" value="com.manning.sbia.ch06.Product"/></map>
  </property>
</bean>
```

The result is a `<products>` root holding one `<product>` element per item. Headers and footers here implement `StaxWriterCallback` and build events with an `XMLEventFactory` (for example a `generated` attribute or a `<writeCount>` element), reaching the `StepExecution` the same listener way as the flat-file footer. Like the flat-file writer, it honors `transactional` buffering. The book wires an `XStreamMarshaller` because it needs no annotations, but XStream's deserialization CVE history makes JAXB the safer default today — the same trade-off covered on the read side.

### Writing file sets with `MultiResourceItemWriter`

When one enormous output file is undesirable, `MultiResourceItemWriter` rolls to a new file every N items. It writes nothing itself: it injects a fresh `Resource` into a `delegate` (any `ResourceAwareItemWriterItemStream` — a `StaxEventItemWriter` here, or a `FlatFileItemWriter`) each time `itemCountLimitPerResource` is reached.

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.file.MultiResourceItemWriter" scope="step">
  <property name="resource" value="file:target/outputs/products-multi.xml"/>
  <property name="itemCountLimitPerResource" value="10000"/>
  <property name="delegate" ref="delegateWriter"/>
</bean>
```

With 40,100 items and a limit of 10,000 you get five files — four of 10,000 and one of 100. By default filenames are suffixed with a numeric index (`products-multi.xml.1`, `.2`, …); supply your own scheme with a `ResourceSuffixCreator`:

```java
public interface ResourceSuffixCreator { String getSuffix(int index); }
```

One subtlety: the roll-over happens on a **chunk boundary**, not mid-chunk — a new resource is created after the commit interval *once* the count is reached, so the commit interval interacts with where files split. This is the output counterpart of `MultiResourceItemReader` (`spring-batch-reading-xml-and-multiple-resources`), and works for flat files just as well as XML.

### Book vs. today: builders replace the XML (and the 6.0 package move)

Since **Spring Batch 4** (`FlatFileItemWriterBuilder` and `StaxEventItemWriterBuilder` are both `@since 4.0`), fluent builders replace the `<bean>` wiring: `.delimited()`/`.formatted()` build the aggregator + `BeanWrapperFieldExtractor` for you, and `.names(...)` sets the fields.

```java
@Bean
public FlatFileItemWriter<Product> productItemWriter(WritableResource out) {
    return new FlatFileItemWriterBuilder<Product>()
            .name("productItemWriter")
            .resource(out)
            .shouldDeleteIfExists(true)
            .delimited().delimiter(",")
            .names("id", "price", "name")
            .build();                      // .formatted().format("%-9s%6.2f%-30s") for fixed-width
}

@Bean
public StaxEventItemWriter<Product> productXmlWriter(WritableResource out, Marshaller marshaller) {
    return new StaxEventItemWriterBuilder<Product>()
            .name("productXmlWriter")
            .resource(out).marshaller(marshaller)
            .rootTagName("products").overwriteOutput(true)
            .build();
}
```

Two version facts to cite accurately. First, the contract itself: Spring Batch **5.0** replaced the `List` parameter with a `Chunk`, and **6.0** relocated the infrastructure classes out of `org.springframework.batch.item.*` (those pre-6.0 paths now 404):

```java
package org.springframework.batch.infrastructure.item;   // was org.springframework.batch.item

public interface ItemWriter<T> {
    void write(Chunk<? extends T> chunk) throws Exception;
}
```

So today `FlatFileItemWriter` and `MultiResourceItemWriter` live in `org.springframework.batch.infrastructure.item.file`, `StaxEventItemWriter` in `org.springframework.batch.infrastructure.item.xml`, and the builders under the matching `...builder` sub-packages. Second, the `batch:` XML namespace used throughout the book is deprecated as of 6.0 (removal planned for 7.0), so Java config plus builders is the recommended style rather than an optional convenience. Confirmed via the Spring Batch 6.0.x API Javadoc (`ItemWriter`, `FlatFileItemWriter`, `StaxEventItemWriter`, `MultiResourceItemWriter`, `FlatFileItemWriterBuilder`, `StaxEventItemWriterBuilder`) and the Spring Batch reference (Flat Files; XML Item Readers and Writers).

## Trade-offs

- **Delimited vs. fixed-width output** — `DelimitedLineAggregator` is compact and tolerant of varying field lengths but breaks if the data contains an unescaped delimiter; `FormatterLineAggregator` is positionally self-describing and delimiter-safe but larger, and brittle if a column width ever shifts. Match the aggregator to the consumer, not to taste.
- **`BeanWrapperFieldExtractor` vs. a custom `FieldExtractor`** — the bean-wrapper extractor is zero-code when you just name existing properties, but it can only emit values that already exist as getters. A hand-written extractor is more code yet lets you reorder, add markers, or compute fields the object does not store:
  ```java
  return new Object[] { item.getId(), item.getPrice().multiply(TAX_RATE) }; // derived column
  ```
- **Transactional writing on vs. off** — `transactional=true` buffers each chunk and discards it on rollback, so a failed chunk never leaves torn or duplicated lines; the cost is holding the chunk's lines in memory until commit. Turning it off streams straight through, trading that safety for slightly less buffering.
- **One file vs. a file set** — a single writer is the simplest thing that works; `MultiResourceItemWriter` bounds file size for downstream tools, but it only splits on chunk boundaries and adds index-suffixed filenames that consumers must glob and order.
- **XStream vs. JAXB marshaller** — `XStreamMarshaller` needs no annotations (just an alias map) and is fastest to wire, but is untyped and carries XStream's deserialization-CVE history; `Jaxb2Marshaller` requires bound classes yet is type-checked and the recommended default — the same read/write symmetry noted in `spring-batch-reading-xml-and-multiple-resources`.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 6, "Writing data", sections 6.1-6.2, "Data-writing concepts" / "Writing files", p. 158-179 — doc
- [Spring Batch Reference — Flat Files (`FlatFileItemWriter`)](https://docs.spring.io/spring-batch/reference/readers-and-writers/flat-files.html) — doc
- [Spring Batch Reference — XML Item Readers and Writers (`StaxEventItemWriter`)](https://docs.spring.io/spring-batch/reference/readers-and-writers/xml-reading-writing.html) — doc
